// 全量监听：自动附加子目标（OOPIF / Service Worker），实时打印请求，命中 paypal 表单 POST 时打印完整细节
import { connect, listPages, pickPage, attachPage, send } from './cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TIMEOUT = Number(process.argv[3] || 240000);

const ws = await connect();
const pages = await listPages(ws);
const t = pickPage(pages, process.argv[2] || 'paypal');
const sid = await attachPage(ws, t.targetId);
console.error(`# 附加主页面: ${t.url}`);

const sessions = new Set([sid]);
const records = new Map();
let hit = null;

ws.addEventListener('message', async (ev) => {
  let m; try { m = JSON.parse(ev.data); } catch { return; }
  const p = m.params;
  if (!m.method) return;

  // 新的子目标（iframe / worker）自动附加并开 Network
  if (m.method === 'Target.attachedToTarget' && p.sessionId) {
    sessions.add(p.sessionId);
    console.error(`# 发现子目标: ${p.targetInfo?.type} ${String(p.targetInfo?.url || '').slice(0, 80)}`);
    send(ws, 'Network.enable', {}, p.sessionId).catch(() => {});
    return;
  }
  if (!sessions.has(m.sessionId)) return;

  if (m.method === 'Network.requestWillBeSent') {
    const r = p.request;
    const rec = {
      sessionId: m.sessionId,
      requestId: p.requestId,
      method: r.method,
      url: r.url,
      type: p.type,
      headers: r.headers,
      postData: r.postData || null,
      ts: Date.now(),
    };
    records.set(p.requestId, rec);
    // 实时打印（排除图片/字体的噪音）
    if (!/\.(png|jpg|jpeg|gif|svg|woff2?|css|ico)(\?|$)/i.test(r.url)) {
      console.log(`→ ${r.method} ${r.type} ${r.url.slice(0, 130)}`);
    }
    if (r.method === 'POST' && /paypal\.com/.test(r.url) && !/datadoghq|tealeaf|sprig/i.test(r.url)) {
      hit = rec;
      console.log('\n########## 命中 paypal POST ##########');
      console.log('URL:', r.url);
      console.log('type:', p.type);
      console.log('\n-- headers (requestWillBeSent) --');
      for (const k of Object.keys(r.headers)) console.log(`${k}: ${r.headers[k]}`);
      console.log('\n-- body --');
      console.log(r.postData || '(无)');
      if (r.postData) {
        console.log('\n-- 解析 --');
        try { for (const [k, v] of new URLSearchParams(r.postData)) console.log(`  ${k} = ${v}`); } catch {}
      }
      console.log('########## ##########\n');
    }
  } else if (m.method === 'Network.requestWillBeSentExtraInfo') {
    const rec = records.get(p.requestId);
    if (rec) {
      rec.extraHeaders = p.headers;
      if (rec === hit) {
        console.log('-- headers (实际发送，含 Cookie) --');
        for (const k of Object.keys(p.headers).sort()) console.log(`${k}: ${p.headers[k]}`);
        console.log('');
      }
    }
  } else if (m.method === 'Network.responseReceived') {
    const rec = records.get(p.requestId);
    if (rec) { rec.status = p.response.status; rec.mime = p.response.mimeType; }
    if (rec === hit) console.log(`-- 响应: ${p.response.status} ${p.response.mimeType} ${p.response.url.slice(0, 100)}`);
  }
});

// 主 session 与后续子目标都开 Network，并自动附加子目标
await send(ws, 'Network.enable', { maxTotalBufferSize: 1e8, maxResourceBufferSize: 5e7 }, sid);
await send(ws, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid);
console.error('# 监听已就绪，可以点击了');

const start = Date.now();
while (Date.now() - start < TIMEOUT) {
  await sleep(500);
  if (hit && hit.extraHeaders && hit.status) break;
}
await sleep(1200);

console.log(`\n=== 结束 ===`);
console.log(`请求总数: ${records.size}`);
console.log(hit ? `命中: ${hit.method} ${hit.url} → ${hit.status ?? '无响应'}` : '未命中 paypal 表单 POST');
if (!hit) {
  const posts = [...records.values()].filter((r) => r.method === 'POST');
  console.log(`期间的 POST 共 ${posts.length} 个:`);
  for (const r of posts) console.log(`  ${r.url.slice(0, 120)}`);
}

ws.close();
process.exit(0);