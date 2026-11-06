// 捕捉发往 paypal.com 的表单 POST（排除埋点），抓到即打印并退出
import { connect, listPages, pickPage, attachPage, send } from './cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TIMEOUT = 120000;

const ws = await connect();
const pages = await listPages(ws);
const t = pickPage(pages, process.argv[2] || 'paypal');
const sid = await attachPage(ws, t.targetId);
console.error(`# 监听: ${t.url}`);
console.error('# 请现在点「下一步」…');

let hit = null;
let extraHeaders = null;
const reqs = new Map();

ws.addEventListener('message', async (ev) => {
  let m; try { m = JSON.parse(ev.data); } catch { return; }
  if (m.sessionId !== sid || !m.method) return;
  const p = m.params;

  if (m.method === 'Network.requestWillBeSent') {
    if (p.request.method !== 'POST') return;
    if (!/paypal\.com/.test(p.request.url)) return;
    if (/datadoghq|tealeaf|sprig|i\.paypal\.com\/ee/.test(p.request.url)) return;
    hit = {
      url: p.request.url,
      type: p.type,
      headers: p.request.headers,
      postData: p.request.postData || null,
      hasPostData: !!p.request.hasPostData,
      ts: new Date().toISOString(),
    };
    reqs.set(p.requestId, hit);
  } else if (m.method === 'Network.requestWillBeSentExtraInfo') {
    if (reqs.has(p.requestId)) extraHeaders = p.headers;
  } else if (m.method === 'Network.responseReceived') {
    if (reqs.has(p.requestId)) { hit.status = p.response.status; hit.mime = p.response.mimeType; }
  } else if (m.method === 'Network.loadingFinished') {
    if (reqs.has(p.requestId)) hit.finished = true;
  }
});

await send(ws, 'Network.enable', { maxTotalBufferSize: 1e8, maxResourceBufferSize: 5e7 }, sid);

const start = Date.now();
while (!hit && Date.now() - start < TIMEOUT) await sleep(300);
await sleep(1500); // 等 extra info 与响应体

if (!hit) {
  console.log('=== 超时：没有捕获到发往 paypal.com 的 POST ===');
  ws.close(); setTimeout(() => process.exit(0), 50).unref();
}

console.log('=== 捕获到表单 POST ===\n');
console.log('URL     :', hit.url);
console.log('方法    : POST');
console.log('类型    :', hit.type);
console.log('状态    :', hit.status ?? '—');
console.log('时间    :', hit.ts);

console.log('\n--- 请求头（浏览器实际发送，含 Cookie）---');
const h = extraHeaders || hit.headers || {};
for (const k of Object.keys(h).sort()) console.log(`${k}: ${h[k]}`);

console.log('\n--- 请求体 ---');
console.log(hit.postData ?? '(无 body)');

if (hit.postData) {
  console.log('\n--- 解析后的字段 ---');
  try {
    for (const [k, v] of new URLSearchParams(hit.postData)) console.log(`  ${k} = ${v}`);
  } catch (e) { console.log('解析失败:', e.message); }
}

if (hit.finished) {
  try {
    const res = await send(ws, 'Network.getResponseBody', { requestId: [...reqs.keys()][0] }, sid, 5000);
    const body = res.base64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : res.body;
    console.log('\n--- 响应体（前 800 字符）---');
    console.log(body ? body.slice(0, 800) : '(空)');
  } catch { console.log('\n(响应体不可读，通常是 302 跳转)'); }
}

ws.close();
setTimeout(() => process.exit(0), 50).unref();
