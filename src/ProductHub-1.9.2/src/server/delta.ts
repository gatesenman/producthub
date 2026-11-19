/**
 * 产品库增量包（producthub-delta v2，兼容读取 v1）
 * - 打包：自上一个包的 until 以来新增/更新的产品 + 删除墓碑 + versions / alt_rel / sources 元数据；
 *   带序号链（from.seq → to.seq）与 body sha256 校验和；索引 index.json 列出全部包（文件 sha256/大小）
 * - 下载：断点续传（HTTP Range，.part 临时文件），sha256 + 大小校验通过才落盘，失败自动重试
 * - 应用：单事务（任一错误整体回滚，库不变）；序号校验（重复导入幂等 / 不连续拒绝 / 累积包可跳过中间版本）；
 *   不覆盖收藏、筛选、备注；origin=manual 只补空字段；保留本地来源设置；同步 FTS 与 alt_rel
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { DB, now } from './db';
import { upsertSource } from './sources';
import { safeJson, hostOf, normalizeUrl, productDedupKey, productGuid, sha1 } from './util';
import { classify, autoTags } from './taxonomy';
import { localEmbed } from './ai';
import { syncFts } from './search/fts';
import { resolveAlias, findDuplicate, mergeInto, nameKey } from './dedup';

export const DELTA_FORMAT = 'producthub-delta';
export const DELTA_INDEX_FORMAT = 'producthub-delta-index';
export const DELTA_VERSION = 2;
export const SUPPORTED_VERSIONS = [1, 2];
export const DEFAULT_DATASET = 'producthub-main';

export type DeltaVersion = { source_guid?: string | null; version_label?: string | null; launched_at?: string | null; url?: string | null; votes?: number | null; content_hash?: string | null; snapshot?: any };
export type DeltaProduct = {
  guid: string; dedup_key?: string | null; name: string; url?: string | null; tagline?: string | null; description?: string | null; category?: string | null;
  tags?: string | string[]; logo_url?: string | null; pricing?: string | null; platforms?: string | string[]; maker?: string | null; country?: string | null;
  launch_date?: string | null; votes?: number | null; origin?: string | null; first_seen?: string | null; last_seen?: string | null; created_at?: string | null; updated_at?: string | null;
  versions?: DeltaVersion[];
};
export type DeltaTombstone = { guid: string; dedup_key?: string | null; deleted_at?: string | null; reason?: string | null; merged_into?: string | null };
export type DeltaPack = {
  format: typeof DELTA_FORMAT; version: number; dataset?: string; generated_at: string;
  from: { since: string; seed_version?: string | null; seq?: number };
  to: { until: string; seed_version?: string | null; product_count?: number; seq?: number };
  counts: { products: number; deleted?: number; versions: number; alt_rel: number; alt_rel_deleted?: number; sources: number };
  checksum?: { algo: 'sha256'; body: string };
  products: DeltaProduct[];
  deleted?: DeltaTombstone[];
  alt_rel?: Array<{ target: string; product_guid: string; src?: string | null }>;
  alt_rel_deleted?: Array<{ target: string; product_guid: string }>;
  sources?: Array<Record<string, any>>;
};
export type ApplyResult = {
  merged?: number; deduped?: number;
  status: 'applied' | 'already-applied' | 'legacy-applied';
  inserted: number; updated: number; unchanged: number; skipped_manual: number; deleted: number; delete_protected: number;
  versions_added: number; alt_rel_added: number; alt_rel_removed: number; sources_upserted: number; fts_synced: number;
  errors: string[]; from: DeltaPack['from']; to: DeltaPack['to'];
  product_count_before: number; product_count_after: number; seq_before: number; seq_after: number; ms: number;
};
export type PackOpts = { since: string; until?: string; seedVersionFrom?: string | null; seedVersionTo?: string | null; fromSeq?: number; toSeq?: number; dataset?: string; limit?: number; includeDeleted?: boolean; deletedSince?: string };

export { TOMBSTONE_SCHEMA } from './db';

const PRODUCT_COLS = `guid,dedup_key,name,url,tagline,description,category,tags,logo_url,pricing,platforms,maker,country,launch_date,votes,origin,first_seen,last_seen,updated_at,created_at`;
const chunk = <T,>(arr: T[], n: number) => { const out: T[][] = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

export function bodyChecksum(p: Pick<DeltaPack, 'products' | 'deleted' | 'alt_rel' | 'alt_rel_deleted' | 'sources'>): string {
  return crypto.createHash('sha256').update(JSON.stringify([p.products || [], p.deleted || [], p.alt_rel || [], p.alt_rel_deleted || [], p.sources || []])).digest('hex');
}
export const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');

/** 从库中抽取自 since 以来新增/更新的产品、删除墓碑及附属数据 */
export function buildDeltaPack(db: DB, opts: PackOpts): DeltaPack {
  const since = opts.since; const until = opts.until || now();
  const lim = opts.limit && opts.limit > 0 ? ` LIMIT ${Number(opts.limit)}` : '';
  const rows = db.all<any>(`SELECT ${PRODUCT_COLS} FROM products WHERE (created_at >= ? OR updated_at >= ?) AND COALESCE(updated_at, created_at) < ? AND origin <> 'manual' ORDER BY COALESCE(updated_at, created_at) ASC${lim}`, [since, since, until]);
  const guids = rows.map(r => r.guid); const products: DeltaProduct[] = []; let versionCount = 0; const sourceGuids = new Set<string>();
  const versionsBy = new Map<string, any[]>();
  for (const part of chunk(guids, 400)) {
    const vs = db.all<any>(`SELECT product_guid,source_guid,version_label,launched_at,url,votes,content_hash,snapshot FROM product_versions WHERE product_guid IN (${part.map(() => '?').join(',')})`, part);
    for (const v of vs) { const l = versionsBy.get(v.product_guid) || []; l.push(v); versionsBy.set(v.product_guid, l); if (v.source_guid) sourceGuids.add(v.source_guid); versionCount++; }
  }
  for (const r of rows) products.push({
    guid: r.guid, dedup_key: r.dedup_key, name: r.name, url: r.url, tagline: r.tagline, description: r.description, category: r.category,
    tags: safeJson(r.tags, []), logo_url: r.logo_url, pricing: r.pricing, platforms: safeJson(r.platforms, []), maker: r.maker, country: r.country,
    launch_date: r.launch_date, votes: r.votes, origin: r.origin, first_seen: r.first_seen, last_seen: r.last_seen, created_at: r.created_at, updated_at: r.updated_at,
    versions: (versionsBy.get(r.guid) || []).map(v => ({ source_guid: v.source_guid, version_label: v.version_label, launched_at: v.launched_at, url: v.url, votes: v.votes, content_hash: v.content_hash, snapshot: typeof v.snapshot === 'string' ? safeJson(v.snapshot, v.snapshot) : v.snapshot })),
  });
  let alt_rel: NonNullable<DeltaPack['alt_rel']> = [];
  for (const part of chunk(guids, 400)) { const ph = part.map(() => '?').join(','); alt_rel.push(...db.all<any>(`SELECT target, product_guid, src FROM alt_rel WHERE product_guid IN (${ph})`, part)); }
  const seenAlt = new Set<string>(); alt_rel = alt_rel.filter(a => { const k = a.target + '\0' + a.product_guid; if (seenAlt.has(k)) return false; seenAlt.add(k); return true; });
  ensureTombstones(db);
  const withDel = opts.includeDeleted ?? !lim;
  const deleted: DeltaTombstone[] = !withDel ? [] : db.all<any>(`SELECT d.guid, d.dedup_key, d.deleted_at, d.merged_into FROM deleted_products d WHERE d.deleted_at >= ? AND d.deleted_at < ? AND NOT EXISTS (SELECT 1 FROM products p WHERE p.guid=d.guid)`, [opts.deletedSince || since, until]);
  const alt_rel_deleted = !withDel ? [] : db.all<any>(`SELECT target, product_guid FROM deleted_alt_rel d WHERE deleted_at >= ? AND deleted_at < ? AND NOT EXISTS (SELECT 1 FROM alt_rel a WHERE a.target=d.target AND a.product_guid=d.product_guid)`, [opts.deletedSince || since, until]);
  const sources: NonNullable<DeltaPack['sources']> = [];
  for (const part of chunk([...sourceGuids], 400)) sources.push(...db.all<any>(`SELECT guid,seq,name,url,host,category,region,intro,submit_mode,traffic,verify_status,interval_min FROM sources WHERE guid IN (${part.map(() => '?').join(',')})`, part));
  const total = db.get<any>('SELECT COUNT(*) c FROM products')?.c ?? products.length;
  const body = { products, deleted, alt_rel, alt_rel_deleted, sources };
  return {
    format: DELTA_FORMAT, version: DELTA_VERSION, dataset: opts.dataset || DEFAULT_DATASET, generated_at: now(),
    from: { since, seed_version: opts.seedVersionFrom || null, seq: opts.fromSeq ?? 0 },
    to: { until, seed_version: opts.seedVersionTo || null, product_count: total, seq: opts.toSeq ?? (opts.fromSeq ?? 0) + 1 },
    counts: { products: products.length, deleted: deleted.length, versions: versionCount, alt_rel: alt_rel.length, alt_rel_deleted: alt_rel_deleted.length, sources: sources.length },
    checksum: { algo: 'sha256', body: bodyChecksum(body) },
    ...body,
  };
}

