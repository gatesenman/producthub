/**
 * 失败来源修复 + 增量补抓至今天（Asia/Shanghai）
 * 不打包、不备份整库。产物：data/delta/fix-*.json + docs/crawl-delta-2026-11-09-fix.md
 *
 *   PATH=.../node-v22.../bin:$PATH npx tsx scripts/crawl-delta-fix.ts [--only=ph,hs,sr,of,ecomm,mcp,gh,sources]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DB, now } from '../src/server/db';
import { crawlSource, pool, CrawlItem } from '../src/server/crawler';
import { upsertProduct } from '../src/server/products';
import { PoliteFetcher, parseShowHn, CHROME_UA, parseSitemap, isArticleNoise } from '../src/server/history';

const ARGS = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']));
const ONLY = new Set(String(ARGS.only || 'ph,hs,sr,of,ecomm,mcp,gh,bl,sources').split(',').filter(Boolean));
const DIR = path.resolve('data/crawl');
const DBF = path.join(DIR, 'producthub.db');
const DELTA = path.resolve('data/delta');
const LOGF = path.resolve('logs/crawl-delta-fix.log');
fs.mkdirSync(DELTA, { recursive: true });
fs.mkdirSync(path.dirname(LOGF), { recursive: true });
const log = (s: string) => {
  const line = `[${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })}] ${s}`;
  fs.appendFileSync(LOGF, line + '\n');
  console.log(line);
};

const stats = {
  inserted: 0, updated: 0, found: 0, noise: 0,
  by: {} as Record<string, { inserted: number; updated: number; found: number; note?: string }>,
  failed: [] as { name: string; error: string }[],
  fixed: [] as string[],
  unfixable: [] as { name: string; reason: string }[],
};

const pf = new PoliteFetcher(+(ARGS.interval || 1200), {
  'api.github.com': 7000,
  'hn.algolia.com': 500,
  'registry.modelcontextprotocol.io': 600,
  'www.producthunt.com': 1800,
  'producthunt.com': 1800,
  'startupranking.com': 1500,
  'www.startupranking.com': 1500,
  'openfuture.ai': 1000,
  'ecomm.design': 800,
  'huntscreens.com': 1500,
  'betalist.com': 1500,
}, log);

function shanghaiToday(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 10);
}
function slugToName(slug: string): string {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\s+/g, ' ').trim();
}
function decodeHtml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function bump(key: string, ins: number, upd: number, found: number, note?: string) {
  const b = stats.by[key] || (stats.by[key] = { inserted: 0, updated: 0, found: 0 });
  b.inserted += ins; b.updated += upd; b.found += found; if (note) b.note = note;
}

async function ingest(db: DB, src: any, strategy: string, items: CrawlItem[], opts: { keepNoise?: boolean } = {}) {
  let inserted = 0, updated = 0, n = 0;
  db.tx(() => {
    for (const it of items) {
      if (!it.name || it.name.length < 2) continue;
      if (!opts.keepNoise && isArticleNoise(it.name, it.url)) { stats.noise++; continue; }
      const date = it.date ? String(it.date).slice(0, 10) : null;
      try {
        const r = upsertProduct(db, {
          name: it.name, url: it.url, tagline: it.tagline, description: it.description,
          logo_url: it.image, votes: it.votes, launch_date: date,
        }, { sourceGuid: src.guid, origin: 'crawl-delta-fix', versionLabel: src.name });
        n++;
        if (r.status === 'inserted') inserted++;
        else if (r.status === 'updated' || (r as any).newVersion) updated++;
      } catch { /* skip */ }
    }
  });
  stats.found += n; stats.inserted += inserted; stats.updated += updated;
  const pc = db.get<any>('SELECT COUNT(DISTINCT product_guid) c FROM product_versions WHERE source_guid=?', [src.guid]).c;
  db.run('UPDATE sources SET last_crawl_at=?, last_status=?, last_error=NULL, product_count=? WHERE guid=?', [now(), pc ? 'ok' : 'empty', pc, src.guid]);
  db.run(
    'INSERT OR REPLACE INTO crawl_state(source_guid,strategy,cursor,pages,items,inserted,status,earliest,last_error,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    [src.guid, strategy, null, 1, n, inserted, 'done', null, null, now()],
  );
  return { n, inserted, updated, pc };
}

