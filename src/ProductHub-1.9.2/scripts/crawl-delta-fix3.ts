import crypto from 'node:crypto';
/**
 * 失败来源修复第三轮（至 2026-11-09）
 * 公开 API / 第三方镜像 / sitemap / 分类加深；不打包、不整库备份。
 *
 *   PATH=.../node-v22.../bin:$PATH npx tsx scripts/crawl-delta-fix3.ts [--only=e27,reddit,chip,ys,dq,ph,gh,bl,mcp]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DB, now } from '../src/server/db';
import { upsertProduct, deleteProduct } from '../src/server/products';
import { PoliteFetcher, CHROME_UA, isArticleNoise } from '../src/server/history';
import { CrawlItem } from '../src/server/crawler';
import { slugName } from '../src/server/util';

const ARGS = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']));
const ONLY = new Set(String(ARGS.only || 'e27,reddit,chip,ys,dq,ph,gh,bl,mcp').split(',').filter(Boolean));
const DIR = path.resolve('data/crawl');
const DBF = path.join(DIR, 'producthub.db');
const DELTA = path.resolve('data/delta');
const LOGF = path.resolve('logs/crawl-delta-fix3.log');
const TMP = path.resolve('data/delta/fix3-tmp');
fs.mkdirSync(DELTA, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(path.dirname(LOGF), { recursive: true });

const log = (s: string) => {
  const line = `[${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })}] ${s}`;
  fs.appendFileSync(LOGF, line + '\n');
  console.log(line);
};

const stats = {
  inserted: 0, updated: 0, found: 0, noise: 0, skippedExisting: 0, deleted: 0,
  by: {} as Record<string, { inserted: number; updated: number; found: number; skipped?: number; note?: string }>,
  fixed: [] as string[],
  failed: [] as { name: string; error: string }[],
  dead: [] as { name: string; reason: string; evidence: string }[],
  probes: [] as { name: string; attempts: string[]; verdict: string }[],
};

const pf = new PoliteFetcher(+(ARGS.interval || 900), {
  'e27.co': 700,
  'www.e27.co': 700,
  'arctic-shift.photon-reddit.com': 1200,
  'www.chip.de': 900,
  'chip.de': 900,
  'yourstory.com': 1200,
  'www.yourstory.com': 1200,
  'api.github.com': 7000,
  'registry.modelcontextprotocol.io': 600,
  'www.producthunt.com': 1800,
  'betalist.com': 1500,
}, log);

function slugToName(slug: string): string {
  return decodeURIComponent(slug)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
}
function bump(key: string, ins: number, upd: number, found: number, extra?: { skipped?: number; note?: string }) {
  const b = stats.by[key] || (stats.by[key] = { inserted: 0, updated: 0, found: 0 });
  b.inserted += ins; b.updated += upd; b.found += found;
  if (extra?.skipped) b.skipped = (b.skipped || 0) + extra.skipped;
  if (extra?.note) b.note = extra.note;
}
function curlGet(url: string, outFile: string, timeoutSec = 60): { ok: boolean; status: number; size: number; body?: string } {
  const r = spawnSync('curl', ['-sS', '-L', '--max-time', String(timeoutSec), '-A', CHROME_UA, '-o', outFile, '-w', '%{http_code}', url], { encoding: 'utf8' });
  const status = parseInt(String(r.stdout || '0').trim(), 10) || 0;
  const size = fs.existsSync(outFile) ? fs.statSync(outFile).size : 0;
  if (r.error) log(`  curl err ${url}: ${r.error.message}`);
  return { ok: status >= 200 && status < 400 && size > 50, status, size };
}
function curlJson(url: string, timeoutSec = 45): any | null {
  const f = path.join(TMP, 'j-' + sha1hex(url) + '.json');
  const r = curlGet(url, f, timeoutSec);
  if (!r.ok) return null;
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    try { fs.unlinkSync(f); } catch { /* */ }
    return j;
  } catch {
    try { fs.unlinkSync(f); } catch { /* */ }
    return null;
  }
}
function sha1hex(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex');
}
const NOISE_NAME = /^(登录|注册|关于我们|公司动态|帮助中心|首页|home|about|contact|privacy|terms|blog|news|login|signup|sign up|categories|tools|confidential|stealth)$/i;
function existingNamesForSource(db: DB, sourceGuid: string): Set<string> {
  const set = new Set<string>();
  const rows = db.all<any>(`SELECT p.name FROM products p JOIN product_versions v ON v.product_guid=p.guid WHERE v.source_guid=?`, [sourceGuid]);
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
          }, { sourceGuid: src.guid, origin: 'crawl-delta-fix3', versionLabel: src.name });
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
  try {
    db.run(
      'INSERT OR REPLACE INTO crawl_state(source_guid, strategy,cursor,pages,items,inserted,status,earliest,last_error,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [src.guid, strategy, null, 1, n, inserted, 'done', null, null, now()],
    );
  } catch { /* crawl_state may miss cols */ }
  return { n, inserted, updated, pc, skipped };
}