export function serializeDelta(pack: DeltaPack): Buffer { return Buffer.from(JSON.stringify(pack)); }
export function writeDeltaFile(pack: DeltaPack, outPath: string): { bytes: number; gzip: boolean; sha256: string } {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const raw = serializeDelta(pack); const out = outPath.endsWith('.gz') ? zlib.gzipSync(raw, { level: 9 }) : raw;
  const tmp = outPath + '.tmp'; fs.writeFileSync(tmp, out); fs.renameSync(tmp, outPath);
  return { bytes: out.length, gzip: outPath.endsWith('.gz'), sha256: sha256(out) };
}

export class DeltaError extends Error { constructor(public code: string, message: string) { super(message); } }

/** 解析并校验增量包（.json / .json.gz / Buffer / 对象）；v2 必须通过 body 校验和 */
export function parseDelta(input: Buffer | string | DeltaPack, expect?: { sha256?: string; size?: number }): DeltaPack {
  if (input && typeof input === 'object' && !Buffer.isBuffer(input) && (input as DeltaPack).format) return validatePack(input as DeltaPack);
  let buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  if (expect?.size != null && buf.length !== expect.size) throw new DeltaError('size', `增量包大小不符：期望 ${expect.size} 字节，实际 ${buf.length}（可能下载不完整）`);
  if (expect?.sha256 && sha256(buf) !== expect.sha256.toLowerCase()) throw new DeltaError('sha256', '增量包 SHA256 校验失败（文件损坏或被篡改）');
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) { try { buf = zlib.gunzipSync(buf); } catch (e) { throw new DeltaError('corrupt', '增量包 gzip 解压失败（文件损坏或不完整）：' + (e as Error).message); } }
  let j: any; try { j = JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, '')); } catch (e) { throw new DeltaError('corrupt', '增量包不是合法 JSON（文件损坏或不完整）：' + (e as Error).message); }
  return validatePack(j);
}
function validatePack(j: any): DeltaPack {
  if (!j || j.format !== DELTA_FORMAT) throw new DeltaError('format', `不支持的增量包格式（需要 ${DELTA_FORMAT}）`);
  if (!SUPPORTED_VERSIONS.includes(Number(j.version))) throw new DeltaError('version', `不支持的增量包版本：${j.version}（当前支持 ${SUPPORTED_VERSIONS.join('/')}），请升级应用`);
  if (!Array.isArray(j.products)) throw new DeltaError('corrupt', '增量包缺少 products 数组');
  if (!j.from?.since) throw new DeltaError('corrupt', '增量包缺少 from.since');
  if (Number(j.version) >= 2) {
    if (!j.checksum?.body) throw new DeltaError('checksum', '增量包缺少校验和');
    if (bodyChecksum(j) !== j.checksum.body) throw new DeltaError('checksum', '增量包内容校验和不匹配（数据被修改或损坏）');
    if (!Number.isInteger(j.from?.seq) || !Number.isInteger(j.to?.seq) || j.to.seq <= j.from.seq) throw new DeltaError('seq', '增量包序号无效');
    for (const p of j.products) if (!p || typeof p.guid !== 'string' || !p.name) throw new DeltaError('corrupt', '增量包产品条目缺少 guid/name');
  }
  return j as DeltaPack;
}

