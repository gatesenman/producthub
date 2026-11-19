/** v1.5 全量历史抓取的纯函数与礼貌抓取器（可单测） */
import { parse } from 'node-html-parser';

export const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
export interface FetchResult { status: number; text: string; contentType: string; finalUrl: string; retryAfter?: number | null }

/** 每主机最小间隔 + 429/503 退避的礼貌抓取器 */
export class PoliteFetcher {
  private last = new Map<string, number>(); private chain = new Map<string, Promise<void>>();
  public stats = { requests: 0, r429: 0, errors: 0, backoffMs: 0 };
  constructor(public minIntervalMs = 1200, public perHost: Record<string, number> = {}, private log: (s: string) => void = () => {}, private sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))) {}
  intervalFor(host: string) { for (const [k, v] of Object.entries(this.perHost)) if (host.endsWith(k)) return v; return this.minIntervalMs; }
  /** 串行化同一主机的请求，保证间隔 */
  private async slot(host: string) {
    const prev = this.chain.get(host) || Promise.resolve(); let release!: () => void;
    const mine = new Promise<void>(r => (release = r)); this.chain.set(host, prev.then(() => mine));
    await prev; const wait = (this.last.get(host) || 0) + this.intervalFor(host) - Date.now(); if (wait > 0) await this.sleep(wait);
    return () => { this.last.set(host, Date.now()); release(); };
  }
  async fetch(url: string, init: { headers?: Record<string, string>; maxRetries?: number; raw?: (u: string, h: Record<string, string>) => Promise<FetchResult> } = {}): Promise<FetchResult> {
    const host = new URL(url).host; const maxRetries = init.maxRetries ?? 4;
    const headers = { 'user-agent': CHROME_UA, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9,zh-CN;q=0.8', ...(init.headers || {}) };
    for (let attempt = 0; ; attempt++) {
      const done = await this.slot(host); let res: FetchResult;
      try { this.stats.requests++; res = await (init.raw || rawFetch)(url, headers); }
      catch (e) { this.stats.errors++; done(); if (attempt >= 1) throw e; await this.sleep(3000); continue; }
      done();
      if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
        this.stats.r429++; const wait = backoffMs(attempt, res.retryAfter); this.stats.backoffMs += wait;
        this.log(`  ⏳ ${res.status} ${host} 退避 ${Math.round(wait / 1000)}s (第${attempt + 1}次)`);
        this.last.set(host, Date.now() + wait); await this.sleep(wait); continue;
      }
      return res;
    }
  }
}
export function backoffMs(attempt: number, retryAfter?: number | null) { if (retryAfter && retryAfter > 0) return Math.min(retryAfter * 1000, 600_000); return Math.min(15_000 * 2 ** attempt, 600_000); }
export async function rawFetch(url: string, headers: Record<string, string>): Promise<FetchResult> {
  const r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  const text = Buffer.from(await r.arrayBuffer()).subarray(0, 8_000_000).toString('utf8');
  const ra = r.headers.get('retry-after'); return { status: r.status, text, contentType: r.headers.get('content-type') || '', finalUrl: r.url || url, retryAfter: ra && /^\d+$/.test(ra) ? +ra : null };
}

/** 从 HTML 中找下一页链接 */
export function findNextPage(html: string, base: string): string | null {
  const root = parse(html);
  const rel = root.querySelector('link[rel="next"]')?.getAttribute('href') || root.querySelector('a[rel~="next"]')?.getAttribute('href');
  const cand = rel || root.querySelectorAll('a[href]').find(a => /^(next|next page|older|older posts|more|下一页|下页|›|»|→|next ›|next »|load more)$/i.test(a.text.trim()) || /pagination[-_ ]?next|next[-_]?page/i.test(a.getAttribute('class') || ''))?.getAttribute('href');
  if (!cand) return null; try { const u = new URL(cand, base); return u.toString() === base ? null : u.toString(); } catch { return null; }
}
/** 猜测分页 URL 模式 */
export function pageUrlCandidates(base: string, n: number): string[] {
  const u = new URL(base); const out: string[] = [];
  for (const k of ['page', 'p', 'paged']) { const x = new URL(u); x.searchParams.set(k, String(n)); out.push(x.toString()); }
  const path = u.pathname.replace(/\/$/, ''); out.push(`${u.origin}${path}/page/${n}${u.search}`); out.push(`${u.origin}${path}/page/${n}/${u.search}`);
  return [...new Set(out)];
}
export function setPage(template: string, n: number) { return template.replace('{n}', String(n)); }
export function templateFrom(base: string, cand: string): string | null {
  for (const n of [2]) { const i = cand.lastIndexOf(String(n)); if (i < 0) return null; return cand.slice(0, i) + '{n}' + cand.slice(i + 1); } return null;
}

