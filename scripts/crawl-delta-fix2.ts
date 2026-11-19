/**
 * 失败来源修复第二轮（至 2026-11-09）
 * 公开入口：sitemap / 分类页 / 增量 API；不打包、不整库备份。
 *
 *   PATH=.../node-v22.../bin:$PATH npx tsx scripts/crawl-delta-fix2.ts [--only=setapp,chip,aiom,osc,tai,wc,ph,gh,bl,mcp]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DB, now } from '../src/server/db';
import { upsertProduct } from '../src/server/products';
import { PoliteFetcher, CHROME_UA, isArticleNoise } from '../src/server/history';
import { CrawlItem } from '../src/server/crawler';
import { slugName } from '../src/server/util';

const ARGS = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']));
const ONLY = new Set(String(ARGS.only || 'setapp,chip,aiom,osc,tai,wc,ph,gh,bl,mcp').split(',').filter(Boolean));
const DIR = path.resolve('data/crawl');
const DBF = path.join(DIR, 'producthub.db');
const DELTA = path.resolve('data/delta');
const LOGF = path.resolve('logs/crawl-delta-fix2.log');
const TMP = path.resolve('data/delta/fix2-tmp');
fs.mkdirSync(DELTA, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(path.dirname(LOGF), { recursive: true });

const log = (s: string) => {
  const line = `[${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })}] ${s}`;
  fs.appendFileSync(LOGF, line + '\n');
  console.log(line);
};

const stats = {
  inserted: 0, updated: 0, found: 0, noise: 0, skippedExisting: 0,
  by: {} as Record<string, { inserted: number; updated: number; found: number; skipped?: number; note?: string }>,
  fixed: [] as string[],
  failed: [] as { name: string; error: string }[],
  unfixable: [] as { name: string; reason: string }[],
};

const pf = new PoliteFetcher(+(ARGS.interval || 1000), {
  'api.github.com': 7000,
  'registry.modelcontextprotocol.io': 600,
  'www.producthunt.com': 1800,
  'producthunt.com': 1800,
  'betalist.com': 1500,
  'setapp.com': 800,
  'cdn.setapp.com': 800,
  'www.chip.de': 900,
  'chip.de': 900,
  'www.aiopenminds.com': 600,
  'aiopenminds.com': 600,
  'www.oschina.net': 800,
  'oschina.net': 800,
  'tools-ai.online': 800,
  'www.tools-ai.online': 800,
  'webcatalog.io': 1000,
}, log);

function shanghaiToday(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 10);
}
function slugToName(slug: string): string {
  return decodeURIComponent(slug)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
}
function decodeHtml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function bump(key: string, ins: number, upd: number, found: number, extra?: { skipped?: number; note?: string }) {
  const b = stats.by[key] || (stats.by[key] = { inserted: 0, updated: 0, found: 0 });
  b.inserted += ins; b.updated += upd; b.found += found;
  if (extra?.skipped) b.skipped = (b.skipped || 0) + extra.skipped;
  if (extra?.note) b.note = extra.note;
}
function curlGet(url: string, outFile: string, timeoutSec = 60): { ok: boolean; status: number; size: number } {
  const r = spawnSync('curl', ['-sS', '-L', '--max-time', String(timeoutSec), '-A', CHROME_UA, '-o', outFile, '-w', '%{http_code}', url], { encoding: 'utf8' });
  const status = parseInt(String(r.stdout || '0').trim(), 10) || 0;
  const size = fs.existsSync(outFile) ? fs.statSync(outFile).size : 0;
  if (r.error) log(`  curl err ${url}: ${r.error.message}`);
  return { ok: status >= 200 && status < 400 && size > 50, status, size };
}
function parseLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim()).filter(Boolean);
}
const NOISE_NAME = /^(登录|注册|关于我们|公司动态|帮助中心|首页|home|about|contact|privacy|terms|blog|news|login|signup|sign up|categories|tools|frameworks|ui ux tips)$/i;
function existingNamesForSource(db: DB, sourceGuid: string): Set<string> {
  const set = new Set<string>();
  const rows = db.all<any>(
    `SELECT p.name FROM products p JOIN product_versions v ON v.product_guid=p.guid WHERE v.source_guid=?`,
    [sourceGuid],
  );
  for (const r of rows) set.add(slugName(r.name));
  return set;
}

async function ingest(db: DB, src: any, strategy: string, items: CrawlItem[], opts: { skipExistingNames?: Set<string>; keepNoise?: boolean } = {}) {
  let inserted = 0, updated = 0, n = 0, skipped = 0;
  const batch: CrawlItem[] = [];
  for (const it of items) {
    if (!it.name || it.name.length < 2) continue;
    if (!opts.keepNoise && (isArticleNoise(it.name, it.url) || NOISE_NAME.test(it.name.trim()))) { stats.noise++; continue; }
    if (opts.skipExistingNames && opts.skipExistingNames.has(slugName(it.name))) { skipped++; continue; }
    batch.push(it);
  }
  for (let i = 0; i < batch.length; i += 2000) {
    const chunk = batch.slice(i, i + 2000);
    db.tx(() => {
      for (const it of chunk) {
        const date = it.date ? String(it.date).slice(0, 10) : null;
        try {
          const r = upsertProduct(db, {
            name: it.name, url: it.url, tagline: it.tagline, description: it.description,
            logo_url: it.image, votes: it.votes, launch_date: date,
          }, { sourceGuid: src.guid, origin: 'crawl-delta-fix2', versionLabel: src.name });
          n++;
          if (r.status === 'inserted') {
            inserted++;
            if (opts.skipExistingNames) opts.skipExistingNames.add(slugName(it.name));
          } else if (r.status === 'updated' || (r as any).newVersion) updated++;
        } catch { /* skip */ }
      }
    });
  }
  stats.found += n; stats.inserted += inserted; stats.updated += updated; stats.skippedExisting += skipped;
  const pc = db.get<any>('SELECT COUNT(DISTINCT product_guid) c FROM product_versions WHERE source_guid=?', [src.guid]).c;
  db.run('UPDATE sources SET last_crawl_at=?, last_status=?, last_error=NULL, product_count=? WHERE guid=?', [now(), pc ? 'ok' : 'empty', pc, src.guid]);
  db.run(
    'INSERT OR REPLACE INTO crawl_state(source_guid,strategy,cursor,pages,items,inserted,status,earliest,last_error,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    [src.guid, strategy, null, 1, n, inserted, 'done', null, null, now()],
  );
  return { n, inserted, updated, pc, skipped };
}