export function ensureTombstones(_db: DB) { /* DB 构造时已建墓碑表与触发器（db.ts TOMBSTONE_SCHEMA） */ }
export const localSeq = (db: DB) => Number(db.getSetting('delta.seq', '0')) || 0;
export const localDataset = (db: DB) => db.getSetting('delta.dataset', DEFAULT_DATASET) || DEFAULT_DATASET;

export type ApplyProgress = (p: { phase: string; done: number; total: number; message?: string }) => void;

/** 合并产品：按包内 guid 定位；manual 只补空；永不写 notes/收藏/AI 字段 */
const SEL_EXISTING = 'SELECT guid, origin, name, url, tagline, description, category, tags, platforms, logo_url, pricing, maker, country, launch_date, votes, content_hash, embedding, updated_at FROM products WHERE guid=?';
/** 返回包内产品在本地实际落到的 guid（别名/去重后可能与包内 guid 不同） */
function mergeProduct(db: DB, p: DeltaProduct, r: ApplyResult, ts: string): string {
  const url = normalizeUrl(p.url);
  let g = resolveAlias(db, p.guid);
  let existing = db.get<any>(SEL_EXISTING, [g]);
  if (!existing) {
    // 去重：同 dedup_key（规范化 URL）或按统一规则判为同一产品 → 并入本地已有条目，记别名，不新增重复
    const key = p.dedup_key || productDedupKey({ name: p.name, url });
    const clash = db.get<any>('SELECT guid FROM products WHERE dedup_key=?', [key]) || findDuplicate(db, { guid: g, name: p.name, key, url });
    if (clash) { db.run('INSERT OR REPLACE INTO product_alias(alias, guid) VALUES(?,?)', [p.guid, clash.guid]); g = clash.guid; existing = db.get<any>(SEL_EXISTING, [g]); r.deduped = (r.deduped || 0) + 1; }
  }
  p = { ...p, guid: g };
  const tags = Array.isArray(p.tags) ? p.tags : safeJson<string[]>(p.tags, []); const platforms = Array.isArray(p.platforms) ? p.platforms : safeJson<string[]>(p.platforms, []);
  if (existing && existing.origin === 'manual') {
    const sets: string[] = []; const vals: any[] = [];
    const fill = (col: string, val: any) => { if (val == null || val === '') return; const cur = existing[col]; if (cur == null || cur === '') { sets.push(`${col}=?`); vals.push(val); } };
    fill('url', url); fill('tagline', p.tagline); fill('description', p.description); fill('logo_url', p.logo_url); fill('pricing', p.pricing); fill('maker', p.maker); fill('country', p.country);
    if (url && !existing.url) { sets.push('domain=?'); vals.push(hostOf(url)); }
    if (sets.length) { db.run(`UPDATE products SET ${sets.join(',')}, updated_at=? WHERE guid=?`, [...vals, ts, p.guid]); r.updated++; } else r.skipped_manual++;
    return g;
  }
  const text = [p.name, p.tagline, p.description].filter(Boolean).join(' ');
  const contentHash = sha1(JSON.stringify([p.name, url, p.tagline || '', p.description || '', p.launch_date || '']));
  if (!existing) {
    const key = p.dedup_key || productDedupKey({ name: p.name, url });
    db.run(`INSERT INTO products(guid,dedup_key,name,url,domain,tagline,description,category,tags,logo_url,pricing,platforms,maker,country,launch_date,first_seen,last_seen,votes,launch_count,embedding,origin,content_hash,created_at,updated_at,name_key)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)`,
      [p.guid, key, p.name, url, hostOf(url), p.tagline, p.description, p.category || classify(text), JSON.stringify(tags.length ? tags : autoTags(text)), p.logo_url, p.pricing, JSON.stringify(platforms),
        p.maker, p.country, p.launch_date || (p.created_at || ts).slice(0, 10), p.first_seen || ts, p.last_seen || ts, p.votes || 0, JSON.stringify(localEmbed(text)), p.origin && p.origin !== 'manual' ? p.origin : 'delta', contentHash, p.created_at || ts, p.updated_at || ts, nameKey(p.name)]);
    r.inserted++; return g;
  }
  // 已有抓取产品：包内非空值为准（新抓取更全），标签/平台合并，票数取大
  const pick = (a: any, b: any) => (b != null && b !== '' ? b : a);
  const merged = {
    name: pick(existing.name, p.name), url: pick(existing.url, url), tagline: pick(existing.tagline, p.tagline),
    description: p.description && (!existing.description || p.description.length >= existing.description.length * 0.6) ? p.description : existing.description,
    category: pick(existing.category, p.category), logo_url: pick(existing.logo_url, p.logo_url), pricing: pick(existing.pricing, p.pricing), maker: pick(existing.maker, p.maker), country: pick(existing.country, p.country),
    launch_date: pick(existing.launch_date, p.launch_date),
    tags: JSON.stringify([...new Set([...safeJson<string[]>(existing.tags, []), ...tags])]), platforms: JSON.stringify([...new Set([...safeJson<string[]>(existing.platforms, []), ...platforms])]),
    votes: Math.max(existing.votes || 0, p.votes || 0),
  };
  const same = merged.name === existing.name && merged.url === existing.url && merged.tagline === existing.tagline && merged.description === existing.description && merged.category === existing.category
    && merged.logo_url === existing.logo_url && merged.pricing === existing.pricing && merged.maker === existing.maker && merged.country === existing.country && merged.tags === (existing.tags || '[]') && merged.platforms === (existing.platforms || '[]') && merged.votes === (existing.votes || 0) && merged.launch_date === existing.launch_date;
  if (same) { r.unchanged++; return g; }
  const textChanged = merged.name !== existing.name || merged.tagline !== existing.tagline || merged.description !== existing.description;
  db.run(`UPDATE products SET name=?,url=?,domain=?,tagline=?,description=?,category=?,tags=?,logo_url=?,pricing=?,platforms=?,maker=?,country=?,launch_date=?,votes=?,last_seen=?,content_hash=?,embedding=?,updated_at=? WHERE guid=?`,
    [merged.name, merged.url, hostOf(merged.url), merged.tagline, merged.description, merged.category, merged.tags, merged.logo_url, merged.pricing, merged.platforms, merged.maker, merged.country, merged.launch_date, merged.votes,
      p.last_seen || ts, textChanged ? contentHash : existing.content_hash, textChanged ? JSON.stringify(localEmbed([merged.name, merged.tagline, merged.description].filter(Boolean).join(' '))) : existing.embedding, p.updated_at || ts, p.guid]);
  r.updated++; return g;
}
function addVersions(db: DB, p: DeltaProduct, ts: string, g = p.guid): number {
  if (!p.versions?.length) return 0; let n = 0; p = { ...p, guid: g };
  for (const v of p.versions || []) n += db.run(`INSERT OR IGNORE INTO product_versions(product_guid,source_guid,version_label,launched_at,url,votes,snapshot,content_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
    [p.guid, v.source_guid || null, v.version_label || '增量更新', v.launched_at || null, v.url || null, v.votes || 0, typeof v.snapshot === 'string' ? v.snapshot : JSON.stringify(v.snapshot || {}), v.content_hash || sha1(JSON.stringify(v.snapshot || {})), ts]).changes;
  if (n) db.run('UPDATE products SET launch_count=(SELECT COUNT(*) FROM product_versions WHERE product_guid=?) WHERE guid=?', [p.guid, p.guid]);
  return n;
}

/**
 * 应用增量包（单事务，失败整体回滚）。序号规则（v2）：
 *   to.seq <= 本地 seq → 已应用（幂等，不改库）；from.seq > 本地 seq → 拒绝（缺中间包）；
 *   from.seq <= 本地 seq < to.seq → 应用（累积包可跳过中间版本），完成后本地 seq = to.seq
 */
export function applyDelta(db: DB, packInput: Buffer | string | DeltaPack, onProgress?: ApplyProgress, expect?: { sha256?: string; size?: number }): ApplyResult {
  const t0 = Date.now(); const pack = parseDelta(packInput, expect); ensureTombstones(db);
  const before = db.get<any>('SELECT COUNT(*) c FROM products')?.c || 0; const seq0 = localSeq(db);
  const r: ApplyResult = { status: 'applied', inserted: 0, updated: 0, unchanged: 0, skipped_manual: 0, deleted: 0, delete_protected: 0, versions_added: 0, alt_rel_added: 0, alt_rel_removed: 0, sources_upserted: 0, fts_synced: 0,
    errors: [], from: pack.from, to: pack.to, product_count_before: before, product_count_after: before, seq_before: seq0, seq_after: seq0, ms: 0 };
  const v2 = Number(pack.version) >= 2;
  if (v2) {
    if (pack.dataset && pack.dataset !== localDataset(db)) throw new DeltaError('dataset', `增量包数据集（${pack.dataset}）与本地库（${localDataset(db)}）不匹配`);
    if (pack.to.seq! <= seq0) { r.status = 'already-applied'; r.ms = Date.now() - t0; onProgress?.({ phase: 'done', done: 0, total: 0, message: `已是 #${seq0}，此包（#${pack.from.seq}→#${pack.to.seq}）已应用过，跳过` }); return r; }
    if (pack.from.seq! > seq0) throw new DeltaError('seq-gap', `增量包不连续：本地数据版本 #${seq0}，此包需要从 #${pack.from.seq} 开始。请先应用 #${seq0}→#${pack.from.seq} 的包，或使用累积包`);
  } else r.status = 'legacy-applied';
  const total = pack.products.length; const ts = now();
  onProgress?.({ phase: 'products', done: 0, total, message: '开始合并（单事务）' });
  db.tx(() => {
    let i = 0;
    for (const p of pack.products) {
      const g = mergeProduct(db, p, r, ts); r.versions_added += addVersions(db, p, ts, g);
      if (++i % 2000 === 0) onProgress?.({ phase: 'products', done: i, total });
    }
    if (pack.deleted?.length) {
      onProgress?.({ phase: 'deleted', done: 0, total: pack.deleted.length });
      for (const d of pack.deleted) {
        // 去重合并的墓碑：把本地的收藏/备注/版本/alt_rel 并入保留方后删除（手动产品除外）
        if (d.merged_into) {
          const tgt = resolveAlias(db, d.merged_into);
          if (tgt !== d.guid && db.get<any>('SELECT 1 x FROM products WHERE guid=?', [tgt])) {
            const lo = db.get<any>('SELECT origin FROM products WHERE guid=?', [d.guid]);
            if (lo && lo.origin === 'manual') { r.delete_protected++; continue; }
            if (lo && mergeInto(db, tgt, d.guid)) { r.merged = (r.merged || 0) + 1; r.deleted++; }
            else db.run('INSERT OR REPLACE INTO product_alias(alias, guid) VALUES(?,?)', [d.guid, tgt]);
            continue;
          }
        }
        const ex = db.get<any>(`SELECT guid, origin, notes, (SELECT 1 FROM favorites f WHERE f.product_guid=products.guid) fav FROM products WHERE guid=?`, [d.guid]);
        if (!ex) continue;
        if (ex.origin === 'manual' || ex.fav || (ex.notes && String(ex.notes).trim())) { r.delete_protected++; continue; }
        db.run('DELETE FROM product_versions WHERE product_guid=?', [d.guid]); r.alt_rel_removed += db.run('DELETE FROM alt_rel WHERE product_guid=?', [d.guid]).changes;
        r.deleted += db.run('DELETE FROM products WHERE guid=?', [d.guid]).changes;
      }
    }
    for (const a0 of pack.alt_rel || []) { const a = { ...a0, product_guid: resolveAlias(db, a0.product_guid) }; if (db.get<any>('SELECT 1 x FROM products WHERE guid=?', [a.product_guid])) r.alt_rel_added += db.run('INSERT OR IGNORE INTO alt_rel(target, product_guid, src) VALUES(?,?,?)', [a.target, a.product_guid, a.src || null]).changes; }
    for (const a of pack.alt_rel_deleted || []) r.alt_rel_removed += db.run('DELETE FROM alt_rel WHERE target=? AND product_guid=?', [a.target, a.product_guid]).changes;
    for (const s of pack.sources || []) {
      const ex = s.guid ? db.get<any>('SELECT guid FROM sources WHERE guid=?', [s.guid]) : null;
      if (ex) db.run('UPDATE sources SET name=COALESCE(?,name), category=COALESCE(?,category), region=COALESCE(?,region), intro=COALESCE(?,intro), traffic=COALESCE(?,traffic), verify_status=COALESCE(?,verify_status), updated_at=? WHERE guid=?', [s.name, s.category, s.region, s.intro, s.traffic, s.verify_status, ts, s.guid]);
      else upsertSource(db, { seq: s.seq, name: s.name, url: s.url, category: s.category, region: s.region, intro: s.intro, submit_mode: s.submit_mode, traffic: s.traffic, verify_status: s.verify_status, interval_min: s.interval_min });
      r.sources_upserted++;
    }
    const touched = new Set<string>(); for (const p of pack.products) for (const v of p.versions || []) if (v.source_guid) touched.add(v.source_guid);
    for (const g of touched) db.run('UPDATE sources SET product_count=(SELECT COUNT(DISTINCT product_guid) FROM product_versions v WHERE v.source_guid=?) WHERE guid=?', [g, g]);
    db.setSetting('delta.last_applied_at', ts); db.setSetting('delta.last_since', pack.from.since); db.setSetting('delta.last_until', pack.to.until || '');
    if (pack.to.seed_version) db.setSetting('delta.last_seed_version', String(pack.to.seed_version));
    if (pack.from.seed_version) db.setSetting('delta.base_seed_version', String(pack.from.seed_version));
    if (v2) { db.setSetting('delta.seq', String(pack.to.seq)); r.seq_after = pack.to.seq!; }
    const hist = safeJson<any[]>(db.getSetting('delta.history', '[]'), []); hist.unshift({ at: ts, from: pack.from.seq ?? null, to: pack.to.seq ?? null, until: pack.to.until, inserted: r.inserted, updated: r.updated, deleted: r.deleted });
    db.setSetting('delta.history', JSON.stringify(hist.slice(0, 20)));
  });
  onProgress?.({ phase: 'fts', done: 0, total: 1, message: '同步全文索引' });
  r.fts_synced = syncFts(db); db.saveNow();
  r.product_count_after = db.get<any>('SELECT COUNT(*) c FROM products')?.c || 0; r.ms = Date.now() - t0;
  onProgress?.({ phase: 'done', done: total, total, message: `新增 ${r.inserted}，更新 ${r.updated}，删除 ${r.deleted}` });
  return r;
}

