import { DB, now } from './db';
import { productDedupKey, productGuid, hostOf, normalizeUrl, sha1, safeJson, decodeEntities } from './util';
import { classify, autoTags } from './taxonomy';
import { localEmbed } from './ai';
import { resolveAlias, findDuplicate, nameKey } from './dedup';

export interface ProductInput {
  name: string; url?: string | null; tagline?: string | null; description?: string | null; category?: string | null;
  tags?: string[] | string | null; logo_url?: string | null; pricing?: string | null; platforms?: string[] | string | null;
  maker?: string | null; country?: string | null; launch_date?: string | null; votes?: number | null; notes?: string | null;
}
export interface UpsertResult { guid: string; status: 'inserted' | 'updated' | 'unchanged'; newVersion: boolean }

const arr = (v: any): string[] => Array.isArray(v) ? v.map(String).filter(Boolean) : typeof v === 'string' && v.trim() ? (v.trim().startsWith('[') ? safeJson<string[]>(v, []) : v.split(/[,，;；|]/).map(s => s.trim()).filter(Boolean)) : [];

/** 插入或合并产品（去重：规范化域名/URL → 稳定 GUID），并记录一次发布版本 */
export function upsertProduct(db: DB, input: ProductInput, opts: { sourceGuid?: string | null; origin?: string; versionLabel?: string } = {}): UpsertResult {
  input = { ...input, ...(input.tagline ? { tagline: decodeEntities(input.tagline) } : {}), ...(input.description ? { description: decodeEntities(input.description) } : {}) };
  const name = decodeEntities(String(input.name || '')).trim(); if (!name) throw new Error('产品名称不能为空');
  const url = normalizeUrl(input.url);
  const key = productDedupKey({ name, url });
  // 去重：被合并过的 guid 走别名；新条目先按统一规则（dedup.ts）找已有的同一产品
  let guid = resolveAlias(db, productGuid(key));
  if (!db.get<any>('SELECT 1 x FROM products WHERE guid=?', [guid])) {
    const dup = findDuplicate(db, { guid, name, key, url });
    if (dup) { db.run('INSERT OR IGNORE INTO product_alias(alias, guid) VALUES(?,?)', [guid, dup.guid]); guid = dup.guid; }
  }
  const ts = now();
  const text = [name, input.tagline, input.description].filter(Boolean).join(' ');
  const contentHash = sha1(JSON.stringify([name, url, input.tagline || '', input.description || '', input.launch_date || '']));
  const existing = db.get<any>('SELECT * FROM products WHERE guid=?', [guid]);
  const tags = arr(input.tags); const platforms = arr(input.platforms);
  let status: UpsertResult['status'];
  if (!existing) {
    const allTags = [...new Set([...tags, ...autoTags(text)])];
    db.run(`INSERT INTO products(guid,dedup_key,name,url,domain,tagline,description,category,tags,logo_url,pricing,platforms,maker,country,launch_date,first_seen,last_seen,votes,launch_count,embedding,origin,notes,content_hash,created_at,updated_at,name_key)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?)`,
      [guid, key, name, url, hostOf(url), input.tagline, input.description, input.category || classify(text), JSON.stringify(allTags), input.logo_url, input.pricing,
        JSON.stringify(platforms), input.maker, input.country, input.launch_date || ts.slice(0, 10), ts, ts, input.votes || 0, JSON.stringify(localEmbed(text)), opts.origin || 'crawl', input.notes, contentHash, ts, ts, nameKey(name)]);
    status = 'inserted';
  } else {
    // 合并：只用新值补全/覆盖非空字段，保留人工编辑过的内容
    const merged: any = {
      tagline: existing.tagline || input.tagline, description: (input.description && (!existing.description || input.description.length > existing.description.length)) ? input.description : existing.description,
      logo_url: existing.logo_url || input.logo_url, pricing: existing.pricing || input.pricing, maker: existing.maker || input.maker, country: existing.country || input.country,
      tags: JSON.stringify([...new Set([...safeJson<string[]>(existing.tags, []), ...tags])]), platforms: JSON.stringify([...new Set([...safeJson<string[]>(existing.platforms, []), ...platforms])]),
      votes: Math.max(existing.votes || 0, input.votes || 0), url: existing.url || url,
    };
    const changed = existing.content_hash !== contentHash;
    const t2 = [name, merged.tagline, merged.description].filter(Boolean).join(' ');
    db.run(`UPDATE products SET tagline=?,description=?,logo_url=?,pricing=?,maker=?,country=?,tags=?,platforms=?,votes=?,url=?,domain=?,last_seen=?,content_hash=?,embedding=?,updated_at=? WHERE guid=?`,
      [merged.tagline, merged.description, merged.logo_url, merged.pricing, merged.maker, merged.country, merged.tags, merged.platforms, merged.votes, merged.url, hostOf(merged.url), ts, contentHash,
        changed ? JSON.stringify(localEmbed(t2)) : existing.embedding, changed ? ts : existing.updated_at, guid]);
    status = changed ? 'updated' : 'unchanged';
  }
  const before = db.get<any>('SELECT COUNT(*) c FROM product_versions WHERE product_guid=?', [guid]).c;
  db.run(`INSERT OR IGNORE INTO product_versions(product_guid,source_guid,version_label,launched_at,url,votes,snapshot,content_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
    [guid, opts.sourceGuid || null, opts.versionLabel || null, input.launch_date || ts.slice(0, 10), url, input.votes || 0, JSON.stringify({ ...input, name }), contentHash, ts]);
  const after = db.get<any>('SELECT COUNT(*) c FROM product_versions WHERE product_guid=?', [guid]).c;
  db.run('UPDATE products SET launch_count=? WHERE guid=?', [after, guid]);
  return { guid, status, newVersion: after > before };
}

/** 列表/分页默认列：不含 description / enrich_json / embedding / ai_analysis 等大字段 */
export const LIST_COLS_BASE = 'guid,name,url,domain,tagline,category,tags,logo_url,logo_local,pricing,platforms,maker,country,launch_date,first_seen,last_seen,votes,launch_count,origin,updated_at,created_at,enrich_status';
export const LIST_COLS = `${LIST_COLS_BASE},(ai_summary IS NOT NULL AND ai_summary<>'') AS has_summary`;
export const LIST_FAV = `(guid IN (SELECT product_guid FROM favorites)) AS favorite`;
export function hydrate(p: any) {
  if (!p) return p; const { embedding, ...rest } = p;
  return { ...rest, favorite: !!p.favorite, tags: safeJson(p.tags, []), platforms: safeJson(p.platforms, []), ai_analysis: safeJson(p.ai_analysis, null), enrich: safeJson(p.enrich_json, null), enrich_json: undefined };
}
/** 列表行：不解析 enrich_json / ai_analysis，减小主线程 JSON 与 IPC 体积 */
export function hydrateList(p: any) {
  if (!p) return p;
  const { embedding, description, enrich_json, ai_analysis, notes, ai_summary, ...rest } = p;
  return { ...rest, favorite: !!p.favorite, tags: safeJson(p.tags, []), platforms: safeJson(p.platforms, []), has_summary: !!(p.has_summary || ai_summary) };
}
export function getProduct(db: DB, guid: string) {
  const p = db.get('SELECT *, (guid IN (SELECT product_guid FROM favorites)) AS favorite FROM products WHERE guid=?', [guid]); if (!p) return null;
  const versions = db.all(`SELECT v.*, s.name source_name FROM product_versions v LEFT JOIN sources s ON s.guid=v.source_guid WHERE product_guid=? ORDER BY launched_at DESC, id DESC`, [guid])
    .map((v: any) => ({ ...v, snapshot: safeJson(v.snapshot, {}) }));
  return { ...hydrate(p), versions };
}
const EDITABLE = ['name', 'url', 'tagline', 'description', 'category', 'tags', 'logo_url', 'pricing', 'platforms', 'maker', 'country', 'launch_date', 'notes', 'ai_summary'];
export function updateProduct(db: DB, guid: string, patch: any) {
  const sets: string[] = [], vals: any[] = [];
  for (const k of EDITABLE) if (k in patch) { sets.push(`${k}=?`); vals.push(k === 'tags' || k === 'platforms' ? JSON.stringify(arr(patch[k])) : patch[k]); if (k === 'url') { sets.push('domain=?'); vals.push(hostOf(patch[k])); } }
  if (!sets.length) return getProduct(db, guid);
  sets.push('updated_at=?'); vals.push(now()); vals.push(guid);
  db.run(`UPDATE products SET ${sets.join(',')} WHERE guid=?`, vals);
  return getProduct(db, guid);
}
export function deleteProduct(db: DB, guid: string) { db.tx(() => { db.run('DELETE FROM product_versions WHERE product_guid=?', [guid]); db.run('DELETE FROM products WHERE guid=?', [guid]); }); }

/** 手动合并两个重复产品：把 from 的版本记录并入 into */
export function mergeProducts(db: DB, intoGuid: string, fromGuid: string) {
  db.tx(() => {
    db.run('UPDATE OR IGNORE product_versions SET product_guid=? WHERE product_guid=?', [intoGuid, fromGuid]);
    db.run('DELETE FROM product_versions WHERE product_guid=?', [fromGuid]);
    db.run('DELETE FROM products WHERE guid=?', [fromGuid]);
    const c = db.get<any>('SELECT COUNT(*) c FROM product_versions WHERE product_guid=?', [intoGuid]).c;
    db.run('UPDATE products SET launch_count=? WHERE guid=?', [c, intoGuid]);
  });
  return getProduct(db, intoGuid);
}
/** 疑似重复（同名不同域名） */
export function findDuplicateCandidates(db: DB) {
  const rows = db.all<any>('SELECT guid,name,domain FROM products');
  const by = new Map<string, any[]>();
  for (const r of rows) { const k = String(r.name).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, ''); if (!k) continue; (by.get(k) || by.set(k, []).get(k)!).push(r); }
  return [...by.values()].filter(g => g.length > 1);
}
