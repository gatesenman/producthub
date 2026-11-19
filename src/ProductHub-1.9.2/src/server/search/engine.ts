/** 产品搜索引擎（内存倒排索引）：BM25F 多字段打分 + 名称加权 + 同义/跨语言 + 拼音 + 拼写容错 + 热度 + 约束 + 可解释的匹配理由 */
import type { DB } from '../db';
import { safeJson } from '../util';
import { categoryName, CATEGORIES } from '../taxonomy';
import { docTokens, pinyinTokens, editDistance, normalize, latinWords, stem, isCJK, isGenericProductName, looksLikeAlternativesList } from './text';
import { parseRule, Parsed, Concept, Alt } from './nlq';
import { CONSTRAINT_LABEL, ConstraintKey } from './lexicon';
import { findSimilar } from '../ai';
import { useFts, ftsCandidates } from './fts';

const FIELDS = { name: 3.2, py: 2.6, domain: 2.2, tagline: 2.0, tags: 1.5, enrich: 1.2, desc: 1.0 } as const;
type Field = keyof typeof FIELDS;
const FIELD_CN: Record<Field, string> = { name: '名称', py: '名称拼音', domain: '域名', tagline: '简介', tags: '标签/分类', enrich: '官网信息', desc: '描述' };
const K1 = 1.2, B = 0.75;
type Doc = { i: number; guid: string; name: string; nameN: string; pop: number; row: any; zh: boolean };
type Post = { ids: Int32Array; w: Float32Array; f: Uint8Array };
type Index = { rev: number; docs: Doc[]; byGuid: Map<string, Doc>; df: Map<string, number>; post: Map<string, Post>; N: number; vocab: Map<string, string[]> };
let cache: { db: DB; idx: Index } | null = null;
const FKEYS = Object.keys(FIELDS) as Field[];

/** 「类似 X」目标优选：域名贴合名称、非替代品清单页优先于单纯 pop */
function targetQuality(d: Doc): number {
  let s = 0; const domain = (d.row.domain || '').toLowerCase(); const name = d.nameN;
  if (domain && (domain === name + '.com' || domain === name + '.so' || domain === name + '.io' || domain === name + '.app' || domain.startsWith(name + '.') || domain.includes('.' + name + '.'))) s += 12;
  if (looksLikeAlternativesList(d.row.tagline || '', d.row.description || '')) s -= 25;
  if (isGenericProductName(d.name)) s -= 30;
  if (!domain) s -= 4;
  if (/producthunt\.com|github\.com|affiliate\./i.test(domain)) s -= 3;
  s += d.pop;
  return s;
}