// ———————————————————— 索引 / 下载 / 更新计划 ————————————————————
export type DeltaIndexPack = { from_seq: number; to_seq: number; file?: string; url?: string; sha256: string; size: number; products?: number; deleted?: number; since?: string; until?: string; generated_at?: string };
export type DeltaIndex = { format?: string; version?: number; dataset?: string; latest_seq?: number; latest: string; packs?: DeltaIndexPack[]; until?: string; since?: string; size?: number; sha256?: string; seed_version?: string; product_count?: number; min_app_version?: string };

export function parseDeltaIndex(text: string): DeltaIndex {
  let j: any; try { j = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) { throw new DeltaError('index', '增量索引不是合法 JSON：' + (e as Error).message); }
  if (!j || (!j.latest && !Array.isArray(j.packs))) throw new DeltaError('index', '增量索引缺少 latest / packs 字段');
  return j as DeltaIndex;
}
export const isIndexText = (t: string) => /"format"\s*:\s*"producthub-delta-index"/.test(t.slice(0, 2000)) || (/"latest"\s*:/.test(t) && !/"products"\s*:/.test(t.slice(0, 5000)));

/** 计算更新链：从本地 seq 出发，每步选能接上的、终点最远的包 */
export function planUpdates(index: DeltaIndex, seq: number): { plan: DeltaIndexPack[]; latest: number; gap: boolean } {
  const packs = (index.packs || []).filter(p => Number.isInteger(p.from_seq) && Number.isInteger(p.to_seq)); const latest = index.latest_seq ?? Math.max(0, ...packs.map(p => p.to_seq));
  const plan: DeltaIndexPack[] = []; let cur = seq;
  while (cur < latest) { const c = packs.filter(p => p.from_seq <= cur && p.to_seq > cur).sort((a, b) => b.to_seq - a.to_seq)[0]; if (!c) return { plan, latest, gap: true }; plan.push(c); cur = c.to_seq; }
  return { plan, latest, gap: false };
}
export function resolveRef(ref: string, base: string): string {
  if (/^(https?:|file:)/i.test(ref) || path.isAbsolute(ref) || /^[A-Za-z]:[\\/]/.test(ref)) return ref;
  if (/^https?:/i.test(base)) return new URL(ref, base).toString();
  return path.join(path.dirname(base.replace(/^file:\/\//, '')), ref);
}
const isLocal = (u: string) => !/^https?:/i.test(u);
const localPath = (u: string) => decodeURIComponent(u.replace(/^file:\/\//, ''));

export async function fetchBuffer(url: string, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  if (isLocal(url)) { const p = localPath(url); if (!fs.existsSync(p)) throw new DeltaError('notfound', '本地文件不存在：' + p); return fs.readFileSync(p); }
  const r = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) } as any); if (!r.ok) throw new DeltaError('http', `下载失败 HTTP ${r.status}：${url}`);
  return Buffer.from(await r.arrayBuffer());
}

/**
 * 断点续传下载到 dest：写 dest.part，失败重试（带 Range 续传），全部字节到齐且 sha256 一致才 rename 成正式文件。
 * 校验失败会删掉 .part 并报错——不会有半包被合并。
 */
export async function downloadVerified(url: string, dest: string, expect: { sha256?: string; size?: number }, o: { retries?: number; fetchImpl?: typeof fetch; onProgress?: (got: number, total: number) => void; retryDelayMs?: number } = {}): Promise<{ file: string; bytes: number; resumed: number; attempts: number; cached: boolean }> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const ok = (f: string) => fs.existsSync(f) && (expect.size == null || fs.statSync(f).size === expect.size) && (!expect.sha256 || sha256(fs.readFileSync(f)) === expect.sha256);
  if (ok(dest)) return { file: dest, bytes: fs.statSync(dest).size, resumed: 0, attempts: 0, cached: true };
  if (isLocal(url)) {
    const src = localPath(url); if (!fs.existsSync(src)) throw new DeltaError('notfound', '本地增量包不存在：' + src);
    fs.copyFileSync(src, dest + '.part'); if (!ok(dest + '.part')) { fs.rmSync(dest + '.part', { force: true }); throw new DeltaError('sha256', '增量包 SHA256/大小校验失败（文件损坏）'); }
    fs.renameSync(dest + '.part', dest); return { file: dest, bytes: fs.statSync(dest).size, resumed: 0, attempts: 1, cached: false };
  }
  const fetchImpl = o.fetchImpl || fetch; const retries = o.retries ?? 4; const part = dest + '.part'; let resumed = 0; let lastErr: any = null; let attempts = 0; let shaFails = 0;
  for (let a = 0; a <= retries; a++) {
    attempts++;
    let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    if (expect.size != null && have > expect.size) { fs.rmSync(part, { force: true }); have = 0; }
    try {
      const headers: Record<string, string> = have ? { range: `bytes=${have}-` } : {};
      const r = await fetchImpl(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(120_000) } as any);
      if (r.status === 416 && expect.size != null && have === expect.size) { /* 已完整 */ }
      else {
        if (!(r.status === 200 || r.status === 206)) throw new DeltaError('http', `下载失败 HTTP ${r.status}`);
        if (r.status === 200 && have) { fs.rmSync(part, { force: true }); have = 0; } else if (r.status === 206 && have) resumed += have;
        const total = expect.size ?? (Number(r.headers.get('content-length') || 0) + have);
        const fd = fs.openSync(part, have ? 'a' : 'w'); let got = have;
        try { const reader = (r.body as any).getReader(); for (;;) { const { done, value } = await reader.read(); if (done) break; fs.writeSync(fd, Buffer.from(value)); got += value.length; o.onProgress?.(got, total); } }
        finally { fs.closeSync(fd); }
      }
      const size = fs.statSync(part).size;
      if (expect.size != null && size < expect.size) throw new DeltaError('incomplete', `下载中断：${size}/${expect.size} 字节`);
      if (!ok(part)) { fs.rmSync(part, { force: true }); throw new DeltaError('sha256', '下载完成但 SHA256/大小校验失败，已丢弃'); }
      fs.renameSync(part, dest); return { file: dest, bytes: size, resumed, attempts, cached: false };
    } catch (e) {
      lastErr = e;
      // 校验失败：最多再整包重下 1 次（中途断开则按 retries 续传重试）
      if (e instanceof DeltaError && e.code === 'sha256' && (shaFails = (shaFails || 0) + 1) >= 2) break;
      if (a < retries) await new Promise(res => setTimeout(res, (o.retryDelayMs ?? 1500) * (a + 1)));
    }
  }
  throw lastErr instanceof DeltaError ? lastErr : new DeltaError('download', '下载失败（已重试）：' + (lastErr?.message || lastErr));
}