/** e27：公开 JSON API ~38813 startups */
async function e27Fix(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=154'); if (!src) return;
  log('▶ e27 API startups');
  const pageSize = +(ARGS.e27Size || 100);
  const maxPages = +(ARGS.e27Pages || 400);
  const items: CrawlItem[] = [];
  const seen = new Set<string>();
  let emptyStreak = 0;
  for (let page = 1; page <= maxPages; page++) {
    const url = `https://e27.co/api/startups?page=${page}&length=${pageSize}`;
    const j = curlJson(url, 40);
    const list = j?.data?.list || [];
    if (!list.length) {
      emptyStreak++;
      log(`  e27 p${page} empty`);
      if (emptyStreak >= 2) break;
      continue;
    }
    emptyStreak = 0;
    for (const row of list) {
      const name = String(row.name || '').trim();
      const slug = String(row.slug || '').trim();
      if (!name || NOISE_NAME.test(name) || !slug) continue;
      if (seen.has(slug)) continue;
      seen.add(slug);
      const site = row.metas?.website || null;
      const desc = row.metas?.short_description || null;
      const link = row.link || `https://e27.co/startups/${slug}/`;
      items.push({
        name,
        url: site || link,
        tagline: (row.vertical || 'Startup').toString().slice(0, 120),
        description: desc,
        image: row.metas?.logo_thumb || null,
      });
    }
    if (page === 1 || page % 20 === 0) log(`  e27 p${page}: total unique ${items.length} (api total ${j?.data?.totalstartupcount || '?'})`);
  }
  const res = await ingest(db, src, 'e27-api-fix3', items, { keepNoise: true });
  bump('e27', res.inserted, res.updated, res.n, { note: `apiUnique=${items.length}` });
  stats.fixed.push(`e27: API 拉取 ${items.length}，新产品 +${res.inserted}，来源 ${res.pc}`);
  log(`✔ e27: items ${items.length} upsert ${res.n} 新${res.inserted} pc=${res.pc}`);
}

const REDDIT_SUBS: { seq: number; sub: string }[] = [
  { seq: 165, sub: 'SideProject' },
  { seq: 166, sub: 'startups' },
  { seq: 167, sub: 'SaaS' },
  { seq: 168, sub: 'IMadeThis' },
  { seq: 169, sub: 'alphaandbetausers' },
  { seq: 170, sub: 'indiehackers' },
  { seq: 171, sub: 'microsaas' },
  { seq: 172, sub: 'EntrepreneurRideAlong' },
];

const BAD_HOST = /(reddit\.com|redd\.it|imgur\.com|i\.redd\.it|v\.redd\.it|youtube\.com|youtu\.be|twitter\.com|x\.com|tiktok\.com)$/i;

