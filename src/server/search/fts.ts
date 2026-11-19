/** v1.8：FTS5 候选召回（磁盘索引）+ 增量同步。精排仍由 engine.ts 的 BM25F/约束/理由逻辑在候选子集上完成 */
import type { DB } from '../db';
import { safeJson } from '../util';
import { fieldTokens, type SearchOpts } from './engine';
import { normalize, docTokens, isGenericProductName, looksLikeAlternativesList } from './text';
import type { Parsed } from './nlq';
import { findSimilar } from '../ai';

const FCOLS = ['name', 'py', 'domain', 'tagline', 'tags', 'enrich', 'descr'] as const;
const W = '3.2, 2.6, 2.2, 2.0, 1.5, 1.2, 1.0';
const PER_ALT = 400, MAX_CAND = 3000;
let countCache: { rev: number; n: number } | null = null;

export function useFts(db: DB, o: SearchOpts = {}): boolean {
  if (o.fullIndex) return false;
  if (!countCache || countCache.rev !== db.rev) countCache = { rev: db.rev, n: db.get<any>('SELECT COUNT(*) n FROM products')?.n || 0 };
  return countCache.n > 20000;
}
function rowText(r: any): string[] {
  const t = fieldTokens(r, safeJson(r.tags, []), safeJson<any>(r.enrich_json, null));
  return [t.name, t.py, t.domain, t.tagline, t.tags, t.enrich, t.desc].map(a => a.join(' '));
}
/** 同步待更新队列；返回同步行数 */
export function syncFts(db: DB, max = Infinity): number {
  let done = 0;
  while (done < max) {
    const ids = db.all<any>('SELECT rid FROM fts_queue LIMIT 5000').map(r => r.rid); if (!ids.length) break;
    db.tx(() => {
      const rows = db.all<any>(`SELECT rowid rid, name, tagline, description, tags, category, domain, enrich_json FROM products WHERE rowid IN (${ids.map(() => '?').join(',')})`, ids);
      for (const id of ids) db.run('DELETE FROM products_fts WHERE rowid=?', [id]);
      for (const r of rows) db.run(`INSERT INTO products_fts(rowid, ${FCOLS.join(',')}) VALUES (?,?,?,?,?,?,?,?)`, [r.rid, ...rowText(r)]);
      db.run(`DELETE FROM fts_queue WHERE rid IN (${ids.map(() => '?').join(',')})`, ids);
    });
    done += ids.length;
  }
  return done;
}
export function rebuildFts(db: DB) {
  db.run('DELETE FROM products_fts'); db.run('INSERT OR IGNORE INTO fts_queue(rid) SELECT rowid FROM products');
  const n = syncFts(db); db.run("INSERT INTO products_fts(products_fts) VALUES('optimize')"); return n;
}
const quote = (t: string) => '"' + t.replace(/"/g, '""') + '"';
/** 由解析后的概念生成候选 rowid：每个候选词（同义/跨语言/拼音）各取 bm25 前 N，再并入名称精确匹配 */
export function ftsCandidates(db: DB, parsed: Parsed, q: string, o: SearchOpts = {}): number[] {
  if (db.get<any>('SELECT 1 x FROM fts_queue LIMIT 1')) syncFts(db, 50000);
  const out = new Set<number>();
  const add = (expr: string, lim: number) => { try { for (const r of db.all<any>(`SELECT rowid r FROM products_fts WHERE products_fts MATCH ? ORDER BY bm25(products_fts, ${W}) LIMIT ${lim}`, [expr])) out.add(r.r); } catch { /* 非法表达式忽略 */ } };
  const concepts = [...parsed.concepts]; if (parsed.similarTo) concepts.push(...[]);
  for (const c of concepts) for (const a of c.alts) {
    if (!a.toks.length) continue;
    add(a.toks.map(quote).join(' AND '), PER_ALT);
    const last = a.toks[a.toks.length - 1];
    if (/^[a-z0-9]{3,}$/.test(last)) add([...a.toks.slice(0, -1).map(quote), quote(last) + '*'].join(' AND '), 150);
    if (out.size > MAX_CAND) break;
  }
  // 多概念：再取全部概念同时命中的前 N（保证严格匹配不被各自的 top-N 截断）
  if (concepts.length > 1) add(concepts.map(c => '(' + c.alts.filter(a => a.toks.length).map(a => '(' + a.toks.map(quote).join(' AND ') + ')').join(' OR ') + ')').filter(x => x !== '()').join(' AND '), 800);
  const qn = normalize(q).trim();
  if (qn) for (const r of db.all<any>('SELECT rowid r FROM products WHERE name = ? COLLATE NOCASE LIMIT 20', [q.trim()])) out.add(r.r);
  if (!concepts.length) for (const r of db.all<any>('SELECT rowid r FROM products ORDER BY votes DESC, launch_count DESC LIMIT 3000')) out.add(r.r);
  if (parsed.similarTo) {
    const rawName = parsed.similarTo.trim();
    const cands = db.all<any>('SELECT rowid r, guid, name, domain, tagline, description, category, launch_count, votes FROM products WHERE name = ? COLLATE NOCASE LIMIT 30', [rawName]);
    const scoreT = (r: any) => {
      let s = 0; const d = (r.domain || '').toLowerCase(); const n = normalize(r.name).trim();
      if (d && (d === n + '.com' || d === n + '.so' || d === n + '.io' || d.startsWith(n + '.'))) s += 12;
      if (looksLikeAlternativesList(r.tagline || '', r.description || '')) s -= 25;
      if (isGenericProductName(r.name)) s -= 30;
      if (!d) s -= 4;
      if (/producthunt\.com|github\.com|affiliate\./i.test(d)) s -= 3;
      s += 0.5 * Math.log1p(r.votes || 0) + 0.2 * Math.min(r.launch_count || 1, 10);
      return s;
    };
    const tg = [...cands].sort((a, b) => scoreT(b) - scoreT(a)).slice(0, 5);
    for (const r of tg) out.add(r.r);
    const sn = normalize(parsed.similarTo).trim();
    // alt_rel 产品优先入候选；过滤类目名
    for (const r of db.all<any>('SELECT p.rowid r, p.name FROM alt_rel a JOIN products p ON p.guid = a.product_guid WHERE a.target = ? LIMIT 1500', [sn])) {
      if (!isGenericProductName(r.name)) out.add(r.r);
    }
    add(`${quote(sn)} AND ("alternative" OR "alternatives" OR "替代" OR "replace" OR "vs")`, 400);
    if (tg[0]) { const sims = tg.slice(0, 3).flatMap(t => findSimilar(db, { guid: t.guid, limit: 200 }).map((x: any) => x.guid));
      for (let i = 0; i < sims.length; i += 500) { const ch = sims.slice(i, i + 500); for (const r of db.all<any>(`SELECT rowid r FROM products WHERE guid IN (${ch.map(() => '?').join(',')})`, ch)) out.add(r.r); } }
    else for (const r of db.all<any>('SELECT rowid r FROM products_fts WHERE products_fts MATCH ? LIMIT 400', [quote(sn)])) out.add(r.r); }
  return [...out].sort((a, b) => a - b);
}
/** “相似产品”候选：用文本的 token（OR）在 FTS 中取 bm25 前 N */
export function ftsByText(db: DB, text: string, lim = 3000): number[] {
  if (db.get<any>('SELECT 1 x FROM fts_queue LIMIT 1')) syncFts(db, 50000);
  const toks = [...new Set(docTokens(text))].filter(t => t.length > 1).slice(0, 24); if (!toks.length) return [];
  try { return db.all<any>(`SELECT rowid r FROM products_fts WHERE products_fts MATCH ? ORDER BY bm25(products_fts, ${W}) LIMIT ${lim}`, [toks.map(quote).join(' OR ')]).map(r => r.r); } catch { return []; }
}
