/**
 * v1.5 全量历史抓取（可断点续跑）
 *   npx tsx scripts/crawl-history.ts [--only=seq,seq] [--phase=crawl|images|enrich|all]
 * 工作库：data/crawl/producthub.db（首次从 data/seed 复制）；状态表 crawl_state；日志 logs/crawl-history.log
 */
import fs from 'node:fs';
import path from 'node:path';
import { DB, now } from '../src/server/db';
import { runRule, parseFeed, pool, Fetcher, CrawlItem, CrawlRule, parseDetail, inferHtmlRule, parseJsonLd, discoverFeeds } from '../src/server/crawler';
import { upsertProduct } from '../src/server/products';
import { PoliteFetcher, findNextPage, pageUrlCandidates, parseSitemap, pickProductUrls, isArticleNoise, parseShowHn, parseBetaListPage, FetchResult, CHROME_UA } from '../src/server/history';
import { safeJson, sha1, hostOf } from '../src/server/util';

const ARGS = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']));
const DIR = path.resolve('data/crawl'); const DBF = path.join(DIR, 'producthub.db'); const IMG = path.join(DIR, 'images');
const LOGF = path.resolve('logs/crawl-history.log'); fs.mkdirSync(path.dirname(LOGF), { recursive: true }); fs.mkdirSync(IMG, { recursive: true });
const log = (s: string) => { const line = `[${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })}] ${s}`; fs.appendFileSync(LOGF, line + '\n'); console.log(line); };

// —— 预算（文档化的上限，保证离线包大小与搜索性能） ——
const CAP = { perSourceItems: +(ARGS.cap || 4000), maxPages: 400, sitemapDetail: +(ARGS.detail || 2500), sourceMinutes: +(ARGS.minutes || 80), hnMinPoints: 20, ghMinStars: 3000, redditPerSub: 1000, emptyPagesStop: 2 };
// 新闻/媒体/文章型来源：不做历史回溯，并清理已有的文章噪音
const NEWS_SEQ = new Set([152, 154, 173, 174, 175, 182, 183, 185, 186, 187, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 203, 204, 205, 206, 207, 208]);
// 可信结构化来源（不做标题噪音过滤）
const TRUSTED = new Set([162, 211]);
const PER_HOST: Record<string, number> = { 'api.github.com': 7000, 'hn.algolia.com': 400, 'old.reddit.com': 2500 };

const pf = new PoliteFetcher(+(ARGS.interval || 1200), PER_HOST, log);
const fetcher: Fetcher = async (u) => { const t = Date.now(); const r = await pf.fetch(u); if (ARGS.debug || Date.now() - t > 20000) log(`  · ${r.status} ${Date.now() - t}ms ${u}`); return r; };

// —— Playwright（JS/403 站点渲染） ——
let browser: any = null;
async function render(url: string): Promise<FetchResult> {
  if (!browser) { const { chromium } = await import('playwright'); browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] }); }
  const ctx = await browser.newContext({ userAgent: CHROME_UA, locale: 'en-US', viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.route('**/*', (r: any) => ['image', 'media', 'font'].includes(r.request().resourceType()) ? r.abort() : r.continue());
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); page.setDefaultTimeout(15000);
    let challenged = false; for (let i = 0; i < 6 && /just a moment|attention required/i.test(await page.title()); i++) { challenged = true; await page.waitForTimeout(2500); }
    await page.waitForTimeout(2500); try { await page.mouse.wheel(0, 4000); await page.waitForTimeout(1200); } catch { /* */ }
    const text = await page.content(); const passed = challenged && !/just a moment|attention required/i.test(await page.title()); return { status: passed ? 200 : resp?.status() ?? 0, text, contentType: 'text/html', finalUrl: page.url() };
  } finally { await Promise.race([ctx.close(), new Promise(r => setTimeout(r, 5000))]); }
}
const renderFetcher: Fetcher = async (u) => { const host = new URL(u).host; return pf.fetch(u, { raw: () => render(u), maxRetries: 1 }).catch(() => ({ status: 0, text: '', contentType: '', finalUrl: u })).then(r => r) as any; };