function parseAtomEntries(xml: string): CrawlItem[] {
  const out: CrawlItem[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const block = m[1];
    const title = (block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1];
    const link = (block.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/) || block.match(/<link[^>]*href="([^"]+)"/) || [])[1];
    const published = (block.match(/<published>([^<]+)/) || block.match(/<updated>([^<]+)/) || [])[1];
    const summary = (block.match(/<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/) || block.match(/<content[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content>/) || [])[1];
    if (!title) continue;
    const name = decodeHtml(title).slice(0, 200);
    const tagline = summary ? decodeHtml(summary).slice(0, 300) : null;
    out.push({ name, url: link || null, tagline, description: tagline, date: published ? published.slice(0, 10) : null });
  }
  return out;
}

/** Product Hunt：多分类 Atom，补 10-21～今天缺口 */
async function phFix(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=1'); if (!src) return;
  log('▶ Product Hunt 多分类 Atom 补缺口');
  const cats = [
    '', 'artificial-intelligence', 'developer-tools', 'productivity', 'saas', 'design',
    'marketing', 'no-code', 'open-source', 'chrome-extensions', 'ios', 'android', 'mac',
    'web-app', 'tech', 'artificial_intelligence', 'finance', 'health-fitness', 'games',
    'social-media', 'photo-video', 'writing', 'education', 'growth-hacking', 'sales',
    'customer-communication', 'analytics', 'prototyping', 'wearables', 'virtual-assistants',
    'artificial-intelligence-1', 'developer-tools-2', 'link-in-bio',
  ];
  const seen = new Set<string>();
  const all: CrawlItem[] = [];
  for (const cat of cats) {
    const u = cat ? `https://www.producthunt.com/feed?category=${encodeURIComponent(cat)}` : 'https://www.producthunt.com/feed';
    const r = await pf.fetch(u);
    if (r.status >= 400) { log(`  PH feed ${cat || 'default'} HTTP ${r.status}`); continue; }
    const rows = parseAtomEntries(r.text);
    let added = 0;
    for (const it of rows) {
      const key = (it.url || it.name).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(it); added++;
    }
    log(`  PH ${cat || 'default'}: +${added}/${rows.length}`);
  }
  const res = await ingest(db, src, 'ph-atom-categories-fix', all, { keepNoise: true });
  bump('Product Hunt', res.inserted, res.updated, res.n, `atom categories ${cats.length}`);
  stats.fixed.push('Product Hunt: 多分类 Atom 覆盖 10-21～11-07 缺口（榜单仍 CF）');
  fs.writeFileSync(path.join(DELTA, 'fix-ph.json'), JSON.stringify({ seq: 1, strategy: 'ph-atom-categories-fix', rows: all }, null, 0));
  log(`✔ PH: upsert ${res.n} 新${res.inserted} 更新${res.updated} unique=${all.length}`);
}

