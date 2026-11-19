/**
 * v1.9 历史数据深度补抓（覆盖度盘点 → 按缺口排序补抓 → 报告），断点续跑
 *   npx tsx scripts/history-deep.ts --phase=coverage|fill|report|all [--budget=150] [--only=seq,..] [--conc=12]
 * 只走公开 API / sitemap / Common Crawl / Wayback；不做任何人机验证绕过；只收产品/工具条目。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DB, now } from '../src/server/db';
import { upsertProduct } from '../src/server/products';
import { PoliteFetcher, isArticleNoise, parseShowHn, FetchResult, CHROME_UA } from '../src/server/history';
import { parseJsonLd, parseDetail, pool } from '../src/server/crawler';
import { httpGet, isChallengeHtml, listCommonCrawlIndexes } from '../src/server/archive-fallback';
import { CursorStore, ensureDeepTables, saveCoverage, discoverSitemapProducts, slugToName, normKey, canonicalProductUrl, SLUG_DENY_HOSTS, monthWindows, splitWindow, isShowHnNonProduct, retryDelay, Coverage } from '../src/server/history-deep';
import { hostOf } from '../src/server/util';

const ARGS = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']));
const DBF = path.resolve(String(ARGS.db || 'data/crawl/producthub.db'));
const CACHE = path.resolve('data/delta/deep-cache'); fs.mkdirSync(CACHE, { recursive: true });
const LOGF = path.resolve('logs/history-deep.log'); fs.mkdirSync(path.dirname(LOGF), { recursive: true });
const SUMF = path.resolve('data/delta/history-deep-summary.json');
const log = (s: string) => { const line = `[${new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })}] ${s}`; fs.appendFileSync(LOGF, line + '\n'); console.log(line); };
const BUDGET_MIN = +(ARGS.budget || 150); const T0 = Date.now(); const DEADLINE = T0 + BUDGET_MIN * 60_000;
const timeUp = () => Date.now() > DEADLINE || fs.existsSync(path.join(CACHE, 'STOP'));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// 媒体/新闻来源（不收文章）+ 非产品库（公司信息库）
const NEWS_SEQ = new Set([152, 154, 173, 174, 175, 182, 183, 185, 186, 187, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 203, 204, 205, 206, 207, 208]);
const NON_PRODUCT: Record<number, string> = { 345: 'Ferra.ru 的 /apps/ 段实为 /news/apps/ 新闻文章，按「不收新闻」规则不收（本次已回滚）', 567: 'chip.de 的 /software/ 段实为 /news/software/ 新闻文章，不收（本次已回滚）', 604: 'SEMrush 的 sitemap 是 /website/<域名> 流量页（网站域名列表），不是产品，按规则不收（本次已回滚）', 528: 'Webflow 的 sitemap 主要是 made-in-webflow 用户建站展示页（个人网站），不是产品/应用，按规则不收（本次已回滚）', 314: 'BuiltWith 的 sitemap 是 /<技术>/<域名> 网站技术画像（网站域名列表），不是产品，按规则不收（本次已回滚）', 134: 'Owler 为公司信息库（含大量非软件企业），按「只收产品/工具」规则不收', 146: 'GetLatka 为公司营收库：sitemap 只有公司域名 slug（如 xxx.com），无产品描述，多为非软件企业，按「只收产品/工具」规则不收（本次已回滚）', 151: 'Dealroom 为创业公司/投资库（公司而非产品条目），按「只收产品/工具」规则不收（本次已回滚）' };
const API_SOURCES: Record<number, string> = { 162: 'hn-algolia', 636: 'github-search', 211: 'github-search', 125: 'mcp-registry-api', 1: 'producthunt' };
// 产品段后需要保留的层级（Glama: /mcp/servers/<owner>/<repo>）
const DEPTH: Record<string, number> = { 'glama.ai': 2 };
const SEG: Record<string, string> = { 'glama.ai': 'servers' };

const pf = new PoliteFetcher(+(ARGS.interval || 700), { 'api.github.com': 6500, 'hn.algolia.com': 350, 'index.commoncrawl.org': 3000, 'web.archive.org': 2500 }, log);
const rawGet = async (u: string, h: Record<string, string>): Promise<FetchResult> => { const r = await httpGet(u, { timeoutMs: 40_000, retries: 1, headers: { 'user-agent': h['user-agent'] || CHROME_UA, ...(h.accept ? { accept: h.accept } : {}) } }); const ra = r.headers.get('retry-after'); return { status: r.status, text: r.text.slice(0, 12_000_000), contentType: r.headers.get('content-type') || '', finalUrl: r.finalUrl, retryAfter: ra && /^\d+$/.test(ra) ? +ra : null }; };
const get = (u: string, headers: Record<string, string> = {}) => pf.fetch(u, { headers: { 'user-agent': CHROME_UA, ...headers }, raw: rawGet, maxRetries: 3 } as any).catch(() => ({ status: 0, text: '', contentType: '', finalUrl: u } as FetchResult));

let db: DB; let cs: CursorStore;
const summary: any = { started_at: new Date(T0).toISOString(), budget_min: BUDGET_MIN, before: 0, after: 0, by: {} as Record<string, { name: string; strategy: string; found: number; inserted: number; note?: string }>, stopped: [] as string[] };
function bump(seq: number, name: string, strategy: string, found: number, inserted: number, note?: string) { const k = `${seq}`; const b = summary.by[k] || (summary.by[k] = { name, strategy, found: 0, inserted: 0 }); b.found += found; b.inserted += inserted; if (note) b.note = note; b.strategy = strategy; }
let lastSave = 0; const saveSummary = (force = false) => { if (!force && Date.now() - lastSave < 30_000) return; lastSave = Date.now(); summary.updated_at = now(); fs.writeFileSync(SUMF, JSON.stringify(summary, null, 2)); };

type Item = { name: string; url?: string | null; tagline?: string | null; description?: string | null; image?: string | null; votes?: number | null; date?: string | null; snapshotExtra?: any };
function ingest(src: any, items: Item[], trusted = false): { n: number; inserted: number; earliest: string | null; noise: number } {
  let n = 0, inserted = 0, noise = 0; let earliest: string | null = null;
  db.tx(() => { for (const it of items) {
    const name = String(it.name || '').trim(); if (name.length < 2) continue;
    if (!trusted && isArticleNoise(name, it.url)) { noise++; continue; }
    // v1.9.0：只有 slug、无网址无简介且名称带数字后缀（"Shopify 13"）→ 无法区分的同名条目，不收
    if (!it.url && !it.tagline && /\s\d{1,3}$/.test(name)) { noise++; continue; }
    const date = it.date ? String(it.date).slice(0, 10) : null; if (date && /^\d{4}-\d\d-\d\d$/.test(date) && date > '1995' && (!earliest || date < earliest)) earliest = date;
    try { const r = upsertProduct(db, { name, url: it.url, tagline: it.tagline, description: it.description, logo_url: it.image, votes: it.votes, launch_date: date }, { sourceGuid: src.guid, origin: 'crawl-history', versionLabel: src.name }); n++; if (r.status === 'inserted') inserted++; } catch { /* skip */ }
  } });
  return { n, inserted, earliest, noise };
}