const ZH_SOURCE = (db: DB) => new Set(db.all<any>("SELECT DISTINCT v.product_guid g FROM product_versions v JOIN sources s ON s.guid=v.source_guid WHERE s.region LIKE '中国/%'").map(r => r.g));
export function fieldTokens(r: any, tags: string[], en: any): Record<Field, string[]> {
  const cat = CATEGORIES.find(c => c.id === r.category); const catText = [cat?.name, cat?.parent ? categoryName(cat.parent) : '', ...(cat?.keywords || []).slice(0, 4)].join(' ');
  return {
    name: docTokens(r.name), py: pinyinTokens(r.name), domain: (r.domain || '').split('.').slice(0, -1).filter((x: string) => x !== 'www' && x.length > 1).map((x: string) => stem(x)),
    tagline: docTokens(r.tagline || ''), tags: docTokens(tags.join(' ') + ' ' + catText),
    enrich: en ? docTokens([...(en.features || []), ...(en.audience || []), ...(en.pricing?.tiers || []).map((t: any) => t.name), en.summary || ''].join(' ')) : [],
    desc: docTokens((r.description || '').slice(0, 1500)),
  };
}
/** 构建倒排索引（token → 有序 doc 列表 + 预计算 BM25F 字段加权 tf），大数据量下只对候选打分 */
export function buildIndex(db: DB, rowids?: number[]): Index {
  if (!rowids && cache && cache.db === db && cache.idx.rev === db.rev) return cache.idx;
  if (!rowids) cache = null;
  const COLS = `p.guid,p.name,p.tagline,p.description,p.tags,p.category,p.url,p.domain,p.votes,p.launch_count,p.launch_date,p.first_seen,p.platforms,p.enrich_json`;
  let rows: any[]; let zh: Set<string>;
  if (rowids) {
    rows = [];
    for (let i = 0; i < rowids.length; i += 500) { const ch = rowids.slice(i, i + 500);
      rows.push(...db.all<any>(`SELECT ${COLS}, (SELECT COUNT(DISTINCT source_guid) FROM product_versions v WHERE v.product_guid=p.guid) nsrc FROM products p WHERE p.rowid IN (${ch.map(() => '?').join(',')})`, ch)); }
    zh = new Set(rows.length ? db.all<any>(`SELECT DISTINCT v.product_guid g FROM product_versions v JOIN sources s ON s.guid=v.source_guid WHERE s.region LIKE '中国/%' AND v.product_guid IN (${rows.map(() => '?').join(',')})`, rows.map(r => r.guid)).map(r => r.g) : []);
  } else {
    rows = db.all<any>(`SELECT ${COLS}, COALESCE(n.c, 0) nsrc FROM products p LEFT JOIN (SELECT product_guid, COUNT(DISTINCT source_guid) c FROM product_versions GROUP BY product_guid) n ON n.product_guid=p.guid`);
    zh = ZH_SOURCE(db);
  } const sum: Record<string, number> = {}; const docs: Doc[] = [];
  let maxV = 1; for (const r of rows) if ((r.votes || 0) > maxV) maxV = r.votes;
  // 第一遍：字段长度均值
  const lens: Uint16Array[] = FKEYS.map(() => new Uint16Array(rows.length)); const parsed: { tags: string[]; en: any }[] = [];
  rows.forEach((r, i) => { const tags: string[] = safeJson(r.tags, []); const en = safeJson<any>(r.enrich_json, null); parsed.push({ tags, en }); const t = fieldTokens(r, tags, en); FKEYS.forEach((f, k) => { lens[k][i] = Math.min(65535, t[f].length); sum[f] = (sum[f] || 0) + t[f].length; }); });
  const N = rows.length || 1; const avg = FKEYS.map(f => Math.max(1, (sum[f] || 0) / N));
  // 第二遍：倒排
  const tmp = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const { tags, en } = parsed[i]; const t = fieldTokens(r, tags, en); const acc = new Map<string, [number, number, number]>();
    FKEYS.forEach((f, k) => { const norm = 1 - B + B * lens[k][i] / avg[k]; const c = new Map<string, number>(); for (const x of t[f]) c.set(x, (c.get(x) || 0) + 1);
      for (const [x, tf] of c) { const w = FIELDS[f] * tf / norm; const a = acc.get(x); if (!a) acc.set(x, [w, k, w]); else { a[0] += w; if (w > a[2]) { a[1] = k; a[2] = w; } } } });
    for (const [x, a] of acc) { let l = tmp.get(x); if (!l) tmp.set(x, l = []); l.push(i, a[0], a[1]); }
    const desc = r.description ? String(r.description).slice(0, 400) : null;
    docs.push({ i, guid: r.guid, name: r.name, nameN: normalize(r.name).trim(), zh: zh.has(r.guid),
      row: { name: r.name, tagline: r.tagline, description: desc, category: r.category, url: r.url, domain: r.domain, launch_date: r.launch_date, first_seen: r.first_seen, platforms: r.platforms, nsrc: r.nsrc, tags, enrich: en ? { pricing: en.pricing ? { hasFree: en.pricing.hasFree } : null, languages: en.languages, audience: en.audience } : null },
      pop: 0.5 * Math.log1p(r.votes || 0) / Math.log1p(maxV) + 0.3 * Math.min((r.launch_count || 1) - 1, 4) / 4 + 0.2 * Math.min((r.nsrc || 1) - 1, 3) / 3 });
    rows[i] = null;
  });
  const post = new Map<string, Post>(); const df = new Map<string, number>();
  for (const [x, l] of tmp) { const n = l.length / 3; const p: Post = { ids: new Int32Array(n), w: new Float32Array(n), f: new Uint8Array(n) }; for (let j = 0; j < n; j++) { p.ids[j] = l[3 * j]; p.w[j] = l[3 * j + 1]; p.f[j] = l[3 * j + 2]; } post.set(x, p); df.set(x, n); }
  tmp.clear();
  const vocab = new Map<string, string[]>(); for (const t of df.keys()) if (/^[a-z0-9]/.test(t) && t.length >= 3) { const k = t[0]; if (!vocab.has(k)) vocab.set(k, []); vocab.get(k)!.push(t); }
  const idx = { rev: db.rev, docs, byGuid: new Map(docs.map(d => [d.guid, d])), df, post, N, vocab };
  if (!rowids) cache = { db, idx }; return idx;
}
function bsearch(a: Int32Array, x: number) { let lo = 0, hi = a.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m] === x) return m; if (a[m] < x) lo = m + 1; else hi = m - 1; } return -1; }