/** HuntScreens：EN sitemap 产品 slug 入库 */
async function hsFix(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=366'); if (!src) return;
  log('▶ HuntScreens EN sitemap');
  let xml = '';
  const cached = '/tmp/hs-en.xml';
  if (fs.existsSync(cached) && fs.statSync(cached).size > 1_000_000) {
    xml = fs.readFileSync(cached, 'utf8');
    log(`  使用缓存 ${cached} ${(xml.length / 1e6).toFixed(1)}MB`);
  } else {
    const r = await pf.fetch('https://huntscreens.com/sitemaps/en', { maxRetries: 2 });
    if (r.status >= 400) { log(`  HS sitemap HTTP ${r.status}`); stats.failed.push({ name: 'HuntScreens', error: `HTTP ${r.status}` }); return; }
    xml = r.text;
  }
  const locs = [...xml.matchAll(/<loc>\s*(https:\/\/huntscreens\.com\/products\/[^<\s]+)\s*<\/loc>/g)].map(m => m[1]);
  const all: CrawlItem[] = [];
  for (const loc of locs) {
    const slug = decodeURIComponent(loc.split('/products/')[1] || '').replace(/\/$/, '');
    if (!slug || slug.length < 2) continue;
    all.push({ name: slugToName(slug), url: loc, tagline: null, description: null, date: null });
  }
  log(`  sitemap 产品 URL ${all.length}`);
  const res = await ingest(db, src, 'huntscreens-sitemap-en-fix', all, { keepNoise: true });
  bump('HuntScreens', res.inserted, res.updated, res.n);
  stats.fixed.push('HuntScreens: EN sitemap（~26k URLs）补全首页浅抓遗漏');
  // 不落超大 JSON，只记摘要
  fs.writeFileSync(path.join(DELTA, 'fix-hs-summary.json'), JSON.stringify({ seq: 366, strategy: 'huntscreens-sitemap-en-fix', urls: all.length, inserted: res.inserted, updated: res.updated, pc: res.pc }));
  log(`✔ HS: upsert ${res.n} 新${res.inserted} 更新${res.updated}`);
}

function parseStartupRankingPage(html: string): CrawlItem[] {
  const out: CrawlItem[] = [];
  for (const m of html.matchAll(/<a class="rnk-name" href="(\/startup\/[a-z0-9-]+)">([^<]+)<\/a>\s*<span class="rnk-startup__desc">([^<]*)<\/span>/g)) {
    out.push({
      name: decodeHtml(m[2]),
      url: 'https://www.startupranking.com' + m[1],
      tagline: decodeHtml(m[3]).slice(0, 280) || null,
      description: decodeHtml(m[3]).slice(0, 600) || null,
      date: null,
    });
  }
  // new startups page alternate markup
  if (!out.length) {
    for (const m of html.matchAll(/href="(\/startup\/([a-z0-9-]+))"[^>]*>[\s\S]{0,400}?nws-startup__blurb[^>]*>([^<]*)/g)) {
      out.push({
        name: slugToName(m[2]),
        url: 'https://www.startupranking.com' + m[1],
        tagline: decodeHtml(m[3]).slice(0, 280) || null,
        description: decodeHtml(m[3]).slice(0, 600) || null,
        date: null,
      });
    }
  }
  if (!out.length) {
    const links = [...html.matchAll(/href="(\/startup\/([a-z0-9-]+))"/g)].map(m => m);
    const seen = new Set<string>();
    for (const m of links) {
      const slug = m[2]; if (slug === 'new' || seen.has(slug)) continue; seen.add(slug);
      out.push({ name: slugToName(slug), url: 'https://www.startupranking.com' + m[1], tagline: null, description: null, date: null });
    }
  }
  return out;
}

