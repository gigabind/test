// 抓取页面刷新期间的网络请求，重点找 country / geo / config 类接口，并检查响应体里有没有 CN / +86
import { connect, listPages, pickPage, attachPage, send, evaluate } from './cdp.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sel = process.argv[2] || 'paypal';
const waitMs = Number(process.argv[3] || 18000);

const ws = await connect();
const pages = await listPages(ws);
const t = pickPage(pages, sel);
const sid = await attachPage(ws, t.targetId);
console.error(`# 接管: ${t.title}\n# ${t.url}`);

const reqs = new Map();
ws.addEventListener('message', (ev) => {
  let m; try { m = JSON.parse(ev.data); } catch { return; }
  if (m.sessionId !== sid || !m.method) return;
  if (m.method === 'Network.requestWillBeSent') {
    const p = m.params;
    reqs.set(p.requestId, {
      id: p.requestId, url: p.request.url, method: p.request.method, type: p.type,
      postData: p.request.postData, start: p.timestamp,
    });
  } else if (m.method === 'Network.responseReceived') {
    const r = reqs.get(m.params.requestId);
    if (r) { r.status = m.params.response.status; r.mime = m.params.response.mimeType; }
  } else if (m.method === 'Network.loadingFinished') {
    const r = reqs.get(m.params.requestId);
    if (r) r.finished = true;
  }
});

await send(ws, 'Network.enable', { maxTotalBufferSize: 1e8, maxResourceBufferSize: 5e7 }, sid);
await send(ws, 'Page.enable', {}, sid);
console.error('# 刷新页面（忽略缓存）…');
await send(ws, 'Page.reload', { ignoreCache: true }, sid, 5000).catch(() => {});
await sleep(waitMs);

const all = [...reqs.values()];
const KEY = /country|geo|dial|region|config|locale|phone|hrd|signup|preferences|available/i;
const interesting = all.filter((r) => KEY.test(r.url) && !/\.(png|jpg|svg|woff2?|css|js)(\?|$)/i.test(r.url));

console.log(`=== 共捕获 ${all.length} 个请求，其中 country/geo/config 类 ${interesting.length} 个 ===\n`);
for (const r of interesting) {
  console.log(`[${r.status ?? '—'}] ${r.method} ${r.type} ${r.url.slice(0, 180)}`);
  if (r.postData) console.log(`       POST: ${r.postData.slice(0, 200)}`);
}

// 抓响应体，搜 CN / +86
mkdirSync('net', { recursive: true });
console.log('\n=== 响应体检查（CN / +86）===');
const CN_RE = /"(?:country|countryCode|isoCode|code)"\s*:\s*"CN"|"\+861?"|\+86\b|\bCHN\b/i;
for (const r of interesting) {
  if (!r.finished) { console.log(`↷ 未完成，跳过: ${r.url.slice(0, 100)}`); continue; }
  let body;
  try {
    const res = await send(ws, 'Network.getResponseBody', { requestId: r.id }, sid, 8000);
    body = res.base64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : res.body;
  } catch { continue; }
  if (!body) continue;
  const idx = body.search(CN_RE);
  const tag = idx >= 0 ? '★命中' : '无 CN';
  console.log(`[${tag}] ${r.url.split('?')[0].slice(0, 110)} (${body.length}B)`);
  const name = r.url.split('?')[0].replace(/[^a-z0-9]+/gi, '_').slice(-70) + '.txt';
  writeFileSync(`net/${name}`, body);
  if (idx >= 0) {
    console.log('   …' + body.slice(Math.max(0, idx - 200), idx + 200).replace(/\s+/g, ' ') + '…');
  }
}

// 顺带记录页面当前的 country/prefix 状态
const state = await evaluate(ws, `(() => {
  const p = document.querySelector('#paypalAccountData_ph___-prefix');
  const i = document.querySelector('input[autocomplete="tel-national"]') || document.querySelector('input[type="tel"]');
  return {
    url: location.href,
    contentCountry: (window.dataLayer && window.dataLayer.contentCountry) || null,
    prefixText: p ? p.textContent.trim() : null,
    inputValue: i ? i.value : null,
    inputInvalid: i ? i.getAttribute('aria-invalid') : null,
  };
})()`, sid).catch((e) => ({ error: e.message }));
console.log('\n=== 页面状态 ===');
console.log(JSON.stringify(state, null, 2));

ws.close();
setTimeout(() => process.exit(0), 50).unref();