/** Setapp：sitemap 应用页（原 RSS 尽是博客） */
async function setappFix(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=238'); if (!src) return;
  log('▶ Setapp sitemap apps');
  const sm = path.join(TMP, 'setapp-sitemap.xml');
  const r = curlGet('https://setapp.com/sitemap/sitemap.xml', sm, 60);
  if (!r.ok) { stats.failed.push({ name: 'Setapp', error: `sitemap HTTP ${r.status}` }); return; }
  const locs = parseLocs(fs.readFileSync(sm, 'utf8')).filter(u => /\/apps\/[a-z0-9-]+$/i.test(u));
  const items: CrawlItem[] = [];
  const seen = new Set<string>();
  for (const u of locs) {
    const slug = u.split('/apps/')[1];
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    items.push({ name: slugToName(slug), url: `https://setapp.com/apps/${slug}`, tagline: 'Mac app on Setapp', description: null });
  }
  const res = await ingest(db, src, 'setapp-sitemap-fix2', items, { keepNoise: true });
  bump('Setapp', res.inserted, res.updated, res.n, { note: `sitemapApps=${items.length}` });
  stats.fixed.push(`Setapp: sitemap ${items.length} 应用，新产品 +${res.inserted}，来源 ${res.pc}`);
  log(`✔ Setapp: items ${items.length} upsert ${res.n} 新${res.inserted} 更新${res.updated} pc=${res.pc}`);
}

