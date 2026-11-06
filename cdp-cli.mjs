// 用法:
//   node cdp-cli.mjs pages
//   node cdp-cli.mjs eval -u 关键词 "document.title"
//   node cdp-cli.mjs eval -i 0 -f change.js
//   echo "1+1" | node cdp-cli.mjs eval -i 0
//   node cdp-cli.mjs css  -u 关键词 "body{background:#111}"
//   node cdp-cli.mjs shot -u 关键词 -o out.png
//   node cdp-cli.mjs nav  -i 0 https://example.com

import { readFileSync, writeFileSync } from 'node:fs';
import { connect, listPages, pickPage, attachPage, send, evaluate, readEndpoint } from './cdp.mjs';

function parsedArgs(argv) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('-') && a.length > 1) {
      const key = a.replace(/^--?/, '');
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) { opts[key] = next; i++; }
      else opts[key] = true;
    } else rest.push(a);
  }
  return { opts, rest };
}

async function readStdinIfEmpty(str) {
  if (str && str.trim()) return str;
  if (process.stdin.isTTY) return str || '';
  return new Promise((resolve) => {
    let d = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (d += c));
    process.stdin.on('end', () => resolve(d));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [cmd, ...argv] = process.argv.slice(2);
const { opts, rest } = parsedArgs(argv);
const sel = opts.u ?? opts.url ?? opts.i ?? opts.idx ?? null;

async function main() {
  if (cmd === 'endpoint') {
    console.log(readEndpoint());
    return;
  }

  const ws = await connect();

  try {
    const pages = await listPages(ws);

    if (cmd === 'pages') {
      pages.forEach((p, i) => console.log(`[${i}] ${p.title || '(无标题)'}\n     ${p.url}`));
      if (!pages.length) console.log('（没有可调试标签页）');
      return;
    }

    if (cmd === 'tab') {
      const url = rest[0];
      if (!url) throw new Error('缺少 URL');
      const { targetId } = await send(ws, 'Target.createTarget', { url });
      await sleep(2500);
      const after = await listPages(ws);
      const t = after.find((p) => p.targetId === targetId) || {};
      console.log(JSON.stringify({ targetId, url: t.url, title: t.title }, null, 2));
      return;
    }

    if (cmd === 'close') {
      const t = pickPage(pages, sel);
      await send(ws, 'Target.closeTarget', { targetId: t.targetId });
      console.log(`已关闭: ${t.title || ''} ${t.url}`);
      return;
    }

    const target = pickPage(pages, sel);
    const sessionId = await attachPage(ws, target.targetId);
    console.error(`# 已接管: ${target.title || '(无标题)'} ${target.url}`);

    if (cmd === 'eval') {
      let expr = rest[0];
      if (opts.f) expr = readFileSync(opts.f, 'utf8');
      expr = await readStdinIfEmpty(expr);
      if (!expr || !expr.trim()) throw new Error('没有要执行的 JS');
      const value = await evaluate(ws, expr, sessionId);
      console.log(value === undefined ? '(undefined)' : JSON.stringify(value, null, 2));
    } else if (cmd === 'css') {
      const css = rest[0] || (await readStdinIfEmpty(''));
      if (!css || !css.trim()) throw new Error('没有要注入的 CSS');
      const len = await evaluate(ws, `
        let el = document.getElementById('__wb_cdp_style__');
        if (!el) { el = document.createElement('style'); el.id = '__wb_cdp_style__'; document.head.appendChild(el); }
        el.textContent += ${JSON.stringify('\n' + css)};
        return el.textContent.length;
      `, sessionId);
      console.log(`样式已注入，当前共 ${len} 字符`);
    } else if (cmd === 'shot') {
      const out = opts.o || 'shot.png';
      await send(ws, 'Page.enable', {}, sessionId, 5000).catch(() => {});
      await send(ws, 'Page.bringToFront', {}, sessionId, 5000).catch(() => {});
      const r = await send(ws, 'Page.captureScreenshot',
        { format: 'png', fromSurface: true, captureBeyondViewport: !!opts.full }, sessionId, 25000);
      writeFileSync(out, Buffer.from(r.data, 'base64'));
      console.log(`已保存 ${out}`);
    } else if (cmd === 'nav') {
      const url = rest[0];
      if (!url) throw new Error('缺少 URL');
      await send(ws, 'Page.navigate', { url }, sessionId, 5000).catch(() => {});
      for (let i = 0; i < 24; i++) {
        await sleep(500);
        try {
          const st = await evaluate(ws, 'return document.readyState', sessionId);
          if (st === 'complete') break;
        } catch { /* 页面切换中 */ }
      }
      const info = await evaluate(ws, 'return { url: location.href, title: document.title }', sessionId).catch(() => null);
      console.log(JSON.stringify(info, null, 2));
    } else if (cmd === 'html') {
      const html = await evaluate(ws, 'return document.documentElement.outerHTML', sessionId);
      console.log(html);
    } else {
      console.error(`未知命令: ${cmd}\n可用: endpoint / pages / eval / css / shot / nav / html`);
      process.exitCode = 1;
    }
  } finally {
    ws.close();
    setTimeout(() => process.exit(process.exitCode || 0), 50).unref();
  }
}

main().catch((e) => {
  console.error('ERR:', e.message);
  process.exitCode = 1;
});