import type { DB } from './db';
import { hydrateList, LIST_COLS, LIST_FAV } from './products';
import { CATEGORIES } from './taxonomy';
import { searchAll } from './search/engine';
import type { Parsed } from './search/nlq';
import type { ConstraintKey } from './search/lexicon';

export type Cond = { type: 'cond'; field: string; op: string; value?: any };
export type Group = { type: 'group'; op: 'AND' | 'OR'; not?: boolean; children: (Cond | Group)[] };
export type FilterNode = Cond | Group;

export const FIELDS: Record<string, { label: string; kind: 'text' | 'number' | 'date' | 'enum' | 'array' | 'bool' | 'source' | 'source_region'; col?: string }> = {
  name: { label: '名称', kind: 'text' }, tagline: { label: '一句话简介', kind: 'text' }, description: { label: '描述', kind: 'text' },
  url: { label: '网址', kind: 'text' }, domain: { label: '域名', kind: 'text' }, category: { label: '分类', kind: 'enum' },
  tags: { label: '标签', kind: 'array' }, platforms: { label: '平台', kind: 'array' }, pricing: { label: '定价', kind: 'text' },
  maker: { label: '开发者', kind: 'text' }, country: { label: '国家/地区', kind: 'text' }, origin: { label: '来源方式', kind: 'enum' },
  launch_date: { label: '发布日期', kind: 'date' }, first_seen: { label: '首次收录', kind: 'date' }, last_seen: { label: '最近出现', kind: 'date' },
  votes: { label: '票数', kind: 'number' }, launch_count: { label: '发布次数', kind: 'number' },
  has_logo: { label: '有图片', kind: 'bool', col: "(COALESCE(logo_local,logo_url,'')<>'')" }, has_summary: { label: '已 AI 总结', kind: 'bool', col: "(COALESCE(ai_summary,'')<>'')" },
  guid: { label: 'GUID', kind: 'enum', col: 'guid' },
  favorite: { label: '已关注', kind: 'bool', col: '(guid IN (SELECT product_guid FROM favorites))' },
  source: { label: '来源', kind: 'source' }, source_region: { label: '来源地区', kind: 'source_region' as any },
};
export const OPS: Record<string, string> = { contains: '包含', not_contains: '不包含', eq: '等于', neq: '不等于', starts_with: '开头是', in: '属于任一', not_in: '不属于', gt: '大于', gte: '≥', lt: '小于', lte: '≤', between: '介于', empty: '为空', not_empty: '不为空', has_any: '含任一', has_all: '含全部', is_true: '是', is_false: '否' };

const like = (s: any) => '%' + String(s ?? '').replace(/[%_\\]/g, m => '\\' + m) + '%';
const list = (v: any): any[] => Array.isArray(v) ? v : String(v ?? '').split(/[,，]/).map(s => s.trim()).filter(Boolean);

