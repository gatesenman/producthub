/**
 * v1.4 关键信息自动补齐：抓取官网（+ 自动发现的定价页），提取定价档位、核心功能、目标用户、公司/团队、社交账号、语言。
 * 有 AI Key 时用大模型从正文抽取并与启发式结果合并；否则纯启发式（meta / Open Graph / JSON-LD / 定价页规则）。
 * 后台队列（并发 3），结果写入 products.enrich_json / enriched_at / enrich_status。
 */
import type { DB } from './db';
import { now } from './db';
import { defaultFetcher, type Fetcher } from './crawler';
import { decodeEntities, stripHtml, safeJson, hostOf } from './util';
import { aiEnabled, chat } from './ai';

export type Tier = { name: string; price: string | null; period?: string | null };
export type Enrich = {
  summary: string | null; pricing: { hasFree: boolean | null; tiers: Tier[]; model: string | null; url: string | null };
  features: string[]; audience: string[]; company: { name: string | null; founded?: string | null; location?: string | null } | null;
  socials: Record<string, string>; languages: string[]; title: string | null; fetched_url: string; method: 'heuristic' | 'llm'; pages: string[];
};

const t = (s: any) => decodeEntities(stripHtml(String(s ?? ''))).replace(/\s+/g, ' ').trim();
const uniq = <T>(a: T[]) => [...new Set(a)];
const meta = (html: string, key: string) => { const re = new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]*>`, 'i'); const m = html.match(re); const c = m?.[0].match(/content=["']([^"']*)["']/i); return c ? t(c[1]) : null; };

function jsonLd(html: string): any[] {
  const out: any[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const j = safeJson<any>(m[1].trim(), null); if (!j) continue;
    const push = (x: any) => { if (Array.isArray(x)) x.forEach(push); else if (x && typeof x === 'object') { out.push(x); if (x['@graph']) push(x['@graph']); } };
    push(j);
  }
  return out;
}
const typeIs = (o: any, ...ts: string[]) => { const v = ([] as string[]).concat(o['@type'] || []); return v.some(x => ts.includes(x)); };

const SOCIAL: [string, RegExp][] = [
  ['x', /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent|share|home|search|hashtag)[A-Za-z0-9_]{2,30}\/?(?=["'\s?#])/i],
  ['linkedin', /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|in)\/[A-Za-z0-9_\-%.]+\/?/i],
  ['github', /https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)?\/?(?=["'\s?#])/i],
  ['discord', /https?:\/\/(?:www\.)?discord\.(?:gg|com\/invite)\/[A-Za-z0-9\-]+/i],
  ['youtube', /https?:\/\/(?:www\.)?youtube\.com\/(?:@|c\/|channel\/)[A-Za-z0-9_\-]+/i],
  ['weibo', /https?:\/\/(?:www\.)?weibo\.com\/[A-Za-z0-9_\-]+/i],
  ['producthunt', /https?:\/\/(?:www\.)?producthunt\.com\/products\/[a-z0-9\-]+/i],
];
const AUDIENCE: [string, RegExp][] = [
  ['开发者', /\b(developers?|engineers?|devs)\b|开发者|程序员/i], ['团队/企业', /\b(teams?|enterprises?|organi[sz]ations|companies|businesses)\b|团队|企业/i],
  ['设计师', /\bdesigners?\b|设计师/i], ['营销人员', /\bmarket(?:ers|ing teams)\b|营销|市场人员/i], ['销售', /\bsales (?:teams|reps)\b|销售团队/i],
  ['创作者', /\b(creators?|youtubers|influencers)\b|创作者|博主/i], ['学生/教育', /\b(students?|teachers?|educators?)\b|学生|老师|教育/i],
  ['个人用户', /\b(individuals?|personal use|freelancers?)\b|个人|自由职业/i], ['初创公司', /\b(startups?|founders?|indie hackers?)\b|创业/i],
  ['产品经理', /\bproduct managers?\b|产品经理/i], ['客服团队', /\b(support teams?|customer support)\b|客服/i], ['研究人员', /\bresearchers?\b|研究人员|科研/i],
];
const PRICE_RE = /(?:[$€£¥￥]\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|EUR|元|美元))/;
const PERIOD_RE = /(\/\s?(?:mo|month|yr|year|user|seat)|per (?:month|year|user|seat)|每月|\/月|\/年|每年|monthly|annually)/i;
const TIER_NAMES = /^(free|starter|basic|hobby|personal|plus|pro|professional|premium|team|teams|business|growth|scale|enterprise|ultimate|lite|standard|advanced|免费版?|基础版|个人版|专业版|高级版|团队版|企业版|旗舰版)$/i;

/** 定价：从定价页（或首页）中找出档位名与紧随其后的价格 */
export function extractPricing(html: string): { hasFree: boolean | null; tiers: Tier[]; model: string | null } {
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ');
  const chunks = body.split(/<(?:h[1-6]|div|span|p|li|td|th|strong|b)(?=[\s>])[^>]*>/i).map(t).filter(Boolean);
  const tiers: Tier[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]; if (c.length > 24 || !TIER_NAMES.test(c)) continue;
    const name = c.charAt(0).toUpperCase() + c.slice(1).toLowerCase(); if (tiers.some(x => x.name.toLowerCase().replace(/s$/, '') === name.toLowerCase().replace(/s$/, ''))) continue;
    let price: string | null = null; let period: string | null = null;
    for (let j = i + 1; j < Math.min(i + 8, chunks.length); j++) {
      if (TIER_NAMES.test(chunks[j]) && chunks[j].length <= 24) break;
      const pm = chunks[j].match(PRICE_RE); if (pm) { price = pm[0].replace(/\s+/g, ''); period = (chunks[j].match(PERIOD_RE) || chunks[j + 1]?.match(PERIOD_RE))?.[0] || null; break; }
      if (/^(free|免费|\$0|0元)\b/i.test(chunks[j])) { price = '免费'; break; }
      if (/contact (?:us|sales)|custom|联系销售|定制/i.test(chunks[j])) { price = '联系销售'; break; }
    }
    if (/^(free|免费版?)$/i.test(c) && !price) price = '免费';
    tiers.push({ name, price, period });
  }
  const text = t(body).slice(0, 200000);
  const hasFree = tiers.some(x => x.price === '免费' || /^\$?0(\.0+)?$/.test(x.price || '')) || /\b(free plan|free forever|free tier|start for free|get started for free|free trial|freemium|open[- ]source)\b|免费版|免费试用|永久免费|免费使用/i.test(text) ? true : (tiers.length ? false : null);
  const model = /open[- ]source/i.test(text) ? '开源' : /free trial|免费试用/i.test(text) && !tiers.some(x => x.price === '免费') ? '免费试用 + 付费' : hasFree && tiers.length > 1 ? 'Freemium' : tiers.length ? '付费订阅' : hasFree ? '免费' : null;
  return { hasFree, tiers: tiers.slice(0, 6), model };
}

/** 功能点：优先功能区块的标题/列表项，其次 feature 列表、keywords */
export function extractFeatures(html: string): string[] {
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<nav[\s\S]*?<\/nav>|<footer[\s\S]*?<\/footer>/gi, ' ');
  const cands: string[] = [];
  for (const m of body.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)) cands.push(t(m[1]));
  for (const m of body.matchAll(/<li(?:\s[^>]*)?>([\s\S]*?)<\/li>/gi)) { const s = t(m[1]); if (s.length >= 8) cands.push(s); }
  const bad = /cookie|privacy|terms|sign ?in|log ?in|sign ?up|subscribe|newsletter|copyright|©|all rights|pricing|contact|blog|careers|about us|faq|testimonials|trusted by|^menu$|下载|登录|注册|隐私|条款|联系我们/i;
  return uniq(cands.filter(s => s.length >= 6 && s.length <= 90 && !bad.test(s) && !PRICE_RE.test(s) && !TIER_NAMES.test(s) && /[a-zA-Z\u4e00-\u9fff]{3}/.test(s))).slice(0, 8);
}

export function extractFromHtml(html: string, url: string, pricingHtml?: string | null, pricingUrl?: string | null): Enrich {
  const ld = jsonLd(html);
  const org = ld.find(o => typeIs(o, 'Organization', 'Corporation')) || ld.find(o => o.publisher?.name)?.publisher || null;
  const app = ld.find(o => typeIs(o, 'SoftwareApplication', 'WebApplication', 'MobileApplication', 'Product'));
  const desc = meta(html, 'description') || meta(html, 'og:description') || app?.description || null;
  const title = t(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '') || meta(html, 'og:title');
  const socials: Record<string, string> = {};
  for (const s of ([] as string[]).concat(org?.sameAs || [], app?.sameAs || [])) for (const [k, re] of SOCIAL) if (!socials[k] && re.test(s + '"')) socials[k] = s;
  for (const [k, re] of SOCIAL) if (!socials[k]) { const m = html.match(re); if (m) socials[k] = m[0].replace(/\/$/, ''); }
  const copyright = t(html).match(/(?:©|&copy;|Copyright)\s*(?:\d{4}\s*[-–]?\s*)?(?:\d{4}\s*)?([A-Z][\w&.,' -]{1,60}?(?:Inc\.?|LLC|Ltd\.?|GmbH|Limited|Corp\.?|Co\.|SAS|B\.V\.|有限公司)?)(?=[.\s|]|$)/);
  const base = (hostOf(url) || '').replace(/^www\./, '').split('.')[0].toLowerCase().slice(0, 4);
  if (socials.github && base && !socials.github.toLowerCase().split('github.com/')[1]?.split('/')[0].includes(base)) delete socials.github;
  const company = org?.name ? { name: t(org.name), founded: org.foundingDate || null, location: t(org.address?.addressLocality || org.address?.addressCountry || '') || null } : copyright ? { name: copyright[1].trim().replace(/[.,]$/, ''), founded: null, location: null } : null;
  const lang = uniq([html.match(/<html[^>]*\blang=["']([\w-]+)/i)?.[1], ...[...html.matchAll(/hreflang=["']([\w-]+)["']/gi)].map(m => m[1])].filter(Boolean).map(l => l!.toLowerCase().split('-')[0]).filter(l => l !== 'x')).slice(0, 12);
  const pr = extractPricing(pricingHtml || html);
  if (app?.offers && !pr.tiers.length) for (const of of ([] as any[]).concat(app.offers)) { const p = of.price ?? of.lowPrice; pr.tiers.push({ name: t(of.name || '标准'), price: p == null ? null : +p === 0 ? '免费' : `${of.priceCurrency === 'USD' ? '$' : (of.priceCurrency || '') + ' '}${p}` }); if (+p === 0) pr.hasFree = true; }
  const text = t(html).slice(0, 60000) + ' ' + (desc || '');
  const audience = AUDIENCE.filter(([, re]) => re.test(text)).map(([k]) => k).slice(0, 5);
  return { summary: desc, pricing: { ...pr, url: pricingHtml ? pricingUrl || null : null }, features: uniq([...extractFeatures(html), ...([] as string[]).concat(app?.featureList || []).map(t)]).slice(0, 8), audience, company, socials, languages: lang, title: title || null, fetched_url: url, method: 'heuristic', pages: [url, ...(pricingUrl && pricingHtml ? [pricingUrl] : [])] };
}

/** 在首页中寻找定价页链接 */
export function findPricingUrl(html: string, base: string): string | null {
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]; const label = t(m[2]);
    if (/pricing|price|plans|定价|价格|购买|订阅/i.test(href + ' ' + label)) { try { const u = new URL(href, base); if (hostOf(u.toString())?.replace(/^www\./, '') === hostOf(base)?.replace(/^www\./, '')) return u.toString(); } catch { /* skip */ } }
  }
  return null;
}

async function llmExtract(db: DB, name: string, text: string, base: Enrich): Promise<Enrich> {
  const out = await chat(db, '你是产品资料整理助手。仅依据给定官网文本，输出 JSON：{"summary":"一句话中文定位","features":["中文核心功能，最多6条"],"audience":["目标用户，最多4个"],"pricing":{"hasFree":true|false|null,"tiers":[{"name":"","price":"","period":""}]},"company":"公司名或 null"}。不确定的填 null，不要编造。',
    `产品：${name}\n官网文本：\n${text.slice(0, 9000)}`, true);
  const j = safeJson<any>(out.replace(/^```json|```$/g, ''), null); if (!j) return base;
  return { ...base, method: 'llm', summary: j.summary || base.summary, features: Array.isArray(j.features) && j.features.length ? j.features.slice(0, 8) : base.features, audience: Array.isArray(j.audience) && j.audience.length ? j.audience.slice(0, 5) : base.audience,
    pricing: { ...base.pricing, hasFree: j.pricing?.hasFree ?? base.pricing.hasFree, tiers: base.pricing.tiers.length ? base.pricing.tiers : (j.pricing?.tiers || []).filter((x: any) => x?.name).slice(0, 6) }, company: base.company || (j.company ? { name: j.company } : null) };
}

/** 补齐一个产品；失败写 enrich_status='error:…' */
export async function enrichProduct(db: DB, guid: string, fetcher: Fetcher = defaultFetcher, o: { useLLM?: boolean } = {}): Promise<{ ok: boolean; error?: string; enrich?: Enrich }> {
  const p = db.get<any>('SELECT guid,name,url FROM products WHERE guid=?', [guid]); if (!p) return { ok: false, error: '产品不存在' };
  const set = (status: string, e?: Enrich) => db.run('UPDATE products SET enrich_status=?, enriched_at=?' + (e ? ', enrich_json=?' : '') + ' WHERE guid=?', e ? [status, now(), JSON.stringify(e), guid] : [status, now(), guid]);
  if (!p.url) { set('error:无官网地址'); return { ok: false, error: '无官网地址' }; }
  try {
    const r = await fetcher(p.url); if (r.status >= 400) throw new Error('HTTP ' + r.status);
    if (!/html/i.test(r.contentType) && !/<html/i.test(r.text.slice(0, 2000))) throw new Error('不是网页（' + (r.contentType || '未知类型') + '）');
    const pu = findPricingUrl(r.text, r.finalUrl); let ph: string | null = null;
    if (pu) { try { const pr = await fetcher(pu); if (pr.status < 400) ph = pr.text; } catch { /* 定价页失败不影响主体 */ } }
    let e = extractFromHtml(r.text, r.finalUrl, ph, pu);
    if ((o.useLLM ?? true) && aiEnabled(db)) { try { e = await llmExtract(db, p.name, t(r.text) + '\n' + (ph ? t(ph) : ''), e); } catch { /* 回退启发式 */ } }
    set('ok', e); return { ok: true, enrich: e };
  } catch (err: any) { const msg = String(err?.message || err).slice(0, 100); set('error:' + msg); return { ok: false, error: msg }; }
}

/** 后台队列：并发 3，去重入队，可查询进度 */
export class EnrichQueue {
  private q: string[] = []; private running = new Set<string>(); private done = 0; private failed = 0; private total = 0; private recent: { guid: string; name: string; ok: boolean; error?: string }[] = [];
  constructor(private db: DB, private fetcher: Fetcher = defaultFetcher, private concurrency = 3) {}
  add(guids: string[]) { if (!this.running.size && !this.q.length) this.reset(); let n = 0; for (const g of guids) if (!this.q.includes(g) && !this.running.has(g)) { this.q.push(g); n++; } this.total += n; for (const g of guids) this.db.run("UPDATE products SET enrich_status='queued' WHERE guid=? AND COALESCE(enrich_status,'') NOT LIKE 'ok%'", [g]); this.pump(); return { queued: n, ...this.status() }; }
  private reset() { this.done = 0; this.failed = 0; this.total = 0; }
  private pump() {
    while (this.running.size < this.concurrency && this.q.length) {
      const g = this.q.shift()!; this.running.add(g);
      enrichProduct(this.db, g, this.fetcher).then(r => { this.done++; if (!r.ok) this.failed++; const n = this.db.get<any>('SELECT name FROM products WHERE guid=?', [g])?.name || g; this.recent.unshift({ guid: g, name: n, ok: r.ok, error: r.error }); this.recent.length = Math.min(this.recent.length, 20); })
        .finally(() => { this.running.delete(g); if (!this.q.length && !this.running.size) setTimeout(() => { if (!this.q.length && !this.running.size) this.reset(); }, 30000).unref?.(); this.pump(); });
    }
  }
  status() { return { active: this.running.size > 0 || this.q.length > 0, pending: this.q.length, running: this.running.size, done: this.done, failed: this.failed, total: this.total, recent: this.recent.slice(0, 8) }; }
  idle() { return new Promise<void>(res => { const tick = () => (!this.q.length && !this.running.size ? res() : setTimeout(tick, 50)); tick(); }); }
}
