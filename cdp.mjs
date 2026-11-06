// 极简 CDP 客户端 —— Node 22 内置 WebSocket，无需 puppeteer/playwright
//
// 关键变化：新版 Edge 用 edge://inspect 的 UI 开关开端口时，HTTP 的 /json/* 接口是关的
// （防 cookie 窃取）。所以这里一律走「浏览器级 WebSocket + Target.attachToTarget(flatten)」，
// 再在 session 上发 Runtime/Page 命令。端口与路径从 DevToolsActivePort 文件读。

import { readFileSync, existsSync } from 'node:fs';

const PROFILE_DIR = process.env.EDGE_PROFILE
  || (process.env.LOCALAPPDATA + '\\Microsoft\\Edge\\User Data');

export function readEndpoint() {
  if (process.env.CDP_WS) return process.env.CDP_WS;
  const f = PROFILE_DIR + '\\DevToolsActivePort';
  if (!existsSync(f)) {
    throw new Error(`找不到 ${f}\n→ 请先在 Edge 里打开 edge://inspect/#remote-debugging 并勾选「允许对此浏览器实例进行远程调试」`);
  }
  const [port, path] = readFileSync(f, 'utf8').split(/\r?\n/);
  if (!port || !path) throw new Error('DevToolsActivePort 内容异常，调试端口可能没真正开启');
  return `ws://127.0.0.1:${port.trim()}${path.trim()}`;
}

export async function connect() {
  const url = readEndpoint();
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败，检查 Edge 是否还开着、远程调试是否被取消勾选')), { once: true });
  });
  return ws;
}

let msgId = 0;

export function send(ws, method, params = {}, sessionId, timeoutMs = 30000) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const onMessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (msg.error) reject(new Error(`${method}: ${msg.error.message || JSON.stringify(msg.error)}`));
      else resolve(msg.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      reject(new Error(`${method} 超时`));
    }, timeoutMs);
  });
}

export async function listPages(ws) {
  const { targetInfos } = await send(ws, 'Target.getTargets');
  return targetInfos.filter((t) => t.type === 'page');
}

export function pickPage(pages, sel) {
  if (!pages.length) throw new Error('没有可调试的标签页');
  if (sel == null || sel === '' || sel === true) {
    const real = pages.filter((p) => !p.url.startsWith('edge://') && !p.url.startsWith('devtools://'));
    return real[0] || pages[0];
  }
  if (/^\d+$/.test(String(sel))) {
    const i = Number(sel);
    if (!pages[i]) throw new Error(`索引 ${i} 越界，共 ${pages.length} 个标签页`);
    return pages[i];
  }
  const needle = String(sel).toLowerCase();
  const hit = pages.filter((p) => p.url.toLowerCase().includes(needle) || (p.title || '').toLowerCase().includes(needle));
  if (!hit.length) throw new Error(`没有匹配 "${sel}" 的标签页\n现有: ${pages.map((p, i) => `[${i}] ${p.title || p.url}`).join(' | ')}`);
  if (hit.length > 1) {
    // DevTools 窗口标题里也带页面标题/URL，优先排除
    const real = hit.filter((p) => !p.url.startsWith('devtools://'));
    if (real.length === 1) return real[0];
    throw new Error(`匹配到多个: ${hit.map((h) => h.title).join(' | ')}，请用 -i 索引`);
  }
  return hit[0];
}

export async function attachPage(ws, targetId) {
  const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
  return sessionId;
}

export async function evaluate(ws, expr, sessionId) {
  // 两种写法都支持：纯表达式（document.title）与函数体（return document.title）
  // 先按表达式试，语法不通过再按函数体执行；两者都能自动处理 IIFE 里带 return 的情况
  const run = async (body) => {
    const r = await send(ws, 'Runtime.evaluate', {
      expression: `(async () => {\n${body}\n})()`,
      awaitPromise: true,
      returnByValue: true,
      allowUnsafeEvalBlockedByCSP: true,
    }, sessionId);
    return r;
  };

  let r = await run(`return (${expr});`);
  if (r.exceptionDetails) {
    const first = r.exceptionDetails;
    r = await run(expr);
    if (r.exceptionDetails) {
      const e = r.exceptionDetails;
      throw new Error(e.exception?.description || e.text || first.text || '页面脚本抛异常');
    }
  }
  return r.result.value;
}
