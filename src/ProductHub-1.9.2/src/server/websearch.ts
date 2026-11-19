/**
 * v1.4 联网搜索：本地结果少/无时，在后台并发查询公开来源（Bing / DuckDuckGo HTML、GitHub、Hacker News Show HN）。
 * 每个来源独立超时、独立失败；结果过滤非产品站点、按域名与库内去重；可一键入库（生成与本地一致的 GUID）。
 */
import type { DB } from './db';
import { defaultFetcher, type Fetcher } from './crawler';
import { decodeEntities, stripHtml, hostOf, normalizeUrl, productDedupKey, productGuid } from './util';
import { upsertProduct } from './products';

export type WebItem = { name: string; title?: string; url: string; domain: string; snippet: string; provider: string; stars?: number | null; date?: string | null; guid: string; inLibrary: boolean; libraryGuid?: string | null };
export type ProviderStatus = { id: string; label: string; ok: boolean; count: number; ms: number; error?: string };
export type WebSearchResult = { query: string; items: WebItem[]; providers: ProviderStatus[]; tookMs: number };

/** 非产品类站点：百科、问答、新闻、视频、社交、应用商店聚合等 */
const NON_PRODUCT = /(^|\.)(wikipedia\.org|britannica\.com|wikimedia\.org|baike\.baidu\.com|zhihu\.com|quora\.com|reddit\.com|stackoverflow\.com|stackexchange\.com|youtube\.com|youtu\.be|bilibili\.com|facebook\.com|twitter\.com|x\.com|linkedin\.com|instagram\.com|tiktok\.com|medium\.com|forbes\.com|nytimes\.com|theverge\.com|techcrunch\.com|wired\.com|cnet\.com|zapier\.com|g2\.com|capterra\.com|bing\.com|microsoft\.com\/en-us\/bing|duckduckgo\.com|google\.com|baidu\.com|csdn\.net|36kr\.com|sohu\.com|163\.com|qq\.com|sina\.com\.cn|merriam-webster\.com|dictionary\.com|cambridge\.org|ibm\.com|amazon\.com|ebay\.com)$/i;
const LISTICLE = /\b(top \d+|best \d+|\d+ best|best .* (tools|apps|software) (in|for|of)|vs\.? |versus|review[s]?\b|how to|what is|guide)\b|排行|盘点|推荐\d|大全|哪个好|是什么/i;

export const isProductCandidate = (url: string, title: string) => { const h = hostOf(url); if (!h) return false; if (NON_PRODUCT.test(h)) return false; return !LISTICLE.test(title); };
const nameFromTitle = (t: string, domain: string) => {
  const parts = t.split(/\s+[|\-–—:·]\s+|\s*[|｜–—]\s*/).map(s => s.trim()).filter(Boolean);
  const base = domain.replace(/^www\./, '').split('.')[0].toLowerCase();
  const hit = parts.find(p => p.toLowerCase().replace(/[^a-z0-9]/g, '').includes(base.replace(/[^a-z0-9]/g, '')) && p.length <= 40);
  const n = hit || (parts[0] && parts[0].length <= 40 ? parts[0] : base.charAt(0).toUpperCase() + base.slice(1));
  return n.replace(/\.(ai|io|com|app|so|dev)$/i, m => m).slice(0, 60);
};
const txt = (s: string) => decodeEntities(stripHtml(s)).replace(/\s+/g, ' ').trim();