/** Startup Ranking：修复选择器，抓 top 分页 + new */
async function srFix(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=131'); if (!src) return;
  log('▶ Startup Ranking 修复（原 0 产品，选择器失效）');
  const rule = {
    mode: 'html',
    listUrl: 'https://startupranking.com/top',
    itemSelector: 'a.rnk-name',
    fields: {
      name: { selector: null, attr: null, text: true },
      url: { attr: 'href' },
      description: { selector: '.rnk-startup__desc' },
    },
    note: 'fix-2026-11-09: rnk-name + top/{n} 分页',
  };
  db.run('UPDATE sources SET rule_json=? WHERE guid=?', [JSON.stringify(rule), src.guid]);

  const all: CrawlItem[] = [];
  const seen = new Set<string>();
  const maxPages = +(ARGS.srPages || 40);
  for (let p = 1; p <= maxPages; p++) {
    const u = p === 1 ? 'https://startupranking.com/top' : `https://startupranking.com/top/${p}`;
    const r = await pf.fetch(u);
    if (r.status >= 400) { log(`  SR top/${p} HTTP ${r.status}`); break; }
    const rows = parseStartupRankingPage(r.text);
    let added = 0;
    for (const it of rows) {
      const k = (it.url || it.name).toLowerCase();
      if (seen.has(k)) continue; seen.add(k); all.push(it); added++;
    }
    log(`  SR top/${p}: +${added} 累计 ${all.length}`);
    if (added === 0) break;
  }
  // new startups (单页约 300)
  {
    const r = await pf.fetch('https://startupranking.com/startup/new');
    if (r.status < 400) {
      const rows = parseStartupRankingPage(r.text);
      let added = 0;
      for (const it of rows) {
        const k = (it.url || it.name).toLowerCase();
        if (seen.has(k)) continue; seen.add(k); all.push(it); added++;
      }
      log(`  SR new: +${added}`);
    }
  }
  // 几个大国榜
  for (const c of ['united-states', 'india', 'united-kingdom', 'germany', 'canada', 'france', 'singapore', 'australia']) {
    const r = await pf.fetch(`https://startupranking.com/top/country/${c}`);
    if (r.status >= 400) continue;
    const rows = parseStartupRankingPage(r.text);
    let added = 0;
    for (const it of rows) {
      const k = (it.url || it.name).toLowerCase();
      if (seen.has(k)) continue; seen.add(k); all.push(it); added++;
    }
    log(`  SR country/${c}: +${added}`);
  }

  const res = await ingest(db, src, 'startupranking-top-fix', all, { keepNoise: true });
  bump('Startup Ranking', res.inserted, res.updated, res.n);
  stats.fixed.push(`Startup Ranking: 修复规则为 a.rnk-name + top 分页；入库 ${res.pc}`);
  fs.writeFileSync(path.join(DELTA, 'fix-sr.json'), JSON.stringify({ seq: 131, strategy: 'startupranking-top-fix', rows: all }, null, 0));
  log(`✔ SR: upsert ${res.n} 新${res.inserted} 更新${res.updated} pc=${res.pc}`);
}