// ———— 覆盖度 ————
function localStats(): Map<string, { c: number; mn: string | null; mx: string | null }> {
  const m = new Map<string, any>();
  for (const r of db.all<any>(`SELECT source_guid g, COUNT(DISTINCT product_guid) c, MIN(CASE WHEN launched_at>'1995' THEN launched_at END) mn, MAX(launched_at) mx FROM product_versions WHERE source_guid IS NOT NULL GROUP BY source_guid`)) m.set(r.g, { c: r.c, mn: r.mn, mx: r.mx });
  return m;
}
async function apiTotal(seq: number): Promise<{ total: number | null; method: string; note?: string }> {
  try {
    if (seq === 162) { const r = await get('https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=0&numericFilters=' + encodeURIComponent('points>=3')); return { total: JSON.parse(r.text).nbHits, method: 'hn-algolia nbHits(show_hn, points>=3)' }; }
    if (seq === 636 || seq === 211) { const r = await get('https://api.github.com/search/repositories?per_page=1&q=' + encodeURIComponent('stars:>=500'), { accept: 'application/vnd.github+json' }); return { total: JSON.parse(r.text).total_count, method: 'github total_count(stars>=500)', note: '两个 GitHub 来源共享同一公开总量' }; }
    if (seq === 125) return { total: null, method: 'mcp-registry api（游标分页，已全量）' };
    if (seq === 1) return { total: null, method: 'producthunt（官方 API 需 token；sitemap 受限）', note: '已有 33.6 万，公开通道无更多总量' };
  } catch (e) { return { total: null, method: 'api-error', note: String((e as Error).message).slice(0, 120) }; }
  return { total: null, method: 'unknown' };
}
async function coverage(only: Set<number> | null) {
  const srcs = db.all<any>('SELECT * FROM sources ORDER BY seq').filter(s => !only || only.has(s.seq));
  const local = localStats(); log(`覆盖度盘点：${srcs.length} 个来源`);
  let done = 0;
  await pool(srcs, +(ARGS.conc || 16), async (s: any) => {
    const l = local.get(s.guid) || { c: 0, mn: null, mx: null };
    const base: Coverage = { source_guid: s.guid, seq: s.seq, name: s.name, host: s.host || hostOf(s.url) || '', method: '', public_total: null, local_count: l.c, gap: null, earliest: l.mn?.slice(0, 10), latest: l.mx?.slice(0, 10), status: 'unknown', note: null };
    if (NEWS_SEQ.has(s.seq)) { saveCoverage(db, { ...base, method: 'skip', status: 'news', note: '新闻/媒体来源：只收产品，不做历史回溯' }); return; }
    if (NON_PRODUCT[s.seq]) { saveCoverage(db, { ...base, method: 'skip', status: 'non-product', note: NON_PRODUCT[s.seq] }); return; }
    if (API_SOURCES[s.seq]) { const a = await apiTotal(s.seq); saveCoverage(db, { ...base, method: a.method, public_total: a.total, gap: a.total != null ? Math.max(0, a.total - l.c) : null, status: 'api', note: a.note }); return; }
    if (ARGS.reuse && fs.existsSync(path.join(CACHE, `${s.seq}.json`))) { const j = JSON.parse(fs.readFileSync(path.join(CACHE, `${s.seq}.json`), 'utf8')); saveCoverage(db, { ...base, method: j.method, public_total: j.total, gap: Math.max(0, j.total - l.c), status: j.blocked ? 'blocked' : 'sitemap' }); return; }
    try {
      const host = (hostOf(s.url) || '').replace(/^www\./, '');
      const d = await discoverSitemapProducts(async u => { const r = await get(u); return { status: r.status, text: r.text }; }, s.url, { maxFiles: +(ARGS.files || 60), seg: SEG[host], depth: DEPTH[host] });
      let method = `sitemap(${d.files} 文件, ${d.urls} URL, 段 /${d.seg || '-'}/${d.truncated ? ', 截断' : ''})`;
      let product = d.product; let blocked = d.blocked;
      fs.writeFileSync(path.join(CACHE, `${s.seq}.json`), JSON.stringify({ seq: s.seq, method, total: product.length, seg: d.seg, blocked, urls: product }));
      saveCoverage(db, { ...base, method, public_total: product.length || (blocked ? null : 0), gap: product.length ? Math.max(0, product.length - l.c) : null, status: blocked ? 'blocked' : product.length ? 'sitemap' : 'no-sitemap', note: blocked });
    } catch (e) { saveCoverage(db, { ...base, method: 'error', status: 'error', note: String((e as Error).message).slice(0, 200) }); }
    if (++done % 25 === 0) log(`  覆盖度 ${done}/${srcs.length}`);
  });
}