// —— 状态 ——
let db: DB;
function st(src: string, strategy: string) { return db.get<any>('SELECT * FROM crawl_state WHERE source_guid=? AND strategy=?', [src, strategy]); }
function setSt(src: string, strategy: string, patch: Record<string, any>) {
  const cur = st(src, strategy) || { source_guid: src, strategy, cursor: null, pages: 0, items: 0, inserted: 0, status: 'running', earliest: null, last_error: null };
  const n = { ...cur, ...patch, updated_at: now() };
  db.run('INSERT OR REPLACE INTO crawl_state(source_guid,strategy,cursor,pages,items,inserted,status,earliest,last_error,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', [n.source_guid, n.strategy, n.cursor, n.pages, n.items, n.inserted, n.status, n.earliest, n.last_error, n.updated_at]);
  return n;
}
let lastSave = Date.now(); function maybeSave(force = false) { if (force || Date.now() - lastSave > 60_000) { db.saveNow(); lastSave = Date.now(); } }
const totals = { items: 0, inserted: 0, noise: 0 };

function ingest(src: any, strategy: string, items: CrawlItem[]): { n: number; inserted: number; earliest: string | null } {
  let inserted = 0, n = 0; let earliest: string | null = null;
  db.tx(() => { for (const it of items) {
    if (!it.name || it.name.length < 2) continue;
    if (!TRUSTED.has(src.seq) && isArticleNoise(it.name, it.url)) { totals.noise++; continue; }
    const date = it.date ? String(it.date).slice(0, 10) : null; if (date && /^\d{4}-\d\d-\d\d$/.test(date) && date > '1995' && (!earliest || date < earliest)) earliest = date;
    try { const r = upsertProduct(db, { name: it.name, url: it.url, tagline: it.tagline, description: it.description, logo_url: it.image, votes: it.votes, launch_date: date }, { sourceGuid: src.guid, origin: 'crawl-history', versionLabel: src.name }); n++; if (r.status === 'inserted') inserted++; } catch { /* skip */ }
  } });
  totals.items += n; totals.inserted += inserted; return { n, inserted, earliest };
}
function bump(src: any, strategy: string, pages: number, r: { n: number; inserted: number; earliest: string | null }, cursor: any) {
  const c = st(src.guid, strategy) || {};
  return setSt(src.guid, strategy, { pages: (c.pages || 0) + pages, items: (c.items || 0) + r.n, inserted: (c.inserted || 0) + r.inserted, earliest: [c.earliest, r.earliest].filter(Boolean).sort()[0] || null, cursor: JSON.stringify(cursor) });
}
const deadline = (m: number) => { const t = Date.now() + m * 60_000; return () => Date.now() > t; };

