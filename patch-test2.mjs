// 实验二：同时改写 phoneMetadata.phoneCode = 86，观察前缀显示与表单序列化内容
import { connect, listPages, pickPage, attachPage, send, evaluate } from './cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ws = await connect();
const pages = await listPages(ws);
const t = pickPage(pages, process.argv[2] || 'paypal');
const sid = await attachPage(ws, t.targetId);
console.error(`# 接管: ${t.url}`);

const HOOK = `(() => {
  let v;
  Object.defineProperty(window, 'modelData', {
    configurable: true,
    get() { return v; },
    set(val) {
      v = val;
      try {
        const g = val?.modelData?.page_flow_data?.griffinData;
        if (!g) return;
        if (Array.isArray(g.paypalSupportedCountries) && Array.isArray(g.allPaypalSupportedCountries)) {
          const have = new Set(g.paypalSupportedCountries.map(c => c.id));
          for (const c of g.allPaypalSupportedCountries) if (!have.has(c.id)) g.paypalSupportedCountries.push(c);
        }
        if (g.phoneMetadata) g.phoneMetadata.phoneCode = '86';
      } catch (e) { window.__patchError = String(e); }
    }
  });
})();`;

const { identifier } = await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: HOOK }, sid);
await send(ws, 'Page.enable', {}, sid);
await send(ws, 'Page.reload', { ignoreCache: true }, sid, 5000).catch(() => {});
await sleep(14000);

const res = await evaluate(ws, `(() => {
  const g = window.modelData?.modelData?.page_flow_data?.griffinData;
  const prefix = document.querySelector('#paypalAccountData_ph___-prefix');
  const form = document.forms[0];
  // 序列化表单（不提交），看服务端到底会收到什么
  const sent = form ? [...new FormData(form).entries()].map(([k, v]) => ({ key: k, value: String(v).slice(0, 30) })) : null;
  return {
    phoneCodeInConfig: g?.phoneMetadata?.phoneCode ?? null,
    supportedCount: g?.paypalSupportedCountries?.length ?? null,
    prefixText: prefix ? prefix.textContent.trim() : null,
    prefixHTML: prefix ? prefix.outerHTML.slice(0, 120) : null,
    formAction: form ? form.getAttribute('action') : null,
    formMethod: form ? form.getAttribute('method') : null,
    serializedFields: sent,
    patchError: window.__patchError || null
  };
})()`, sid);

console.log(JSON.stringify(res, null, 2));

await send(ws, 'Page.removeScriptToEvaluateOnNewDocument', { identifier }, sid).catch(() => {});
await send(ws, 'Page.reload', { ignoreCache: false }, sid, 5000).catch(() => {});
console.error('\n# 已移除注入并刷新，页面已恢复原状');

ws.close();
setTimeout(() => process.exit(0), 50).unref();