export function resolveDeltaUrl(db: DB, override?: string | null): string {
  return (override && String(override).trim()) || db.getSetting('delta.updateUrl', '') || process.env.PH_DELTA_URL || '';
}

export type CheckResult = { kind: 'index' | 'pack'; url: string; localSeq: number; latestSeq: number; upToDate: boolean; gap: boolean; plan: (DeltaIndexPack & { href: string })[]; totalBytes: number; totalProducts: number; message: string; checkedAt: string };
/** 检查更新：读取索引（或单包），计算从本地 seq 到最新的更新链 */
export async function checkDelta(db: DB, url: string, fetchImpl?: typeof fetch): Promise<CheckResult> {
  const buf = await fetchBuffer(url, fetchImpl); const seq = localSeq(db); const at = now();
  const text = buf[0] === 0x1f ? '' : buf.toString('utf8');
  if (text && isIndexText(text)) {
    const idx = parseDeltaIndex(text);
    if (idx.dataset && idx.dataset !== localDataset(db)) throw new DeltaError('dataset', `更新源数据集（${idx.dataset}）与本地库不匹配`);
    if (!idx.packs?.length) { // v1 索引：只有 latest
      const href = resolveRef(idx.latest, url);
      return { kind: 'index', url, localSeq: seq, latestSeq: seq + 1, upToDate: false, gap: false, plan: [{ from_seq: seq, to_seq: seq + 1, url: href, href, sha256: idx.sha256 || '', size: idx.size || 0, products: idx.product_count }], totalBytes: idx.size || 0, totalProducts: idx.product_count || 0, message: `发现旧版索引（v1），latest=${idx.latest}`, checkedAt: at };
    }
    const { plan, latest, gap } = planUpdates(idx, seq);
    const p2 = plan.map(p => ({ ...p, href: resolveRef(p.url || p.file || '', url) }));
    const totalBytes = p2.reduce((a, p) => a + (p.size || 0), 0); const totalProducts = p2.reduce((a, p) => a + (p.products || 0), 0);
    const msg = gap ? `本地数据 #${seq} 与更新源最新 #${latest} 之间缺少可衔接的增量包，请安装新版安装包` : !p2.length ? `已是最新（数据版本 #${seq}）` : `有 ${p2.length} 个增量包可更新（#${seq} → #${latest}，约 ${(totalBytes / 1048576).toFixed(1)} MB，${totalProducts} 条产品）`;
    return { kind: 'index', url, localSeq: seq, latestSeq: latest, upToDate: !gap && !p2.length, gap, plan: gap ? [] : p2, totalBytes, totalProducts, message: msg, checkedAt: at };
  }
  const pack = parseDelta(buf);
  const already = Number(pack.version) >= 2 && pack.to.seq! <= seq; const gap = Number(pack.version) >= 2 && pack.from.seq! > seq;
  return { kind: 'pack', url, localSeq: seq, latestSeq: pack.to.seq ?? seq, upToDate: already, gap, plan: already || gap ? [] : [{ from_seq: pack.from.seq ?? seq, to_seq: pack.to.seq ?? seq + 1, url, href: url, sha256: sha256(buf), size: buf.length, products: pack.counts.products }], totalBytes: buf.length, totalProducts: pack.counts.products,
    message: already ? `此包已应用（本地 #${seq}）` : gap ? `此包需要从 #${pack.from.seq} 开始，本地为 #${seq}` : `可更新 ${pack.counts.products} 条产品`, checkedAt: at };
}

export function deltaStatus(db: DB, dataDir: string) {
  const seedFile = path.join(dataDir, 'seed-version.txt');
  const seedVersion = fs.existsSync(seedFile) ? fs.readFileSync(seedFile, 'utf8').trim() : '';
  return {
    seedVersion, updateUrl: resolveDeltaUrl(db), seq: localSeq(db), dataset: localDataset(db),
    autoCheck: db.getSetting('delta.autoCheck', '1') !== '0',
    lastCheckAt: db.getSetting('delta.lastCheckAt', ''), lastCheck: safeJson<any>(db.getSetting('delta.lastCheck', ''), null),
    lastAppliedAt: db.getSetting('delta.last_applied_at', ''), lastSince: db.getSetting('delta.last_since', ''), lastUntil: db.getSetting('delta.last_until', ''),
    lastSeedVersion: db.getSetting('delta.last_seed_version', ''), baseSeedVersion: db.getSetting('delta.base_seed_version', ''),
    history: safeJson<any[]>(db.getSetting('delta.history', '[]'), []),
    productCount: db.get<any>('SELECT COUNT(*) c FROM products')?.c || 0, envUrl: process.env.PH_DELTA_URL || '',
  };
}
