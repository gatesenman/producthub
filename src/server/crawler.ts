import { parse, HTMLElement } from 'node-html-parser';
import { XMLParser } from 'fast-xml-parser';
import type { DB } from './db';
import { now } from './db';
import { hostOf, safeJson, stripHtml, isSharedHost } from './util';
import { chat, aiEnabled } from './ai';
import { cacheImage } from './images';
import { request } from './net';

export interface FieldRule { selector?: string; attr?: string; regex?: string }
export interface CrawlRule {
  mode: 'auto' | 'rss' | 'html' | 'jsonld' | 'json';
  listUrl?: string; itemSelector?: string; jsonPath?: string;
  fields?: { name?: FieldRule; url?: FieldRule; description?: FieldRule; image?: FieldRule; votes?: FieldRule; date?: FieldRule; tagline?: FieldRule };
  followDetail?: boolean; maxItems?: number; note?: string; headers?: Record<string, string>;
  /** v1.9.1：站内详情页也作为产品网址保留（如 GitHub 仓库、Product Hunt 产品页） */ keepDetailAsUrl?: boolean; noFeeds?: boolean; requireExternalUrl?: boolean;
}
export interface CrawlItem { extLink?: string | null; detailName?: string | null; name: string; url?: string | null; detailUrl?: string | null; tagline?: string | null; description?: string | null; image?: string | null; votes?: number | null; date?: string | null }