// ———— CF/无 sitemap 回退：Common Crawl 多索引 + Wayback CDX 列 URL ————
async function archiveUrlList(host: string, maxPer = 15000): Promise<{ urls: string[]; evidence: string[] }> {
  const urls = new Set<string>(); const ev: string[] = [];
  try {
    const idx = (await listCommonCrawlIndexes()).slice(0, +(ARGS.ccidx || 4));
    for (const ix of idx) {
      if (timeUp()) break;
      for (let a = 0; a < 3; a++) {
        const r = await get(`${ix.cdx}?url=${encodeURIComponent(host + '/*')}&output=json&fl=url,status&filter=status:200&limit=${maxPer}`);
        if (r.status === 503 || r.status === 504 || r.status === 429 || r.status === 0) { await sleep(retryDelay(a, 5000)); continue; }
        let n = 0; if (r.status === 200) for (const line of r.text.split('\n')) { try { const j = JSON.parse(line); if (j.url) { urls.add(j.url.replace(/[?#].*$/, '')); n++; } } catch { /* */ } }
        ev.push(`${ix.id}:${r.status}/${n}`); break;
      }
    }
  } catch (e) { ev.push('cc-err ' + String((e as Error).message).slice(0, 60)); }
  for (let a = 0; a < 3 && !timeUp(); a++) {
    const r = await get(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(host + '/*')}&output=json&fl=original&filter=statuscode:200&collapse=urlkey&limit=${maxPer * 2}`);
    if (r.status !== 200) { ev.push(`wayback:${r.status}`); await sleep(retryDelay(a, 6000)); continue; }
    try { const rows = JSON.parse(r.text); for (const row of rows.slice(1)) urls.add(String(row[0]).replace(/[?#].*$/, '').replace(/^http:/, 'https:').replace(/:80\//, '/')); ev.push(`wayback:${rows.length - 1}`); } catch { ev.push('wayback:non-json'); }
    break;
  }
  return { urls: [...urls], evidence: ev };
}

// ———— 补抓：sitemap / 归档 URL → 详情或 slug ————
function knownKeys(src: any): { names: Set<string>; urls: Set<string> } {
  const names = new Set<string>(), urls = new Set<string>();
  for (const r of db.all<any>(`SELECT p.name, p.url, v.url vurl, json_extract(v.snapshot,'$.description') d, json_extract(v.snapshot,'$.name') sn FROM product_versions v JOIN products p ON p.guid=v.product_guid WHERE v.source_guid=?`, [src.guid])) {
    names.add(normKey(r.name)); if (r.sn) names.add(normKey(r.sn));
    for (const u of [r.url, r.vurl, ...(String(r.d || '').match(/https?:\/\/\S+/g) || [])]) if (u) urls.add(String(u).replace(/[)\],.;]+$/, '').replace(/\/$/, '').toLowerCase());
  }
  return { names, urls };
}
/** 目录站标题模板去壳：ITreview「レビュー募集中！X を紹介…」、Microlaunch「X is now on Microlaunch」等 */
export function stripTitleTemplate(n: string): string {
  return String(n || '').replace(/^レビュー募集中！\s*(.+?)を紹介.*$/, '$1').replace(/^(.+?)の評判・口コミ.*$/, '$1').replace(/^(.+?)\s+is now on Microlaunch$/i, '$1').replace(/^(.+?)\s+is (now )?live on .+$/i, '$1').trim();
}
function cleanDetailName(name: string, siteName: string): string {
  name = stripTitleTemplate(name);
  let n = name.replace(/\s*[|·•»]\s*.*$/, '').replace(/\s+[-–—]\s+(.*)$/, (m, rest) => /review|pricing|alternative|features|mcp|server|tool|app|ai/i.test(rest) || rest.length > 25 ? '' : m).trim();
  n = n.replace(/\s*(Reviews?|Pricing|Alternatives|Features)\b.*$/i, '').replace(/\s*MCP Server\b.*$/i, ' MCP').trim();
  if (normKey(n) === normKey(siteName)) return '';
  return n.slice(0, 80);
}
async function fillSitemap(src: any, cov: any) {
  const S = 'deep-sitemap'; const c0 = cs.get(src.guid, S); if (c0?.status === 'done' || c0?.status === 'skipped') return;
  if (NON_PRODUCT[src.seq]) return;
  const host = (hostOf(src.url) || '').replace(/^www\./, '');
  const file = path.join(CACHE, `${src.seq}.json`); let list: { loc: string; lastmod: string | null }[] = []; let via = 'sitemap';
  if (fs.existsSync(file)) list = JSON.parse(fs.readFileSync(file, 'utf8')).urls || [];
  if (!list.length && (cov.status === 'blocked' || cov.status === 'no-sitemap')) {
    const cf = cs.cursor<any>(src.guid, 'deep-archive-list', null);
    let urls: string[] = cf?.urls || [];
    if (!cf) { const a = await archiveUrlList(host); urls = a.urls; cs.set(src.guid, 'deep-archive-list', { cursor: { urls: [], n: urls.length, evidence: a.evidence }, status: 'done' }); log(`  ${src.name}: 归档列 URL ${urls.length}（${a.evidence.join(' ')}）`);
      const d = await discoverSitemapProducts(async () => ({ status: 200, text: `<urlset>${urls.map(u => `<url><loc>${u.replace(/&/g, '&amp;')}</loc></url>`).join('')}</urlset>` }), src.url, { maxFiles: 1, seg: SEG[host], depth: DEPTH[host] });
      list = d.product; fs.writeFileSync(file, JSON.stringify({ seq: src.seq, method: `archive(${a.evidence.join(' ')}) 段 /${d.seg || '-'}/`, total: list.length, seg: d.seg, blocked: cov.note, urls: list, via: 'archive' }));
      if (list.length) saveCoverage(db, { ...cov, method: `archive-cdx 段 /${d.seg}/`, public_total: list.length, gap: Math.max(0, list.length - cov.local_count), status: 'archive' } as any);
    }
    via = 'archive';
  }
  if (!list.length) { cs.set(src.guid, S, { status: 'done', last_error: 'no product urls' }); return; }
  // 新闻/博客 URL 守卫：抽样 300 条，>10% 像文章（/news/、/blog/、日期路径）→ 判为新闻源，不收
  { const smp = list.slice(0, 300); const art = smp.filter(x => /\/(news|blog|blogs|article|articles|post|posts|press|stories)\/|\d{2}-\d{2}-\d{4}|\/\d{4}\/\d{2}\//i.test(x.loc)).length;
    if (smp.length && art / smp.length > 0.1) { log(`  ${src.name}: URL 多为新闻/文章（${art}/${smp.length}），按规则不收`); cs.set(src.guid, S, { status: 'skipped', last_error: '新闻/文章 URL' }); (summary as any).skipped = [...((summary as any).skipped || []), `${src.seq} ${src.name}: URL 为新闻/文章`]; return; } }
  const known = knownKeys(src);
  const missing = list.filter(x => { const l = x.loc.replace(/\/$/, '').toLowerCase(); if (known.urls.has(l)) return false; const n = slugToName(x.loc); return !!n && !known.names.has(normKey(n)); });
  let cur = cs.cursor<any>(src.guid, S, { i: 0, detailOk: 0, detailFail: 0, mode: via === 'archive' ? 'slug' : 'detail' });
  if (cur.total !== missing.length) cur = { ...cur, i: Math.min(cur.i, missing.length), total: missing.length };
  log(`▶ ${src.seq} ${src.name}: 公开 ${list.length}，本地 ${cov.local_count}，待补 ${missing.length}（${via}，模式 ${cur.mode}）`);
  const detailCap = +(ARGS.detailcap || 3000);
  while (cur.i < missing.length && !timeUp()) {
    if (cur.mode === 'slug' && !cur.domainChecked) { cur.domainChecked = true; const smp = missing.slice(0, 200); const dom = smp.filter(x => /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,6}$/i.test(decodeURIComponent(x.loc.replace(/\/$/, '').split('/').pop() || ''))).length;
      if (smp.length >= 20 && dom / smp.length > 0.5) { log(`  ${src.name}: slug 多为网站域名（${dom}/${smp.length}），判为网站列表而非产品，跳过`); cs.set(src.guid, S, { cursor: cur, status: 'skipped', last_error: 'slug 为网站域名列表' }); (summary as any).skipped = [...((summary as any).skipped || []), `${src.seq} ${src.name}: slug 为网站域名列表，非产品`]; return; } }
    if (cur.mode === 'slug' && SLUG_DENY_HOSTS.has(host)) { log(`  ${src.name}: 详情不可用且 slug 不可靠（截断/无 ID/多为主题），跳过`); cs.set(src.guid, S, { cursor: cur, status: 'skipped', last_error: 'slug 不可靠，跳过' }); (summary as any).skipped = [...((summary as any).skipped || []), `${src.seq} ${src.name}: 详情页 JS 渲染，slug 截断且丢失 ID，多为主题皮肤`]; return; }
    const useDetail = cur.mode === 'detail' && (cur.detailOk + cur.detailFail) < detailCap;
    const batch = missing.slice(cur.i, cur.i + (useDetail ? 16 : 1000)); const items: Item[] = [];
    if (useDetail) {
      await pool(batch, 2, async x => {
        const r = await get(x.loc);
        let name: string | undefined, url: string | null = null, desc: string | null = null, img: string | null = null;
        if (r.status > 0 && r.status < 400 && !isChallengeHtml(r.text, r.status)) {
          const ld = parseJsonLd(r.text, r.finalUrl).filter(i => i.name)[0]; const d = parseDetail(r.text, r.finalUrl);
          name = cleanDetailName(ld?.name || d.name || '', src.name) || undefined; url = (ld?.url && hostOf(ld.url) !== hostOf(x.loc) ? ld.url : null) || d.url || null; desc = (ld?.description || d.description || null) as any; img = (ld?.image || d.image || null) as any;
        }
        if (name) cur.detailOk++; else cur.detailFail++;
        const slug = slugToName(x.loc);
        const finalName = name || slug; if (!finalName) return;
        items.push({ name: finalName, url, tagline: desc ? desc.slice(0, 200) : null, description: [desc, `${src.name}: ${x.loc}`].filter(Boolean).join('\n'), image: img, date: x.lastmod });
      });
      // 前 40 个详情失败率 >70%（JS 渲染/挑战/403）→ 改 slug 模式
      if (cur.detailOk + cur.detailFail >= 40 && cur.detailFail / (cur.detailOk + cur.detailFail) > 0.7) { cur.mode = 'slug'; log(`  ${src.name}: 详情页不可用（${cur.detailFail}/${cur.detailOk + cur.detailFail} 失败），改用 sitemap slug 入库`); }
    } else {
      for (const x of batch) { const n = slugToName(x.loc); if (n) items.push({ name: n, url: null, description: `${src.name}: ${x.loc}`, date: x.lastmod }); }
    }
    const res = ingest(src, items); cur.i += batch.length;
    cs.add(src.guid, S, { pages: 1, items: res.n, inserted: res.inserted, earliest: res.earliest, cursor: cur, status: 'running' });
    bump(src.seq, src.name, `${S}/${cur.mode}${via === 'archive' ? '+archive' : ''}`, res.n, res.inserted);
    if (cur.i % 400 < batch.length) log(`  ${src.name} ${cur.i}/${missing.length} 本源新增 ${summary.by[src.seq]?.inserted || 0}`);
    saveSummary();
  }
  const fin = cur.i >= missing.length;
  cs.set(src.guid, S, { cursor: cur, status: fin ? 'done' : 'partial' });
  if (!fin) summary.stopped.push(`${src.seq} ${src.name} @${cur.i}/${missing.length}`);
}

// ———— HN Show HN 深度（points>=3，按时间游标倒序） ————
async function fillHn(src: any) {
  const S = 'deep-hn'; const s0 = cs.get(src.guid, S); if (s0?.status === 'done') return;
  let cur = cs.cursor<any>(src.guid, S, { before: Math.floor(Date.now() / 1000) + 3600, pages: 0 });
  log(`▶ HN Show HN 深度 points>=3 从 ${new Date(cur.before * 1000).toISOString().slice(0, 10)} 往前`);
  while (!timeUp()) {
    const r = await get(`https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=1000&numericFilters=${encodeURIComponent(`points>=3,created_at_i<${cur.before}`)}`);
    if (r.status !== 200) { log(`  HN HTTP ${r.status}，退避`); await sleep(retryDelay(cur.err = (cur.err || 0) + 1)); if (cur.err > 6) break; continue; }
    cur.err = 0; const hits: any[] = JSON.parse(r.text).hits || []; if (!hits.length) { cs.set(src.guid, S, { status: 'done', cursor: cur }); break; }
    const items: Item[] = hits.filter(h => h.title && h.url && !isShowHnNonProduct(h.title) && !/substack\.com|medium\.com|\/blog\//i.test(h.url)).map(h => { const p = parseShowHn(h.title); return { name: p.name, tagline: p.tagline, url: h.url || null, description: [h.story_text ? String(h.story_text).replace(/<[^>]+>/g, ' ').slice(0, 600) : p.tagline, `HN: https://news.ycombinator.com/item?id=${h.objectID}`].filter(Boolean).join('\n'), votes: h.points, date: h.created_at }; });
    const res = ingest(src, items, true); cur.before = Math.min(...hits.map(h => h.created_at_i)); cur.pages++;
    cs.add(src.guid, S, { pages: 1, items: res.n, inserted: res.inserted, earliest: res.earliest, cursor: cur });
    bump(src.seq, src.name, 'hn-algolia points>=3', res.n, res.inserted);
    log(`  HN +${res.n}（新 ${res.inserted}）已到 ${new Date(cur.before * 1000).toISOString().slice(0, 10)}`); saveSummary();
    if (hits.length < 50) { cs.set(src.guid, S, { status: 'done', cursor: cur }); break; }
  }
  if (timeUp()) summary.stopped.push(`HN @${new Date(cur.before * 1000).toISOString().slice(0, 10)}`);
}

// ———— GitHub 高星仓库（stars>=500，按创建月窗口，>1000 自动二分） ————
async function ghQuery(q: string, page: number): Promise<any | null> {
  for (let a = 0; a < 6 && !timeUp(); a++) {
    const r = await get(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=100&page=${page}`, { accept: 'application/vnd.github+json' });
    if (r.status === 200) try { return JSON.parse(r.text); } catch { return null; }
    if (r.status === 403 || r.status === 429 || r.status === 0 || r.status >= 500) { await sleep(r.status === 403 || r.status === 429 ? 61_000 : retryDelay(a)); continue; }
    return null;
  }
  return null;
}
async function fillGithub(src: any) {
  const S = 'deep-github'; const s0 = cs.get(src.guid, S); if (s0?.status === 'done') return;
  const stars = +(ARGS.ghstars || 500);
  let cur = cs.cursor<any>(src.guid, S, { queue: monthWindows(2008, new Date().toISOString().slice(0, 10)).reverse(), page: 1 });
  log(`▶ GitHub stars>=${stars} 窗口 ${cur.queue.length} 个`);
  while (cur.queue.length && !timeUp()) {
    const [a, b] = cur.queue[0]; const q = `stars:>=${stars} created:${a}..${b}`;
    const j = await ghQuery(q, cur.page); if (!j) { if (timeUp()) break; cur.queue.shift(); cur.page = 1; continue; }
    if (cur.page === 1 && j.total_count > 1000 && a !== b) { cur.queue.splice(0, 1, ...splitWindow(a, b)); cs.set(src.guid, S, { cursor: cur }); continue; }
    const its: any[] = j.items || [];
    const items: Item[] = its.filter(x => !x.fork && !x.archived).map(x => ({ name: x.name, url: x.homepage && /^https?:/.test(x.homepage) ? x.homepage : x.html_url, tagline: x.description ? String(x.description).slice(0, 200) : null, description: [x.description, x.language && `Language: ${x.language}`, (x.topics || []).length && `Topics: ${x.topics.join(', ')}`, `GitHub: ${x.html_url}`, `Stars: ${x.stargazers_count}`].filter(Boolean).join('\n'), image: x.owner?.avatar_url, votes: x.stargazers_count, date: x.created_at }));
    const res = ingest(src, items, true);
    cs.add(src.guid, S, { pages: 1, items: res.n, inserted: res.inserted, earliest: res.earliest });
    bump(src.seq, src.name, `github-search stars>=${stars}`, res.n, res.inserted);
    if (its.length < 100 || cur.page >= 10) { cur.queue.shift(); cur.page = 1; log(`  GitHub ${a}..${b} 完成；累计新增 ${summary.by[src.seq]?.inserted || 0}，剩 ${cur.queue.length} 窗口`); } else cur.page++;
    cs.set(src.guid, S, { cursor: cur }); saveSummary();
  }
  cs.set(src.guid, S, { cursor: cur, status: cur.queue.length ? 'partial' : 'done' });
  if (cur.queue.length) summary.stopped.push(`GitHub 剩 ${cur.queue.length} 窗口（最新未完成 ${cur.queue[0]?.join('..')}）`);
}

async function fill(only: Set<number> | null) {
  const covs = db.all<any>(`SELECT h.*, s.url, s.guid FROM history_coverage h JOIN sources s ON s.guid=h.source_guid`).filter(c => (!only || only.has(c.seq)) && !['news', 'non-product', 'error'].includes(c.status));
  const ranked = covs.filter(c => (c.gap || 0) >= +(ARGS.mingap || 30) || ['blocked'].includes(c.status) && (ARGS.archive !== '0')).sort((a, b) => (b.gap || 0) - (a.gap || 0));
  log(`补抓：${ranked.length} 个来源按缺口排序；前 10：${ranked.slice(0, 10).map(c => `${c.name}(${c.gap ?? '?'})`).join('、')}`);
  const src = (c: any) => ({ guid: c.source_guid, seq: c.seq, name: c.name, url: c.url });
  const tasks: Promise<void>[] = [];
  const hn = ranked.find(c => c.seq === 162); if (hn) tasks.push(fillHn(src(hn)).catch(e => log('HN 失败 ' + e.message)));
  const gh = covs.find(c => c.seq === 636); if (gh && (!only || only.has(636))) tasks.push(fillGithub(src(gh)).catch(e => log('GitHub 失败 ' + e.message)));
  const site = ranked.filter(c => !API_SOURCES[c.seq]);
  tasks.push(pool(site, +(ARGS.conc || 14), async c => { if (timeUp()) { summary.stopped.push(`${c.seq} ${c.name} 未开始`); return; } try { await fillSitemap(src(c), c); } catch (e) { log(`✘ ${c.name}: ${(e as Error).message}`); } }));
  await Promise.all(tasks);
}

function refreshCoverage() {
  const local = localStats();
  for (const c of db.all<any>('SELECT * FROM history_coverage')) {
    const l = local.get(c.source_guid) || { c: 0, mn: null, mx: null };
    db.run('UPDATE history_coverage SET local_count=?, gap=CASE WHEN public_total IS NULL THEN NULL ELSE MAX(0, public_total-?) END, earliest=?, latest=?, window_from=COALESCE(window_from, ?), window_to=? WHERE source_guid=?', [l.c, l.c, l.mn?.slice(0, 10) || null, l.mx?.slice(0, 10) || null, l.mn?.slice(0, 10) || null, l.mx?.slice(0, 10) || null, c.source_guid]);
    db.run('UPDATE sources SET product_count=? WHERE guid=?', [l.c, c.source_guid]);
  }
}
function report() {
  const rows = db.all<any>('SELECT * FROM history_coverage ORDER BY COALESCE(gap,-1) DESC');
  const esc = (v: any) => v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const cols = ['seq', 'name', 'host', 'status', 'method', 'public_total', 'local_count', 'gap', 'earliest', 'latest', 'note', 'checked_at'];
  const ins = (seq: number) => summary.by[seq]?.inserted ?? '';
  fs.writeFileSync(path.resolve('docs/历史抓取-覆盖度-2026-11-09.csv'), '\uFEFF' + [[...cols, 'added_this_run'].join(','), ...rows.map(r => [...cols.map(c => esc(r[c])), ins(r.seq)].join(','))].join('\n'));
  log(`覆盖度 CSV：docs/历史抓取-覆盖度-2026-11-09.csv（${rows.length} 行）`);
}

(async () => {
  db = await DB.open(DBF); ensureDeepTables(db); cs = new CursorStore(db);
  if (fs.existsSync(SUMF) && ARGS.resume) Object.assign(summary, JSON.parse(fs.readFileSync(SUMF, 'utf8')), { resumed_at: now() });
  if (!summary.before) summary.before = db.get<any>('SELECT COUNT(*) c FROM products').c;
  const only = ARGS.only ? new Set(String(ARGS.only).split(',').map(Number)) : null;
  const phase = String(ARGS.phase || 'all'); log(`==== history-deep 启动 phase=${phase} 预算 ${BUDGET_MIN} 分钟 库 ${summary.before} ====`);
  const timer = setInterval(() => { try { log(`📊 产品 ${db.get<any>('SELECT COUNT(*) c FROM products').c}；剩余 ${Math.round((DEADLINE - Date.now()) / 60000)} 分钟；请求 ${pf.stats.requests} 429/503 ${pf.stats.r429}`); saveSummary(true); } catch { /* */ } }, 300_000);
  if (phase === 'all' || phase === 'coverage') await coverage(only);
  if ((phase === 'all' || phase === 'fill') && !timeUp()) await fill(only);
  refreshCoverage(); report();
  summary.after = db.get<any>('SELECT COUNT(*) c FROM products').c; summary.finished_at = now(); summary.timed_out = timeUp(); saveSummary(true);
  clearInterval(timer); db.saveNow(); log(`==== 完成：${summary.before} → ${summary.after}（+${summary.after - summary.before}）${summary.timed_out ? '，到点停止，断点已保存' : ''} ====`); process.exit(0);
})().catch(e => { log('FATAL ' + (e?.stack || e)); try { saveSummary(true); db?.saveNow(); } catch { /* */ } process.exit(1); });
