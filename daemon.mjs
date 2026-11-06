// 常驻 CDP 连接 + Network 抓包 + 真实键盘输入，用于闭环验证
// 端点:
//   GET  /ping  /pages  /net/log
//   POST /eval {sel,expr}  /shot {sel,out}  /nav {sel,url}
//   POST /net/clear
//   POST /type {sel,index,value,settleMs}  → 真实键盘输入并读回 DOM 状态
import { createServer } from 'node:http';
import { connect, listPages, pickPage, attachPage, send, evaluate, readEndpoint } from './cdp.mjs';

const PORT = Number(process.env.DAEMON_PORT || 9223);
const ws = await connect();
console.error(`✓ 已连接: ${readEndpoint()}`);

const sessions = new Map();      // targetId -> sessionId
const netLog = [];               // 抓到的接口请求
const MAX_LOG = 200;

ws.addEventListener('close', () => { console.error('! CDP 连接断开'); process.exit(1); });

// Network 事件：按 sessionId 过滤
ws.addEventListener('message', async (ev) => {
  let m; try { m = JSON.parse(ev.data); } catch { return; }
  const p = m.params;
  if (!m.method || !p) return;
  const sidOf = m.sessionId;
  if (!sidOf || ![...sessions.values()].includes(sidOf)) return;

  if (m.method === 'Network.requestWillBeSent') {
    const r = p.request;
    if (!/ValidateAttributeValue|profile\/v1|nickname/i.test(r.url)) return;
    netLog.push({
      ts: Date.now(), requestId: p.requestId, sessionId: sidOf,
      method: r.method, url: r.url, postData: r.postData || null,
    });
    if (netLog.length > MAX_LOG) netLog.shift();
  } else if (m.method === 'Network.responseReceived') {
    const rec = netLog.find((x) => x.requestId === p.requestId);
    if (rec) { rec.status = p.response.status; rec.mime = p.response.mimeType; }
  } else if (m.method === 'Network.loadingFinished') {
    const rec = netLog.find((x) => x.requestId === p.requestId);
    if (rec && !rec.resp) {
      try {
        const r = await send(ws, 'Network.getResponseBody', { requestId: p.requestId }, sidOf, 5000);
        rec.resp = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body;
      } catch { rec.resp = null; }
    }
  }
});

async function getSession(sel) {
  const pages = await listPages(ws);
  const t = pickPage(pages, sel);
  let sid = sessions.get(t.targetId);
  if (!sid) {
    sid = await attachPage(ws, t.targetId);
    sessions.set(t.targetId, sid);
    await send(ws, 'Network.enable', { maxTotalBufferSize: 5e7, maxResourceBufferSize: 2e7 }, sid).catch(() => {});
  }
  return { target: t, sid };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
  try {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (url.pathname === '/ping') return json(200, { ok: true, endpoint: readEndpoint(), sessions: [...sessions.values()], netEntries: netLog.length });
    if (url.pathname === '/pages') {
      const pages = await listPages(ws);
      return json(200, pages.map((p, i) => ({ i, title: p.title, url: p.url, targetId: p.targetId })));
    }
    if (url.pathname === '/net/log') {
      const since = Number(url.searchParams.get('since') || 0);
      return json(200, netLog.filter((x) => x.ts >= since));
    }
    if (url.pathname === '/net/clear') { netLog.length = 0; return json(200, { ok: true }); }

    if (req.method !== 'POST') return json(405, { error: '需要 POST' });
    const body = await readBody(req);
    const sel = body.sel ?? 0;

    if (url.pathname === '/eval') {
      const { sid } = await getSession(sel);
      return json(200, { ok: true, value: await evaluate(ws, body.expr, sid) });
    }

    if (url.pathname === '/shot') {
      const { sid } = await getSession(sel);
      await send(ws, 'Page.enable', {}, sid, 5000).catch(() => {});
      await send(ws, 'Page.bringToFront', {}, sid, 5000).catch(() => {});
      const r = await send(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true }, sid, 25000);
      const { writeFileSync } = await import('node:fs');
      const out = body.out || 'shot.png';
      writeFileSync(out, Buffer.from(r.data, 'base64'));
      return json(200, { ok: true, file: out });
    }

    if (url.pathname === '/nav') {
      const { sid } = await getSession(sel);
      await send(ws, 'Page.navigate', { url: body.url }, sid, 8000).catch(() => {});
      return json(200, { ok: true });
    }

    if (url.pathname === '/type') {
      const { sid } = await getSession(sel);
      const idx = body.index ?? 4;
      const value = String(body.value ?? '');
      const settle = Number(body.settleMs || 2500);

      // 1) 清空（原生 setter + input 事件，只用于清空）
      await evaluate(ws, `(() => {
        const el = [...document.querySelectorAll('input')].filter(e => e.offsetParent !== null)[${idx}];
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        el.focus();
        const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        s.call(el, '');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return el.value;
      })()`, sid);

      // 2) 真实键盘输入
      if (value) await send(ws, 'Input.insertText', { text: value }, sid, 5000);

      // 3) 失焦触发校验
      await evaluate(ws, `(() => {
        const el = [...document.querySelectorAll('input')].filter(e => e.offsetParent !== null)[${idx}];
        if (el) { el.blur(); el.dispatchEvent(new Event('blur', { bubbles: true })); }
        return true;
      })()`, sid);

      // 4) 等待接口返回并读回 DOM
      const startedAt = Date.now();
      await new Promise((r) => setTimeout(r, settle));
      const state = await evaluate(ws, `(() => {
        const el = [...document.querySelectorAll('input')].filter(e => e.offsetParent !== null)[${idx}];
        if (!el) return { missing: true };
        return { value: el.value, ariaInvalid: el.getAttribute('aria-invalid'), isInvalidClass: el.className.includes('is-invalid') };
      })()`, sid);

      const related = netLog.filter((x) => x.ts >= startedAt - 500 && /ValidateAttributeValue/i.test(x.url)).map((x) => ({ ts: x.ts - startedAt, status: x.status, postData: x.postData, resp: x.resp }));
      return json(200, { ok: true, typed: value, dom: state, api: related });
    }

    return json(404, { error: '未知路径: /ping /pages /net/log /net/clear /eval /shot /nav /type' });
  } catch (e) {
    return json(500, { error: String(e.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.error(`✓ 常驻服务: http://127.0.0.1:${PORT}`);
});