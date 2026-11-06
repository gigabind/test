// 搜索页面所有 JS bundle，找国家/区号配置表与 country 类接口路径
import { connect, listPages, pickPage, attachPage, send, evaluate } from './cdp.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const sel = process.argv[2] || 'paypal';
const ws = await connect();
const pages = await listPages(ws);
const t = pickPage(pages, sel);
const sid = await attachPage(ws, t.targetId);
console.error(`# 接管: ${t.url}`);

// 1. 列出所有已加载的脚本资源
const scripts = await evaluate(ws, `(() => {
  const out = new Set();
  for (const s of document.querySelectorAll('script[src]')) out.add(s.src);
  for (const e of performance.getEntriesByType('resource')) {
    if (e.initiatorType === 'script' || /\\.js(\\?|$)/.test(e.name)) out.add(e.name);
  }
  return [...out];
})()`, sid);
console.error(`# 脚本数: ${scripts.length}`);

// 2. 逐个下载（用页面自身 fetch，同源无 CORS 问题）
mkdirSync('net/js', { recursive: true });
const PATTERNS = [
  { name: 'API: getavailablecountry', re: /getavailablecountry/gi },
  { name: 'API: geo-config', re: /geo[-_]?config/gi },
  { name: 'API: country 接口路径', re: /["'`][^"'`\s]*(?:country|countryconfig|dialcode|phonecode)[^"'`\s]*["'`]/gi },
  { name: '+86 字面量', re: /["'`]\+?86["'`]|\\u002B86/g },
  { name: 'CN 配置', re: /["'`]CN["'`]/g },
  { name: 'dialCode/countryCode 字段', re: /dial_?code|country_?code|phoneCountryCode/gi },
];

const summary = new Map();
let totalBytes = 0;

for (const url of scripts) {
  let text;
  try {
    text = await evaluate(ws, `fetch(${JSON.stringify(url)}).then(r => r.ok ? r.text() : '')`, sid);
  } catch { continue; }
  if (!text) continue;
  totalBytes += text.length;
  const fname = url.split('/').pop().split('?')[0] || 'inline.js';
  writeFileSync(`net/js/${fname}`, text);

  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    const m = p.re.exec(text);
    if (!m) continue;
    const key = fname;
    if (!summary.has(key)) summary.set(key, []);
    summary.get(key).push({ pattern: p.name, sample: text.slice(Math.max(0, m.index - 90), m.index + 90).replace(/\s+/g, ' ') });
  }
}

console.log(`=== 扫描 ${scripts.length} 个脚本 / ${(totalBytes / 1e6).toFixed(1)} MB ===\n`);
if (!summary.size) console.log('（没有任何命中）');
for (const [file, hits] of summary) {
  console.log(`▸ ${file}`);
  const seen = new Set();
  for (const h of hits) {
    if (seen.has(h.pattern)) continue;
    seen.add(h.pattern);
    console.log(`   [${h.pattern}] …${h.sample}…`);
  }
}

// 3. 汇总：+86 与 CN 在哪个文件、出现几次
console.log('\n=== 关键统计 ===');
for (const url of scripts) {
  const fname = url.split('/').pop().split('?')[0];
  try {
    const text = writeFileSync ? null : null;
  } catch {}
}

ws.close();
setTimeout(() => process.exit(0), 50).unref();