/** OpenFuture：分类页浅抓（sitemap 超时则用分类） */
async function ofFix(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=411'); if (!src) return;
  log('▶ OpenFuture AI 分类补抓');
  const home = await pf.fetch('https://openfuture.ai');
  if (home.status >= 400) {
    log(`  OF home HTTP ${home.status}`);
    stats.failed.push({ name: 'OpenFuture AI', error: `HTTP ${home.status}` });
    return;
  }
  const cats = [...new Set([...home.text.matchAll(/href="(\/ai-tools\/[^"#]+)"/g)].map(m => m[1]))];
  log(`  分类 ${cats.length}`);
  const rule = {
    mode: 'html',
    listUrl: 'https://openfuture.ai',
    itemSelector: 'a[href^="/tool/"]',
    fields: { name: { text: true }, url: { attr: 'href' } },
    note: 'fix-2026-11-09: /tool/ + /ai-tools/* 分类',
  };
  db.run('UPDATE sources SET rule_json=?, last_error=NULL WHERE guid=?', [JSON.stringify(rule), src.guid]);

  const seen = new Set<string>();
  const all: CrawlItem[] = [];
  const addFrom = (html: string) => {
    let n = 0;
    for (const m of html.matchAll(/href="(\/tool\/([^"#]+))"/g)) {
      const slug = m[2]; if (seen.has(slug)) continue; seen.add(slug);
      all.push({ name: slugToName(slug), url: 'https://openfuture.ai/tool/' + slug, tagline: null, description: null, date: null });
      n++;
    }
    return n;
  };
  addFrom(home.text);
  // 尝试 sitemap（可能失败）
  if (fs.existsSync('/tmp/of-tools.xml') && fs.statSync('/tmp/of-tools.xml').size > 10000) {
    const xml = fs.readFileSync('/tmp/of-tools.xml', 'utf8');
    let n = 0;
    for (const m of xml.matchAll(/<loc>\s*(https:\/\/openfuture\.ai\/tool\/([^<\s]+))\s*<\/loc>/g)) {
      const slug = m[2].replace(/\/$/, ''); if (seen.has(slug)) continue; seen.add(slug);
      all.push({ name: slugToName(slug), url: m[1], tagline: null, description: null, date: null }); n++;
    }
    log(`  sitemap 新增 ${n}`);
  } else {
    let i = 0;
    for (const cat of cats) {
      i++;
      const r = await pf.fetch('https://openfuture.ai' + cat);
      if (r.status >= 400) continue;
      const n = addFrom(r.text);
      if (i % 30 === 0 || i === cats.length) log(`  OF cats ${i}/${cats.length} 累计工具 ${all.length} (本页+${n})`);
    }
  }
  const res = await ingest(db, src, 'openfuture-categories-fix', all, { keepNoise: true });
  bump('OpenFuture AI', res.inserted, res.updated, res.n);
  stats.fixed.push(`OpenFuture AI: 首页现可访问；分类/sitemap 补抓，来源产品 ${res.pc}`);
  fs.writeFileSync(path.join(DELTA, 'fix-of-summary.json'), JSON.stringify({ seq: 411, urls: all.length, inserted: res.inserted, updated: res.updated, pc: res.pc }));
  log(`✔ OF: upsert ${res.n} 新${res.inserted} 更新${res.updated}`);
}

/** Ecomm Design：WP REST website/tool/app */
async function ecommFix(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=339'); if (!src) return;
  log('▶ Ecomm Design WP REST');
  const all: CrawlItem[] = [];
  for (const type of ['website', 'tool', 'app', 'platform']) {
    for (let page = 1; page <= 40; page++) {
      const u = `https://ecomm.design/wp-json/wp/v2/${type}?per_page=100&page=${page}&orderby=date&order=desc`;
      const r = await pf.fetch(u, { headers: { accept: 'application/json' } });
      if (r.status === 400 || r.status === 404) break;
      if (r.status >= 400) { log(`  ecomm ${type} p${page} HTTP ${r.status}`); break; }
      let arr: any[] = [];
      try { arr = JSON.parse(r.text); } catch { break; }
      if (!Array.isArray(arr) || !arr.length) break;
      for (const x of arr) {
        const name = decodeHtml(x.title?.rendered || x.slug || '');
        if (!name) continue;
        const website = x.acf?.website_url || null;
        const excerpt = x.excerpt?.rendered ? decodeHtml(x.excerpt.rendered).slice(0, 400) : null;
        all.push({
          name,
          url: website || x.link || null,
          tagline: excerpt,
          description: excerpt,
          date: (x.date || '').slice(0, 10) || null,
        });
      }
      log(`  ecomm ${type} p${page}: +${arr.length} 累计 ${all.length}`);
      if (arr.length < 100) break;
    }
  }
  db.run('UPDATE sources SET rule_json=? WHERE guid=?', [JSON.stringify({
    mode: 'api', listUrl: 'https://ecomm.design/wp-json/wp/v2/website', note: 'fix-2026-11-09 WP REST website/tool/app/platform',
  }), src.guid]);
  const res = await ingest(db, src, 'ecomm-wp-rest-fix', all, { keepNoise: true });
  bump('Ecomm Design', res.inserted, res.updated, res.n);
  stats.fixed.push(`Ecomm Design: 改 WP REST（website/tool/app/platform），绕过首页 403 浅抓`);
  fs.writeFileSync(path.join(DELTA, 'fix-ecomm-summary.json'), JSON.stringify({ seq: 339, rows: all.length, inserted: res.inserted, updated: res.updated, pc: res.pc }));
  log(`✔ Ecomm: upsert ${res.n} 新${res.inserted} 更新${res.updated}`);
}

async function mcpFix(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=125'); if (!src) return;
  log('▶ MCP Registry 续抓（提高页上限）');
  const out: CrawlItem[] = [];
  let cur: string | null = null; let pages = 0;
  const maxPages = +(ARGS.mcpPages || 800);
  while (pages < maxPages) {
    const u = 'https://registry.modelcontextprotocol.io/v0/servers?limit=100&version=latest' + (cur ? '&cursor=' + encodeURIComponent(cur) : '');
    let r: any = null;
    for (let t = 0; t < 4; t++) {
      r = await pf.fetch(u);
      if (r.status < 400) break;
      await new Promise(x => setTimeout(x, 2500));
    }
    if (!r || r.status >= 400) { log(`  MCP fail HTTP ${r?.status}`); break; }
    const j = JSON.parse(r.text);
    for (const s of j.servers || []) {
      const v = s.server; const m = s._meta?.['io.modelcontextprotocol.registry/official'] || {};
      if (m.isLatest === false) continue;
      out.push({
        name: v.title || v.name?.split('/')?.pop() || v.name,
        url: v.websiteUrl || v.repository?.url || null,
        tagline: v.description ? String(v.description).slice(0, 200) : null,
        description: v.description || null,
        date: (m.publishedAt || '').slice(0, 10) || null,
      });
    }
    pages++; cur = j.metadata?.nextCursor || null;
    if (pages % 50 === 0) log(`  MCP pages ${pages} items ${out.length}`);
    if (!cur) break;
  }
  const res = await ingest(db, src, 'mcp-registry-fix', out, { keepNoise: true });
  bump('MCP Registry', res.inserted, res.updated, res.n, `pages=${pages} cursorDone=${!cur}`);
  if (!cur) stats.fixed.push(`MCP Registry: 已拉完全量 latest（${pages} 页）`);
  else stats.fixed.push(`MCP Registry: 续跑至 ${pages} 页（仍有 cursor，可再提上限）`);
  fs.writeFileSync(path.join(DELTA, 'fix-mcp-summary.json'), JSON.stringify({ seq: 125, pages, items: out.length, inserted: res.inserted, updated: res.updated, pc: res.pc, hasMore: !!cur }));
  log(`✔ MCP: upsert ${res.n} 新${res.inserted} 更新${res.updated} pages ${pages}`);
}

async function githubFix(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=211') || db.get<any>('SELECT * FROM sources WHERE seq=636');
  if (!src) return;
  log('▶ GitHub 增量补（stars≥100, created 2026-10-01..今天）');
  const end = shanghaiToday();
  const windows = ['2026-10-01..2026-10-15', '2026-10-16..2026-10-31', `2026-11-01..${end}`];
  const all: CrawlItem[] = [];
  for (const w of windows) {
    for (let page = 1; page <= 10; page++) {
      const q = `stars:>=100 created:${w}`;
      const r = await pf.fetch(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=100&page=${page}`,
        { headers: { accept: 'application/vnd.github+json' } },
      );
      if (r.status === 403 || r.status === 422) {
        log(`  GitHub ${r.status} 等 65s`); await new Promise(x => setTimeout(x, 65000)); page--; continue;
      }
      if (r.status >= 400) { log(`  GitHub HTTP ${r.status}`); break; }
      const j = JSON.parse(r.text); const its: any[] = j.items || [];
      for (const x of its) {
        all.push({
          name: x.name,
          url: x.homepage && /^https?:/.test(x.homepage) ? x.homepage : x.html_url,
          tagline: x.description ? String(x.description).slice(0, 200) : null,
          description: [x.description, x.language && `Language: ${x.language}`, (x.topics || []).length && `Topics: ${x.topics.join(', ')}`, `GitHub: ${x.html_url}`].filter(Boolean).join('\n'),
          image: x.owner?.avatar_url ? x.owner.avatar_url + '&s=96' : null,
          votes: x.stargazers_count,
          date: x.created_at,
        });
      }
      log(`  GitHub ${w} p${page}: +${its.length}`);
      if (its.length < 100) break;
    }
  }
  const res = await ingest(db, src, 'github-search-fix', all);
  bump('GitHub', res.inserted, res.updated, res.n);
  log(`✔ GitHub: upsert ${res.n} 新${res.inserted} 更新${res.updated}`);
}

async function betalistFix(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=2'); if (!src) return;
  log('▶ BetaList 增量（前 60 页）');
  const { parseBetaListPage } = await import('../src/server/history');
  const all: CrawlItem[] = [];
  for (let page = 1; page <= 60; page++) {
    const r = await pf.fetch(`https://betalist.com/?page=${page}`);
    if (r.status >= 400) { log(`  BetaList HTTP ${r.status} @${page}`); break; }
    const rows = parseBetaListPage(r.text);
    if (!rows.length) break;
    for (const x of rows) all.push({ name: x.name, tagline: x.tagline, description: x.tagline, url: null, image: x.image, date: x.date });
    if (page % 15 === 0) log(`  BetaList p${page} 累计 ${all.length}`);
  }
  const res = await ingest(db, src, 'betalist-fix', all);
  bump('BetaList', res.inserted, res.updated, res.n);
  log(`✔ BetaList: upsert ${res.n} 新${res.inserted} 更新${res.updated}`);
}

async function sourcesPass(db: DB) {
  log('▶ 通用来源浅抓（避开长期封锁）');
  const SKIP_HOST = new Set([
    'reddit.com', 'old.reddit.com', 'www.reddit.com',
    'sourceforge.net', 'trustpilot.com', 'selecthub.com', 'spotsaas.com',
    'thingtesting.com', 'startupbuffer.com', 'nocode.tech', 'tools.so',
    'f6s.com', 'saaspo.com', 'itjuzi.com', 'web.okjike.com', 'coolapk.com',
    'pmthinking.com', 'fwol.cn', 'owler.com', 'getlatka.com', 'glama.ai',
    'eu-startups.com', 'e27.co', 'yourstory.com', 'geekwire.com', 'geekpark.net',
    'saashub.com', 'libhunt.com', 'alternativeto.net', 'capterra.com',
    'softwareadvice.com', 'softwareworld.co', 'serchen.com', 'saasworthy.com',
    'awesomeindie.com', 'everydev.ai',
  ]);
  const NEWS = new Set([152, 154, 173, 174, 175, 182, 183, 185, 186, 187, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 203, 204, 205, 206, 207, 208]);
  const DONE = new Set([1, 2, 125, 131, 162, 211, 339, 366, 411, 636]);
  const srcs = db.all<any>('SELECT * FROM sources WHERE enabled=1 ORDER BY product_count DESC, seq')
    .filter(s => {
      if (DONE.has(s.seq) || NEWS.has(s.seq)) return false;
      const host = String(s.host || '').replace(/^www\./, '');
      if (SKIP_HOST.has(host) || SKIP_HOST.has(String(s.host || ''))) return false;
      if (/reddit\.com/i.test(s.url || '')) return false;
      return (s.product_count || 0) >= 200 && s.last_status === 'ok';
    })
    .slice(0, +(ARGS.limit || 40));
  log(`  通用来源 ${srcs.length}`);
  let i = 0;
  await pool(srcs, +(ARGS.conc || 2), async (s) => {
    const idx = ++i;
    try {
      const r = await crawlSource(db, s.guid, { log: (m) => log(`  · ${s.name}: ${m}`) });
      stats.found += r.found || 0; stats.inserted += r.inserted || 0; stats.updated += r.updated || 0;
      bump(s.name, r.inserted || 0, r.updated || 0, r.found || 0);
      if (r.error) { stats.failed.push({ name: s.name, error: String(r.error).slice(0, 200) }); log(`✘ [${idx}] ${s.seq} ${s.name}: ${r.error}`); }
      else log(`✔ [${idx}] ${s.seq} ${s.name}: found ${r.found} 新${r.inserted} 更新${r.updated}`);
    } catch (e) {
      const msg = String((e as Error).message || e).slice(0, 200);
      stats.failed.push({ name: s.name, error: msg });
      log(`✘ [${idx}] ${s.seq} ${s.name}: ${msg}`);
    }
  });
}

function recordUnfixable() {
  const rows: { name: string; reason: string }[] = [
    { name: 'Reddit 各子版 (165-172)', reason: 'Reddit 网络级 403，需官方 API + OAuth，本环境不可用' },
    { name: 'SourceForge / Trustpilot / SelectHub / SpotSaaS', reason: 'Cloudflare/403 长期封锁，无合法公开 API/sitemap 可绕' },
    { name: 'SaaSHub / LibHunt / AlternativeTo / Capterra / Software Advice', reason: 'Cloudflare Just a moment；sitemap 同样 403；已有大量存量，暂不可增量' },
    { name: 'NoCode.Tech / Tools.so / EveryDev.ai / Awesome Indie', reason: 'Vercel Security Checkpoint 或 CF 403/429' },
    { name: 'F6S / Startup Buffer / Saaspo / Thingtesting 主站', reason: '浏览器挑战或 CF；Thingtesting 偏消费品牌非软件产品' },
    { name: 'IT桔子', reason: 'HTTP 412 / 反爬，需登录' },
    { name: '即刻 / 酷安 / 产品沉思录 / FWOL', reason: '空页/fetch failed/非产品列表，暂不可修' },
    { name: '新闻媒体源（36氪/少数派/爱范儿等）', reason: '按规则跳过文章站，只收产品' },
    { name: 'Product Hunt 日榜页', reason: 'Cloudflare 拦截 leaderboard；已用多分类 Atom 补近月缺口' },
  ];
  stats.unfixable.push(...rows);
}

(async () => {
  log(`==== crawl-delta-fix 启动 only=${[...ONLY]} today=${shanghaiToday()} ====`);
  const db = await DB.open(DBF);
  const before = db.get<any>('SELECT COUNT(*) p FROM products').p;
  log(`产品数 before=${before}`);
  recordUnfixable();

  if (ONLY.has('ph')) await phFix(db);
  if (ONLY.has('hs')) await hsFix(db);
  if (ONLY.has('sr')) await srFix(db);
  if (ONLY.has('of')) await ofFix(db);
  if (ONLY.has('ecomm')) await ecommFix(db);
  if (ONLY.has('mcp')) await mcpFix(db);
  if (ONLY.has('gh')) await githubFix(db);
  if (ONLY.has('bl')) await betalistFix(db);
  if (ONLY.has('sources')) await sourcesPass(db);

  const after = db.get<any>('SELECT COUNT(*) p FROM products').p;
  const summary = {
    started: new Date().toISOString(),
    finished: new Date().toISOString(),
    before, after, deltaProducts: after - before,
    found: stats.found, inserted: stats.inserted, updated: stats.updated, noise: stats.noise,
    by: stats.by, fixed: stats.fixed, failed: stats.failed, unfixable: stats.unfixable,
    requests: pf.stats,
  };
  fs.writeFileSync(path.join(DELTA, 'fix-summary.json'), JSON.stringify(summary, null, 2));
  db.setSetting('crawl.deltaFixFinishedAt', new Date().toISOString());
  db.saveNow();
  log(`==== 完成 products ${before} → ${after} (+${after - before}) 新=${stats.inserted} 更新=${stats.updated} ====`);
  process.exit(0);
})().catch(e => { log('FATAL ' + (e?.stack || e)); process.exit(1); });