/** 拼写容错 / 前缀补全 / 拼音：基于索引词表为英文词补充候选 */
function enrich(idx: Index, c: Concept): Concept {
  const base = c.alts[0]; if (!base || !base.toks.length || /\s/.test(base.text.trim())) return c; const tok = base.toks[0]; if (!/^[a-z0-9]*[a-z][a-z0-9]*$/.test(tok)) return c;
  const alts = [...c.alts]; const has = (t: string) => alts.some(a => a.toks.length === 1 && a.toks[0] === t);
  const known = (idx.df.get(tok) || 0) > 0;
  if (!known && tok.length >= 4) {
    const max = tok.length >= 8 ? 2 : 1;
    const cands = (idx.vocab.get(tok[0]) || []).concat(tok.length >= 5 ? (idx.vocab.get(tok[1]) || []) : []).filter(v => Math.abs(v.length - tok.length) <= max && editDistance(tok, v, max) <= max)
      .sort((a, b) => (idx.df.get(b)! - idx.df.get(a)!)).slice(0, 3);
    for (const v of cands) if (!has(v)) alts.push({ text: v, toks: [v], w: 0.7, kind: 'typo' });
  }
  if (tok.length >= 4) for (const v of (idx.vocab.get(tok[0]) || []).filter(v => v.length > tok.length && v.startsWith(tok)).sort((a, b) => idx.df.get(b)! - idx.df.get(a)!).slice(0, 4)) if (!has(v)) alts.push({ text: v, toks: [v], w: 0.6, kind: 'prefix' });
  return { ...c, alts };
}

function tokScore(idx: Index, d: Doc, t: string): { s: number; f: Field | null } {
  const p = idx.post.get(t); if (!p) return { s: 0, f: null }; const j = bsearch(p.ids, d.i); if (j < 0) return { s: 0, f: null };
  const n = p.ids.length; const wtf = p.w[j]; const idf = Math.log(1 + (idx.N - n + 0.5) / (n + 0.5));
  return { s: idf * wtf * (K1 + 1) / (wtf + K1), f: FKEYS[p.f[j]] };
}
function altScore(idx: Index, d: Doc, a: Alt) { let s = 0; let f: Field | null = null; for (const t of a.toks) { const r = tokScore(idx, d, t); if (!r.s) return null; s += r.s; f = f || r.f; } return { s: a.w * s / Math.sqrt(a.toks.length), f: f! }; }

