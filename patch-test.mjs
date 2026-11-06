// 实验：把 paypalSupportedCountries 从 201 扩到 204（含 CN），看实际效果
import { connect, listPages, pickPage, attachPage, send, evaluate } from './cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sel = process.argv[2] || 'paypal';
const restore = process.argv[3] !== '--keep';

const ws = await connect();
const pages = await listPages(ws);
const t = pickPage(pages, sel);
const sid = await attachPage(ws, t.targetId);
console.error(`# 接管: ${t.url}`);

// 在页面脚本执行前，拦截 modelData 赋值，把 201 扩到 204
const HOOK = `(() => {
  let v;
  Object.defineProperty(window, 'modelData', {
    configurable: true,
    get() { return v; },
    set(val) {
      v = val;
      try {
        const g = val && val.modelData && val.modelData.page_flow_data && val.modelData.page_flow_data.griffinData;
        if (g && Array.isArray(g.paypalSupportedCountries) && Array.isArray(g.allPaypalSupportedCountries)) {
          const before = g.paypalSupportedCountries.length;
          const have = new Set(g.paypalSupportedCountries.map(c => c.id));
          for (const c of g.allPaypalSupportedCountries) {
            if (!have.has(c.id)) g.paypalSupportedCountries.push(c);
          }
          g.__patch = { before, after: g.paypalSupportedCountries.length };
        }
      } catch (e) { window.__patchError = String(e); }
    }
  });
})();`;

const { identifier } = await send(ws, 'Page.addScriptToEvaluateOnNewDocument', { source: HOOK }, sid);
console.error(`# 注入完成: ${identifier}`);
await send(ws, 'Page.enable', {}, sid);
await send(ws, 'Page.reload', { ignoreCache: true }, sid, 5000).catch(() => {});
await sleep(14000);

const res = await evaluate(ws, `(() => {
  const g = window.modelData?.modelData?.page_flow_data?.griffinData;
  const ids = (g?.paypalSupportedCountries || []).map(c => c.id);
  const phoneField = (() => {
    let hit = null;
    const seen = new WeakSet();
    (function walk(o, d) {
      if (!o || typeof o !== 'object' || d > 7 || seen.has(o) || hit) return;
      seen.add(o);
      if ('disablePhoneType' in o) { hit = { disablePhoneType: o.disablePhoneType, keys: Object.keys(o).slice(0, 12) }; return; }
      for (const k of Object.keys(o).slice(0, 80)) { try { walk(o[k], d + 1); } catch (e) {} }
    })(g, 0);
    return hit;
  })();
  const prefix = document.querySelector('#paypalAccountData_ph___-prefix');
  return {
    patch: g?.__patch || null,
    patchError: window.__patchError || null,
    supportedCount: ids.length,
    hasCN: ids.includes('CN'),
    cnEntry: (g?.paypalSupportedCountries || []).find(c => c.id === 'CN') || null,
    phoneCode: g?.phoneMetadata?.phoneCode || null,
    phoneField,
    prefixText: prefix ? prefix.textContent.trim() : null,
    selects: [...document.querySelectorAll('select')].map(s => ({ id: s.id, name: s.name, options: s.options.length })),
    fieldCount: document.querySelectorAll('input,select,textarea').length
  };
})()`, sid);

console.log(JSON.stringify(res, null, 2));

if (restore) {
  await send(ws, 'Page.removeScriptToEvaluateOnNewDocument', { identifier }, sid).catch(() => {});
  await send(ws, 'Page.reload', { ignoreCache: false }, sid, 5000).catch(() => {});
  console.error('\n# 已移除注入并刷新，页面恢复原状');
}

ws.close();
setTimeout(() => process.exit(0), 50).unref();
