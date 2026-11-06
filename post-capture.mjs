// 监听并记录 paypal 的所有 POST 请求：完整 headers、postData、响应
import { connect, listPages, pickPage, attachPage, send } from './cdp.mjs';
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const durMs = Number(process.argv[2] || 180000);
const outFile = 'net/post-capture.ndjson';

const ws = await connect();
const pages = await listPages(ws);
const t = pickPage(pages, 'paypal');
const sid = await attachPage(ws, t.targetId);
console.error(`# 监听中: ${t.url}`);
console.error(`# 时长 ${Math.round(durMs / 1000)}s —— 请现在在页面上操作（点继续/下一步）`);

mkdirSync('net', { recursive: true });
writeFileSync(outFile, '');

const reqs = new Map();
const extra = new Map();

ws.addEventListener('message', (ev) => {
  let m; try { m = JSON.parse(ev.data); } catch { return; }
  const p = m.params;
  if (m.method === 'Network.requestWillBeSent') {
    if (p.request.method !== 'POST') return;
    reqs.set(p.requestId, {
      ts: new Date().toISOString(),
      requestId: p.requestId,
      url: p.request.url,
      type: p.type,
      headers: p.request.headers,
      postData: p.request.postData,
      hasPostData: p.request.hasPostData,
    });
  } else if (m.method === 'Network.requestWillBeSentExtraInfo') {
    // 这里才有真正发出的完整 header（含 Cookie、sec-* 等）
    if (reqs.has(p.requestId)) extra.set(p.requestId, p.headers);
  } else if (m.method === 'Network.responseReceived') {
    const r = reqs.get(p.requestId);
    if (r) { r.status = p.response.status; r.mime = p.response.mimeType; r.remoteIP = p.response.remoteIPAddress; }
  } else if (m.method === 'Network.loadingFinished') {
    const r = reqs.get(p.requestId);
    if (r) r.finished = true;
  }
});

await send(ws, 'Network.enable', { maxTotalBufferSize: 1e8, maxResourceBufferSize: 5e7 }, sid);
await sleep(durMs);

// 汇总：补上 extra headers 与响应体
const all = [...reqs.values()];
for (const r of all) {
  r.extraHeaders = extra.get(r.requestId) || null;
  if (r.finished) {
    try {
      const res = await send(ws, 'Network.getResponseBody', { requestId: r.requestId }, sid, 5000);
      const body = res.base64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : res.body;
      r.responseBodyHead = body ? body.slice(0, 600) : null;
      r.responseLen = body ? body.length : 0;
    } catch { /* 部分响应无 body */ }
  }
}

for (const r of all) appendFileSync(outFile, JSON.stringify(r) + '\n');

console.log(`\n=== 捕获到 ${all.length} 个 POST 请求 ===\n`);
for (const r of all) {
  console.log(`▸ [${r.status ?? '—'}] ${r.url.slice(0, 150)}`);
  console.log(`  类型: ${r.type}  响应长度: ${r.responseLen ?? '—'}`);
  const h = r.extraHeaders || r.headers || {};
  const interesting = Object.keys(h).filter((k) =>
    /csrf|token|origin|referer|content-type|sec-|accept|user-agent|x-pp|x-requested/i.test(k)
  );
  for (const k of interesting) console.log(`  ${k}: ${String(h[k]).slice(0, 160)}`);
  if (r.postData) console.log(`  BODY: ${r.postData.slice(0, 400)}`);
  console.log('');
}

ws.close();
setTimeout(() => process.exit(0), 50).unref();