function titleToProductName(title: string): string | null {
  let t = title.replace(/\s+/g, ' ').trim();
  // "I built X — ..." / "Show HN-ish"
  const m = t.match(/^(?:I\s+(?:built|made|launched|created)|We\s+(?:built|made|launched)|Introducing|Launching)\s+(.+)$/i);
  if (m) t = m[1];
  t = t.split(/\s+[—–\-|:]\s+/)[0].trim();
  t = t.replace(/^["'“]+|["'”]+$/g, '').trim();
  if (t.length < 2 || t.length > 80) return null;
  if (/^(help|how|what|why|anyone|looking|need|question)\b/i.test(t)) return null;
  return t;
}

/** Reddit：官方 403；改用 arctic-shift 公开归档 API */
async function redditFix(db: DB) {
  log('▶ Reddit via arctic-shift');
  const perSub = +(ARGS.redditLimit || 200);
  for (const { seq, sub } of REDDIT_SUBS) {
    const src = db.get<any>('SELECT * FROM sources WHERE seq=?', [seq]);
    if (!src) continue;
    const items: CrawlItem[] = [];
    const seen = new Set<string>();
    // paginate with after=created_utc
    let after: number | null = null;
    let pages = 0;
    while (items.length < perSub && pages < 12) {
      pages++;
      let url = `https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=${encodeURIComponent(sub)}&limit=100&sort=desc`;
      if (after != null) url += `&before=${after}`; // older posts
      const j = curlJson(url, 40);
      const arr: any[] = Array.isArray(j?.data) ? j.data : [];
      if (!arr.length) { log(`  r/${sub} page ${pages} empty`); break; }
      let minCreated = Infinity;
      for (const p of arr) {
        const created = Number(p.created_utc) || 0;
        if (created && created < minCreated) minCreated = created;
        const urlExt = String(p.url || '');
        let host = '';
        try { host = new URL(urlExt).hostname; } catch { /* */ }
        if (!urlExt || BAD_HOST.test(host)) continue;
        let name = titleToProductName(String(p.title || ''));
        if (!name) {
          // 链出帖：用主机名派生短名，避免标题过滤过严导致整板为 0
          try { name = slugToName(new URL(urlExt).hostname.replace(/^www\./,'').split('.')[0]); } catch { continue; }
          if (!name || name.length < 2) continue;
        }
        const key = urlExt.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const date = created ? new Date(created * 1000).toISOString().slice(0, 10) : null;
        items.push({
          name,
          url: urlExt,
          tagline: `r/${sub}`,
          description: String(p.selftext || '').slice(0, 500) || null,
          votes: Number(p.score) || 0,
          date,
        });
      }
      if (!Number.isFinite(minCreated) || minCreated === after) break;
      after = minCreated;
      if (arr.length < 50) break;
    }
    const res = await ingest(db, src, 'reddit-arctic-fix3', items, { keepNoise: true });
    bump(`Reddit r/${sub}`, res.inserted, res.updated, res.n, { note: `posts=${items.length}` });
    stats.fixed.push(`Reddit r/${sub}: arctic ${items.length}，新产品 +${res.inserted}，来源 ${res.pc}`);
    log(`✔ r/${sub}: items ${items.length} 新${res.inserted} pc=${res.pc}`);
  }
}

/** CHIP：加深分页 */
async function chipFix(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=567'); if (!src) return;
  log('▶ CHIP Downloads 加深');
  const cats = [
    'system-tuning', 'multimedia-kreativtools', 'browser-kommunikation-online-tools', 'android-apps',
    'office-produktivitaet-finanzen', 'security-datenschutz', 'spiele-unterhaltung', 'windows-apps-microsoft-store',
    'macos-apps', 'linux-apps', 'iphone-ipad-apps', 'browser-addons', 'betriebssysteme-distributionen',
    'apk-android-apps-chip-exklusiv',
  ];
  const maxPage = +(ARGS.chipPages || 80);
  const seen = new Set<string>();
  // seed seen from existing chip URLs
  for (const r of db.all<any>(`SELECT p.url FROM products p JOIN product_versions v ON v.product_guid=p.guid WHERE v.source_guid=?`, [src.guid])) {
    const m = String(r.url || '').match(/\/d\/([a-f0-9-]{36})/i);
    if (m) seen.add(m[1]);
  }
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
        items.push({ name, url: `https://www.chip.de/d/${id}`, tagline: `CHIP · ${cat}`, description: null });
        added++;
      }
      if (page === 1 || page % 10 === 0) log(`  CHIP ${cat} p${page}: +${added} (new batch ${items.length})`);
      if (added === 0 && page > 1) break;
      try { fs.unlinkSync(f); } catch { /* */ }
    }
  }
  const res = await ingest(db, src, 'chip-download-fix3', items, { keepNoise: true });
  bump('CHIP Downloads', res.inserted, res.updated, res.n, { note: `newUnique=${items.length}` });
  stats.fixed.push(`CHIP: 加深 +${items.length} 候选，新产品 +${res.inserted}，来源 ${res.pc}`);
  log(`✔ CHIP: new ${items.length} 新${res.inserted} pc=${res.pc}`);
}

