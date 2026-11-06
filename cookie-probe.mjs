// 列出 paypal.com 域下所有 cookie（含 HttpOnly），找区域相关的那一个
import { connect, listPages, pickPage, attachPage, send } from './cdp.mjs';

const ws = await connect();
const pages = await listPages(ws);
const t = pickPage(pages, process.argv[2] || 'paypal');
const sid = await attachPage(ws, t.targetId);

await send(ws, 'Network.enable', {}, sid);
const { cookies } = await send(ws, 'Network.getAllCookies', {}, sid);

const pp = cookies.filter((c) => /paypal/i.test(c.domain));
const KEY = /countr|region|locale|lang|geo|cc$|^cc|market|site/i;

console.log(`=== paypal 相关 cookie 共 ${pp.length} 个，其中疑似区域相关 ${pp.filter((c) => KEY.test(c.name)).length} 个 ===\n`);
for (const c of pp.sort((a, b) => (KEY.test(b.name) ? 1 : 0) - (KEY.test(a.name) ? 1 : 0))) {
  const mark = KEY.test(c.name) ? '★' : ' ';
  const v = c.value.length > 60 ? c.value.slice(0, 60) + '…' : c.value;
  console.log(`${mark} ${c.name} = ${v}   [${c.domain}${c.path}] httpOnly=${c.httpOnly} size=${c.size}`);
}

ws.close();
setTimeout(() => process.exit(0), 50).unref();