export function compile(node: FilterNode | null | undefined, params: any[]): string {
  if (!node) return '1=1';
  if (node.type === 'group') {
    const parts = (node.children || []).map(c => compile(c, params)).filter(Boolean);
    const body = parts.length ? '(' + parts.join(node.op === 'OR' ? ' OR ' : ' AND ') + ')' : '1=1';
    return node.not ? `NOT ${body}` : body;
  }
  const f = FIELDS[node.field]; if (!f) throw new Error('未知字段: ' + node.field);
  const col = f.col || node.field; const v = node.value;
  if (f.kind === 'source') {
    const ids = list(v); if (!ids.length) return '1=1';
    params.push(...ids); const q = `guid ${node.op === 'not_in' ? 'NOT IN' : 'IN'} (SELECT product_guid FROM product_versions WHERE source_guid IN (${ids.map(() => '?').join(',')}))`; return q;
  }
  if ((f.kind as string) === 'source_region') { const vals = list(v); if (!vals.length) return '1=1'; params.push(...vals.map(x => like(x)));
    return `guid IN (SELECT v.product_guid FROM product_versions v JOIN sources s ON s.guid=v.source_guid WHERE ${vals.map(() => "s.region LIKE ? ESCAPE '\\'").join(' OR ')})`; }
  if (f.kind === 'bool') return node.op === 'is_false' ? `NOT ${col}` : col;
  if (f.kind === 'array') {
    const vals = list(v); if (node.op === 'empty') return `(${col} IS NULL OR ${col} IN ('[]',''))`; if (node.op === 'not_empty') return `(${col} IS NOT NULL AND ${col} NOT IN ('[]',''))`;
    if (!vals.length) return '1=1';
    const parts = vals.map(x => { params.push(like(JSON.stringify(String(x)))); return `${col} LIKE ? ESCAPE '\\'`; });
    if (node.op === 'has_all') return '(' + parts.join(' AND ') + ')';
    if (node.op === 'not_in' || node.op === 'not_contains') return 'NOT (' + parts.join(' OR ') + ')';
    return '(' + parts.join(' OR ') + ')';
  }
  switch (node.op) {
    case 'contains': params.push(like(v)); return `${col} LIKE ? ESCAPE '\\'`;
    case 'not_contains': params.push(like(v)); return `COALESCE(${col},'') NOT LIKE ? ESCAPE '\\'`;
    case 'starts_with': params.push(String(v ?? '').replace(/[%_\\]/g, m => '\\' + m) + '%'); return `${col} LIKE ? ESCAPE '\\'`;
    case 'eq': params.push(v); return `${col} = ?`;
    case 'neq': params.push(v); return `COALESCE(${col},'') <> ?`;
    case 'in': case 'not_in': { const vals = list(v); if (!vals.length) return '1=1'; params.push(...vals); return `${col} ${node.op === 'in' ? 'IN' : 'NOT IN'} (${vals.map(() => '?').join(',')})`; }
    case 'gt': params.push(v); return `${col} > ?`; case 'gte': params.push(v); return `${col} >= ?`;
    case 'lt': params.push(v); return `${col} < ?`; case 'lte': params.push(v); return `${col} <= ?`;
    case 'between': { const [a, b] = list(v); params.push(a, b); return `${col} BETWEEN ? AND ?`; }
    case 'empty': return `COALESCE(${col},'') = ''`; case 'not_empty': return `COALESCE(${col},'') <> ''`;
    default: throw new Error('未知运算符: ' + node.op);
  }
}

