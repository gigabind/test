// 读页面 React 状态，提取 phoneMetadata / phoneCountryCodes / paypalSupportedCountries / disablePhoneType
import { connect, listPages, pickPage, attachPage, evaluate } from './cdp.mjs';

const sel = process.argv[2] || 'paypal';
const ws = await connect();
const pages = await listPages(ws);
const t = pickPage(pages, sel);
const sid = await attachPage(ws, t.targetId);
console.error(`# 接管: ${t.url}`);

const expr = `(() => {
  const WANT = ['phoneMetadata','phoneCountryCodes','paypalSupportedCountries','allPaypalSupportedCountries','disablePhoneType','phoneCode'];
  const found = {};
  const seen = new WeakSet();
  let nodes = 0;

  const root = document.querySelector('#root') || document.body;
  const fkey = Object.keys(root).find(k => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$'));
  if (!fkey) return { error: '未找到 React fiber（可能不是 React 页面）' };

  const stack = [[root[fkey], 0]];
  while (stack.length && nodes < 60000) {
    const [o, d] = stack.pop();
    if (!o || typeof o !== 'object' || seen.has(o) || d > 60) continue;
    seen.add(o); nodes++;

    for (const k of WANT) {
      if (found[k] !== undefined) continue;
      if (Object.prototype.hasOwnProperty.call(o, k)) {
        const v = o[k];
        if (k === 'phoneCountryCodes' || k === 'paypalSupportedCountries' || k === 'allPaypalSupportedCountries') {
          if (v && typeof v === 'object') found[k] = v;
        } else if (v !== undefined && v !== null) {
          found[k] = v;
        }
      }
    }
    for (const k in o) {
      if (k === 'return' || k === 'child' || k === 'sibling' || k === 'stateNode' || k === '_owner') continue;
      let v; try { v = o[k]; } catch { continue; }
      if (v && typeof v === 'object') stack.push([v, d + 1]);
    }
  }

  const out = { nodesVisited: nodes };
  const pc = found.phoneCountryCodes;
  if (pc) {
    const keys = Object.keys(pc);
    out.phoneCountryCodes = {
      count: keys.length,
      hasCN: 'CN' in pc,
      CN: pc.CN || null,
      sample: keys.slice(0, 12),
      all: keys,
    };
  }
  if (found.paypalSupportedCountries) {
    const ids = found.paypalSupportedCountries.map(x => x && x.id).filter(Boolean);
    out.paypalSupportedCountries = { count: ids.length, hasCN: ids.includes('CN'), ids: ids };
  }
  if (found.allPaypalSupportedCountries) {
    const ids = found.allPaypalSupportedCountries.map(x => x && x.id).filter(Boolean);
    out.allPaypalSupportedCountries = { count: ids.length, hasCN: ids.includes('CN'), ids: ids };
  }
  if (found.phoneMetadata && typeof found.phoneMetadata === 'object') {
    out.phoneMetadata = { phoneCode: found.phoneMetadata.phoneCode || null, keys: Object.keys(found.phoneMetadata) };
  }
  out.disablePhoneType = found.disablePhoneType === undefined ? null : found.disablePhoneType;
  out.phoneCode = found.phoneCode === undefined ? null : found.phoneCode;
  out.pageCountry = (window.dataLayer && window.dataLayer.contentCountry) || null;
  return out;
})()`;

const res = await evaluate(ws, expr, sid);
console.log(JSON.stringify(res, null, 2));

ws.close();
setTimeout(() => process.exit(0), 50).unref();