/** 解析 sitemap（index 或 urlset） */
export function parseSitemap(xml: string): { sitemaps: string[]; urls: { loc: string; lastmod: string | null }[] } {
  const sitemaps: string[] = []; const urls: { loc: string; lastmod: string | null }[] = [];
  for (const m of xml.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/g)) { const l = m[1].match(/<loc>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*<\/loc>/); if (l) sitemaps.push(l[1].trim().replace(/&amp;/g, '&')); }
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) { const l = m[1].match(/<loc>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*<\/loc>/); const d = m[1].match(/<lastmod>\s*(.*?)\s*<\/lastmod>/); if (l) urls.push({ loc: l[1].trim().replace(/&amp;/g, '&'), lastmod: d ? d[1].slice(0, 10) : null }); }
  return { sitemaps, urls };
}
const PRODUCT_SEG = /^(products?|tools?|startups?|launch(es)?|apps?|software|listing|listings|item|items|projects?|p|ai|ai-tools|tool|s|posts|companies|company|sites?|websites?|showcase|launches|directory)$/i;
const NON_PRODUCT = /^(blog|news|article|articles|tag|tags|category|categories|topics?|collections?|compare|vs|alternatives?|pricing|about|privacy|terms|legal|login|signup|auth|users?|u|makers?|author|authors|profile|search|help|docs|faq|contact|jobs|careers|newsletter|best|lists?|deals?|stories)$/i;
/** 从 sitemap URL 中挑出产品详情页（按最多的产品型一级路径），新的在前 */
export function pickProductUrls(urls: { loc: string; lastmod: string | null }[], host: string): { seg: string | null; urls: { loc: string; lastmod: string | null }[] } {
  const cnt = new Map<string, number>();
  const segOf = (loc: string) => { try { const u = new URL(loc); if (!u.host.endsWith(host.replace(/^www\./, ''))) return null; const parts = u.pathname.split('/').filter(Boolean); if (parts.length !== 2) return null; return parts[0]; } catch { return null; } };
  for (const x of urls) { const s = segOf(x.loc); if (s && !NON_PRODUCT.test(s)) cnt.set(s, (cnt.get(s) || 0) + 1); }
  const ranked = [...cnt.entries()].filter(([s, c]) => PRODUCT_SEG.test(s) && c >= 5).sort((a, b) => b[1] - a[1]);
  const seg = ranked[0]?.[0] || null; if (!seg) return { seg: null, urls: [] };
  const picked = urls.filter(x => segOf(x.loc) === seg && !/\/(reviews?|alternatives?)$/.test(x.loc));
  picked.sort((a, b) => (b.lastmod || '').localeCompare(a.lastmod || ''));
  return { seg, urls: picked };
}

/** 新闻/文章噪音判定 */
const NOISE_TITLE = /(raises|raised|funding|series [a-e]\b|acquires|acquired|announces|announced|launches new|layoffs?|lawsuit|ipo\b|earnings|interview|podcast|weekly|newsletter|roundup|this week|recap|how to|why |what is|tips|guide to|top \d+|best \d+|\d+ best|vs\.?\s|融资|获投|收购|宣布|发布会|周刊|早报|日报|晚报|周报|访谈|专访|观点|盘点|一文|如何|为什么|财报|裁员)/i;
export function isArticleNoise(name: string, url?: string | null): boolean {
  const n = (name || '').trim(); if (!n) return true;
  if (NOISE_TITLE.test(n)) return true;
  if (n.length > 80) return true; if (/[?？]$/.test(n)) return true;
  if (url && /\/(20\d\d)\/(\d\d)\/|\/news\/|\/article[s]?\/|\/blog\/|\/p\/\d{5,}/.test(url)) return true;
  return false;
}
/** HN “Show HN: X – tagline” 标题拆分 */
export function parseShowHn(title: string): { name: string; tagline: string | null } {
  const t = title.replace(/^show hn\s*[:：-]\s*/i, '').trim(); const m = t.match(/^(.{1,60}?)\s+[–—-]{1,2}\s+(.+)$/) || t.match(/^(.{1,60}?)[:：]\s+(.+)$/) || t.match(/^(.{1,60}?),\s+(an?|the)\s+(.+)$/i);
  if (m) return { name: m[1].trim(), tagline: (m[3] ? `${m[2]} ${m[3]}` : m[2]).trim() };
  return { name: t.split(/\s+/).slice(0, 6).join(' '), tagline: t };
}

/** BetaList 首页分页（?page=N）解析：按日期分组的 startup-row */
export function parseBetaListPage(html: string): { name: string; tagline: string | null; slug: string; image: string | null; date: string | null }[] {
  const out: { name: string; tagline: string | null; slug: string; image: string | null; date: string | null }[] = [];
  const re = /data-duplicate-id="day_(\d+)"|startup-row">\s*<a[^>]*href="\/startups\/([^"]+)"([\s\S]*?)(?=startup-row">|data-duplicate-id="day_|$)/g;
  let day: string | null = null;
  for (const m of html.matchAll(re)) {
    if (m[1]) { day = new Date(+m[1] * 1000).toISOString().slice(0, 10); continue; }
    const body = m[3] || ''; const spans = [...body.matchAll(/<span[^>]*>([^<]{1,300})<\/span>/g)].map(x => x[1].trim()).filter(Boolean);
    const img = body.match(/<img[^>]*src="([^"]+)"/)?.[1] || null;
    if (spans[0]) out.push({ name: decode(spans[0]), tagline: spans[1] ? decode(spans[1]) : null, slug: m[2], image: img, date: day });
  }
  return out;
}
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