/** CHIP Downloads：分类目录分页 */
async function chipFix(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=567'); if (!src) return;
  log('▶ CHIP Downloads 分类分页');
  const cats = [
    'system-tuning', 'multimedia-kreativtools', 'browser-kommunikation-online-tools', 'android-apps',
    'office-produktivitaet-finanzen', 'security-datenschutz', 'spiele-unterhaltung', 'windows-apps-microsoft-store',
    'macos-apps', 'linux-apps', 'iphone-ipad-apps', 'browser-addons', 'betriebssysteme-distributionen',
    'apk-android-apps-chip-exklusiv',
    // skip handbuecher-vorlagen（模板/文书，非软件产品）
  ];
  const maxPage = +(ARGS.chipPages || 30);
  const seen = new Set<string>();
  const items: CrawlItem[] = [];
  for (const cat of cats) {
    for (let page = 1; page <= maxPage; page++) {
      const url = page === 1
        ? `https://www.chip.de/download/${cat}/`
        : `https://www.chip.de/download/${cat}/${page}`;
      const f = path.join(TMP, `chip-${cat}-${page}.html`);
      const r = curlGet(url, f, 30);
      if (!r.ok) { log(`  CHIP ${cat} p${page} HTTP ${r.status}`); break; }
      const html = fs.readFileSync(f, 'utf8');
      const hrefs = [...html.matchAll(/href="(\/download\/[^"/]+\/[^"/]+_[a-f0-9-]{36}\.html)"/g)].map(m => m[1]);
      let added = 0;
      for (const href of hrefs) {
        const file = href.split('/').pop() || '';
        const m = file.match(/^(.+)_([a-f0-9-]{36})\.html$/i);
        if (!m) continue;
        const id = m[2];
        if (seen.has(id)) continue;
        seen.add(id);
        const name = slugToName(m[1].replace(/-\d+-bit$/i, '').replace(/-64-bit$/i, '').replace(/-32-bit$/i, ''));
        if (name.length < 2) continue;
        items.push({
          name,
          url: `https://www.chip.de/d/${id}`,
          tagline: `CHIP download · ${cat}`,
          description: null,
        });
        added++;
      }
      if (page === 1 || page % 5 === 0) log(`  CHIP ${cat} p${page}: +${added} (total ${items.length})`);
      if (added === 0 && page > 1) break;
      // stop if pagination link to next missing
      if (page > 1 && !html.includes(`/download/${cat}/${page + 1}`) && !html.includes(`>${page + 1}<`)) {
        // allow last page
        if (!hrefs.length) break;
      }
      try { fs.unlinkSync(f); } catch { /* */ }
    }
  }
  const res = await ingest(db, src, 'chip-download-fix2', items, { keepNoise: true });
  bump('CHIP Downloads', res.inserted, res.updated, res.n, { note: `unique=${items.length}` });
  stats.fixed.push(`CHIP Downloads: 分类抓取 ${items.length}，新产品 +${res.inserted}`);
  log(`✔ CHIP: items ${items.length} upsert ${res.n} 新${res.inserted} pc=${res.pc}`);
}