const DAY = 86400000;
export function constraintOf(d: { row: any; zh: boolean }, k: ConstraintKey, now = Date.now()): boolean | null {
  const r = d.row; const tags: string[] = r.tags || []; const en = r.enrich; const text = `${r.name} ${r.tagline || ''} ${r.description || ''}`; const pl: string[] = safeJson(r.platforms, []);
  switch (k) {
    case 'free': return tags.some(t => ['免费', '免费增值', '开源'].includes(t)) || !!en?.pricing?.hasFree || /\bfree\b|免费/i.test(text) ? true : null;
    case 'opensource': return tags.includes('开源') || /open[- ]source|开源/i.test(text) || /github\.com\/[^/]+\/[^/]+/.test(r.url || '') ? true : null;
    case 'chinese': return d.zh || /[\u4e00-\u9fff]/.test(`${r.name} ${r.tagline || ''}`) || (en?.languages || []).some((l: string) => /^zh/i.test(l)) || /\.cn$/.test(r.domain || '') ? true : null;
    case 'recent': { const t = Date.parse(r.launch_date || r.first_seen || ''); return t && now - t <= 30 * DAY ? true : false; }
    case 'team': return /\bteams?\b|collaborat|团队|协作|企业|workspace/i.test(text + ' ' + (en?.audience || []).join(' ')) || tags.includes('企业') ? true : null;
    case 'personal': return /personal|个人|individual/i.test(text) || tags.includes('个人用户') ? true : null;
    case 'developer': return tags.includes('开发者') || r.category === 'dev' || /developer|开发者/i.test(text) ? true : null;
    case 'ios': return tags.includes('iOS') || pl.includes('iOS') || /\bios\b|iphone|app store/i.test(text) ? true : null;
    case 'android': return tags.includes('Android') || /android|google play/i.test(text) ? true : null;
    case 'mac': return tags.includes('macOS') || /\bmac(os)?\b/i.test(text) ? true : null;
    case 'windows': return tags.includes('Windows') || /windows/i.test(text) ? true : null;
    case 'extension': return tags.includes('Chrome 扩展') || /extension|插件|扩展/i.test(text) ? true : null;
    case 'selfhost': return tags.includes('自托管') || /self[- ]host/i.test(text) ? true : null;
  }
}

export type SearchOpts = { fullIndex?: boolean; chips?: ConstraintKey[]; parsed?: Parsed; candidates?: Set<string> | null; limit?: number; offset?: number; now?: number; explain?: [number, number] };
export type Hit = { guid: string; score: number; coverage: number; partial: boolean; reasons: string[]; hl: string[]; matched: { concept: string; alt: string; kind: string; field: string }[] };
export type SearchResult = { parsed: Parsed; ignored: string[]; total: number; strict: number; weak: boolean; hits: Hit[]; tookMs: number; similarTo?: { guid: string; name: string } | null };