// ---------- 解析器（纯函数，可用离线样本测试） ----------
export function parseDuckDuckGo(html: string): { title: string; url: string; snippet: string }[] {
  if (/anomaly-modal|challenge-form|Unfortunately, bots use DuckDuckGo/i.test(html) && !/class="result__a"/.test(html)) throw new Error('被反爬验证拦截');
  const out: { title: string; url: string; snippet: string }[] = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>|(?=<div class="result))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let href = decodeEntities(m[1]); const ud = href.match(/[?&]uddg=([^&]+)/); if (ud) href = decodeURIComponent(ud[1]); if (href.startsWith('//')) href = 'https:' + href;
    if (/duckduckgo\.com\/y\.js|ad_provider/.test(href)) continue;
    out.push({ title: txt(m[2]), url: href, snippet: txt(m[3] || '') });
  }
  return out;
}
export function parseBing(html: string): { title: string; url: string; snippet: string }[] {
  const out: { title: string; url: string; snippet: string }[] = [];
  for (const blk of html.split('<li class="b_algo"').slice(1)) {
    const a = blk.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/); if (!a) continue;
    let href = decodeEntities(a[1]);
    const u = href.match(/[?&]u=a1([^&]+)/); if (u) { try { href = Buffer.from(u[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch { /* keep */ } }
    const p = blk.match(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/);
    out.push({ title: txt(a[2]), url: href, snippet: txt(p?.[1] || '') });
  }
  return out;
}
export function parseGitHub(json: string) {
  const j = JSON.parse(json); if (!Array.isArray(j.items)) throw new Error(j.message || 'GitHub 返回格式异常');
  return j.items.map((r: any) => ({ title: r.name, url: r.homepage && /^https?:/.test(r.homepage) ? r.homepage : r.html_url, repo: r.html_url, snippet: r.description || '', stars: r.stargazers_count ?? null, date: (r.created_at || '').slice(0, 10) || null }));
}
export function parseHN(json: string) {
  const j = JSON.parse(json);
  return (j.hits || []).filter((h: any) => h.url && /^show hn/i.test(h.title || '')).map((h: any) => {
    const t = String(h.title).replace(/^show hn:\s*/i, ''); const [name, ...rest] = t.split(/\s+[–—-]\s+|:\s+/);
    return { title: name.trim(), url: h.url, snippet: rest.join(' – ') || t, stars: h.points ?? null, date: (h.created_at || '').slice(0, 10) || null };
  });
}

type Provider = { id: string; label: string; run: (q: string, f: Fetcher) => Promise<{ title: string; url: string; snippet: string; stars?: number | null; date?: string | null; repo?: string }[]> };
const enc = encodeURIComponent;
export const PROVIDERS: Provider[] = [
  { id: 'bing', label: 'Bing', run: async (q, f) => { const r = await f(`https://www.bing.com/search?q=${enc(q)}&setlang=zh-Hans&count=20`); if (r.status >= 400) throw new Error('HTTP ' + r.status); return parseBing(r.text); } },
  { id: 'ddg', label: 'DuckDuckGo', run: async (q, f) => { const r = await f(`https://html.duckduckgo.com/html/?q=${enc(q)}`); if (r.status >= 400) throw new Error('HTTP ' + r.status); return parseDuckDuckGo(r.text); } },
  { id: 'github', label: 'GitHub', run: async (q, f) => { const r = await f(`https://api.github.com/search/repositories?q=${enc(q)}&sort=stars&per_page=10`); if (r.status === 403) throw new Error('接口限流（未登录每分钟 10 次）'); if (r.status >= 400) throw new Error('HTTP ' + r.status); return parseGitHub(r.text); } },
  { id: 'hn', label: 'Hacker News', run: async (q, f) => { const r = await f(`https://hn.algolia.com/api/v1/search?query=${enc(q)}&tags=show_hn&hitsPerPage=20`); if (r.status >= 400) throw new Error('HTTP ' + r.status); return parseHN(r.text); } },
];

const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`超时（${ms / 1000}s）`)), ms))]);
const cache = new Map<string, { at: number; r: WebSearchResult }>();