const SORTS: Record<string, string> = { updated: 'updated_at DESC', newest: 'launch_date DESC, first_seen DESC', name: 'name COLLATE NOCASE ASC', votes: 'votes DESC', launches: 'launch_count DESC, votes DESC', first_seen: 'first_seen DESC' };
export interface Query { q?: string; filter?: FilterNode | null; category?: string; sort?: string; page?: number; pageSize?: number; chips?: ConstraintKey[]; parsed?: Parsed }
/** 仅对命中集合排序，禁止全表 ORDER BY（140 万库下会卡数秒） */
function orderHitGuids(db: DB, guids: string[], sortKey: string): string[] {
  if (!guids.length) return guids;
  const ord = SORTS[sortKey] || SORTS.updated;
  if (guids.length <= 800) {
    return db.all<any>(`SELECT guid FROM products WHERE guid IN (${guids.map(() => '?').join(',')}) ORDER BY ${ord}`, guids).map(r => r.guid);
  }
  const col = ord.split(',')[0].trim().replace(/ (DESC|ASC)$/i, '').replace(/ COLLATE NOCASE/i, '');
  const desc = /DESC/i.test(ord.split(',')[0]);
  const meta = new Map<string, any>();
  for (let i = 0; i < guids.length; i += 800) {
    const ch = guids.slice(i, i + 800);
    for (const r of db.all<any>(`SELECT guid, ${col} AS s FROM products WHERE guid IN (${ch.map(() => '?').join(',')})`, ch)) meta.set(r.guid, r.s);
  }
  return [...guids].sort((a, b) => {
    const va = meta.get(a), vb = meta.get(b);
    if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
    if (va === vb) return 0;
    return (va < vb ? -1 : 1) * (desc ? -1 : 1);
  });
}
/** v1.4：有关键词或快捷条件时走搜索引擎（BM25F + 同义词 + 拼音 + 容错），SQL 只负责结构化条件；默认按相关度排序 */
export function queryProducts(db: DB, qy: Query) {
  const q = qy.q?.trim(); const chips = (qy.chips || []).filter(Boolean);
  if (!q && !chips.length) return queryProductsLegacy(db, qy);
  const params: any[] = []; const where: string[] = [compile(qy.filter, params)];
  if (qy.category) { const ids = [qy.category, ...CATEGORIES.filter(c => c.parent === qy.category).map(c => c.id)]; where.push(`category IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
  const structured = where.some(w => w !== '1=1');
  const candidates = structured ? new Set(db.all<any>(`SELECT guid FROM products WHERE ${where.join(' AND ')}`, params).map(r => r.guid)) : null;
  const size0 = Math.min(Math.max(qy.pageSize || 50, 1), 1000); const page0 = Math.max(qy.page || 1, 1);
  const byRel0 = !qy.sort || qy.sort === 'relevance' || (q && qy.sort === 'updated');
  const r = searchAll(db, q || '', { chips, parsed: qy.parsed, candidates, explain: byRel0 ? [(page0 - 1) * size0, page0 * size0] : [0, Math.min(5000, page0 * size0)] });
  let order = r.hits.map(h => h.guid);
  const size = Math.min(Math.max(qy.pageSize || 50, 1), 1000); const page = Math.max(qy.page || 1, 1);
  const byRel = !qy.sort || qy.sort === 'relevance' || (q && qy.sort === 'updated');
  if (!byRel && order.length) order = orderHitGuids(db, order, qy.sort!);
  const slice = order.slice((page - 1) * size, page * size);
  const rows = slice.length ? db.all<any>(`SELECT ${LIST_COLS}, ${LIST_FAV} FROM products WHERE guid IN (${slice.map(() => '?').join(',')})`, slice) : [];
  const m = new Map(rows.map(x => [x.guid, x]));
  const items = slice.map(g => m.get(g)).filter(Boolean).map(x => { const h = r.scores.get(x.guid)!; return { ...hydrateList(x), match: { score: h.score, reasons: h.reasons, hl: h.hl, partial: h.partial } }; });
  return { total: order.length, page, pageSize: size, items, search: { mode: r.parsed.mode, keywords: r.parsed.keywords, concepts: r.parsed.concepts.map(c => ({ label: c.label, alts: c.alts.filter(a => a.kind !== 'exact').slice(0, 6).map(a => ({ text: a.text, kind: a.kind })) })), constraints: r.parsed.constraints, chips, similarTo: r.similarTo, weak: r.weak, strict: r.strict, tookMs: r.tookMs } };
}
/** v1.3 及以前的 LIKE 检索（保留用于搜索评测的“修复前”基线） */
export function queryProductsLegacy(db: DB, qy: Query) {
  const params: any[] = []; const where: string[] = [compile(qy.filter, params)];
  if (qy.q) { const terms = qy.q.trim().split(/\s+/).filter(Boolean); for (const t of terms) { where.push(`(name LIKE ? ESCAPE '\\' OR tagline LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR domain LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\')`); params.push(...Array(5).fill(like(t))); } }
  if (qy.category) { const ids = [qy.category, ...CATEGORIES.filter(c => c.parent === qy.category).map(c => c.id)]; where.push(`category IN (${ids.map(() => '?').join(',')})`); params.push(...ids); }
  const w = where.join(' AND ');
  const total = db.get<any>(`SELECT COUNT(*) c FROM products WHERE ${w}`, params).c;
  const size = Math.min(Math.max(qy.pageSize || 50, 1), 1000); const page = Math.max(qy.page || 1, 1);
  // 有关键词时：名称完全匹配 > 名称开头 > 名称包含 > 仅简介/描述匹配，其次再按所选排序
  const q0 = qy.q?.trim(); const rank = q0 ? `CASE WHEN lower(name)=lower(?) THEN 0 WHEN name LIKE ? ESCAPE '\\' THEN 1 WHEN name LIKE ? ESCAPE '\\' THEN 2 ELSE 3 END, ` : '';
  const rp = q0 ? [q0, q0.replace(/[%_\\]/g, m => '\\' + m) + '%', like(q0)] : [];
  const rows = db.all(`SELECT ${LIST_COLS}, EXISTS(SELECT 1 FROM favorites f WHERE f.product_guid=products.guid) AS favorite FROM products WHERE ${w} ORDER BY ${rank}${SORTS[qy.sort || 'updated'] || SORTS.updated} LIMIT ? OFFSET ?`, [...params, ...rp, size, (page - 1) * size]).map(hydrateList);
  return { total, page, pageSize: size, items: rows };
}