/** aiopenminds：sitemap-tools（对已有名跳过，避免与 null-URL 存量撞成双份） */
async function aiomFix(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=266'); if (!src) return;
  log('▶ aiopenminds sitemap-tools');
  const sm = path.join(TMP, 'aiom-tools.xml');
  const r = curlGet('https://www.aiopenminds.com/sitemap-tools.xml', sm, 90);
  if (!r.ok) { stats.failed.push({ name: 'aiopenminds.com', error: `sitemap HTTP ${r.status}` }); return; }
  const locs = parseLocs(fs.readFileSync(sm, 'utf8'));
  const existing = existingNamesForSource(db, src.guid);
  const items: CrawlItem[] = [];
  const seen = new Set<string>();
  for (const u of locs) {
    const m = u.match(/\/(?:en\/)?tool\/([^/?#]+)/i);
    if (!m) continue;
    const slug = m[1];
    if (seen.has(slug)) continue;
    seen.add(slug);
    const name = slugToName(slug);
    if (name.length < 2) continue;
    items.push({ name, url: `https://www.aiopenminds.com/tool/${slug}`, tagline: 'AI tool', description: null });
  }
  const res = await ingest(db, src, 'aiom-sitemap-fix2', items, { skipExistingNames: existing, keepNoise: true });
  bump('aiopenminds.com', res.inserted, res.updated, res.n, { skipped: res.skipped, note: `sitemapTools=${seen.size}` });
  stats.fixed.push(`aiopenminds: sitemap ${seen.size}，跳过已有名 ${res.skipped}，新产品 +${res.inserted}，来源 ${res.pc}`);
  log(`✔ aiom: sitemap ${seen.size} upsert ${res.n} 新${res.inserted} skip ${res.skipped} pc=${res.pc}`);
  try { fs.unlinkSync(sm); } catch { /* */ }
}

/** OSCHINA：项目 sitemap 仅补新名 */
async function oscFix(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=215'); if (!src) return;
  log('▶ OSCHINA 项目 sitemap 增量');
  const existing = existingNamesForSource(db, src.guid);
  const items: CrawlItem[] = [];
  const seen = new Set<string>();
  for (const page of [1, 2]) {
    const sm = path.join(TMP, `osc-p${page}.xml`);
    const r = curlGet(`https://www.oschina.net/sitemap-projects.xml?page=${page}`, sm, 120);
    if (!r.ok) { log(`  OSC page ${page} HTTP ${r.status}`); continue; }
    const locs = parseLocs(fs.readFileSync(sm, 'utf8'));
    log(`  OSC page ${page}: locs ${locs.length}`);
    for (const u of locs) {
      const m = u.match(/\/p\/([^/?#]+)/);
      if (!m) continue;
      const slug = m[1];
      if (seen.has(slug)) continue;
      seen.add(slug);
      const name = slugToName(slug);
      if (name.length < 2 || NOISE_NAME.test(name)) continue;
      items.push({ name, url: `https://www.oschina.net/p/${slug}`, tagline: '开源项目', description: null });
    }
    try { fs.unlinkSync(sm); } catch { /* */ }
  }
  const res = await ingest(db, src, 'osc-sitemap-fix2', items, { skipExistingNames: existing, keepNoise: true });
  bump('开源中国 OSCHINA', res.inserted, res.updated, res.n, { skipped: res.skipped, note: `sitemap=${seen.size}` });
  stats.fixed.push(`OSCHINA: sitemap ${seen.size}，跳过已有 ${res.skipped}，新产品 +${res.inserted}，来源 ${res.pc}`);
  log(`✔ OSC: sitemap ${seen.size} upsert ${res.n} 新${res.inserted} skip ${res.skipped} pc=${res.pc}`);
}

/** Tools AI Online：sitemap /tools/* */
async function taiFix(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=506'); if (!src) return;
  log('▶ Tools AI Online sitemap');
  const sm = path.join(TMP, 'tai-sitemap.xml');
  const r = curlGet('https://www.tools-ai.online/sitemap.xml', sm, 90);
  if (!r.ok) { stats.failed.push({ name: 'Tools AI Online', error: `sitemap HTTP ${r.status}` }); return; }
  const locs = parseLocs(fs.readFileSync(sm, 'utf8')).filter(u => /\/tools\/[^/?#]+$/i.test(u));
  const existing = existingNamesForSource(db, src.guid);
  const items: CrawlItem[] = [];
  const seen = new Set<string>();
  for (const u of locs) {
    const slug = u.split('/tools/')[1];
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    items.push({ name: slugToName(slug), url: `https://tools-ai.online/tools/${slug}`, tagline: 'AI tool', description: null });
  }
  const res = await ingest(db, src, 'tai-sitemap-fix2', items, { skipExistingNames: existing, keepNoise: true });
  bump('Tools AI Online', res.inserted, res.updated, res.n, { skipped: res.skipped, note: `sitemapTools=${seen.size}` });
  stats.fixed.push(`Tools AI Online: sitemap ${seen.size}，跳过 ${res.skipped}，新产品 +${res.inserted}`);
  log(`✔ TAI: ${seen.size} upsert ${res.n} 新${res.inserted} skip ${res.skipped} pc=${res.pc}`);
  try { fs.unlinkSync(sm); } catch { /* */ }
}

/** WebCatalog：列表页应用链接（存量用名跳过） */
async function wcFix(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=58'); if (!src) return;
  log('▶ WebCatalog 列表页');
  const existing = existingNamesForSource(db, src.guid);
  const pages = ['https://webcatalog.io/en/apps', 'https://webcatalog.io/en/apps/popular'];
  const items: CrawlItem[] = [];
  const seen = new Set<string>();
  for (const url of pages) {
    const f = path.join(TMP, 'wc-' + url.split('/').pop() + '.html');
    const r = curlGet(url, f, 40);
    if (!r.ok) { log(`  WC ${url} HTTP ${r.status}`); continue; }
    const html = fs.readFileSync(f, 'utf8');
    for (const m of html.matchAll(/href="\/en\/apps\/([a-z0-9-]+)"/g)) {
      const slug = m[1];
      if (['popular', 'categories', 'new'].includes(slug) || seen.has(slug)) continue;
      seen.add(slug);
      items.push({ name: slugToName(slug), url: `https://webcatalog.io/apps/${slug}`, tagline: 'Desktop app', description: null });
    }
    try { fs.unlinkSync(f); } catch { /* */ }
  }
  const res = await ingest(db, src, 'webcatalog-list-fix2', items, { skipExistingNames: existing, keepNoise: true });
  bump('WebCatalog', res.inserted, res.updated, res.n, { skipped: res.skipped, note: `listApps=${seen.size}` });
  if (res.inserted > 0) stats.fixed.push(`WebCatalog: 列表 ${seen.size}，新产品 +${res.inserted}`);
  log(`✔ WC: ${seen.size} upsert ${res.n} 新${res.inserted} skip ${res.skipped} pc=${res.pc}`);
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
    out.push({
      name: decodeHtml(title).slice(0, 200),
      url: link || null,
      tagline: summary ? decodeHtml(summary).slice(0, 300) : null,
      description: summary ? decodeHtml(summary).slice(0, 800) : null,
      date: published ? published.slice(0, 10) : null,
    });
  }
  return out;
}

async function phFix(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=1'); if (!src) return;
  log('▶ Product Hunt 分类 Atom 今日增量');
  const cats = ['', 'artificial-intelligence', 'developer-tools', 'productivity', 'saas', 'design', 'marketing', 'no-code', 'open-source', 'web-app', 'tech'];
  const seen = new Set<string>();
  const all: CrawlItem[] = [];
  for (const c of cats) {
    const url = c ? `https://www.producthunt.com/feed?category=${c}` : 'https://www.producthunt.com/feed';
    const r = await pf.fetch(url);
    if (r.status >= 400) { log(`  PH feed ${c || 'all'} HTTP ${r.status}`); continue; }
    for (const it of parseAtomEntries(r.text)) {
      const k = (it.url || it.name).toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      all.push(it);
    }
  }
  const res = await ingest(db, src, 'ph-atom-fix2', all);
  bump('Product Hunt', res.inserted, res.updated, res.n);
  log(`✔ PH: ${all.length} upsert ${res.n} 新${res.inserted}`);
}

async function githubFix(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=211') || db.get<any>('SELECT * FROM sources WHERE seq=636');
  if (!src) return;
  log('▶ GitHub 近窗增量');
  const end = shanghaiToday();
  const windows = [`2026-11-01..${end}`, '2026-10-20..2026-10-31'];
  const all: CrawlItem[] = [];
  for (const w of windows) {
    for (let page = 1; page <= 5; page++) {
      const q = `stars:>=50 created:${w}`;
      const r = await pf.fetch(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=100&page=${page}`,
        { headers: { accept: 'application/vnd.github+json' } },
      );
      if (r.status === 403 || r.status === 422) { log(`  GH ${r.status} wait`); await new Promise(x => setTimeout(x, 65000)); page--; continue; }
      if (r.status >= 400) { log(`  GH HTTP ${r.status}`); break; }
      const its: any[] = JSON.parse(r.text).items || [];
      for (const x of its) {
        all.push({
          name: x.name,
          url: x.homepage && /^https?:/.test(x.homepage) ? x.homepage : x.html_url,
          tagline: x.description ? String(x.description).slice(0, 200) : null,
          description: [x.description, x.language && `Language: ${x.language}`, `GitHub: ${x.html_url}`].filter(Boolean).join('\n'),
          image: x.owner?.avatar_url ? x.owner.avatar_url + '&s=96' : null,
          votes: x.stargazers_count,
          date: x.created_at,
        });
      }
      if (its.length < 100) break;
    }
  }
  const res = await ingest(db, src, 'github-fix2', all);
  bump('GitHub', res.inserted, res.updated, res.n);
  log(`✔ GitHub: upsert ${res.n} 新${res.inserted}`);
}

async function betalistFix(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=2'); if (!src) return;
  log('▶ BetaList 前 30 页');
  const { parseBetaListPage } = await import('../src/server/history');
  const all: CrawlItem[] = [];
  for (let page = 1; page <= 30; page++) {
    const r = await pf.fetch(`https://betalist.com/?page=${page}`);
    if (r.status >= 400) break;
    const rows = parseBetaListPage(r.text);
    if (!rows.length) break;
    for (const x of rows) all.push({ name: x.name, tagline: x.tagline, description: x.tagline, url: null, image: x.image, date: x.date });
  }
  const res = await ingest(db, src, 'betalist-fix2', all);
  bump('BetaList', res.inserted, res.updated, res.n);
  log(`✔ BetaList: upsert ${res.n} 新${res.inserted}`);
}

async function mcpFix(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=125'); if (!src) return;
  log('▶ MCP Registry 增量（最多 80 页）');
  const all: CrawlItem[] = [];
  let cur: string | null = null;
  let pages = 0;
  while (pages < 80) {
    pages++;
    const url = cur
      ? `https://registry.modelcontextprotocol.io/v0.1/servers?limit=100&cursor=${encodeURIComponent(cur)}`
      : 'https://registry.modelcontextprotocol.io/v0.1/servers?limit=100';
    const r = await pf.fetch(url);
    if (r.status >= 400) { log(`  MCP HTTP ${r.status}`); break; }
    const j = JSON.parse(r.text);
    const servers = j.servers || j.items || [];
    for (const s of servers) {
      const server = s.server || s;
      const name = server.name || server.title;
      if (!name) continue;
      const repo = server.repository?.url || server.websiteUrl || null;
      all.push({
        name: String(name).split('/').pop() || name,
        url: repo,
        tagline: server.description ? String(server.description).slice(0, 200) : 'MCP Server',
        description: server.description || null,
      });
    }
    cur = j.metadata?.nextCursor || j.nextCursor || null;
    if (!cur) break;
  }
  const res = await ingest(db, src, 'mcp-fix2', all, { keepNoise: true });
  bump('Official MCP Registry', res.inserted, res.updated, res.n, { note: `pages=${pages}` });
  log(`✔ MCP: pages ${pages} upsert ${res.n} 新${res.inserted}`);
}

function recordUnfixable() {
  stats.unfixable.push(
    { name: 'Reddit 各子版 (165-172)', reason: 'Reddit 网络级 403，需官方 API + OAuth' },
    { name: 'SourceForge / Trustpilot / SelectHub / SpotSaaS / Startup Buffer / Saaspo', reason: 'Cloudflare 403，sitemap/API 同挡' },
    { name: 'SaaSHub / LibHunt / AlternativeTo / Capterra / Software Advice / Awesome Indie', reason: 'CF Just a moment；已有大量存量，增量暂不可' },
    { name: 'NoCode.Tech / Tools.so / EveryDev.ai', reason: 'Vercel Security Checkpoint / 429 / 超时' },
    { name: 'F6S', reason: '浏览器挑战页 Checking your browser' },
    { name: 'IT桔子', reason: 'HTTP 412 / 反爬，需登录' },
    { name: 'EU-Startups', reason: 'RSS/主站均 CF 403' },
    { name: 'e27 / YourStory / GeekWire / 极客公园 RSS', reason: 'RSS 可通但是新闻站，按规则不入库文章' },
    { name: '即刻 / 酷安 / 产品沉思录 / FWOL / Forinov', reason: '空页/登录墙/fetch failed' },
    { name: 'Thingtesting', reason: '主站 CF 403；sitemap 偏消费品牌' },
    { name: 'DEV / Hashnode / Sidebar / Starter Story / PR TIMES / EnGadget 等', reason: '社区/故事/新闻/公关，非稳定产品目录' },
    { name: 'Product Hunt 日榜 HTML', reason: 'CF；继续用分类 Atom 补' },
  );
}

(async () => {
  log(`==== crawl-delta-fix2 启动 only=${[...ONLY]} today=${shanghaiToday()} ====`);
  const db = await DB.open(DBF);
  const before = db.get<any>('SELECT COUNT(*) p FROM products').p;
  const dayStart = 1386886;
  log(`产品数 before=${before}`);
  recordUnfixable();

  if (ONLY.has('setapp')) await setappFix(db);
  if (ONLY.has('chip')) await chipFix(db);
  if (ONLY.has('aiom')) await aiomFix(db);
  if (ONLY.has('osc')) await oscFix(db);
  if (ONLY.has('tai')) await taiFix(db);
  if (ONLY.has('wc')) await wcFix(db);
  if (ONLY.has('ph')) await phFix(db);
  if (ONLY.has('gh')) await githubFix(db);
  if (ONLY.has('bl')) await betalistFix(db);
  if (ONLY.has('mcp')) await mcpFix(db);

  const after = db.get<any>('SELECT COUNT(*) p FROM products').p;
  const keySeqs = [1, 2, 58, 125, 211, 215, 238, 266, 506, 567];
  const keySources = keySeqs.map(seq => {
    const s = db.get<any>('SELECT seq,name,product_count,last_status FROM sources WHERE seq=?', [seq]);
    return s;
  }).filter(Boolean);

  const summary = {
    timezone: 'Asia/Shanghai',
    finishedAt: new Date().toISOString(),
    before, after, delta: after - before,
    dayStart, dayDelta: after - dayStart,
    found: stats.found, inserted: stats.inserted, updated: stats.updated,
    noise: stats.noise, skippedExisting: stats.skippedExisting,
    by: stats.by, fixed: stats.fixed, failed: stats.failed, unfixable: stats.unfixable,
    keySources, packed: false,
  };
  fs.writeFileSync(path.join(DELTA, 'fix2-summary.json'), JSON.stringify(summary, null, 2));
  db.setSetting('crawl.deltaFix2FinishedAt', new Date().toISOString());
  db.saveNow();
  log(`==== 完成 products ${before} → ${after} (+${after - before}) 新=${stats.inserted} 更新=${stats.updated} skipExisting=${stats.skippedExisting} ====`);
  process.exit(0);
})().catch(e => { log('FATAL ' + (e?.stack || e)); process.exit(1); });