export function search(db: DB, q: string, o: SearchOpts = {}): SearchResult {
  const t0 = Date.now(); const parsed = o.parsed || parseRule(q); const now = o.now ?? Date.now();
  const idx = useFts(db, o) ? buildIndex(db, ftsCandidates(db, parsed, q, o)) : buildIndex(db);
  let concepts = parsed.concepts.map(c => enrich(idx, c));
  // 合并互为同义的重复概念；库中完全不存在的词（多为未识别的口语）不作为必需条件
  concepts = concepts.filter((c, i) => !concepts.slice(0, i).some(p => p.alts.some(a => a.text === c.label)));
  const ignored: string[] = [];
  if (concepts.length > 1) { const live = concepts.filter(c => c.alts.some(a => a.toks.length > 0 && a.toks.every(t => idx.df.has(t)))); if (live.length) { for (const c of concepts) if (!live.includes(c)) ignored.push(c.label); concepts = live; } }
  const qn = normalize(q).trim();
  // “类似 X”：库里能找到 X 时用相似度召回
  let simMap: Map<string, number> | null = null; let similarTo: SearchResult['similarTo'] = null;
  if (parsed.similarTo) { const sn = normalize(parsed.similarTo).trim();
    const named = idx.docs.filter(d => d.nameN === sn || d.nameN.startsWith(sn + ' ') || (d.row.domain || '').toLowerCase().startsWith(sn + '.'));
    const ranked = [...named].sort((a, b) => targetQuality(b) - targetQuality(a));
    const target = ranked[0] || null;
    if (target) { similarTo = { guid: target.guid, name: target.name }; simMap = new Map();
      const targetCat = target.row.category;
      const targetTags = new Set<string>((target.row.tags || []) as string[]);
      for (const t of ranked.slice(0, 3)) for (const s of findSimilar(db, { guid: t.guid, limit: 200 }) as any[]) simMap.set(s.guid, Math.max(simMap.get(s.guid) || 0, s.score));
      const esc = sn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const altRe = new RegExp(`(alternatives?\\s+(to|for)\\s+${esc}\\b|\\b${esc}\\s+(alternative|替代)|替代\\s*${esc})`, 'i');
      try { for (const r of db.all<any>('SELECT product_guid g FROM alt_rel WHERE target = ?', [sn])) simMap.set(r.g, Math.max(simMap.get(r.g) || 0, 1.0)); } catch { /* 旧库无此表 */ }
      for (const d of idx.docs) if (d.nameN !== sn && altRe.test(`${d.row.tagline || ''} ${d.row.description || ''}`)) simMap.set(d.guid, Math.max(simMap.get(d.guid) || 0, 0.9));
      const tToks = new Set(docTokens(`${target.row.tagline || ''} ${(target.row.description || '').slice(0, 200)}`).filter(t => t.length > 2));
      (simMap as any)._targetCat = targetCat; (simMap as any)._targetTags = targetTags; (simMap as any)._targetToks = tToks; }
    else concepts.push(...parseRule(parsed.similarTo).concepts.map(c => enrich(idx, c))); }
  const chips = o.chips || []; const soft = parsed.constraints.filter(k => !chips.includes(k));
  const scored: (Hit & { _d: Doc })[] = [];
  // 候选生成：各概念各候选词首 token 的倒排并集（无概念时退化为全量扫描约束）
  let cand: Doc[] = idx.docs;
  if (concepts.length || simMap) {
    // 每个概念的候选集；多概念时若交集（严格匹配候选）≥5 则只对交集打分，否则用并集以支持部分匹配
    const per = concepts.map(c => { const cs = new Set<number>(); for (const a of c.alts) { const p = a.toks.length ? idx.post.get(a.toks[0]) : null; if (p) for (const i of p.ids) cs.add(i); } return cs; });
    let set = new Set<number>();
    if (per.length > 1) { const sorted = [...per].sort((a, b) => a.size - b.size); for (const i of sorted[0]) if (sorted.every(x => x.has(i))) set.add(i); if (set.size < 5) { set = new Set(); for (const cs of per) for (const i of cs) set.add(i); } }
    else if (per.length) set = per[0];
    if (simMap) for (const g of simMap.keys()) { const d = idx.byGuid.get(g); if (d) set.add(d.i); }
    if (qn) for (const d of idx.docs) if (d.nameN === qn) set.add(d.i);
    cand = [...set].sort((x, y) => x - y).map(i => idx.docs[i]); }
  for (const d of cand) {
    if (o.candidates && !o.candidates.has(d.guid)) continue;
    if (simMap && similarTo && (d.guid === similarTo.guid || d.nameN === normalize(similarTo.name).trim())) continue;
    if (chips.some(k => constraintOf(d, k, now) !== true)) continue;
    let rel = 0, hit = 0; const matched: Hit['matched'] = [];
    for (const c of concepts) { let best: { s: number; f: Field; a: Alt } | null = null;
      for (const a of c.alts) { const r = altScore(idx, d, a); if (r && (!best || r.s > best.s)) best = { ...r, a }; }
      if (best) { rel += best.s; hit++; matched.push({ concept: c.label, alt: best.a.text, kind: best.a.kind, field: best.f }); } }
    const sim = simMap?.get(d.guid) || 0;
    if (concepts.length && !hit && !sim) continue;
    if (simMap && !concepts.length && !sim) continue;
    if (!concepts.length && !simMap && !chips.length && !soft.length) continue;
    const coverage = concepts.length ? hit / concepts.length : 1;
    let score = rel * (0.5 + 0.5 * coverage) * (1 + 0.15 * d.pop);
    if (qn && d.nameN === qn) score += 100; else if (qn.length >= 3 && d.nameN.startsWith(qn)) score += 12;
    if (sim) score += 18 * sim; // alt_rel≈1.0 → +18，高于纯文本命中
    if (simMap && similarTo) {
      const tCat = (simMap as any)._targetCat as string | undefined;
      const tTags = (simMap as any)._targetTags as Set<string> | undefined;
      const tToks = (simMap as any)._targetToks as Set<string> | undefined;
      if (tCat && tCat !== 'other' && d.row.category === tCat) score += 3;
      if (tTags && tTags.size) { const ot: string[] = d.row.tags || []; const ov = ot.filter(t => tTags.has(t)).length; if (ov) score += Math.min(3, ov); }
      if (tToks && tToks.size) {
        const ot = docTokens(`${d.name} ${d.row.tagline || ''} ${(d.row.description || '').slice(0, 200)}`);
        const ov = ot.filter(t => tToks.has(t)).length;
        if (ov) score += Math.min(6, ov * 1.2); // 与目标简介关键词重合（notes/docs/wiki…）
      }
      if (isGenericProductName(d.name)) score *= 0.05; // 类目名 / 截断句沉底
      if (looksLikeAlternativesList(d.row.tagline || '', d.row.description || '')) score *= 0.2;
    } else if (isGenericProductName(d.name) && concepts.length) {
      score *= 0.5;
    }
    const okSoft = soft.filter(k => constraintOf(d, k, now) === true);
    if (!concepts.length && !simMap && soft.length && !okSoft.length) continue; score *= 1 + 0.25 * okSoft.length;
    if (!concepts.length && !simMap) score = 1 + okSoft.length + d.pop;
    scored.push({ guid: d.guid, score: +score.toFixed(4), coverage, partial: coverage < 1, reasons: [], hl: [], matched, _d: d });
  }
  const strictN = scored.filter(h => !h.partial).length;
  let pool = scored.filter(h => !h.partial || (concepts.length > 1 && strictN < 5 && h.coverage >= 0.5) || (simMap?.get(h.guid) || 0) > 0.2);
  pool.sort((a, b) => (Number(a.partial) - Number(b.partial)) || b.score - a.score);
  const total = pool.length; const off = o.offset || 0; const page = pool.slice(off, off + (o.limit ?? 50));
  const ex = o.explain ? pool.slice(o.explain[0], o.explain[1]) : page;
  for (const h of ex) { const d = h._d;
    for (const m of h.matched) {
      const f = m.field as Field; const where = FIELD_CN[f] || '内容';
      if (m.kind === 'exact') h.reasons.push(`${where}匹配「${m.concept}」`);
      else if (m.kind === 'synonym' || m.kind === 'llm') h.reasons.push(`${where}含「${m.alt}」（≈${m.concept}）`);
      else if (m.kind === 'typo') h.reasons.push(`拼写纠正：${m.concept}→${m.alt}`);
      else if (m.kind === 'prefix') h.reasons.push(`前缀补全：${m.concept}→${m.alt}`);
      if (f === 'py') h.reasons.push(`拼音匹配：${m.alt}→${d.name}`);
      h.hl.push(m.alt); if (isCJK(m.concept[0]) || latinWords(m.concept).length) h.hl.push(m.concept);
    }
    if (similarTo && simMap?.has(h.guid)) h.reasons.push(`与「${similarTo.name}」相似 ${Math.round((simMap.get(h.guid) || 0) * 100)}%`);
    for (const k of [...chips, ...soft]) { const v = constraintOf(d, k, now); if (v) h.reasons.push(`✓ ${CONSTRAINT_LABEL[k]}`); else if (soft.includes(k)) h.reasons.push(`? 未确认${CONSTRAINT_LABEL[k]}`); }
    if (h.partial) h.reasons.push(`部分匹配（${h.matched.length}/${concepts.length} 个关键词）`);
    if (d.pop > 0.3) h.reasons.push(`多来源/多次发布（${d.row.nsrc} 个来源）`);
    h.hl = [...new Set(h.hl.filter(Boolean))].sort((a, b) => b.length - a.length);
  }
  const weak = strictN < 3;
  return { parsed: { ...parsed, concepts }, ignored, total, strict: strictN, weak, similarTo, tookMs: Date.now() - t0, hits: page.map(({ _d, ...h }) => h) };
}
/** 用于与 SQL 过滤/排序结合：返回全部命中的 guid → 分数 */
export function searchAll(db: DB, q: string, o: SearchOpts = {}) {
  // 大结果集只为当前页生成匹配理由
  if (!o.explain) o = { ...o, explain: [0, 50] }; const r = search(db, q, { ...o, limit: o.limit ?? 8000 }); return { ...r, scores: new Map(r.hits.map(h => [h.guid, h])) }; }