/** YourStory：公司目录页公开 HTML（搜索页多为 CSR 空壳） */
async function yourstoryFix(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=194'); if (!src) return;
  log('▶ YourStory companies HTML');
  const pages = [
    'https://yourstory.com/companies',
    'https://yourstory.com/companies/search?featured=true',
    'https://yourstory.com/companies/search?sector=Technology',
    'https://yourstory.com/companies/search?sector=SaaS',
    'https://yourstory.com/companies/search?sector=FinTech',
    'https://yourstory.com/companies/search?sector=Enterprise%20Tech',
  ];
  const items: CrawlItem[] = [];
  const seen = new Set<string>();
  for (const url of pages) {
    const f = path.join(TMP, 'ys-' + Buffer.from(url).toString('base64url').slice(0, 24) + '.html');
    const r = curlGet(url, f, 35);
    if (!r.ok) { log(`  YS ${url} HTTP ${r.status}`); continue; }
    const html = fs.readFileSync(f, 'utf8');
    const slugs = [...html.matchAll(/href="(\/companies\/[a-z0-9-]+)"/gi)].map(m => m[1]);
    for (const slugPath of slugs) {
      if (slugPath.includes('/search')) continue;
      const slug = slugPath.split('/').pop()!;
      if (seen.has(slug)) continue;
      seen.add(slug);
      items.push({
        name: slugToName(slug),
        url: `https://yourstory.com/companies/${slug}`,
        tagline: 'YourStory company',
        description: null,
      });
    }
    try { fs.unlinkSync(f); } catch { /* */ }
  }
  if (!items.length) {
    stats.failed.push({ name: 'YourStory', error: 'HTML 无公司链接（可能 CSR）' });
    log('✘ YourStory: no company links');
    return;
  }
  const res = await ingest(db, src, 'yourstory-companies-fix3', items, { keepNoise: true });
  bump('YourStory', res.inserted, res.updated, res.n, { note: `slugs=${items.length}` });
  stats.fixed.push(`YourStory: 公司页 ${items.length}，新产品 +${res.inserted}，来源 ${res.pc}`);
  log(`✔ YourStory: ${items.length} 新${res.inserted} pc=${res.pc}`);
}

/** 数据质量：删除明显「Alternatives to X」清单页（非产品） */
async function dataQuality(db: DB) {
  log('▶ 数据质量清理 Alternatives 清单页');
  const rows = db.all<any>(`
    SELECT guid, name, url, domain FROM products
    WHERE name LIKE 'Alternatives to %'
       OR (lower(name) LIKE '% alternatives' AND (url LIKE '%/alternatives%' OR tagline LIKE '%alternative%'))
    LIMIT 8000
  `);
  let del = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    db.tx(() => {
      for (const r of chunk) {
        try {
          deleteProduct(db, r.guid);
          del++;
        } catch { /* */ }
      }
    });
    if ((i / 200) % 5 === 0) log(`  dq deleted ${del}/${rows.length}`);
  }
  // null-url noise names
  const noise = db.all<any>(`
    SELECT guid FROM products
    WHERE (url IS NULL OR url='')
      AND lower(name) IN ('home','about','privacy','blog','news','login','tools','categories','contact','terms')
    LIMIT 500
  `);
  db.tx(() => { for (const r of noise) { try { deleteProduct(db, r.guid); del++; } catch { /* */ } } });
  stats.deleted = del;
  stats.fixed.push(`数据质量: 删除 Alternatives/噪声 ${del} 条`);
  log(`✔ DQ deleted ${del}`);
}

