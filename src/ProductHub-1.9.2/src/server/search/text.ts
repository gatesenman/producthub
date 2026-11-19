/** 文本处理：归一化、英文轻量词干、中文词典分词（最长匹配）+ 二元组、编辑距离、拼音 */
import { pinyin } from 'pinyin-pro';
import { SYNONYM_GROUPS, FILLERS } from './lexicon';
import { CATEGORIES } from '../taxonomy';

export const isCJK = (c: string) => /[\u3400-\u9fff]/.test(c);
export function normalize(s: string) {
  return String(s || '').normalize('NFKC').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[，。！？、；：（）【】《》“”]/g, ' ');
}
const STOP = new Set('the a an and or of to for in on with your you is are it this that by from at as be we our its their can into all your just more get'.split(' '));
/** 英文轻量词干：notes→note, meetings→meeting, transcribing→transcrib… 只做足以对齐单复数/时态的处理 */
export function stem(w: string) {
  if (w.length <= 3 || /\d/.test(w)) return w;
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (/(ss|us|is)$/.test(w)) return w;
  if (/(xes|ches|shes|sses)$/.test(w)) w = w.slice(0, -2);
  else if (w.endsWith('s')) w = w.slice(0, -1);
  if (w.endsWith('ing') && w.length > 6) return w.slice(0, -3);
  return w;
}
export function latinWords(s: string): string[] { return (normalize(s).match(/[a-z0-9][a-z0-9+#]*(?:[.\-][a-z0-9+#]+)*/g) || []); }
/** 文档分词：英文词（词干 + 连字符拆分）+ 中文二元组 + 中文单字（仅单字串） */
export function docTokens(s: string): string[] {
  const t = normalize(s); const out: string[] = [];
  for (const w of latinWords(t)) { if (STOP.has(w)) continue; out.push(stem(w)); const dm = w.match(/^\d+([a-z]{3,})$/); if (dm) out.push(stem(dm[1])); if (/[.\-]/.test(w)) for (const p of w.split(/[.\-]/)) if (p.length > 1 && !STOP.has(p)) out.push(stem(p)); }
  for (const run of t.match(/[\u3400-\u9fff]+/g) || []) { if (run.length === 1) out.push(run); for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2)); }
  return out;
}
/** 一个“词”在文档侧对应的 token 序列（英文多词短语 → 多个词干；中文 → 二元组） */
export function phraseTokens(s: string): string[] { return docTokens(s); }

// —— 中文分词词典：同义词组里的中文词 + 分类关键词 + 填充词 ——
const DICT = new Set<string>();
for (const g of SYNONYM_GROUPS) for (const w of g) if (isCJK(w)) DICT.add(w);
for (const c of CATEGORIES) for (const k of c.keywords) if (isCJK(k)) DICT.add(k);
for (const f of FILLERS) DICT.add(f);
const MAXW = Math.max(...[...DICT].map(w => w.length));
const FILLER = new Set(FILLERS);
/** 中文串最长匹配分词；单字填充词仅在两侧均为词典词/边界时才视为填充（避免把“和风天气”的“和”删掉） */
export function segmentCJK(run: string): { w: string; filler: boolean }[] {
  const raw: { w: string; dict: boolean }[] = [];
  for (let i = 0; i < run.length;) { let hit = '';
    for (let L = Math.min(MAXW, run.length - i); L >= 2; L--) { const w = run.slice(i, i + L); if (DICT.has(w)) { hit = w; break; } }
    if (hit) { raw.push({ w: hit, dict: true }); i += hit.length; } else { raw.push({ w: run[i], dict: false }); i++; } }
  const out: { w: string; filler: boolean }[] = []; let buf = '';
  const flush = () => { if (buf) { out.push({ w: buf, filler: false }); buf = ''; } };
  raw.forEach((t, i) => {
    if (t.dict) { flush(); out.push({ w: t.w, filler: FILLER.has(t.w) }); return; }
    const prevLoose = i > 0 && !raw[i - 1].dict, nextLoose = i < raw.length - 1 && !raw[i + 1].dict;
    if (FILLER.has(t.w) && !prevLoose && !nextLoose) { flush(); out.push({ w: t.w, filler: true }); } else buf += t.w;
  });
  flush(); return out;
}
/** Damerau-Levenshtein（受限），超过 max 提前返回 */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) { let rowMin = Infinity; for (let j = 1; j <= b.length; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1; d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); rowMin = Math.min(rowMin, d[i][j]); }
    if (rowMin > max) return max + 1; }
  return d[a.length][b.length];
}
/** 名称拼音 token：全拼连写（feishuwendang）、首字母（fswd）、每个词的全拼（feishu） */
export function pinyinTokens(name: string): string[] {
  const cjk = (normalize(name).match(/[\u3400-\u9fff]+/g) || []); if (!cjk.length) return [];
  const out = new Set<string>();
  for (const run of cjk) { const syl = pinyin(run, { toneType: 'none', type: 'array', v: true }).map(x => x.replace(/[^a-z]/g, ''));
    out.add(syl.join('')); out.add(syl.map(x => x[0]).join('')); for (let i = 0; i < syl.length - 1; i++) out.add(syl[i] + syl[i + 1]); }
  return [...out].filter(x => x.length >= 2);
}

/** 类目页 / 清单题 / 问答题等「不像真实产品名」的标题 */
export function isGenericProductName(name: string): boolean {
  const n = String(name || '').trim();
  if (!n) return true;
  if (/\?$/.test(n)) return true;
  if (/^(what is|how to|best |top \d+|which |why |we |i |this |our |looking |want to)/i.test(n)) return true;
  if (/\s(with|for|and|the)\s*$/i.test(n)) return true; // 截断句
  if (/\bsalaries in\b/i.test(n)) return true;
  // "Collaboration & Project Management Software" / "Enterprise Resource Planning Software (ERP)"
  if (/\b(software|tools|platform|solutions?|suite)\s*(\([^)]*\))?$/i.test(n)
    && /\b(&|and|for|management|project|collaboration|enterprise|resource|planning|crm|erp|hr)\b/i.test(n)) return true;
  if (/^(alternatives?|best alternatives?)\b/i.test(n)) return true;
  if (/^alternatives? to\b/i.test(n)) return true;
  // 超长且含 & 的类目式标题
  if (n.length >= 48 && /&/.test(n) && !/\b(ai|for)\b/i.test(n.split('&')[0] || '')) return true;
  return false;
}

/** 是否像「X 的替代品清单」而非产品本身 */
export function looksLikeAlternativesList(tagline: string, description?: string): boolean {
  const t = `${tagline || ''} ${description || ''}`.slice(0, 400);
  return /\b(best |top \d+ )?(open[- ]source )?alternatives?\s+to\b/i.test(t)
    || /开源替代|替代品清单|alternatives? including/i.test(t);
}
