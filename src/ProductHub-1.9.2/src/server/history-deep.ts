/**
 * v1.9 历史抓取深度优化（可单测的纯函数 + 持久化游标/覆盖度表）
 * - 覆盖度盘点：本地已抓 vs 站点公开可见总量（sitemap 产品 URL 数 / API total）
 * - 断点续抓：crawl_state(source_guid, strategy) 存游标；大 URL 列表落盘 data/delta/deep-cache
 * - 覆盖窗口：history_coverage 记录每源 earliest/latest、公开总量、缺口、方法、备注
 * - CF 自动回退：直连被挑战/403 → Common Crawl 多索引 + Wayback CDX 列 URL（不做任何验证绕过）
 * - 去重与噪声：slug 规范化键 + 文章/新闻噪声过滤
 */
import { DB, now } from './db';
import { parseSitemap } from './history';
import { isChallengeHtml } from './archive-fallback';

export const DEEP_SCHEMA = `
CREATE TABLE IF NOT EXISTS crawl_state(source_guid TEXT, strategy TEXT, cursor TEXT, pages INTEGER DEFAULT 0, items INTEGER DEFAULT 0, inserted INTEGER DEFAULT 0, status TEXT, earliest TEXT, last_error TEXT, updated_at TEXT, PRIMARY KEY(source_guid, strategy));
CREATE TABLE IF NOT EXISTS history_coverage(
  source_guid TEXT PRIMARY KEY, seq INTEGER, name TEXT, host TEXT, method TEXT,
  public_total INTEGER, local_count INTEGER, gap INTEGER, earliest TEXT, latest TEXT,
  window_from TEXT, window_to TEXT, status TEXT, note TEXT, checked_at TEXT, filled INTEGER DEFAULT 0
);`;
export function ensureDeepTables(db: DB) { db.run(DEEP_SCHEMA); }

