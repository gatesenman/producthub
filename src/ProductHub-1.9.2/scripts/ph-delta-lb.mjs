import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const LB = '/workspace/ph/lb';
const OUT = '/workspace/product-hub/data/delta/ph-lb-delta.json';
fs.mkdirSync(LB, { recursive: true });
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const START = new Date('2026-10-21T00:00:00+08:00');
const END = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
const endDate = new Date(END.getFullYear(), END.getMonth(), END.getDate());

const P = /"__typename":"Post","id":"(\d+)","name":"((?:\\.|[^"\\])*)","slug":"([a-z0-9-]+)","tagline":"((?:\\.|[^"\\])*)"/g;

function days() {
  const out = [];
  for (let d = new Date(START); d <= endDate; d = new Date(d.getTime() + 86400000)) {
    const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    out.push({ y, m, day, iso: `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}` });
  }
  return out.reverse();
}

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  locale: 'en-US', viewport: { width: 1366, height: 900 },
});
const page = await ctx.newPage();
await page.route('**/*', r => ['image','media','font'].includes(r.request().resourceType()) ? r.abort() : r.continue());

let fetched = 0; const failed = [];
for (const d of days()) {
  const f = path.join(LB, `${d.iso}.json`);
  if (fs.existsSync(f) && fs.statSync(f).size > 10) { console.log('skip', d.iso); continue; }
  const url = `https://www.producthunt.com/leaderboard/daily/${d.y}/${d.m}/${d.day}/all`;
  let ok = false;
  for (let t = 0; t < 5; t++) {
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2500);
      const title = await page.title();
      if (/just a moment|attention required/i.test(title)) { console.log('cf', d.iso, t); await page.waitForTimeout(4000); continue; }
      const status = resp?.status() || 0;
      if (status === 429) { console.log('429', d.iso); await page.waitForTimeout(90000 * (t+1)); continue; }
      if (status >= 400) { console.log('HTTP', status, d.iso); await page.waitForTimeout(5000); continue; }
      const h = await page.content();
      const rows = {};
      let m; const re = new RegExp(P.source, 'g');
      while ((m = re.exec(h))) {
        const nx = h.indexOf('"__typename":"Post"', m.index + 20);
        const seg = h.slice(m.index, nx > 0 ? nx : m.index + 3000);
        const pm = seg.match(/"redirectToProduct":\{"__typename":"Product","id":"\d+","slug":"([a-z0-9-]+)"/);
        let name = m[2], tagline = m[4];
        try { name = JSON.parse('"'+m[2]+'"'); tagline = JSON.parse('"'+m[4]+'"'); } catch {}
        rows[m[3]] = { id: m[1], name, tagline, product: pm?.[1] || null };
      }
      fs.writeFileSync(f, JSON.stringify({ date: d.iso, posts: rows }));
      fetched++; console.log('ok', fetched, d.iso, 'posts', Object.keys(rows).length);
      ok = true; await page.waitForTimeout(2500); break;
    } catch (e) {
      console.log('err', d.iso, String(e).slice(0,120)); await page.waitForTimeout(5000);
    }
  }
  if (!ok) { failed.push(d.iso); fs.appendFileSync('/workspace/ph/lb-delta-errors.log', d.iso+'\n'); }
}
await browser.close();

// build ingest
const rows = []; const seen = new Set();
for (const d of days().reverse()) {
  const f = path.join(LB, `${d.iso}.json`);
  if (!fs.existsSync(f)) continue;
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const [k,v] of Object.entries(data.posts || {})) {
    const slug = v.product || k;
    if (seen.has(slug)) continue; seen.add(slug);
    rows.push({ name: v.name || slug, url: `https://www.producthunt.com/products/${slug}`, tagline: v.tagline, description: v.tagline, date: data.date });
  }
}
fs.writeFileSync(OUT, JSON.stringify({ seq: 1, strategy: 'ph-lb-delta-2026-11-09', rows }));
console.log(JSON.stringify({ fetched, failed, rows: rows.length, out: OUT }));