// —— 适配器 ——
async function hnAlgolia(src: any) {
  const S = 'hn-algolia'; let s = st(src.guid, S); if (s?.status === 'done') return;
  let cur = safeJson<any>(s?.cursor, { before: Math.floor(Date.now() / 1000) + 3600 });
  while (true) {
    const u = `https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=1000&numericFilters=${encodeURIComponent(`points>=${CAP.hnMinPoints},created_at_i<${cur.before}`)}`;
    const r = await pf.fetch(u); if (r.status >= 400) throw new Error('HN HTTP ' + r.status);
    const hits: any[] = JSON.parse(r.text).hits || []; if (!hits.length) break;
    const items: CrawlItem[] = hits.filter(h => h.title).map(h => { const p = parseShowHn(h.title); return { name: p.name, tagline: p.tagline, url: h.url || null, description: h.story_text ? String(h.story_text).replace(/<[^>]+>/g, ' ').slice(0, 600) : p.tagline, votes: h.points, date: h.created_at }; });
    const res = ingest(src, S, items); cur = { before: Math.min(...hits.map(h => h.created_at_i)) };
    s = bump(src, S, 1, res, cur); log(`  HN Show HN: +${res.n} (新${res.inserted}) 累计${s.items} 已到 ${new Date(cur.before * 1000).toISOString().slice(0, 10)}`); maybeSave();
    if (hits.length < 1000 && hits.length < 50) break;
  }
  setSt(src.guid, S, { status: 'done' });
}
async function githubSearch(src: any) {
  const S = 'github-search'; let s = st(src.guid, S); if (s?.status === 'done') return;
  const years: string[] = []; for (let y = 2008; y <= 2026; y++) for (const h of ['01-01..' + y + '-06-30', '07-01..' + y + '-12-31']) years.push(`${y}-${h}`);
  let cur = safeJson<any>(s?.cursor, { i: 0, page: 1 });
  for (; cur.i < years.length; cur = { i: cur.i + 1, page: 1 }) {
    for (; cur.page <= 10; cur.page++) {
      const q = `stars:>=${CAP.ghMinStars} created:${years[cur.i]}`;
      const r = await pf.fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&per_page=100&page=${cur.page}`, { headers: { accept: 'application/vnd.github+json' } });
      if (r.status === 403 || r.status === 422) { log('  GitHub ' + r.status + ' 等待 65s'); await new Promise(x => setTimeout(x, 65000)); cur.page--; continue; }
      if (r.status >= 400) throw new Error('GitHub HTTP ' + r.status);
      const j = JSON.parse(r.text); const its: any[] = j.items || [];
      const items: CrawlItem[] = its.map(x => ({ name: x.name, url: x.homepage && /^https?:/.test(x.homepage) ? x.homepage : x.html_url, tagline: x.description ? String(x.description).slice(0, 200) : null, description: [x.description, x.language && `Language: ${x.language}`, (x.topics || []).length && `Topics: ${x.topics.join(', ')}`, `GitHub: ${x.html_url}`].filter(Boolean).join('\n'), image: x.owner?.avatar_url ? x.owner.avatar_url + '&s=96' : null, votes: x.stargazers_count, date: x.created_at }));
      const res = ingest(src, S, items); s = bump(src, S, 1, res, { i: cur.i, page: cur.page + 1 });
      log(`  GitHub ${years[cur.i]} p${cur.page}: +${res.n} 累计${s.items}`); maybeSave();
      if (its.length < 100) break;
    }
  }
  setSt(src.guid, S, { status: 'done' });
}
async function reddit(src: any) {
  const S = 'reddit-json'; let s = st(src.guid, S); if (s?.status === 'done') return;
  const sub = src.url.match(/\/r\/([^/]+)/)?.[1]; let cur = safeJson<any>(s?.cursor, { after: null });
  for (let i = 0; i < 20; i++) {
    const r = await pf.fetch(`https://old.reddit.com/r/${sub}/new.json?limit=100${cur.after ? '&after=' + cur.after : ''}`);
    if (r.status >= 400 || !r.text.trim().startsWith('{')) throw new Error(`Reddit HTTP ${r.status}${r.text.includes('Blocked') ? '（被 Reddit 网络封锁）' : ''}`);
    const j = JSON.parse(r.text); const ch: any[] = j.data?.children || [];
    const items: CrawlItem[] = ch.map(c => c.data).filter(d => !d.is_self && d.url && !/reddit\.com|redd\.it|imgur|youtu|twitter|x\.com/.test(d.url)).map(d => ({ name: d.title.split(/\s[-–—|:]\s/)[0].slice(0, 60), tagline: d.title, url: d.url, votes: d.score, date: new Date(d.created_utc * 1000).toISOString() }));
    const res = ingest(src, S, items); cur = { after: j.data?.after }; s = bump(src, S, 1, res, cur); maybeSave();
    if (!cur.after) break;
  }
  setSt(src.guid, S, { status: 'done' });
}

async function phSitemap(src: any) {
  const S = 'ph-merged'; const s0 = st(src.guid, S); let cur = safeJson<any>(s0?.cursor, { i: 0 });
  const rows: any[] = JSON.parse(fs.readFileSync(String(ARGS.phfile || '/workspace/ph/merged.json'), 'utf8'));
  if (ARGS.phreset) cur = { i: 0 };
  for (let i = cur.i; i < rows.length; i += 2000) {
    const res = ingest(src, S, rows.slice(i, i + 2000).map(x => ({ name: x.name, url: `https://www.producthunt.com/products/${x.slug}`, tagline: x.tagline || null, description: x.tagline || null, image: null, date: x.date || null } as any)));
    bump(src, S, 1, res, { i: i + 2000 }); if (i % 20000 === 0) log(`  PH 合并 ${i}/${rows.length}`); maybeSave();
  }
  log(`  PH 合并完成 ${rows.length}`); setSt(src.guid, S, { status: 'done' });
}
async function betalist(src: any) {
  const S = 'betalist-pages'; let s = st(src.guid, S); if (s?.status === 'done') return;
  let cur = safeJson<any>(s?.cursor, { page: 1 });
  for (; cur.page <= 3000; cur.page++) {
    const r = await pf.fetch(`https://betalist.com/?page=${cur.page}`); if (r.status >= 400) break;
    const rows = parseBetaListPage(r.text); if (!rows.length) break;
    const res = ingest(src, S, rows.map(x => ({ name: x.name, tagline: x.tagline, description: x.tagline, url: null, image: x.image, date: x.date })));
    s = bump(src, S, 1, res, { page: cur.page + 1 }); if (cur.page % 25 === 0) log(`  BetaList 第${cur.page}页 累计${s.items} 已到 ${s.earliest}`); maybeSave();
  }
  setSt(src.guid, S, { status: 'done' });
}

/** 通用：规则列表分页（RSS ?paged= / HTML next / 模式探测） */
async function listPaged(src: any, f: Fetcher, S: string, baseRule: CrawlRule, timeUp: () => boolean) {
  let s = st(src.guid, S); if (s?.status === 'done') return s;
  let cur = safeJson<any>(s?.cursor, { url: baseRule.listUrl || src.url, page: 1, template: null, empty: 0 });
  const seen = new Set<string>();
  let lastHtml = ''; const cf: Fetcher = async (u) => { const r = await f(u); if (u === cur.url) lastHtml = r.text; return r; };
  while (cur.url && cur.page <= CAP.maxPages && (s?.items || 0) < CAP.perSourceItems && !timeUp()) {
    let items: CrawlItem[] = [];
    try { items = (await runRule({ ...baseRule, listUrl: cur.url, maxItems: 100000 }, src.url, cf)).items; }
    catch (e) { if (cur.page === 1) throw e; break; }
    const fresh = items.filter(i => { const k = i.name.toLowerCase().trim(); if (seen.has(k)) return false; seen.add(k); return true; });
    const res = ingest(src, S, fresh); cur.empty = fresh.length ? 0 : cur.empty + 1;
    // 下一页
    let next: string | null = null;
    if (cur.template) next = cur.template.replace('{n}', String(cur.page + 1));
    else if (baseRule.mode !== 'rss') next = findNextPage(lastHtml, cur.url);
    if (!next && !cur.template && cur.page === 1) {
      for (const c of pageUrlCandidates(cur.url, 2)) {
        try { const r = await f(c); if (r.status >= 400) continue; const its = (await runRule({ ...baseRule, listUrl: c, maxItems: 100000, followDetail: false }, src.url, async u => u === c ? r : f(u))).items;
          const nw = its.filter(i => !seen.has(i.name.toLowerCase().trim())); if (nw.length >= 2) { cur.template = c.replace(/([?&/](?:page|p|paged)[=/])2/, '$1{n}'); next = c; log(`  ${src.name}: 分页模式 ${cur.template}`); break; } } catch { /* */ }
      }
    }
    s = bump(src, S, 1, res, { ...cur, url: next, page: cur.page + 1 }); cur = { ...cur, url: next, page: cur.page + 1 };
    if (cur.page % 10 === 0) log(`  ${src.name} [${S}] 第${cur.page}页 累计${s.items} 新${s.inserted} 最早${s.earliest || '-'}`);
    maybeSave(); if (cur.empty >= CAP.emptyPagesStop || !next) break;
  }
  return setSt(src.guid, S, { status: 'done' });
}
/** 通用：sitemap → 产品详情页 */
async function sitemap(src: any, f: Fetcher, S: string, timeUp: () => boolean) {
  let s = st(src.guid, S); if (s?.status === 'done') return s;
  const origin = new URL(src.url).origin; let cur = safeJson<any>(s?.cursor, null);
  if (!cur) {
    const roots = new Set<string>();
    try { const r = await f(origin + '/robots.txt'); if (r.status < 400) for (const m of r.text.matchAll(/^sitemap:\s*(\S+)/gim)) roots.add(m[1]); } catch { /* */ }
    if (!roots.size) { roots.add(origin + '/sitemap.xml'); roots.add(origin + '/sitemap_index.xml'); }
    const queue = [...roots]; const urls: { loc: string; lastmod: string | null }[] = []; const prodUrls: typeof urls = []; let n = 0;
    while (queue.length && n++ < 60 && urls.length < 200000) { const u = queue.shift()!; try { const r = await f(u); if (r.status >= 400 || !/<urlset|<sitemapindex/.test(r.text.slice(0, 3000))) continue; const p = parseSitemap(r.text); if (/(tools?|products?|startups?|apps?|listings?|software|launch|projects?|companies|items|servers)[-_]?\d*\.xml/i.test(u) && !/compare|alternative|categor|tag|vs/i.test(u)) prodUrls.push(...p.urls); queue.push(...p.sitemaps.filter(x => !/blog|post-sitemap|news|tag|categor|author|page-sitemap|image|video/i.test(x))); urls.push(...p.urls); } catch { /* */ } }
    let pick = pickProductUrls(urls, new URL(src.url).host);
    if (prodUrls.length > pick.urls.length) { prodUrls.sort((a, b) => (b.lastmod || '').localeCompare(a.lastmod || '')); pick = { seg: '(product sitemap)', urls: prodUrls }; }
    cur = { seg: pick.seg, total: pick.urls.length, urls: pick.urls.slice(0, CAP.sitemapDetail), i: Math.min(st(src.guid, 'sitemap-skip')?.items || 0, pick.urls.length) };
    log(`  ${src.name}: sitemap ${urls.length} 条 URL，产品段 /${pick.seg || '-'}/ ${pick.urls.length} 个，抓取前 ${cur.urls.length}`);
    s = setSt(src.guid, S, { cursor: JSON.stringify(cur) });
  }
  const host = hostOf(src.url) || '';
  while (cur.i < cur.urls.length && !timeUp()) {
    const batch = cur.urls.slice(cur.i, cur.i + 20); const items: CrawlItem[] = [];
    await pool(batch, 2, async (x: any) => { try { const r = await f(x.loc); if (r.status >= 400) return; const ld = parseJsonLd(r.text, r.finalUrl).filter(i => i.name)[0]; const d = parseDetail(r.text, r.finalUrl); const name = ld?.name || d.name; if (!name) return; const url = (ld?.url && hostOf(ld.url) !== host ? ld.url : null) || d.url || null; items.push({ name, url, description: ld?.description || d.description || null, tagline: (ld?.description || d.description || '').split(/(?<=[.!?。！？])\s/)[0].slice(0, 160) || null, image: ld?.image || d.image || null, date: x.lastmod }); } catch { /* */ } });
    const res = ingest(src, S, items); cur.i += batch.length; s = bump(src, S, 1, res, cur);
    if (cur.i % 200 === 0) log(`  ${src.name} [sitemap] ${cur.i}/${cur.urls.length} 累计${s.items}`); maybeSave();
  }
  return setSt(src.guid, S, { status: cur.i >= cur.urls.length ? 'done' : 'partial' });
}

async function generic(src: any) {
  const timeUp = deadline(CAP.sourceMinutes); let rule = safeJson<CrawlRule | null>(src.rule_json, null);
  const failing = src.last_status !== 'ok'; let f: Fetcher = fetcher; let usedRender = false;
  if (failing) {
    // 失败来源：先换真实浏览器 UA/备用地址，再 Playwright 渲染
    const alts = [src.url, src.url.replace('://', '://www.'), src.url.replace(/\/$/, '') + '/feed', src.url.replace(/\/$/, '') + '/rss'];
    let ok = false;
    for (const a of alts) { try { const r = await fetcher(a); if (r.status < 400 && r.text.length > 2000 && !/just a moment|cf-chl|captcha|access denied/i.test(r.text.slice(0, 5000))) { const res = await runRule({ mode: 'auto', listUrl: a, maxItems: 100000 }, src.url, fetcher).catch(() => null); if (res && res.items.length >= 3) { rule = res.rule.mode === 'auto' ? { mode: /<rss|<feed|<rdf/i.test(r.text.slice(0, 2000)) ? 'rss' : 'html', listUrl: a, ...(res.rule.itemSelector ? res.rule : {}) } as CrawlRule : res.rule; if (rule.mode === 'html' && !rule.itemSelector) rule = { ...rule, mode: 'jsonld' }; ok = true; break; } } } catch { /* */ } }
    if (!ok) { try { let r = await renderFetcher(src.url); if (r.status >= 400 || r.status === 0) { const w = await renderFetcher(src.url.replace('://', '://www.')); if (w.status && w.status < 400) r = w; } if (r.status < 400 && r.text.length > 2000) { const res = await runRule({ mode: 'auto', listUrl: r.finalUrl, maxItems: 100000 }, src.url, async u => u === r.finalUrl || u === src.url ? r : renderFetcher(u)).catch(() => null); if (res && res.items.length >= 3) { rule = { ...res.rule, listUrl: r.finalUrl }; f = renderFetcher; usedRender = true; ok = true; } } setSt(src.guid, 'probe', { status: 'done', last_error: `Playwright 渲染 HTTP ${r.status}${/just a moment|cf-chl|challenge/i.test(r.text) ? '（Cloudflare 人机验证）' : ''}${ok ? '' : '，未识别出产品列表'}`, cursor: null }); log(`  ${src.name}: Playwright 渲染 HTTP ${r.status}，${ok ? '成功' : '未识别出产品列表'}`); } catch (e) { setSt(src.guid, 'probe', { status: 'done', last_error: String((e as Error).message).slice(0, 200) }); } }
    if (ok) log(`  ${src.name}: 失败来源已恢复（${usedRender ? 'Playwright 渲染' : '真实 UA/备用地址'}，${rule?.mode}）`);
  }
  if (rule && rule.mode !== 'auto') await listPaged(src, f, usedRender ? 'list-render' : 'list-paged', rule, timeUp);
  const s0 = db.get<any>('SELECT SUM(items) c FROM crawl_state WHERE source_guid=?', [src.guid]).c || 0;
  if (s0 < CAP.perSourceItems && !timeUp()) await sitemap(src, usedRender ? renderFetcher : fetcher, 'sitemap', timeUp);
}

async function crawlOne(src: any) {
  const t0 = Date.now(); log(`▶ ${src.seq} ${src.name}`);
  try {
    if (src.seq === 162) await hnAlgolia(src);
    else if (src.seq === 211) await githubSearch(src);
    else if (src.seq === 2) await betalist(src);
    else if (src.seq === 1 && ARGS.ph) await phSitemap(src);
    else if (/reddit\.com\/r\//.test(src.url)) await reddit(src);
    else await Promise.race([generic(src), new Promise((_, rej) => setTimeout(() => rej(new Error('来源硬超时（看门狗）')), (CAP.sourceMinutes + 5) * 60_000))]);
    const rows = db.all<any>('SELECT * FROM crawl_state WHERE source_guid=? AND strategy!=\'probe\'', [src.guid]);
    const items = rows.reduce((a, r) => a + (r.items || 0), 0); const pc = db.get<any>('SELECT COUNT(DISTINCT product_guid) c FROM product_versions WHERE source_guid=?', [src.guid]).c;
    db.run('UPDATE sources SET last_crawl_at=?, last_status=?, last_error=?, product_count=? WHERE guid=?', [now(), pc ? 'ok' : (src.last_status === 'error' ? 'error' : 'empty'), pc ? null : src.last_error, pc, src.guid]);
    setSt(src.guid, 'source', { status: 'done', items, cursor: null });
    log(`✔ ${src.seq} ${src.name}: 本轮 ${items} 条，来源产品 ${pc}，用时 ${Math.round((Date.now() - t0) / 1000)}s`);
  } catch (e) {
    const msg = String((e as Error).message || e).slice(0, 300); setSt(src.guid, 'source', { status: 'error', last_error: msg });
    db.run('UPDATE sources SET last_status=CASE WHEN product_count>0 THEN last_status ELSE \'error\' END, last_error=? WHERE guid=?', [msg, src.guid]); log(`✘ ${src.seq} ${src.name}: ${msg}`);
  }
  maybeSave(true);
}

/** 清理媒体来源的文章噪音：仅来自新闻来源、且无其他来源佐证的产品 */
function cleanNoise() {
  if (db.get<any>("SELECT value FROM settings WHERE key='crawl.noiseCleaned'")) return;
  const news = db.all<any>('SELECT guid,seq FROM sources').filter(s => NEWS_SEQ.has(s.seq)).map(s => s.guid);
  const q = news.map(() => '?').join(',');
  const cand = db.all<any>(`SELECT p.guid,p.name,p.url FROM products p WHERE p.guid IN (SELECT product_guid FROM product_versions WHERE source_guid IN (${q})) AND p.guid NOT IN (SELECT product_guid FROM product_versions WHERE source_guid NOT IN (${q}) AND source_guid IS NOT NULL)`, [...news, ...news]);
  const del = cand.map(c => c.guid);
  db.tx(() => { for (const g of del) { for (const t of ['product_versions', 'products']) db.run(`DELETE FROM ${t} WHERE ${t === 'products' ? 'guid' : 'product_guid'}=?`, [g]); } });
  for (const t of ['favorites', 'product_tags', 'notes']) { try { db.run(`DELETE FROM ${t} WHERE product_guid NOT IN (SELECT guid FROM products)`); } catch { /* table may not exist */ } }
  db.run('UPDATE sources SET product_count=(SELECT COUNT(DISTINCT product_guid) FROM product_versions v WHERE v.source_guid=sources.guid)');
  db.setSetting('crawl.noiseCleaned', JSON.stringify({ removed: del.length, at: new Date().toISOString(), sample: cand.slice(0, 10).map(c => c.name) }));
  log(`🧹 清理新闻/文章噪音产品 ${del.length} 个（仅出现在媒体来源）`); maybeSave(true);
}

async function images() {
  const have = new Set(fs.readdirSync(IMG).map(f => f.split('.')[0]));
  const rows = db.all<any>('SELECT guid, logo_url FROM products WHERE logo_local IS NULL AND logo_url LIKE \'http%\'');
  log(`🖼 待缓存图片 ${rows.length}`); let ok = 0, done = 0; const imgPf = new PoliteFetcher(300, {}, log);
  const EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico', 'image/avif': '.avif' };
  const pending: string[] = [];
  await pool(rows, 16, async r => {
    const key = sha1(r.logo_url); let file: string | null = null;
    if (have.has(key)) file = fs.readdirSync(IMG).find(x => x.startsWith(key + '.')) || null;
    else try { const res = await imgPf.fetch(r.logo_url, { maxRetries: 1, raw: async (u, h) => { const x = await fetch(u, { headers: { 'user-agent': h['user-agent'] }, signal: AbortSignal.timeout(15000) }); const ct = (x.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(); const buf = Buffer.from(await x.arrayBuffer()); const ext = EXT[ct] || (ct.startsWith('image/') ? '.img' : ''); if (x.ok && ext && buf.length >= 50 && buf.length <= 3_000_000) { file = key + ext; fs.writeFileSync(path.join(IMG, file), buf); } return { status: x.status, text: '', contentType: ct, finalUrl: u }; } }); void res; } catch { /* */ }
    if (file) { db.run('UPDATE products SET logo_local=? WHERE guid=?', [file, r.guid]); ok++; have.add(key); pending.push(file); }
    if (++done % 1000 === 0) { log(`  图片 ${done}/${rows.length} 成功 ${ok}`); maybeSave(); }
  });
  log(`🖼 图片完成 ${ok}/${rows.length}`); maybeSave(true);
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  if (!fs.existsSync(DBF)) { fs.copyFileSync('data/seed/producthub.db', DBF); for (const f of fs.readdirSync('data/seed/images')) fs.copyFileSync(path.join('data/seed/images', f), path.join(IMG, f)); log('初始化工作库（复制 v1.4 种子）'); }
  db = await DB.open(DBF);
  db.run('CREATE TABLE IF NOT EXISTS crawl_state(source_guid TEXT, strategy TEXT, cursor TEXT, pages INTEGER DEFAULT 0, items INTEGER DEFAULT 0, inserted INTEGER DEFAULT 0, status TEXT, earliest TEXT, last_error TEXT, updated_at TEXT, PRIMARY KEY(source_guid, strategy))');
  const phase = ARGS.phase || 'all'; log(`==== crawl-history 启动 phase=${phase} cap=${JSON.stringify(CAP)} ====`);
  const timer = setInterval(() => { const c = db.get<any>('SELECT (SELECT COUNT(*) FROM products) p, (SELECT COUNT(*) FROM product_versions) v, (SELECT COUNT(*) FROM crawl_state WHERE strategy=\'source\' AND status=\'done\') d'); log(`📊 进度：产品 ${c.p}，版本 ${c.v}，已完成来源 ${c.d}，本次入库 ${totals.items}（新 ${totals.inserted}，噪音过滤 ${totals.noise}），请求 ${pf.stats.requests}，429 ${pf.stats.r429}`); }, 120_000);
  if (phase === 'all' || phase === 'crawl') {
    cleanNoise();
    const only = ARGS.only ? new Set(String(ARGS.only).split(',').map(Number)) : null;
    const srcs = db.all<any>('SELECT * FROM sources ORDER BY seq').filter(s => (!only || only.has(s.seq)) && !NEWS_SEQ.has(s.seq) && (ARGS.redo || st(s.guid, 'source')?.status !== 'done'));
    // 慢的 API 来源优先启动；其余按 seq
    srcs.sort((a, b) => (+[162, 211].includes(b.seq) - +[162, 211].includes(a.seq)) || a.seq - b.seq);
    if (ARGS.redo) for (const x of srcs) db.run('DELETE FROM crawl_state WHERE source_guid=?', [x.guid]);
    log(`待抓来源 ${srcs.length}（跳过媒体来源 ${NEWS_SEQ.size}）`);
    await pool(srcs, +(ARGS.conc || 12), crawlOne);
  }
  if (phase === 'all' || phase === 'images') await images();
  db.setSetting('crawl.finishedAt', new Date().toISOString()); maybeSave(true); clearInterval(timer);
  if (browser) await browser.close();
  log('==== crawl-history 完成 ===='); process.exit(0);
})().catch(e => { log('FATAL ' + (e?.stack || e)); try { db?.saveNow(); } catch { /* */ } process.exit(1); });