/** 游标持久化（crawl_state） */
export class CursorStore {
  constructor(private db: DB) { ensureDeepTables(db); }
  get(src: string, strategy: string): any { return this.db.get<any>('SELECT * FROM crawl_state WHERE source_guid=? AND strategy=?', [src, strategy]) || null; }
  cursor<T>(src: string, strategy: string, def: T): T { const r = this.get(src, strategy); if (!r?.cursor) return def; try { return JSON.parse(r.cursor); } catch { return def; } }
  set(src: string, strategy: string, patch: { cursor?: any; pages?: number; items?: number; inserted?: number; status?: string; earliest?: string | null; last_error?: string | null }) {
    const cur = this.get(src, strategy) || { source_guid: src, strategy, cursor: null, pages: 0, items: 0, inserted: 0, status: 'running', earliest: null, last_error: null };
    const n = { ...cur, ...patch, cursor: patch.cursor === undefined ? cur.cursor : (typeof patch.cursor === 'string' ? patch.cursor : JSON.stringify(patch.cursor)), updated_at: now() };
    this.db.run('INSERT OR REPLACE INTO crawl_state(source_guid,strategy,cursor,pages,items,inserted,status,earliest,last_error,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [n.source_guid, n.strategy, n.cursor, n.pages, n.items, n.inserted, n.status, n.earliest, n.last_error, n.updated_at]);
    return n;
  }
  add(src: string, strategy: string, d: { pages?: number; items?: number; inserted?: number; earliest?: string | null; cursor?: any; status?: string }) {
    const c = this.get(src, strategy) || {};
    return this.set(src, strategy, { pages: (c.pages || 0) + (d.pages || 0), items: (c.items || 0) + (d.items || 0), inserted: (c.inserted || 0) + (d.inserted || 0),
      earliest: [c.earliest, d.earliest].filter(Boolean).sort()[0] || null, cursor: d.cursor, status: d.status || c.status || 'running' });
  }
}

export type Coverage = { source_guid: string; seq: number; name: string; host: string; method: string; public_total: number | null; local_count: number; gap: number | null; earliest?: string | null; latest?: string | null; window_from?: string | null; window_to?: string | null; status: string; note?: string | null };
export function saveCoverage(db: DB, c: Coverage) {
  ensureDeepTables(db);
  const old = db.get<any>('SELECT filled FROM history_coverage WHERE source_guid=?', [c.source_guid]);
  db.run(`INSERT OR REPLACE INTO history_coverage(source_guid,seq,name,host,method,public_total,local_count,gap,earliest,latest,window_from,window_to,status,note,checked_at,filled) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [c.source_guid, c.seq, c.name, c.host, c.method, c.public_total, c.local_count, c.gap, c.earliest || null, c.latest || null, c.window_from || null, c.window_to || null, c.status, c.note || null, now(), old?.filled || 0]);
}

/** 产品详情 URL 规范化：按产品段截断（去掉 /tools/xxx、/reviews 等子页） */
export function canonicalProductUrl(loc: string, seg: string | null, depthAfterSeg = 1): string | null {
  try {
    const u = new URL(loc); const parts = u.pathname.split('/').filter(Boolean);
    let i = seg ? parts.findIndex(p => p.toLowerCase() === seg.toLowerCase()) : -1;
    if (seg && (i < 0 || i > 1)) return null;
    if (!seg) i = parts.length - 2;
    const keep = parts.slice(0, i + 1 + depthAfterSeg); if (keep.length < i + 1 + depthAfterSeg) return null;
    return `${u.origin}/${keep.join('/')}`;
  } catch { return null; }
}

const SLUG_SUFFIX = /[-_](reviews?|alternatives?(-and-competitors)?|pricing|features|review|details|overview|info|app|x-\d+)$/i;
const SLUG_NOISE = /^(index|page|search|login|signup|tag|tags|category|categories|blog|news|about|contact|privacy|terms|test|undefined|null|new|top|best|feed|rss|sitemap)$/i;
/** URL slug → 产品名（去后缀/ID/哈希；看起来像 ID 的返回 null） */
/** slug 模式下不收的站点：详情页需 JS 渲染、slug 被截断/丢失 ID，且多为主题皮肤等非工具条目 */
export const SLUG_DENY_HOSTS = new Set(['chromewebstore.google.com', 'chrome.google.com', 'addons.mozilla.org', 'microsoftedge.microsoft.com', 'play.google.com', 'apps.apple.com']);
export function slugToName(loc: string): string | null {
  let slug = '';
  try { const parts = new URL(loc).pathname.split('/').filter(Boolean); slug = decodeURIComponent(parts[parts.length - 1] || ''); } catch { return null; }
  slug = slug.replace(/\.(html?|php|aspx?)$/i, '');
  for (let k = 0; k < 2; k++) slug = slug.replace(SLUG_SUFFIX, '');
  slug = slug.replace(/[-_][0-9a-f]{8}(?:[-_][0-9a-f]{4}){0,3}(?:[-_][0-9a-f]{4,12})?$/i, '').replace(/[-_](com|net|org|co)$/i, '').replace(/^\d{2,7}[-_]/, '').replace(/[-_]\d{4,}$/, '').replace(/[-_][0-9a-f]{8,}$/i, '').replace(/[-_]+$/, '');
  if (!slug || SLUG_NOISE.test(slug)) return null;
  if (/^[0-9a-f]{10,}$/i.test(slug) || /^\d+$/.test(slug) || /^[A-Za-z0-9]{16,}$/.test(slug) && /\d/.test(slug) && !/[-_]/.test(slug)) return null;
  const words = slug.replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (words.length < 2 || words.length > 60) return null;
  const isAsciiLower = /^[a-z0-9 .]+$/.test(words);
  return isAsciiLower ? words.replace(/\b[a-z]/g, c => c.toUpperCase()) : words;
}

/** 去重比对键：小写 + 去非字母数字 + 去常见后缀 */
export function normKey(s: string | null | undefined): string {
  return String(s || '').toLowerCase().normalize('NFKC').replace(/\b(reviews?|alternatives?|pricing|app|ai|inc|ltd|llc)\b/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
}

export type SitemapFetch = (url: string) => Promise<{ status: number; text: string }>;
export type SitemapDiscovery = { roots: string[]; files: number; urls: number; seg: string | null; product: { loc: string; lastmod: string | null }[]; blocked: string | null; truncated: boolean };

const PRODUCT_FILE = /(tools?|products?|startups?|apps?|listings?|software|launch(es)?|projects?|companies|items|servers?|mcp|p)[-_]?\d*\.xml/i;
const SKIP_FILE = /(compare|alternative|categor|tag|vs|blog|post|news|article|author|page-sitemap|image|video)/i;
const PRODUCT_SEG = /^(products?|tools?|startups?|launch(es)?|apps?|software|listing|listings|item|items|projects?|project|p|ai|ai-tools|tool|s|companies|company|sites?|websites?|showcase|directory|server|servers|mcp|plugins?|extensions?|startup|launch|detail|ext)$/i;

/**
 * 发现站点 sitemap 中的产品详情 URL（robots → index → urlset，深度优先产品型文件）
 * 返回规范化去重后的产品 URL。被 CF/挑战拦截时 blocked 有值（调用方改走 CC/Wayback）。
 */
export async function discoverSitemapProducts(fetchText: SitemapFetch, siteUrl: string, opts: { maxFiles?: number; maxUrls?: number; seg?: string | null; depth?: number } = {}): Promise<SitemapDiscovery> {
  const origin = new URL(siteUrl).origin; const host = new URL(siteUrl).host.replace(/^www\./, '');
  const maxFiles = opts.maxFiles ?? 80; const maxUrls = opts.maxUrls ?? 400_000;
  const roots = new Set<string>(); let blocked: string | null = null;
  try { const r = await fetchText(origin + '/robots.txt'); if (r.status < 400 && !isChallengeHtml(r.text, r.status)) for (const m of r.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)) roots.add(m[1].trim()); else if (isChallengeHtml(r.text, r.status)) blocked = 'robots-challenge'; } catch { /* */ }
  if (!roots.size) { roots.add(origin + '/sitemap.xml'); roots.add(origin + '/sitemap_index.xml'); }
  const queue = [...roots]; const seenFiles = new Set<string>(); const all: { loc: string; lastmod: string | null }[] = []; let files = 0; let truncated = false; let anyOk = false;
  while (queue.length && files < maxFiles && all.length < maxUrls) {
    // 产品型 sitemap 文件优先
    queue.sort((a, b) => (+PRODUCT_FILE.test(b) - +PRODUCT_FILE.test(a)) || (+SKIP_FILE.test(a) - +SKIP_FILE.test(b)));
    const u = queue.shift()!; if (seenFiles.has(u)) continue; seenFiles.add(u);
    if (SKIP_FILE.test(u.replace(origin, '')) && !PRODUCT_FILE.test(u)) continue;
    files++;
    let r: { status: number; text: string };
    try { r = await fetchText(u); } catch { continue; }
    if (isChallengeHtml(r.text, r.status)) { blocked = blocked || `sitemap-challenge HTTP ${r.status}`; continue; }
    if (r.status >= 400 || !/<urlset|<sitemapindex/i.test(r.text.slice(0, 4000))) continue;
    anyOk = true; const p = parseSitemap(r.text);
    for (const s of p.sitemaps) if (!seenFiles.has(s)) queue.push(s);
    for (const x of p.urls) { if (all.length >= maxUrls) { truncated = true; break; } all.push(x); }
  }
  if (queue.length) truncated = true;
  if (anyOk) blocked = null;
  // 选产品段：规范化后去重数量最多的产品型路径段（避免 /tools/ 这类子页段误选）
  const segUrls = new Map<string, Set<string>>();
  for (const x of all) { try { const uu = new URL(x.loc); if (!uu.host.replace(/^www\./, '').endsWith(host)) continue; const parts = uu.pathname.split('/').filter(Boolean); for (const [i, p] of parts.slice(0, 2).entries()) if (PRODUCT_SEG.test(p) && parts.length > i + 1) { const k = p.toLowerCase(); const c = canonicalProductUrl(x.loc, p, opts.depth ?? 1); if (!c) continue; let set = segUrls.get(k); if (!set) segUrls.set(k, set = new Set()); set.add(c.toLowerCase()); } } catch { /* */ } }
  const seg = opts.seg !== undefined && opts.seg !== null ? opts.seg : ([...segUrls.entries()].map(([k, v]) => [k, v.size] as const).filter(([, c]) => c >= 5).sort((a, b) => b[1] - a[1])[0]?.[0] || null);
  const product: { loc: string; lastmod: string | null }[] = []; const seen = new Set<string>();
  if (seg) for (const x of all) { const c = canonicalProductUrl(x.loc, seg, opts.depth ?? 1); if (!c || seen.has(c.toLowerCase())) continue; seen.add(c.toLowerCase()); product.push({ loc: c, lastmod: x.lastmod }); }
  product.sort((a, b) => (b.lastmod || '').localeCompare(a.lastmod || ''));
  return { roots: [...roots], files, urls: all.length, seg, product, blocked, truncated };
}

/** GitHub 搜索窗口：把 [from,to] 日期区间二分到每段 total<=1000 */
export function splitWindow(from: string, to: string): [string, string][] {
  const a = Date.parse(from + 'T00:00:00Z'), b = Date.parse(to + 'T00:00:00Z'); if (b <= a) return [[from, to]];
  const mid = new Date(a + Math.floor((b - a) / 86400000 / 2) * 86400000).toISOString().slice(0, 10);
  const next = new Date(Date.parse(mid + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  return [[from, mid], [next, to]];
}
export function monthWindows(fromYear: number, toDate: string): [string, string][] {
  const out: [string, string][] = []; const end = toDate;
  for (let y = fromYear; ; y++) for (let m = 1; m <= 12; m++) {
    const s = `${y}-${String(m).padStart(2, '0')}-01`; if (s > end) return out;
    const e = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); out.push([s, e > end ? end : e]);
  }
}

/** Show HN 低分阈值下的产品名清洗：去掉明显的非产品帖 */
export function isShowHnNonProduct(title: string): boolean {
  return /^show hn:?\s*(my|i |i'm|we |a |an |the )?(blog|essay|post|article|thoughts|resume|cv|portfolio|talk|slides|book|newsletter|podcast)\b/i.test(title || '');
}

/** 退避：429/503/504 指数退避，带上限 */
export function retryDelay(attempt: number, base = 4000, cap = 120_000) { return Math.min(cap, base * 2 ** attempt) + Math.floor(Math.random() * 500); }
