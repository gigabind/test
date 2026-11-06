// 通过 UI 逐个试昵称：填入 → 失焦触发校验 → 读取 aria-invalid 结果
import { connect, listPages, pickPage, attachPage, evaluate } from './cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cands = process.argv.slice(2);
if (!cands.length) { console.error('用法: node type-nick-loop.mjs 名字1 名字2 ...'); process.exit(1); }

const ws = await connect();
const pages = await listPages(ws);
const t = pickPage(pages, 'sieportal');
const sid = await attachPage(ws, t.targetId);
console.error(`# 接管: ${t.url}\n`);

const results = [];
for (const nick of cands) {
  const r = await evaluate(ws, `(async () => {
    const inputs = [...document.querySelectorAll('input')].filter(el => el.offsetParent !== null);
    const el = inputs.find(i => i.className.includes('text-input__input-field') && !i.disabled && i.value !== '+8618921636388')
             || inputs[4];
    el.scrollIntoView({ block: 'center' });
    el.focus();
    const setNative = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setNative.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(x => setTimeout(x, 150));
    setNative.call(el, ${JSON.stringify(nick)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(x => setTimeout(x, 250));
    el.blur();
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    await new Promise(x => setTimeout(x, 2200));
    const invalid = el.getAttribute('aria-invalid');
    return { value: el.value, invalid, cls: el.className };
  })()`, sid);

  const msg = r.invalid && r.invalid !== 'false' ? r.invalid : null;
  const ok = !msg;
  results.push({ nick, ok, msg });
  console.log(`${ok ? '✅ 可用' : '❌ 占用'}  ${nick}${msg ? '  → ' + msg : ''}`);
  await sleep(300);
}

console.log('\n=== 汇总 ===');
const free = results.filter((x) => x.ok).map((x) => x.nick);
console.log('可用:', free.length ? free.join(', ') : '（这批全部被占用）');

ws.close();
setTimeout(() => process.exit(0), 50).unref();
