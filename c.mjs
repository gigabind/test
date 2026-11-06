// 轻量客户端：把命令转发给常驻 daemon，不新建 CDP 连接（因此不会再触发 Edge 确认弹窗）
// 用法:
//   node c.mjs pages
//   node c.mjs eval -i 0 "document.title"
//   node c.mjs eval -u sieportal "document.body.innerText.slice(0,200)"
//   node c.mjs shot -i 0 -o out.png
//   node c.mjs nav -i 0 https://example.com
const PORT = Number(process.env.DAEMON_PORT || 9223);
const BASE = `http://127.0.0.1:${PORT}`;

const argv = process.argv.slice(2);
const cmd = argv[0];
const opts = {};
const rest = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('-') && a.length > 1) {
    const key = a.replace(/^--?/, '');
    const next = argv[i + 1];
    if (next && !next.startsWith('-')) { opts[key] = next; i++; } else opts[key] = true;
  } else rest.push(a);
}
const sel = opts.u ?? opts.i ?? opts.idx ?? 0;

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

try {
  if (cmd === 'pages') {
    const r = await (await fetch(BASE + '/pages')).json();
    for (const p of r) console.log(`[${p.i}] ${p.title}\n     ${p.url}`);
  } else if (cmd === 'ping') {
    console.log(JSON.stringify(await (await fetch(BASE + '/ping')).json(), null, 2));
  } else if (cmd === 'eval') {
    const expr = opts.f ? (await import('node:fs')).readFileSync(opts.f, 'utf8') : rest[0];
    if (!expr) throw new Error('缺少表达式');
    const r = await post('/eval', { sel, expr });
    if (r.error) throw new Error(r.error);
    console.log(r.value === undefined ? '(undefined)' : JSON.stringify(r.value, null, 2));
  } else if (cmd === 'shot') {
    const r = await post('/shot', { sel, out: opts.o || 'shot.png', full: !!opts.full });
    if (r.error) throw new Error(r.error);
    console.log(`已保存 ${r.file}`);
  } else if (cmd === 'nav') {
    const r = await post('/nav', { sel, url: rest[0] });
    if (r.error) throw new Error(r.error);
    console.log('已导航');
  } else {
    console.error('可用: pages / ping / eval / shot / nav');
    process.exit(1);
  }
} catch (e) {
  console.error('ERR:', e.message);
  console.error('（若提示连接失败，说明 daemon 没在跑：先 node daemon.mjs）');
  process.exit(1);
}
