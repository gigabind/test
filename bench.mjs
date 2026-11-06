// 事件驱动批量校验：输入 → 等接口返回 → 立刻读 DOM → 下一个；统计平均耗时
// 用法: node bench.mjs 值1 值2 值3 ...
const BASE = 'http://127.0.0.1:9223';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const values = process.argv.slice(2);
if (!values.length) { console.error('用法: node bench.mjs 值1 值2 ...'); process.exit(1); }

const INDEX = 4;
const TIMEOUT = 9000;

async function postJSON(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
async function getJSON(path) {
  const r = await fetch(BASE + path);
  return r.json();
}

const rows = [];

for (const v of values) {
  await postJSON('/net/clear', {});
  const t0 = Date.now();
  await postJSON('/type', { sel: 'sieportal', index: INDEX, value: v, settleMs: 0 });

  // 轮询等响应体落地
  let entry = null;
  while (Date.now() - t0 < TIMEOUT) {
    const log = await getJSON('/net/log');
    const hit = log.filter((x) => x.method === 'POST' && /ValidateAttributeValue/i.test(x.url) && x.resp);
    if (hit.length) { entry = hit[hit.length - 1]; break; }
    await sleep(50);
  }
  const latency = Date.now() - t0;

  // 响应到了再读 DOM
  const dom = await getJSON('/eval?x=1').catch(() => null);
  const domState = await postJSON('/eval', {
    sel: 'sieportal',
    expr: `(() => { const el = [...document.querySelectorAll('input')].filter(e=>e.offsetParent!==null)[${INDEX}]; return el ? { value: el.value, invalid: el.getAttribute('aria-invalid'), red: el.className.includes('is-invalid') } : null; })()`,
  });

  let apiVal = null, av = null, code = null;
  if (entry) {
    apiVal = (String(entry.postData || '').match(/"value"\s*:\s*"([^"]*)"/) || [])[1] ?? null;
    code = (String(entry.resp || '').match(/"errorCode"\s*:\s*"([^"]*)"/) || [])[1] ?? null;
    try { av = JSON.parse(entry.resp).attributeValidation; } catch {}
  }

  const free = av ? av.isUnique === true : null;
  rows.push({ v, sentValue: apiVal, free, code, latency, domValue: domState?.value?.value, domRed: domState?.value?.red });

  console.log(
    `${free === true ? '✅ 可用' : free === false ? '❌ 占用' : '⚠️ 无返回'}  ` +
    `${String(v).padEnd(12)} 耗时 ${String(latency).padStart(5)}ms  ` +
    `发送值=${apiVal ?? '-'}  errorCode=${code ?? '-'}  DOM=${domState?.value?.value ?? '-'}${domState?.value?.red ? '(红框)' : ''}`
  );

  await sleep(400); // 礼貌间隔，避免限流
}

const lat = rows.filter((r) => r.free !== null).map((r) => r.latency);
if (lat.length) {
  const avg = Math.round(lat.reduce((a, b) => a + b, 0) / lat.length);
  console.log(`\n=== 统计（${lat.length} 次有效）===`);
  console.log(`平均耗时: ${avg}ms   最快: ${Math.min(...lat)}ms   最慢: ${Math.max(...lat)}ms`);
}
const mismatched = rows.filter((r) => r.sentValue && r.sentValue !== r.v);
console.log(`输入与请求不一致的条数: ${mismatched.length}`);