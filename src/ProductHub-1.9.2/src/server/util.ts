import crypto from 'node:crypto';

const NS_SOURCE = '6f1c2a5e-9b1d-4c1e-8a59-2d3c1f0a7b10';
const NS_PRODUCT = 'b2d7e8f4-3a6c-4e0b-9f21-7c8d5e4a1b32';

/** RFC4122 v5 UUID (SHA-1, name-based) — stable for the same input */
export function uuidv5(name: string, ns: string): string {
  const nsBytes = Buffer.from(ns.replace(/-/g, ''), 'hex');
  const h = crypto.createHash('sha1').update(Buffer.concat([nsBytes, Buffer.from(name, 'utf8')])).digest();
  const b = h.subarray(0, 16); b[6] = (b[6] & 0x0f) | 0x50; b[8] = (b[8] & 0x3f) | 0x80;
  const x = b.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const TRACKING = /^(utm_|ref$|ref_|via$|source$|fbclid|gclid|dclid|msclkid|yclid|igshid|twclid|li_fat_id|mc_|_ga|_gl$|_hs|hsa_|mkt_tok|spm$|aff$|aff_id|affiliate|campaign$|share$|si$|trk$|from$)/i;
export function normalizeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  let s = String(u).trim(); if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    const url = new URL(s);
    url.hash = ''; url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    url.protocol = 'https:';
    [...url.searchParams.keys()].forEach(k => { if (TRACKING.test(k)) url.searchParams.delete(k); });
    url.pathname = url.pathname.replace(/\/(index|default)\.(html?|php|aspx?)$/i, '/');
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    if (url.port === '443' || url.port === '80') url.port = '';
    let out = url.toString(); if (out.endsWith('/')) out = out.slice(0, -1);
    return out;
  } catch { return null; }
}
export function hostOf(u: string | null | undefined): string | null {
  const n = normalizeUrl(u); if (!n) return null;
  try { return new URL(n).hostname; } catch { return null; }
}
export function slugName(name: string): string {
  return String(name || '').toLowerCase().normalize('NFKC').replace(/[\s\-_.·,:;!?'"()（）【】|/\\]+/g, '').trim();
}
/** Hosts that hold many different products under paths; dedup by full URL path instead of domain */
const SHARED_HOSTS = new Set(['github.com', 'apps.apple.com', 'play.google.com', 'chrome.google.com', 'chromewebstore.google.com', 'producthunt.com', 'huggingface.co', 'npmjs.com', 'gitlab.com', 'medium.com', 'notion.site', 'vercel.app', 'netlify.app', 'itch.io', 'news.ycombinator.com', 'x.com', 'twitter.com', 'startupranking.com', 'openfuture.ai', 'huntscreens.com', 'saashub.com', 'alternativeto.net', 'betalist.com', 'libhunt.com', 'g2.com', 'capterra.com', 'thereisanaiforthat.com', 'theresanaiforthat.com', 'toolify.ai', 'futurepedia.io', 'saasworthy.com', 'serchen.com', 'softwareworld.co', 'ecomm.design', 'setapp.com', 'chip.de', 'aiopenminds.com', 'oschina.net', 'webcatalog.io', 'tools-ai.online', 'e27.co', 'yourstory.com', 'sourceforge.net', 'f6s.com', 'www.f6s.com']);
/** 共享域名（一个域名下有很多不同产品）：不能按域名合并，只能按完整路径 */
export function isSharedHost(host: string | null | undefined): boolean {
  if (!host) return false; host = host.toLowerCase().replace(/^www\./, '');
  return SHARED_HOSTS.has(host) || [...SHARED_HOSTS].some(h => host!.endsWith('.' + h));
}
export function productDedupKey(p: { name: string; url?: string | null }): string {
  const n = normalizeUrl(p.url);
  if (n) {
    const u = new URL(n); const host = u.hostname;
    const shared = SHARED_HOSTS.has(host) || [...SHARED_HOSTS].some(h => host.endsWith('.' + h) && (h.includes('.app') || h.includes('.site') || h === 'itch.io'));
    if (shared) {
      if (host.endsWith('.vercel.app') || host.endsWith('.netlify.app') || host.endsWith('.notion.site') || host.endsWith('.itch.io')) return 'host:' + host;
      return 'url:' + host + u.pathname.split('/').slice(0, 3).join('/').toLowerCase();
    }
    return 'host:' + host;
  }
  return 'name:' + slugName(p.name);
}
export const sourceGuid = (url: string) => uuidv5('source:' + (hostOf(url) || url) + (new URL(normalizeUrl(url) || 'https://x').pathname.replace(/\/$/, '')), NS_SOURCE);
export const productGuid = (dedupKey: string) => uuidv5('product:' + dedupKey, NS_PRODUCT);
export const sha1 = (s: string) => crypto.createHash('sha1').update(s).digest('hex');
export function safeJson<T>(s: any, d: T): T { if (s == null || s === '') return d; try { return JSON.parse(s); } catch { return d; } }
/** 解码 HTML 实体（含数字实体 &#8216; / &#x2019;），用于入库前清洗抓取文本 */
export function decodeEntities(s: string): string { const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => e[0] === '#' ? (() => { const c = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : m; })() : named[e.toLowerCase()] ?? m); }
export function stripHtml(s: string): string { return String(s || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim(); }

/** 按 DB 写版本号缓存；可选 TTL：抓取时 rev 狂涨，靠 TTL 避免聚合被打穿 */
// 按 DB 实例隔离缓存（避免多库/测试间串数据）；rev 变化时仅当上次计算昂贵（≥150ms，大库）才在 TTL 内复用旧值
const _revCaches = new WeakMap<object, Map<string, { rev: number; t: number; cost: number; v: unknown }>>();
export function memoByRev<T>(db: { rev: number }, key: string, fn: () => T, ttlMs = 30_000): T {
  let m = _revCaches.get(db); if (!m) { m = new Map(); _revCaches.set(db, m); }
  const hit = m.get(key);
  const now = Date.now();
  if (hit && (hit.rev === db.rev || (ttlMs > 0 && hit.cost >= 150 && now - hit.t < ttlMs))) return hit.v as T;
  const v = fn();
  m.set(key, { rev: db.rev, t: now, cost: Date.now() - now, v });
  return v;
}