/** 通用续补：PH Atom / GitHub / BetaList / MCP */
async function genericDelta(db: DB) {
  if (ONLY.has('ph')) {
    const src = db.get<any>('SELECT * FROM sources WHERE seq=1');
    if (src) {
      log('▶ Product Hunt 分类 Atom');
      const cats = ['productivity','developer-tools','artificial-intelligence','saas','design-tools','marketing','no-code','open-source','productivity','tech'];
      const items: CrawlItem[] = [];
      const seen = new Set<string>();
      for (const c of cats) {
        const f = path.join(TMP, `ph-${c}.xml`);
        const r = curlGet(`https://www.producthunt.com/feed?category=${c}`, f, 30);
        if (!r.ok) continue;
        const xml = fs.readFileSync(f, 'utf8');
        for (const m of xml.matchAll(/<entry>[\s\S]*?<title>([^<]+)<\/title>[\s\S]*?<link[^>]+href="([^"]+)"[\s\S]*?(?:<published>([^<]+)<\/published>)?[\s\S]*?<\/entry>/g)) {
          const name = m[1].trim(); const url = m[2];
          if (seen.has(url)) continue; seen.add(url);
          items.push({ name, url, tagline: `PH · ${c}`, date: m[3]?.slice(0, 10) || null });
        }
        try { fs.unlinkSync(f); } catch { /* */ }
      }
      const res = await ingest(db, src, 'ph-atom-fix3', items);
      bump('Product Hunt', res.inserted, res.updated, res.n);
      log(`✔ PH atom ${items.length} 新${res.inserted}`);
    }
  }
  if (ONLY.has('gh')) {
    const src = db.get<any>('SELECT * FROM sources WHERE seq=211');
    if (src) {
      log('▶ GitHub stars≥50 近窗');
      const q = encodeURIComponent('stars:>=50 created:2026-10-15..2026-11-09');
      const items: CrawlItem[] = [];
      for (let page = 1; page <= 5; page++) {
        const j = curlJson(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=100&page=${page}`, 40);
        const arr = j?.items || [];
        if (!arr.length) break;
        for (const r of arr) {
          items.push({ name: r.name, url: r.html_url, tagline: r.description, votes: r.stargazers_count, date: (r.created_at || '').slice(0, 10) });
        }
      }
      const res = await ingest(db, src, 'gh-fix3', items);
      bump('GitHub', res.inserted, res.updated, res.n);
      log(`✔ GH ${items.length} 新${res.inserted}`);
    }
  }
  if (ONLY.has('bl')) {
    const src = db.get<any>('SELECT * FROM sources WHERE seq=2');
    if (src) {
      log('▶ BetaList 分页');
      const items: CrawlItem[] = [];
      const seen = new Set<string>();
      for (let page = 1; page <= 40; page++) {
        const f = path.join(TMP, `bl-${page}.html`);
        const r = curlGet(page === 1 ? 'https://betalist.com/' : `https://betalist.com/?page=${page}`, f, 25);
        if (!r.ok) break;
        const html = fs.readFileSync(f, 'utf8');
        let added = 0;
        for (const m of html.matchAll(/href="(\/startups\/[a-z0-9-]+)"[^>]*>\s*([^<]{2,80})</gi)) {
          const slug = m[1]; const name = m[2].trim();
          if (seen.has(slug)) continue; seen.add(slug);
          items.push({ name, url: 'https://betalist.com' + slug, tagline: 'BetaList' });
          added++;
        }
        try { fs.unlinkSync(f); } catch { /* */ }
        if (added === 0 && page > 2) break;
      }
      const res = await ingest(db, src, 'betalist-fix3', items);
      bump('BetaList', res.inserted, res.updated, res.n);
      log(`✔ BetaList ${items.length} 新${res.inserted}`);
    }
  }
  if (ONLY.has('mcp')) {
    const src = db.get<any>('SELECT * FROM sources WHERE seq=125');
    if (src) {
      log('▶ MCP Registry latest 续页');
      const items: CrawlItem[] = [];
      for (let page = 0; page < 40; page++) {
        const j = curlJson(`https://registry.modelcontextprotocol.io/v0/servers?limit=100&version=latest&cursor=${page * 100}`, 30)
          || curlJson(`https://registry.modelcontextprotocol.io/v0/servers?limit=100&version=latest`, 30);
        // cursor may differ — try offset style
        const servers = j?.servers || j?.data || [];
        if (!servers.length) {
          // alternate pagination
          const j2 = curlJson(`https://registry.modelcontextprotocol.io/v0/servers?limit=100&version=latest${page ? '&cursor=' + encodeURIComponent(j?.metadata?.nextCursor || '') : ''}`, 30);
          const s2 = j2?.servers || [];
          if (!s2.length) break;
          for (const s of s2) {
            const name = s.name || s.server?.name;
            const repo = s.repository?.url || s.server?.repository?.url;
            if (!name) continue;
            items.push({ name, url: repo || `https://registry.modelcontextprotocol.io/servers/${encodeURIComponent(name)}`, tagline: 'MCP server' });
          }
          if (!j2?.metadata?.nextCursor) break;
          continue;
        }
        for (const s of servers) {
          const name = s.name || s.server?.name;
          const repo = s.repository?.url || s.server?.repository?.url;
          if (!name) continue;
          items.push({ name, url: repo || `https://registry.modelcontextprotocol.io/servers/${encodeURIComponent(name)}`, tagline: 'MCP server' });
        }
        if (!j?.metadata?.nextCursor && servers.length < 100) break;
      }
      const res = await ingest(db, src, 'mcp-fix3', items);
      bump('MCP Registry', res.inserted, res.updated, res.n);
      log(`✔ MCP ${items.length} 新${res.inserted}`);
    }
  }
}

