// 抓取刷新期间所有 XHR/Fetch 响应体，落盘后按关键词检索
import { connect, listPages, pickPage, attachPage, send } from './cdp.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sel = process.argv[2] || 'paypal';
const waitMs = Number(process.argv[3] || 20000);

const ws = await connect();
const pages = await listPages(ws);
const t = pickPage(pages, sel);
const sid = await attachPage(ws, t.targetId);
console.error(`# 接管: ${t.url}`);

const reqs = new Map();
ws.addEventListener('message', (ev) => {
  let m; try { m = JSON.parse(ev.data); } catch { return; }
  if (m.sessionId !== sid || !m.method) return;
  const p = m.params;
  if (m.method === 'Network.requestWillBeSent') {
    reqs.set(p.requestId, { id: p.requestId, url: p.request.url, method: p.request.method, type: p.type, postData: p.request.postData });
  } else if (m.method === 'Network.responseReceived') {
    const r = reqs.get(p.requestId);
    if (r) { r.status = p.response.status; r.mime = p.response.mimeType; }
  } else if (m.method === 'Network.loadingFinished') {
    const r = reqs.get(p.requestId);
    if (r) r.finished = true;
  }
});

await send(ws, 'Network.enable', { maxTotalBufferSize: 3e8, maxResourceBufferSize: 8e7 }, sid);
await send(ws, 'Page.enable', {}, sid);
console.error('# 刷新（无视缓存）…');
await send(ws, 'Page.reload', { ignoreCache: true }, sid, 5000).catch(() => {});
await sleep(waitMs);

mkdirSync('net/all', { recursive: true });
const dataish = [...reqs.values()].filter((r) =>
  ['XHR', 'Fetch', 'Document'].includes(r.type) || /json/i.test(r.mime || '')
);

console.log(`=== XHR/Fetch/Document 共 ${dataish.length} 个 ===`);
const KEY = /phoneCountryCodes|paypalSupportedCountries|phoneMetadata|disablePhoneType|international_prefix/i;
const hits = [];

for (const r of dataish) {
  if (!r.finished) continue;
  let body;
  try {
    const res = await send(ws, 'Network.getResponseBody', { requestId: r.id }, sid, 8000);
    body = res.base64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : res.body;
  } catch { continue; }
  if (!body || body.length < 40) continue;

  const safe = (r.url.split('?')[0].replace(/[^a-z0-9]+/gi, '_') + '_' + r.id).slice(-90);
  writeFileSync(`net/all/${safe}.txt`, body);

  if (KEY.test(body)) {
    hits.push({ r, body });
    console.log(`★ [${r.status}] ${r.method} ${r.type} ${r.url.slice(0, 140)} (${body.length}B)`);
  }
}

console.log(`\n=== 命中含国家/区号配置的响应: ${hits.length} 个 ===`);
for (const { r, body } of hits) {
  console.log(`\n########## ${r.url.split('?')[0]} ##########`);
  for (const kw of ['phoneCountryCodes', 'paypalSupportedCountries', 'disablePhoneType', 'international_prefix']) {
    const i = body.indexOf(kw);
    if (i >= 0) console.log(`[${kw}] …${body.slice(Math.max(0, i - 120), i + 300).replace(/\s+/g, ' ')}…`);
  }
  const cn = body.indexOf('"CN"');
  console.log(`["CN" 出现位置]: ${cn >= 0 ? cn : '无'}`);
  if (cn >= 0) console.log(`   …${body.slice(Math.max(0, cn - 200), cn + 260).replace(/\s+/g, ' ')}…`);
}

ws.close();
setTimeout(() => process.exit(0), 50).unref();
