/**
 * 增量抓取至今天（Asia/Shanghai）
 *   npx tsx scripts/crawl-delta-today.ts [--phase=api|sources|all] [--conc=3]
 * 工作库：data/crawl/producthub.db；日志：logs/crawl-delta-today.log
 * 只抓产品；跳过新闻来源与已知 403/429/需 API 来源。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DB, now } from '../src/server/db';
import { crawlSource, pool, CrawlItem } from '../src/server/crawler';
import { upsertProduct } from '../src/server/products';
import { PoliteFetcher, parseShowHn, parseBetaListPage, CHROME_UA } from '../src/server/history';
import { isArticleNoise } from '../src/server/history';
import { safeJson } from '../src/server/util';

const ARGS = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']));
const DIR = path.resolve('data/crawl');
const DBF = path.join(DIR, 'producthub.db');
const DELTA = path.resolve('data/delta');
const LOGF = path.resolve('logs/crawl-delta-today.log');
fs.mkdirSync(path.dirname(LOGF), { recursive: true });
fs.mkdirSync(DELTA, { recursive: true });
const log = (s: string) => {
  const line = `[${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })}] ${s}`;
  fs.appendFileSync(LOGF, line + '\n');
  console.log(line);
};

const NEWS_SEQ = new Set([152, 154, 173, 174, 175, 182, 183, 185, 186, 187, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 203, 204, 205, 206, 207, 208]);
const SKIP_HOST = new Set([
  'reddit.com', 'old.reddit.com', 'www.reddit.com',
  'sourceforge.net', 'trustpilot.com', 'selecthub.com', 'spotsaas.com',
  'thingtesting.com', 'startupbuffer.com', 'nocode.tech', 'tools.so',
  'f6s.com', 'saaspo.com', 'itjuzi.com', 'web.okjike.com', 'coolapk.com',
  'pmthinking.com', 'fwol.cn', 'owler.com', 'getlatka.com', 'glama.ai',
  'eu-startups.com', 'e27.co', 'yourstory.com', 'geekwire.com', 'geekpark.net',
]);
const PRIORITY_SEQ = [1, 2, 47, 48, 58, 75, 80, 84, 125, 162, 210, 211, 215, 236, 305, 346, 366, 411, 422, 458, 493, 497, 533, 550];

const stats = { inserted: 0, updated: 0, found: 0, noise: 0, failed: [] as { seq: number; name: string; error: string }[] };
const pf = new PoliteFetcher(+(ARGS.interval || 1500), {
  'api.github.com': 7000,
  'hn.algolia.com': 500,
  'registry.modelcontextprotocol.io': 800,
  'www.producthunt.com': 2500,
  'betalist.com': 1500,
}, log);

function shanghaiToday(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 10);
}

async function ingest(db: DB, src: any, strategy: string, items: CrawlItem[]) {
  let inserted = 0, updated = 0, n = 0;
  db.tx(() => {
    for (const it of items) {
      if (!it.name || it.name.length < 2) continue;
      if (!new Set([162, 211, 125, 1, 2]).has(src.seq) && isArticleNoise(it.name, it.url)) { stats.noise++; continue; }
      const date = it.date ? String(it.date).slice(0, 10) : null;
      try {
        const r = upsertProduct(db, {
          name: it.name, url: it.url, tagline: it.tagline, description: it.description,
          logo_url: it.image, votes: it.votes, launch_date: date,
        }, { sourceGuid: src.guid, origin: 'crawl-delta', versionLabel: src.name });
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

async function hnDelta(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=162'); if (!src) return;
  log('▶ HN Show HN 增量');
  const since = Math.floor(new Date('2026-10-20T00:00:00Z').getTime() / 1000);
  let before = Math.floor(Date.now() / 1000) + 3600;
  const all: CrawlItem[] = [];
  for (let page = 0; page < 40; page++) {
    const u = `https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=1000&numericFilters=${encodeURIComponent(`points>=10,created_at_i<${before},created_at_i>${since}`)}`;
    const r = await pf.fetch(u);
    if (r.status >= 400) { log(`  HN HTTP ${r.status}`); break; }
    const hits: any[] = JSON.parse(r.text).hits || [];
    if (!hits.length) break;
    for (const h of hits) {
      if (!h.title) continue;
      const p = parseShowHn(h.title);
      all.push({
        name: p.name, tagline: p.tagline, url: h.url || null,
        description: h.story_text ? String(h.story_text).replace(/<[^>]+>/g, ' ').slice(0, 600) : p.tagline,
        votes: h.points, date: h.created_at,
      });
    }
    before = Math.min(...hits.map((h: any) => h.created_at_i));
    log(`  HN page ${page + 1}: +${hits.length} 已到 ${new Date(before * 1000).toISOString().slice(0, 10)}`);
    if (hits.length < 1000) break;
  }
  const res = await ingest(db, src, 'hn-algolia-delta', all);
  log(`✔ HN: upsert ${res.n} 新${res.inserted} 更新${res.updated}`);
  fs.writeFileSync(path.join(DELTA, 'hn-delta.json'), JSON.stringify({ seq: 162, strategy: 'hn-algolia-delta', rows: all }, null, 0));
}

async function githubDelta(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=211') || db.get<any>('SELECT * FROM sources WHERE seq=636');
  if (!src) return;
  log('▶ GitHub 增量（created 2026-10-01..今天）');
  const end = shanghaiToday();
  const windows = [
    '2026-10-01..2026-10-15',
    '2026-10-16..2026-10-31',
    `2026-11-01..${end}`,
  ];
  const all: CrawlItem[] = [];
  for (const w of windows) {
    for (let page = 1; page <= 10; page++) {
      const q = `stars:>=200 created:${w}`;
      const r = await pf.fetch(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=100&page=${page}`,
        { headers: { accept: 'application/vnd.github+json' } },
      );
      if (r.status === 403 || r.status === 422) {
        log(`  GitHub ${r.status} 等待 65s`); await new Promise(x => setTimeout(x, 65000)); page--; continue;
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
  const res = await ingest(db, src, 'github-search-delta', all);
  log(`✔ GitHub: upsert ${res.n} 新${res.inserted} 更新${res.updated}`);
  fs.writeFileSync(path.join(DELTA, 'github-delta.json'), JSON.stringify({ seq: src.seq, strategy: 'github-search-delta', rows: all }, null, 0));
}

async function mcpDelta(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=125'); if (!src) return;
  log('▶ MCP Registry 增量');
  const out: CrawlItem[] = [];
  let cur: string | null = null; let pages = 0;
  while (pages < 500) {
    const u = 'https://registry.modelcontextprotocol.io/v0/servers?limit=100&version=latest' + (cur ? '&cursor=' + encodeURIComponent(cur) : '');
    let r: any = null;
    for (let t = 0; t < 4; t++) {
      r = await pf.fetch(u);
      if (r.status < 400) break;
      await new Promise(x => setTimeout(x, 3000));
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
    if (pages % 20 === 0) log(`  MCP pages ${pages} items ${out.length}`);
    if (!cur) break;
  }
  const res = await ingest(db, src, 'mcp-registry-delta', out);
  log(`✔ MCP: upsert ${res.n} 新${res.inserted} 更新${res.updated} pages ${pages}`);
  fs.writeFileSync(path.join(DELTA, 'mcp-delta.json'), JSON.stringify({ seq: 125, strategy: 'mcp-registry-delta', rows: out }, null, 0));
}

async function betalistDelta(db: DB) {
  const src = db.get<any>('SELECT * FROM sources WHERE seq=2'); if (!src) return;
  log('▶ BetaList 增量（前 40 页）');
  const all: CrawlItem[] = [];
  for (let page = 1; page <= 40; page++) {
    const r = await pf.fetch(`https://betalist.com/?page=${page}`);
    if (r.status >= 400) { log(`  BetaList HTTP ${r.status} @${page}`); break; }
    const rows = parseBetaListPage(r.text);
    if (!rows.length) break;
    for (const x of rows) all.push({ name: x.name, tagline: x.tagline, description: x.tagline, url: null, image: x.image, date: x.date });
    if (page % 10 === 0) log(`  BetaList p${page} 累计 ${all.length}`);
  }
  const res = await ingest(db, src, 'betalist-delta', all);
  log(`✔ BetaList: upsert ${res.n} 新${res.inserted} 更新${res.updated}`);
}

async function sourcesDelta(db: DB) {
  log('▶ 通用来源增量（crawlSource，优先高价值 ok 来源）');
  const conc = +(ARGS.conc || 3);
  const srcs = db.all<any>('SELECT * FROM sources WHERE enabled=1 ORDER BY product_count DESC, seq');
  const pick = srcs.filter(s => {
    if (NEWS_SEQ.has(s.seq)) return false;
    if (SKIP_HOST.has(String(s.host || '').replace(/^www\./, '')) || SKIP_HOST.has(String(s.host || ''))) return false;
    if (/reddit\.com/i.test(s.url || '')) return false;
    // 专用适配器已跑过的跳过通用
    if ([1, 2, 125, 162, 211, 636].includes(s.seq)) return false;
    // 优先：PRIORITY 或 product_count>=500 且 status ok/empty
    const host = String(s.host || '').replace(/^www\./, '');
    if (SKIP_HOST.has(host)) return false;
    if (PRIORITY_SEQ.includes(s.seq)) return true;
    if ((s.product_count || 0) >= 500 && s.last_status === 'ok') return true;
    if ((s.product_count || 0) >= 50 && s.last_status === 'ok') return true;
    return false;
  }).slice(0, +(ARGS.limit || 80));
  log(`  待通用增量来源 ${pick.length}（conc=${conc}）`);
  let i = 0;
  await pool(pick, conc, async (s) => {
    const idx = ++i;
    try {
      const r = await crawlSource(db, s.guid, { log: (m) => log(`  · ${s.name}: ${m}`) });
      stats.found += r.found || 0;
      stats.inserted += r.inserted || 0;
      stats.updated += r.updated || 0;
      if (r.error) {
        stats.failed.push({ seq: s.seq, name: s.name, error: String(r.error).slice(0, 200) });
        log(`✘ [${idx}/${pick.length}] ${s.seq} ${s.name}: ${r.error}`);
      } else {
        log(`✔ [${idx}/${pick.length}] ${s.seq} ${s.name}: found ${r.found} 新${r.inserted} 更新${r.updated}`);
      }
    } catch (e) {
      const msg = String((e as Error).message || e).slice(0, 200);
      stats.failed.push({ seq: s.seq, name: s.name, error: msg });
      log(`✘ [${idx}/${pick.length}] ${s.seq} ${s.name}: ${msg}`);
    }
  });
}

(async () => {
  const phase = ARGS.phase || 'all';
  const started = new Date().toISOString();
  log(`==== crawl-delta-today 启动 phase=${phase} today=${shanghaiToday()} ====`);
  const db = await DB.open(DBF);
  const before = db.get<any>('SELECT COUNT(*) p FROM products').p;
  log(`产品数 before=${before}`);

  if (phase === 'all' || phase === 'api') {
    await hnDelta(db);
    await githubDelta(db);
    await mcpDelta(db);
    await betalistDelta(db);
  }
  if (phase === 'all' || phase === 'sources') {
    await sourcesDelta(db);
  }

  const after = db.get<any>('SELECT COUNT(*) p FROM products').p;
  const summary = {
    started, finished: new Date().toISOString(),
    before, after, deltaProducts: after - before,
    found: stats.found, inserted: stats.inserted, updated: stats.updated, noise: stats.noise,
    failed: stats.failed,
    requests: pf.stats,
  };
  fs.writeFileSync(path.join(DELTA, 'summary.json'), JSON.stringify(summary, null, 2));
  db.setSetting('crawl.deltaFinishedAt', new Date().toISOString());
  db.saveNow();
  log(`==== 完成 products ${before} → ${after} (+${after - before}) found=${stats.found} 新=${stats.inserted} 更新=${stats.updated} 失败=${stats.failed.length} ====`);
  process.exit(0);
})().catch(e => { log('FATAL ' + (e?.stack || e)); process.exit(1); });