/** 对「仍不可修」再验证并记证据 */
async function reprobeDead() {
  log('▶ 再验证死结来源');
  const targets: { name: string; urls: string[] }[] = [
    { name: 'Tools.so', urls: ['https://tools.so', 'https://www.tools.so', 'https://tools.so/sitemap.xml'] },
    { name: 'NoCode.Tech', urls: ['https://nocode.tech', 'https://nocode.tech/sitemap.xml'] },
    { name: 'SourceForge', urls: ['https://sourceforge.net/directory/', 'https://sourceforge.net/rest/p/'] },
    { name: 'SelectHub', urls: ['https://www.selecthub.com', 'https://www.selecthub.com/sitemap.xml'] },
    { name: 'SpotSaaS', urls: ['https://spotsaas.com', 'https://spotsaas.com/sitemap.xml'] },
    { name: 'F6S', urls: ['https://www.f6s.com/companies', 'https://www.f6s.com/sitemap.xml'] },
    { name: 'Startup Buffer', urls: ['https://startupbuffer.com'] },
    { name: 'Saaspo', urls: ['https://saaspo.com'] },
    { name: 'EU-Startups', urls: ['https://www.eu-startups.com', 'https://www.eu-startups.com/feed/'] },
    { name: 'IT桔子', urls: ['https://www.itjuzi.com', 'https://m.itjuzi.com'] },
    { name: 'Trustpilot', urls: ['https://www.trustpilot.com/categories/software'] },
    { name: 'SaaSHub', urls: ['https://saashub.com', 'https://saashub.com/sitemap.xml'] },
    { name: 'AlternativeTo', urls: ['https://alternativeto.net'] },
    { name: 'Thingtesting', urls: ['https://thingtesting.com/sitemap.xml', 'https://thingtesting.com/brands'] },
    { name: 'GeekWire Startup List', urls: ['https://www.geekwire.com/startup-list/', 'https://www.geekwire.com/feed/'] },
  ];
  for (const t of targets) {
    const attempts: string[] = [];
    let anyOk = false;
    let productish = false;
    for (const u of t.urls) {
      const f = path.join(TMP, 'probe-' + Buffer.from(u).toString('base64url').slice(0, 20));
      const r = curlGet(u, f, 20);
      const head = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').slice(0, 200).replace(/\s+/g, ' ') : '';
      attempts.push(`${u} → HTTP ${r.status} ${r.size}b`);
      if (r.ok && !/Just a moment|Checking your browser|Verifying Connection|Security Checkpoint/i.test(head)) {
        anyOk = true;
        if (/\/apps\/|\/software\/|\/product\/|startup|company|brand/i.test(head) || u.includes('sitemap') || u.includes('feed')) productish = true;
      }
      try { fs.unlinkSync(f); } catch { /* */ }
    }
    // Wayback CDX sample
    const host = t.urls[0].replace(/^https?:\/\//, '').split('/')[0];
    const wb = path.join(TMP, 'wb-' + host);
    const wbr = curlGet(`https://web.archive.org/cdx/search/cdx?url=${host}/*&output=json&limit=3&fl=timestamp,original,statuscode&filter=statuscode:200`, wb, 8);
    attempts.push(`wayback CDX ${host} → HTTP ${wbr.status} ${wbr.size}b`);
    let verdict = '死结';
    if (t.name === 'Thingtesting' && anyOk) verdict = '站点可访问但为消费品牌评测，非软件产品库重点（按规则不入库）';
    else if (t.name === 'GeekWire Startup List' && anyOk) verdict = 'RSS/页面可通但是新闻站；startup-list 页无稳定产品目录';
    else if (!anyOk) verdict = '公开入口均被拦（CF/412/挑战页），无合法公开列表';
    else if (!productish) verdict = '偶通但无可用产品列表';
    stats.probes.push({ name: t.name, attempts, verdict });
    if (verdict.startsWith('死结') || verdict.includes('被拦') || verdict.includes('消费品牌') || verdict.includes('新闻')) {
      stats.dead.push({ name: t.name, reason: verdict, evidence: attempts.join(' | ') });
    }
    log(`  probe ${t.name}: ${verdict}`);
  }
}

(async () => {
  log(`==== crawl-delta-fix3 启动 only=${[...ONLY]} ====`);
  const db = await DB.open(DBF);
  const before = db.get<any>('SELECT COUNT(*) p FROM products').p;
  log(`产品数 before=${before}`);

  if (ONLY.has('e27')) await e27Fix(db);
  if (ONLY.has('reddit')) await redditFix(db);
  if (ONLY.has('chip')) await chipFix(db);
  if (ONLY.has('ys')) await yourstoryFix(db);
  if (ONLY.has('dq')) await dataQuality(db);
  await genericDelta(db);
  await reprobeDead();

  const after = db.get<any>('SELECT COUNT(*) p FROM products').p;
  const zeros = db.get<any>('SELECT COUNT(*) c FROM sources WHERE product_count=0').c;
  const keySeqs = [1, 2, 125, 154, 165, 166, 167, 168, 169, 170, 171, 172, 194, 211, 567];
  const keySources = keySeqs.map(seq => db.get<any>('SELECT seq,name,product_count,last_status FROM sources WHERE seq=?', [seq])).filter(Boolean);
  const summary = {
    timezone: 'Asia/Shanghai',
    finishedAt: new Date().toISOString(),
    before, after, delta: after - before,
    dayStart: 1386886, dayDelta: after - 1386886,
    found: stats.found, inserted: stats.inserted, updated: stats.updated, deleted: stats.deleted,
    noise: stats.noise, skippedExisting: stats.skippedExisting,
    by: stats.by, fixed: stats.fixed, failed: stats.failed, dead: stats.dead, probes: stats.probes,
    keySources, zeros, packed: false,
  };
  fs.writeFileSync(path.join(DELTA, 'fix3-summary.json'), JSON.stringify(summary, null, 2));
  try { db.setSetting('crawl.deltaFix3FinishedAt', new Date().toISOString()); } catch { /* */ }
  try { (db as any).saveNow?.(); } catch { /* */ }
  log(`==== 完成 products ${before} → ${after} (+${after - before}) 新=${stats.inserted} 删=${stats.deleted} zeros=${zeros} ====`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* */ }
  process.exit(0);
})().catch(e => { log('FATAL ' + (e?.stack || e)); process.exit(1); });
