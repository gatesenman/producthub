import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { DB } from './db';
import { upsertProduct } from './products';
import { queryProducts, Query } from './filter';
import { categoryName, CATEGORIES } from './taxonomy';

export const EXPORT_COLS: [string, string][] = [['guid', 'GUID'], ['name', '名称'], ['url', '网址'], ['domain', '域名'], ['tagline', '一句话简介'], ['description', '描述'], ['category', '分类'], ['tags', '标签'], ['platforms', '平台'], ['pricing', '定价'], ['maker', '开发者'], ['country', '国家/地区'], ['launch_date', '发布日期'], ['first_seen', '首次收录'], ['last_seen', '最近出现'], ['votes', '票数'], ['launch_count', '发布次数'], ['ai_summary', 'AI 总结'], ['origin', '来源方式'], ['logo_url', '图片']];

function rowsFor(db: DB, q: Query) { return queryProducts(db, { ...q, page: 1, pageSize: 1000000 }).items; }
function flat(p: any) { const o: any = {}; for (const [k, label] of EXPORT_COLS) { let v = p[k]; if (Array.isArray(v)) v = v.join(', '); if (k === 'category') v = categoryName(v); let s = v == null ? '' : String(v); if (s.length > 32767) s = s.slice(0, 32764) + '...'; o[label] = s; } return o; }

export function exportProducts(db: DB, format: 'json' | 'csv' | 'xlsx', q: Query = {}): { body: Buffer | string; mime: string; ext: string } {
  const rows = rowsFor(db, q);
  if (format === 'json') { const full = rows.map(p => ({ ...p, versions: db.all('SELECT source_guid,version_label,launched_at,url,votes FROM product_versions WHERE product_guid=?', [p.guid]) })); return { body: JSON.stringify({ exported_at: new Date().toISOString(), count: rows.length, products: full }, null, 2), mime: 'application/json', ext: 'json' }; }
  if (format === 'csv') return { body: '\uFEFF' + Papa.unparse(rows.map(flat)), mime: 'text/csv; charset=utf-8', ext: 'csv' };
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(flat)), '产品');
  return { body: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
}

const REV: Record<string, string> = Object.fromEntries(EXPORT_COLS.flatMap(([k, l]) => [[l, k], [k, k]]));
const catId = (v: string) => CATEGORIES.find(c => c.id === v || c.name === v)?.id || undefined;
export function importProducts(db: DB, format: 'json' | 'csv' | 'xlsx', data: Buffer | string) {
  let rows: any[] = [];
  if (format === 'json') { const j = JSON.parse(data.toString()); rows = Array.isArray(j) ? j : j.products || []; }
  else if (format === 'csv') rows = Papa.parse<any>(data.toString().replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true }).data;
  else { const wb = XLSX.read(data, { type: 'buffer' }); rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]); }
  let inserted = 0, updated = 0, skipped = 0; const errors: string[] = [];
  db.tx(() => rows.forEach((raw, i) => {
    const r: any = {}; for (const [k, v] of Object.entries(raw)) { const key = REV[k.trim()]; if (key) r[key] = v; }
    if (!r.name) { skipped++; return; }
    try { const res = upsertProduct(db, { ...r, category: r.category ? catId(String(r.category)) : undefined, votes: r.votes ? Number(r.votes) : undefined }, { origin: 'import' });
      if (r.ai_summary) db.run('UPDATE products SET ai_summary=COALESCE(ai_summary, ?) WHERE guid=?', [r.ai_summary, res.guid]);
      res.status === 'inserted' ? inserted++ : updated++; } catch (e) { errors.push(`第 ${i + 1} 行: ${(e as Error).message}`); }
  }));
  return { total: rows.length, inserted, updated, skipped, errors };
}
