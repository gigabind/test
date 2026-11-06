// 把 LANG cookie 从 en_US;US 改成 zh_CN;CN，再访问注册页，看区域配置是否切换
import { connect, listPages, pickPage, attachPage, send, evaluate } from './cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ws = await connect();
const pages = await listPages(ws);
const t = pickPage(pages, process.argv[2] || 'paypal');
const sid = await attachPage(ws, t.targetId);
await send(ws, 'Network.enable', {}, sid);

const before = await send(ws, 'Network.getCookies', { urls: ['https://www.paypal.com'] }, sid);
const langBefore = before.cookies.find((c) => c.name === 'LANG');
console.log('LANG 原值:', langBefore ? decodeURIComponent(langBefore.value) : '(无)');

// 写入中国区
await send(ws, 'Network.setCookie', {
  name: 'LANG',
  value: 'zh_CN%3BCN',
  domain: '.paypal.com',
  path: '/',
  secure: true,
  httpOnly: true,
}, sid);
const afterSet = await send(ws, 'Network.getCookies', { urls: ['https://www.paypal.com'] }, sid);
const l = afterSet.cookies.find((c) => c.name === 'LANG');
console.log('LANG 新值:', l ? decodeURIComponent(l.value) : '(失败)');

await send(ws, 'Page.enable', {}, sid);
await send(ws, 'Page.navigate', { url: 'https://www.paypal.com/cn/welcome/signup/' }, sid, 8000).catch(() => {});
await sleep(12000);

const res = await evaluate(ws, `(() => {
  const m = window.modelData || {};
  const g = m.modelData && m.modelData.page_flow_data && m.modelData.page_flow_data.griffinData;
  const prefix = document.querySelector('[id$="-prefix"]');
  return {
    url: location.href,
    title: document.title,
    htmlLang: document.documentElement.lang,
    contentCountry: (window.dataLayer && window.dataLayer.contentCountry) || null,
    localeBase: m.serverInfo && m.serverInfo.localeBaseUrl,
    phoneCode: g && g.phoneMetadata ? g.phoneMetadata.phoneCode : null,
    supportedCount: g && g.paypalSupportedCountries ? g.paypalSupportedCountries.length : null,
    hasCNinSupported: g && g.paypalSupportedCountries ? g.paypalSupportedCountries.some(c => c.id === 'CN') : null,
    prefixText: prefix ? prefix.textContent.trim() : null,
    bodyHead: document.body ? document.body.innerText.slice(0, 200).replace(/\\n+/g, ' | ') : null
  };
})()`, sid);

console.log(JSON.stringify(res, null, 2));

ws.close();
setTimeout(() => process.exit(0), 50).unref();