export type Fetcher = (url: string, o?: { headers?: Record<string, string> }) => Promise<{ status: number; text: string; contentType: string; finalUrl: string }>;
/** v1.9.1：走统一网络层（代理 / 超时 / 重试退避 / 限速）；HTTP ≥400 时抛出带分类的 CrawlError */
export const defaultFetcher: Fetcher = async (url, o) => { const r = await request(url, { headers: o?.headers }); return { status: r.status, text: r.text, contentType: r.contentType, finalUrl: r.finalUrl }; };
const abs = (u: string | undefined | null, base: string) => { if (!u) return null; try { return new URL(u.trim(), base).toString(); } catch { return null; } };
const clean = (s: any) => { const t = stripHtml(String(s ?? '')); return t || null; };
const num = (s: any) => { const m = String(s ?? '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([kK])?/); return m ? Math.round(parseFloat(m[1]) * (m[2] ? 1000 : 1)) : null; };

// ---------- RSS / Atom ----------
export function parseFeed(xml: string, base: string): CrawlItem[] {
  const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text' });
  const j = p.parse(xml); const items: any[] = [].concat(j?.rss?.channel?.item || j?.feed?.entry || j?.['rdf:RDF']?.item || []);
  const txt = (v: any) => typeof v === 'object' && v ? (v['#text'] ?? '') : v;
  return items.map(it => {
    const link = typeof it.link === 'string' ? it.link : Array.isArray(it.link) ? (it.link.find((l: any) => !l['@rel'] || l['@rel'] === 'alternate')?.['@href']) : it.link?.['@href'];
    const descHtml = String(txt(it['content:encoded']) || txt(it.description) || txt(it.summary) || txt(it.content) || '');
    const img = it.enclosure?.['@url'] || it['media:thumbnail']?.['@url'] || it['media:content']?.['@url'] || (descHtml.match(/<img[^>]+src=["']([^"']+)/i)?.[1]);
    const title = clean(txt(it.title)) || '';
    const desc = clean(descHtml);
    const [nm, tagline] = splitTitle(title);
    const extLink = [...descHtml.matchAll(/href=["']([^"']+)["']/gi)].map(m => abs(m[1].replace(/&amp;/g, '&'), base)).find(u => u && !/(reddit\.com|redd\.it|imgur\.com|redditmedia|redditstatic|ycombinator\.com)/.test(hostOf(u) || '')) || null;
    return { extLink, name: nm, tagline: tagline || (desc ? desc.slice(0, 140) : null), description: desc, detailUrl: abs(link, base), url: null, image: abs(img, base), date: normDate(it.pubDate || it.published || it.updated || it['dc:date']) } as CrawlItem;
  }).filter(i => i.name);
}
function splitTitle(t: string): [string, string | null] {
  const m = t.match(/^(.{2,60}?)\s+[-–—:|]\s+(.{4,})$/); return m ? [m[1].trim(), m[2].trim()] : [t.trim(), null];
}
function normDate(d: any): string | null { if (!d) return null; const x = new Date(String(d)); return isNaN(+x) ? null : x.toISOString().slice(0, 10); }

// ---------- JSON-LD ----------
export function parseJsonLd(html: string, base: string): CrawlItem[] {
  const out: CrawlItem[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const j = safeJson<any>(m[1].trim(), null); if (!j) continue;
    const visit = (o: any) => {
      if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(visit);
      if (o['@graph']) visit(o['@graph']);
      if (o['@type'] === 'ItemList' && o.itemListElement) for (const el of [].concat(o.itemListElement)) { const it: any = (el as any).item || el; if (it?.name) out.push({ name: clean(it.name)!, detailUrl: abs(it.url || (el as any).url, base), url: null, description: clean(it.description), image: abs(typeof it.image === 'string' ? it.image : it.image?.url, base) }); }
      if (['SoftwareApplication', 'WebApplication', 'Product', 'MobileApplication'].includes(o['@type']) && o.name && out.length < 1000) out.push({ name: clean(o.name)!, detailUrl: abs(o.url, base), url: null, description: clean(o.description), image: abs(typeof o.image === 'string' ? o.image : o.image?.url, base) });
    };
    visit(j);
  }
  return out;
}

// ---------- HTML 规则 ----------
function pick(el: HTMLElement, f: FieldRule | undefined, base: string, isUrl = false): string | null {
  if (!f) return null;
  const target = f.selector ? el.querySelector(f.selector) : el; if (!target) return null;
  let v: string | undefined = f.attr ? (f.attr === 'text' ? target.text : target.getAttribute(f.attr)) : (isUrl ? target.getAttribute('href') || target.getAttribute('src') : target.text);
  if (v && f.regex) { const m = v.match(new RegExp(f.regex)); v = m ? (m[1] ?? m[0]) : undefined; }
  if (!v) return null; return isUrl ? abs(v, base) : clean(v);
}
export function extractByRule(html: string, rule: CrawlRule, base: string): CrawlItem[] {
  const root = parse(html); if (!rule.itemSelector) return [];
  const f = rule.fields || {};
  return root.querySelectorAll(rule.itemSelector).map(el => {
    const img = f.image ? (pick(el, { ...f.image, attr: f.image.attr || 'src' }, base, true) || pick(el, { ...f.image, attr: 'data-src' }, base, true)) : null;
    return { name: pick(el, f.name, base) || '', detailUrl: pick(el, f.url, base, true), url: null, tagline: pick(el, f.tagline, base), description: pick(el, f.description, base), image: img, votes: num(pick(el, f.votes, base)), date: normDate(pick(el, f.date, base)) } as CrawlItem;
  }).filter(i => i.name && i.name.length < 120);
}

/** 启发式推断列表规则：寻找含链接与标题、结构重复 ≥4 次的元素 */
export function inferHtmlRule(html: string, base: string): CrawlRule | null {
  const root = parse(html);
  const sig = (e: HTMLElement) => { const cls = (e.getAttribute('class') || '').split(/\s+/).filter(c => c && /^[a-zA-Z_][\w-]*$/.test(c) && !/active|selected|hover|first|last|odd|even/.test(c)).slice(0, 2); return e.tagName.toLowerCase() + cls.map(c => '.' + c).join(''); };
  const counts = new Map<string, { n: number; textLen: number; withLink: number; withImg: number }>();
  for (const e of root.querySelectorAll('li, article, div, section, a, tr')) {
    if (!e.getAttribute('class') && e.tagName !== 'ARTICLE' && e.tagName !== 'LI') continue;
    const s = sig(e); const c = counts.get(s) || { n: 0, textLen: 0, withLink: 0, withImg: 0 };
    const t = e.text.trim().length; if (t < 8 || t > 1500) continue;
    c.n++; c.textLen += t; if (e.tagName === 'A' || e.querySelector('a[href]')) c.withLink++; if (e.querySelector('img')) c.withImg++; counts.set(s, c);
  }
  let best: string | null = null, bestScore = 0;
  for (const [s, c] of counts) {
    if (c.n < 4 || c.n > 300 || c.withLink / c.n < 0.8) continue;
    if (/^(nav|header|footer|menu|ul)\b/.test(s) || /nav|menu|footer|header|breadcrumb|pagination|social|tag|btn|button|icon/i.test(s)) continue;
    const avg = c.textLen / c.n; const score = Math.min(c.n, 60) * Math.min(avg, 250) * (1 + c.withImg / c.n) * (s.includes('.') ? 1.3 : 1);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  if (!best) return null;
  const sample = root.querySelector(best)!; const isA = sample.tagName === 'A';
  const nameSel = ['h1', 'h2', 'h3', 'h4', 'strong', '[class*=title]', '[class*=name]', 'a'].find(q => { const x = sample.querySelector(q); return x && x.text.trim().length > 1 && x.text.trim().length < 80; });
  const descSel = ['p', '[class*=desc]', '[class*=tagline]', '[class*=excerpt]', '[class*=summary]'].find(q => { const x = sample.querySelector(q); return x && x.text.trim().length > 10; });
  const rule: CrawlRule = { mode: 'html', listUrl: base, itemSelector: best, fields: { name: { selector: nameSel || undefined }, url: isA ? { attr: 'href' } : { selector: 'a[href]', attr: 'href' }, description: descSel ? { selector: descSel } : undefined, image: sample.querySelector('img') ? { selector: 'img', attr: 'src' } : undefined }, followDetail: true, maxItems: 500, note: '本地启发式推断' };
  const items = extractByRule(html, rule, base); if (items.length < 3) return null;
  return rule;
}

export function discoverFeeds(html: string, base: string): string[] {
  const root = parse(html); const out = root.querySelectorAll('link[rel=alternate]').filter(l => /rss|atom|xml/i.test(l.getAttribute('type') || '')).map(l => abs(l.getAttribute('href'), base)).filter(Boolean) as string[];
  return [...new Set(out)];
}

/** 从详情页提取外部官网链接 + og 信息 */
export function parseDetail(html: string, pageUrl: string): Partial<CrawlItem> & { name?: string } {
  const root = parse(html); const meta = (p: string) => root.querySelector(`meta[property="${p}"]`)?.getAttribute('content') || root.querySelector(`meta[name="${p}"]`)?.getAttribute('content') || null;
  const pageHost = hostOf(pageUrl);
  const BAD = /twitter\.com|x\.com|facebook|linkedin|instagram|youtube|discord|t\.me|reddit|google\.|apple\.com\/app|tiktok|github\.com\/sponsors|mailto:|javascript:|stripe\.com|cloudflare|gravatar|wp\.com|gstatic|googleapis|crisp\.chat|intercom/i;
  const links = root.querySelectorAll('a[href]').map(a => ({ href: abs(a.getAttribute('href'), pageUrl), text: a.text.trim().toLowerCase(), rel: (a.getAttribute('rel') || '').toLowerCase() })).filter(l => l.href && /^https?:/.test(l.href) && hostOf(l.href) !== pageHost && !BAD.test(l.href!));
  const pref = links.find(l => /visit|website|官网|访问|try it|get started|launch|open|go to/.test(l.text)) || links.find(l => /ref=|utm_source/.test(l.href!)) || links.find(l => l.rel.includes('nofollow') || l.rel.includes('noopener'));
  const ogTitle = clean(meta('og:title') || root.querySelector('title')?.text);
  return { url: pref?.href || null, name: ogTitle ? splitTitle(ogTitle.replace(/\s*[|–—-]\s*[^|–—-]*$/, m => m.length < 40 ? '' : m))[0] : undefined, description: clean(meta('og:description') || meta('description')), image: abs(meta('og:image'), pageUrl) };
}

export async function runRule(rule: CrawlRule, sourceUrl: string, fetcher: Fetcher = defaultFetcher, log: (s: string) => void = () => {}): Promise<{ items: CrawlItem[]; rule: CrawlRule }> {
  const listUrl = rule.listUrl || sourceUrl; let items: CrawlItem[] = []; let used = rule;
  const r = await fetcher(listUrl, rule.headers ? { headers: rule.headers } : undefined); if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  const base = r.finalUrl; const isXml = /xml|rss|atom/.test(r.contentType) || /^\s*<\?xml|<rss|<feed/.test(r.text.slice(0, 500));
  if (rule.mode === 'rss' || (rule.mode === 'auto' && isXml)) items = parseFeed(r.text, base);
  else if (rule.mode === 'json') { const j = safeJson<any>(r.text, null); let arr = j; for (const k of (rule.jsonPath || '').split('.').filter(Boolean)) arr = arr?.[k]; items = (Array.isArray(arr) ? arr : []).map((x: any) => { const t = String(x.name || x.title || x.full_name || '').replace(/^(Show|Launch) HN:\s*/i, ''); const [nm, tg] = x.name ? [t, null] : splitTitle(t); return { name: nm, detailUrl: abs(x.homepage || x.url || x.link || x.html_url || x.website, base), url: null, tagline: x.tagline || tg || null, description: x.description || x.story_text || null, image: x.image || x.logo || x.thumbnail || x.owner?.avatar_url || null, votes: num(x.votes ?? x.upvotes ?? x.points ?? x.stargazers_count) } as CrawlItem; }).filter((i: CrawlItem) => i.name); }
  else if (rule.mode === 'html') items = extractByRule(r.text, rule, base);
  else if (rule.mode === 'jsonld') items = parseJsonLd(r.text, base);
  else {
    // auto: feed 发现 → JSON-LD → 启发式 HTML
    if (!rule.noFeeds) for (const feed of [...discoverFeeds(r.text, base), ...['/feed', '/rss', '/feed.xml', '/rss.xml'].map(p => new URL(p, base).toString())].slice(0, 5)) {
      try { const fr = await fetcher(feed); if (fr.status < 400 && /<rss|<feed|<rdf/i.test(fr.text.slice(0, 2000))) { const its = parseFeed(fr.text, fr.finalUrl); if (its.length >= 3) { items = its; used = { mode: 'rss', listUrl: feed, followDetail: true, maxItems: 500, note: '自动发现 RSS' }; log('发现 RSS: ' + feed); break; } } } catch { /* next */ }
    }
    if (!items.length) { const ld = parseJsonLd(r.text, base); if (ld.length >= 3) { items = ld; used = { mode: 'jsonld', listUrl, followDetail: true, maxItems: 500, note: '自动发现 JSON-LD' }; } }
    if (!items.length) { const inf = inferHtmlRule(r.text, base); if (inf) { used = { ...inf, listUrl }; items = extractByRule(r.text, inf, base); log('启发式推断规则: ' + inf.itemSelector); } }
  }
  // 去重 & 截断
  const seen = new Set<string>(); items = items.filter(i => { const k = (i.name + '|' + (i.detailUrl || '')).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, rule.maxItems || used.maxItems || 500);
  // 区分外链（产品官网）与站内详情页
  const srcHost = hostOf(base);
  for (const it of items) if (it.detailUrl && hostOf(it.detailUrl) !== srcHost && !/producthunt|betalist/.test(hostOf(it.detailUrl) || '')) { it.url = it.detailUrl; }
  for (const it of items) if (!it.url && it.extLink && regDomain(hostOf(it.extLink)) !== regDomain(srcHost)) it.url = it.extLink;
  const keepDetail = !!(rule.keepDetailAsUrl || used.keepDetailAsUrl);
  if (used.followDetail !== false && (rule.followDetail ?? used.followDetail) && !keepDetail) {
    const need = items.filter(i => !i.url && i.detailUrl);
    await pool(need, 4, async it => { try { const d = await fetcher(it.detailUrl!); if (d.status < 400) { const x = parseDetail(d.text, d.finalUrl); it.url = x.url || null; it.description = it.description && it.description.length > (x.description?.length || 0) ? it.description : x.description || it.description; it.image = it.image || x.image || null; it.detailName = x.name || null; } } catch { /* ignore */ } });
  }
  // 站点级通用外链（赞助/页脚）出现多次 → 视为无效官网
  const freq = new Map<string, number>(); for (const it of items) if (it.url) { const h = regDomain(hostOf(it.url)); freq.set(h, (freq.get(h) || 0) + 1); }
  const srcReg = regDomain(srcHost);
  for (const it of items) {
    if (it.url && (regDomain(hostOf(it.url)) === srcReg || ((freq.get(regDomain(hostOf(it.url))) || 0) >= 3 && !isSharedHost(hostOf(it.url))))) it.url = null;
    if (!it.url && keepDetail && it.detailUrl) it.url = it.detailUrl;
    it.name = cleanName(it.name, it.detailName);
    if (!it.tagline && it.description) it.tagline = it.description.split(/(?<=[.!?。！？])\s/)[0].slice(0, 160);
  }
  items = items.filter(i => i.name && i.name.length >= 2 && !/^[\d\s%.,+#×x-]+$/i.test(i.name) && !NOISE.test(i.name));
  if (rule.requireExternalUrl) items = items.filter(i => i.url && regDomain(hostOf(i.url)) !== srcReg);
  return { items, rule: used };
}
const NOISE = /^(top pages|home|about|blog|pricing|login|sign ?up|submit|categories|newsletter|advertise|contact|faq)$|this week in|weekly (recap|roundup)|^how to |^top \d+|^best \d+|^\d+ best|review:|just bought|^(marketing|design|development|productivity) & /i;
/** v1.9.1 只收产品 / 软件 / 工具：去掉导航词、文章标题式条目、纯数字 */
const NAV = /^(subscribe|about( us)?|contact( us)?|read more|learn more|see more|view all|show more|categories|category|tags?|stack|projects|articles|apps|games|news|blog|home|login|sign ?(in|up)|pricing|investors|find (startups|investors)|startups|companies|jobs|events|office hours|expert sessions|main categories|selected subcategories|featured .* programs|discover the best .*|open options.*|type|more|next|previous|privacy|terms|faq|help|support|newsletter|advertise|submit( (a )?(tool|product|startup))?)$/i;
export function isLikelyProduct(it: { name?: string | null }): boolean {
  const n = String(it.name || '').trim(); if (n.length < 2 || n.length > 80) return false;
  if (/^[\d\s%.,+#×x$¥€-]+$/i.test(n) || NAV.test(n) || NOISE.test(n)) return false;
  const cjk = (n.match(/[\u3400-\u9fff]/g) || []).length;
  if (cjk >= 4 && n.length > 26) return false; // 中文长句 ≈ 文章标题
  if (!cjk && n.split(/\s+/).length > 8) return false; // 英文长句 ≈ 文章标题
  if (/[？?！!]$|^(how|why|what|when|is|are|can|should|i|we|my|our)\b.{25,}/i.test(n) && n.split(/\s+/).length > 4) return false;
  if (/(融资|发布会|报道|财报|开卖|曝光|评测：|周刊|第\s*\d+\s*期)/.test(n)) return false;
  return true;
}
export function regDomain(h: string | null): string { if (!h) return ''; const p = h.split('.'); const two = p.slice(-2).join('.'); return /^(co|com|org|net|ac|gov)\.[a-z]{2}$/.test(two) ? p.slice(-3).join('.') : two; }
export function cleanName(name: string, detailName?: string | null): string {
  if (detailName) detailName = detailName.replace(/^(discover|check out|meet)\s+/i, '').replace(/\s+(on|at|via)\s+[A-Z][\w.]+$/, '').trim();
  let n = String(name || '').split(/\s·\s/)[0].replace(/(?<=[a-z0-9])by [A-Z][\w ]*$/, '').replace(/^\s*#?\d+[.)、]\s*/, '').replace(/\s+/g, ' ').trim();
  if (n.length > 50 && detailName && detailName.length <= 50) n = detailName;
  if (n.length > 50) { const m = n.match(/^(.{2,50}?)(?:\s[-–—|:]\s|\s\d+\s*(?:reviews?|votes?|upvotes?)|(?<=[a-z])(?=[A-Z][a-z]{3,}\s))/); if (m) n = m[1]; }
  return n.slice(0, 80).trim();
}
export async function pool<T>(arr: T[], n: number, fn: (x: T) => Promise<void>) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, arr.length) }, async () => { while (i < arr.length) await fn(arr[i++]); })); }

export { crawlSource } from './crawl-pipeline';

/** AI 辅助生成抓取规则（无 Key 时回退启发式） */
export async function generateRule(db: DB, url: string, hint: string, fetcher: Fetcher = defaultFetcher): Promise<{ rule: CrawlRule; preview: CrawlItem[]; mode: 'ai' | 'local'; message: string }> {
  const r = await fetcher(url); const base = r.finalUrl;
  if (/<rss|<feed/i.test(r.text.slice(0, 2000))) { const rule: CrawlRule = { mode: 'rss', listUrl: url, followDetail: true, maxItems: 30 }; return { rule, preview: parseFeed(r.text, base).slice(0, 10), mode: 'local', message: '检测到 RSS/Atom 源' }; }
  if (aiEnabled(db)) {
    try {
      const html = r.text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/gi, '').replace(/\s+/g, ' ').slice(0, 24000);
      const out = await chat(db, '你是网页抓取专家。根据 HTML 输出一个 JSON 抓取规则，CSS 选择器需兼容 node-html-parser（仅支持标签/类/ID/属性/后代选择器）。只输出 JSON。',
        `目标：抓取该页面中的产品列表。${hint ? '用户提示：' + hint : ''}\n输出格式：{"mode":"html","itemSelector":"...","fields":{"name":{"selector":"..."},"url":{"selector":"a","attr":"href"},"tagline":{"selector":"..."},"description":{"selector":"..."},"image":{"selector":"img","attr":"src"},"votes":{"selector":"..."}},"followDetail":true,"maxItems":30}\nURL: ${url}\nHTML:\n${html}`, true);
      const rule: CrawlRule = { ...JSON.parse(out), listUrl: url, note: 'AI 生成' }; const preview = extractByRule(r.text, rule, base);
      if (preview.length) return { rule, preview: preview.slice(0, 10), mode: 'ai', message: `AI 生成规则，预览命中 ${preview.length} 条` };
    } catch (e) { /* fall back */ }
  }
  const ld = parseJsonLd(r.text, base); if (ld.length >= 3) return { rule: { mode: 'jsonld', listUrl: url, followDetail: true, maxItems: 30 }, preview: ld.slice(0, 10), mode: 'local', message: '检测到 JSON-LD 结构化数据' };
  const feeds = discoverFeeds(r.text, base); if (feeds.length) return { rule: { mode: 'rss', listUrl: feeds[0], followDetail: true, maxItems: 30 }, preview: [], mode: 'local', message: '发现 RSS 订阅：' + feeds[0] };
  const inf = inferHtmlRule(r.text, base);
  if (inf) return { rule: inf, preview: extractByRule(r.text, inf, base).slice(0, 10), mode: 'local', message: '本地启发式推断（配置 AI Key 可获得更准确的规则）' };
  return { rule: { mode: 'auto', listUrl: url }, preview: [], mode: 'local', message: '未能自动识别列表结构（可能为 JS 渲染页面），请手动填写选择器' };
}