/** 联网查询：q 为原始需求；webQuery 为给搜索引擎的关键词（一般用解析后的关键词） */
export async function webSearch(db: DB, q: string, o: { webQuery?: string; enQuery?: string; terms?: string[]; fetcher?: Fetcher; providers?: string[]; timeoutMs?: number; limit?: number } = {}): Promise<WebSearchResult> {
  const t0 = Date.now(); const wq = (o.webQuery || q).trim(); const key = wq + '|' + (o.providers || []).join(',');
  const c = cache.get(key); if (c && Date.now() - c.at < 10 * 60_000 && !o.fetcher) return relink(db, c.r);
  const f = o.fetcher || defaultFetcher; const provs = PROVIDERS.filter(p => !o.providers || o.providers.includes(p.id));
  const runs = await Promise.allSettled(provs.map(async p => { const s = Date.now(); const items = await withTimeout(p.run(p.id === 'bing' ? wq + ' app' : p.id === 'github' || p.id === 'hn' ? (o.enQuery || wq) : wq, f), o.timeoutMs ?? 12000); return { p, items, ms: Date.now() - s }; }));
  const providers: ProviderStatus[] = []; const seen = new Map<string, WebItem>();
  runs.forEach((r, i) => {
    const p = provs[i];
    if (r.status === 'rejected') { providers.push({ id: p.id, label: p.label, ok: false, count: 0, ms: 0, error: String(r.reason?.message || r.reason).slice(0, 120) }); return; }
    let n = 0;
    for (const it of r.value.items) {
      const url = normalizeUrl(it.url); if (!url || !isProductCandidate(url, it.title)) continue;
      const domain = (hostOf(url) || '').replace(/^www\./, ''); const dk = p.id === 'github' && /github\.com/.test(domain) ? url : domain;
      if (seen.has(dk)) { const e = seen.get(dk)!; if (!e.provider.includes(p.label)) e.provider += ' · ' + p.label; continue; }
      const name = p.id === 'github' || p.id === 'hn' ? it.title : nameFromTitle(it.title, domain);
      seen.set(dk, { name, title: it.title, url, domain, snippet: it.snippet.slice(0, 280), provider: p.label, stars: it.stars ?? null, date: it.date ?? null, guid: productGuid(productDedupKey({ name, url })), inLibrary: false }); n++;
    }
    providers.push({ id: p.id, label: p.label, ok: true, count: n, ms: r.value.ms });
  });
  let all = [...seen.values()];
  if (o.terms?.length) {
    const ts = o.terms.map(t => t.toLowerCase()).filter(t => t.length > 1);
    const sc = (it: WebItem) => { const t = (it.name + ' ' + (it.title || '') + ' ' + it.snippet + ' ' + it.domain).toLowerCase(); return ts.filter(x => t.includes(x)).length; };
    const scored = all.map(it => ({ it, s: sc(it) })).filter(x => x.s > 0);
    all = scored.sort((a, b) => b.s - a.s || (b.it.provider.split('·').length - a.it.provider.split('·').length) || ((b.it.stars || 0) - (a.it.stars || 0))).map(x => x.it);
  }
  const res: WebSearchResult = { query: wq, items: all.slice(0, o.limit ?? 24), providers, tookMs: Date.now() - t0 };
  if (!o.fetcher) cache.set(key, { at: Date.now(), r: res });
  return relink(db, res);
}

/** 与库内比对：同 GUID 或同域名即视为已在库 */
export function relink(db: DB, r: WebSearchResult): WebSearchResult {
  return { ...r, items: r.items.map(it => {
    const byGuid = db.get<any>('SELECT guid FROM products WHERE guid=?', [it.guid]);
    const byDomain = byGuid || (it.domain && !/github\.com$/.test(it.domain) ? db.get<any>("SELECT guid FROM products WHERE url LIKE ? OR url LIKE ? LIMIT 1", [`%://${it.domain}%`, `%://www.${it.domain}%`]) : null);
    return { ...it, inLibrary: !!byDomain, libraryGuid: byDomain?.guid || null };
  }) };
}

/** 入库：origin=web，返回 GUID（重复入库不会产生新记录） */
export function ingestWebItems(db: DB, items: Pick<WebItem, 'name' | 'url' | 'snippet' | 'date' | 'provider'>[]) {
  return items.map(it => {
    const r = upsertProduct(db, { name: it.name, url: it.url, tagline: it.snippet?.slice(0, 200) || null, description: it.snippet || null, launch_date: it.date || null, tags: ['联网发现'] } as any, { origin: 'web', versionLabel: '联网搜索：' + it.provider });
    return { guid: r.guid, status: r.status, name: it.name };
  });
}
