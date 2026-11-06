// 闭环测试：真实键入 → 抓 POST 请求 body 与响应 → 读回 DOM 提示
// 用法: node t.mjs <值> [字段索引=4] [等待毫秒=3000]
const BASE = 'http://127.0.0.1:9223';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const value = process.argv[2];
const index = Number(process.argv[3] ?? 4);
const settleMs = Number(process.argv[4] ?? 3000);

if (!value) { console.error('用法: node t.mjs <值> [索引] [等待ms]'); process.exit(1); }

await fetch(BASE + '/net/clear', { method: 'POST' });
const since = Date.now();

const r = await fetch(BASE + '/type', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sel: 'sieportal', index, value, settleMs }),
});
const j = await r.json();
if (j.error) { console.error('ERR:', j.error); process.exit(1); }

// 再等一会儿，让响应体被抓全
await sleep(1500);
const log = await (await fetch(`${BASE}/net/log?since=${since}`)).json();
const posts = log.filter((x) => x.method === 'POST' && /ValidateAttributeValue/i.test(x.url));

console.log(`输入值       : ${JSON.stringify(j.typed)}`);
console.log(`DOM 实际值   : ${JSON.stringify(j.dom?.value)}`);
console.log(`DOM 提示     : ${JSON.stringify(j.dom?.ariaInvalid)}`);
console.log(`红框状态     : ${j.dom?.isInvalidClass ? '有红框' : '无红框'}`);

if (!posts.length) {
  console.log('\n接口: 未捕获到 POST ValidateAttributeValue');
} else {
  for (const a of posts) {
    console.log('\n--- 接口 ---');
    console.log(`  status : ${a.status}`);
    console.log(`  body   : ${a.postData}`);
    console.log(`  resp   : ${a.resp}`);
  }
  const last = posts[posts.length - 1];
  const apiVal = (String(last.postData || '').match(/"value"\s*:\s*"([^"]*)"/) || [])[1];
  const respObj = (() => { try { return JSON.parse(last.resp); } catch { return null; } })();
  const av = respObj?.attributeValidation;

  console.log('\n=== 闭环 ===');
  console.log(`  ① 我输入        : ${j.typed}`);
  console.log(`  ② 请求里发的值  : ${apiVal ?? '(未解析)'}`);
  console.log(`  ③ 是否一致      : ${apiVal === j.typed ? '✓' : '✗（输入未进入 Angular 模型）'}`);
  if (av) {
    console.log(`  ④ 接口判定      : exists=${av.exists} isUnique=${av.isUnique} format=${av.isValidFormat} auth=${av.isAuthorised}`);
    const apiSaysFree = av.isUnique === true;
    const domSaysFree = !j.dom?.isInvalidClass;
    console.log(`  ⑤ UI 与接口一致 : ${apiSaysFree === domSaysFree ? '✓ 一致' : '✗ 不一致'}`);
    console.log(`  ⑥ 结论          : ${apiSaysFree ? '可用' : '已被占用'}`);
  } else {
    console.log('  ④ 响应体未解析到 attributeValidation');
  }
}
