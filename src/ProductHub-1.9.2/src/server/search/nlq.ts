/** 自然语言需求解析：一句话 → 关键词概念（含同义扩展）+ 约束 + “类似 X”。有 Key 时可用大模型增强，失败回退规则解析 */
import { SYNONYM_GROUPS, EN_FILLERS, CONSTRAINT_PATTERNS, ConstraintKey } from './lexicon';
import { normalize, isCJK, segmentCJK, stem, phraseTokens, latinWords } from './text';

export type AltKind = 'exact' | 'synonym' | 'typo' | 'prefix' | 'pinyin' | 'llm';
export type Alt = { text: string; toks: string[]; w: number; kind: AltKind };
export type Concept = { label: string; alts: Alt[] };
export type Parsed = { raw: string; concepts: Concept[]; constraints: ConstraintKey[]; similarTo?: string; mode: 'rule' | 'llm'; keywords: string[] };

const key = (w: string) => isCJK(w) ? w : latinWords(w).map(stem).join(' ');
const GROUP_OF = new Map<string, number[]>();
SYNONYM_GROUPS.forEach((g, i) => g.forEach(w => { const k = key(w); GROUP_OF.set(k, [...(GROUP_OF.get(k) || []), i]); }));
const EN_PHRASES = [...new Set(SYNONYM_GROUPS.flat().filter(w => !isCJK(w) && /\s|-/.test(w)))].sort((a, b) => b.length - a.length);

/** 一个词 → 概念：原词 + 同义词组 */
export function expand(term: string, extra: string[] = []): Concept {
  const alts: Alt[] = []; const seen = new Set<string>();
  const add = (text: string, w: number, kind: AltKind) => { const toks = phraseTokens(text); const k = toks.join(' '); if (!toks.length || seen.has(k)) return; seen.add(k); alts.push({ text, toks, w, kind }); };
  add(term, 1, 'exact');
  for (const gi of GROUP_OF.get(key(term)) || []) for (const w of SYNONYM_GROUPS[gi]) add(w, 0.8, 'synonym');
  for (const w of extra) add(w, 0.75, 'llm');
  return { label: term, alts };
}

export function parseRule(raw: string): Parsed {
  let t = ' ' + normalize(raw) + ' ';
  const constraints: ConstraintKey[] = []; let similarTo: string | undefined;
  const sim = t.match(/(?:类似|像|替代|平替|对标|alternatives? to|similar to|\blike\b)\s*([a-z0-9][a-z0-9 .\-]{0,24}?[a-z0-9]|[\u4e00-\u9fa5]{2,8}?)(?=\s|的|$|那样|一样|这种|这样|产品|工具|软件)/) || t.match(/([a-z0-9][a-z0-9.\-]{1,24})\s*(?:的)?\s*(?:替代品|平替|alternatives?)/);
  if (sim) { similarTo = sim[1].trim(); t = t.replace(sim[0], ' '); }
  for (const [k, re] of CONSTRAINT_PATTERNS) { const m = t.match(re); if (m) { constraints.push(k); t = t.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), ' '); } }
  const terms: string[] = [];
  // 英文多词短语优先（meeting notes / speech to text …）
  for (const p of EN_PHRASES) { const re = new RegExp('(^|[^a-z])' + p.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '(?=[^a-z]|$)'); if (re.test(t)) { terms.push(p); t = t.replace(re, '$1 '); } }
  for (const seg of t.split(/([\u3400-\u9fff]+)/)) {
    if (!seg.trim()) continue;
    if (isCJK(seg[0])) { for (const s of segmentCJK(seg)) if (!s.filler) terms.push(s.w); }
    else for (const w of latinWords(seg)) if (!EN_FILLERS.has(w)) terms.push(w);
  }
  // 只剩填充词时（如搜 “app”），保留原词
  if (!terms.length && !constraints.length && !similarTo) terms.push(...latinWords(t).slice(0, 3));
  const uniq = [...new Set(terms)];
  return { raw, concepts: uniq.map(x => expand(x)), constraints: [...new Set(constraints)], similarTo, mode: 'rule', keywords: uniq };
}

const llmCache = new Map<string, Parsed>();
/** 大模型解析：输出关键词 + 每个关键词的中英同义词 + 约束；任何异常都回退规则解析 */
export async function parseWithLLM(raw: string, chat: (sys: string, user: string) => Promise<string>, timeoutMs = 8000): Promise<Parsed> {
  const base = parseRule(raw); const hit = llmCache.get(raw); if (hit) return hit;
  try {
    const sys = '你是产品搜索的查询理解器。把用户一句话需求解析为 JSON：{"terms":[{"term":"核心功能词(尽量短)","synonyms":["中英文同义词,最多4个"]}],"constraints":["free|opensource|chinese|recent|team|personal|developer|ios|android|mac|windows|extension|selfhost 中适用的"],"similar_to":"若提到类似某产品则填产品名否则null"}。terms 最多 4 个，不要包含“工具/软件/支持”等泛词，也不要把约束放进 terms。只输出 JSON。';
    const txt = await Promise.race([chat(sys, raw), new Promise<string>((_, rj) => setTimeout(() => rj(new Error('timeout')), timeoutMs))]);
    const j = JSON.parse(String(txt).replace(/^```(json)?|```$/g, '').trim());
    const terms: { term: string; synonyms?: string[] }[] = (j.terms || []).filter((x: any) => x?.term).slice(0, 4);
    if (!terms.length) return base;
    const out: Parsed = { raw, mode: 'llm', concepts: terms.map(x => expand(normalize(x.term).trim(), (x.synonyms || []).map((s: string) => normalize(s)))),
      constraints: [...new Set([...base.constraints, ...((j.constraints || []) as ConstraintKey[]).filter(k => CONSTRAINT_PATTERNS.some(([c]) => c === k))])],
      similarTo: j.similar_to || base.similarTo, keywords: terms.map(x => x.term) };
    llmCache.set(raw, out); return out;
  } catch { return base; }
}
