// 在论坛昵称输入框输入指定值，抓校验结果与相关接口
import { connect, listPages, pickPage, attachPage, send, evaluate } from './cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nick = process.argv[2] || 'gen';

const ws = await connect();
const pages = await listPages(ws);
const t = pickPage(pages, 'sieportal');
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
await send(ws, 'Network.enable', {}, sid);

const before = reqs.size;

// 输入并触发校验
const typed = await evaluate(ws, `(async () => {
  const inputs = [...document.querySelectorAll('input')].filter(el => el.offsetParent !== null);
  const el = inputs.find(i => i.value === 'iwi') || inputs[4];
  el.scrollIntoView({ block: 'center' });
  el.focus();
  const setNative = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setNative.call(el, '');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  setNative.call(el, ${JSON.stringify(nick)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'n' }));
  el.blur();
  el.dispatchEvent(new Event('blur', { bubbles: true }));
  return { value: el.value, focused: document.activeElement === el };
})()`, sid);
console.log('输入结果:', JSON.stringify(typed));

await sleep(4000);

const state = await evaluate(ws, `(() => {
  const inputs = [...document.querySelectorAll('input')].filter(el => el.offsetParent !== null);
  const el = inputs.find(i => i.value === '${nick}') || inputs[4];
  const msg = el.getAttribute('aria-invalid');
  return {
    value: el.value,
    ariaInvalid: msg,
    isError: msg && msg !== 'false',
    outerClass: el.className,
    nearbyText: (el.closest('div') || el).innerText.replace(/\\s+/g, ' ').slice(0, 160)
  };
})()`, sid);
console.log('校验状态:', JSON.stringify(state, null, 2));

// 与本操作相关的接口
const relevant = [...reqs.values()].filter((r) => /siemens|sag|nickname|user|profile/i.test(r.url) && r.type !== 'Document');
console.log(`\n相关请求 ${relevant.length} 个:`);
for (const r of relevant) {
  console.log(`  [${r.status ?? '—'}] ${r.method} ${r.type} ${r.url.slice(0, 140)}`);
  if (r.postData) console.log(`      body: ${String(r.postData).slice(0, 200)}`);
  if (r.finished && ['XHR', 'Fetch'].includes(r.type)) {
    try {
      const res = await send(ws, 'Network.getResponseBody', { requestId: r.id }, sid, 4000);
      const body = res.base64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : res.body;
      console.log(`      resp: ${String(body).slice(0, 400)}`);
    } catch {}
  }
}

ws.close();
setTimeout(() => process.exit(0), 50).unref();
