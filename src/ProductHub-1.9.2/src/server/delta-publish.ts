/** 维护端：生成增量包并更新发布索引 index.json（序号链、sha256、大小），支持大包拆分 */
import fs from 'node:fs';
import path from 'node:path';
import { DB, now } from './db';
import { buildDeltaPack, writeDeltaFile, DEFAULT_DATASET, DELTA_INDEX_FORMAT, type DeltaIndex, type DeltaIndexPack } from './delta';

export type PublishOpts = { indexPath: string; outDir?: string; since?: string; until?: string; seedFrom?: string | null; seedTo?: string | null; cumulativeFrom?: number; split?: number; dataset?: string; baseUrl?: string; prefix?: string; log?: (s: string) => void };

export function readIndex(indexPath: string, dataset = DEFAULT_DATASET): DeltaIndex & { packs: DeltaIndexPack[] } {
  if (fs.existsSync(indexPath)) { const j = JSON.parse(fs.readFileSync(indexPath, 'utf8')); if (Array.isArray(j.packs)) return j; }
  return { format: DELTA_INDEX_FORMAT, version: 2, dataset, latest_seq: 0, latest: '', packs: [] };
}

export function publishDelta(db: DB, o: PublishOpts): { index: DeltaIndex; created: DeltaIndexPack[] } {
  const log = o.log || (() => {}); const dataset = o.dataset || DEFAULT_DATASET;
  const idx = readIndex(o.indexPath, dataset); const outDir = o.outDir || path.dirname(o.indexPath); fs.mkdirSync(outDir, { recursive: true });
  const latest = idx.latest_seq || 0;
  const fromSeq = o.cumulativeFrom ?? latest;
  const prevUntil = fromSeq === 0 ? null : idx.packs.filter(p => p.to_seq === fromSeq).sort((a, b) => (b.until || '').localeCompare(a.until || ''))[0]?.until;
  const since = o.since || prevUntil; if (!since) throw new Error(`无法确定 since：索引中没有到 #${fromSeq} 的包，请传 --since`);
  const until = o.until || now();
  // 拆分边界：按 COALESCE(updated_at, created_at) 排序，每 split 条一个包（同一时间戳不跨包）
  const bounds: string[] = [since];
  if (o.split && o.split > 0) {
    const ts = db.all<any>(`SELECT COALESCE(updated_at, created_at) t FROM products WHERE (created_at >= ? OR updated_at >= ?) AND COALESCE(updated_at, created_at) < ? AND origin <> 'manual' ORDER BY t`, [since, since, until]).map(r => r.t);
    for (let k = o.split; k < ts.length; k += o.split) { const b = ts[k]; if (b > bounds[bounds.length - 1]) bounds.push(b); }
  }
  bounds.push(until);
  const created: DeltaIndexPack[] = [];
  let seq = fromSeq; const cumulative = o.cumulativeFrom != null && o.cumulativeFrom < latest;
  if (cumulative && bounds.length > 2) throw new Error('累积包不支持拆分');
  for (let i = 0; i + 1 < bounds.length; i++) {
    const last = i + 2 === bounds.length;
    const toSeq = cumulative ? latest + 1 : seq + 1;
    const pack = buildDeltaPack(db, { since: bounds[i], until: bounds[i + 1], fromSeq: cumulative ? fromSeq : seq, toSeq, seedVersionFrom: o.seedFrom, seedVersionTo: o.seedTo, dataset, includeDeleted: last, deletedSince: since });
    const name = `${o.prefix || 'producthub-delta'}-${String(pack.from.seq).padStart(4, '0')}-${String(toSeq).padStart(4, '0')}-${until.slice(0, 10)}.phdelta.json.gz`;
    const file = path.join(outDir, name); const w = writeDeltaFile(pack, file);
    const entry: DeltaIndexPack = { from_seq: pack.from.seq!, to_seq: toSeq, file: name, ...(o.baseUrl ? { url: o.baseUrl.replace(/\/?$/, '/') + name } : {}), sha256: w.sha256, size: w.bytes, products: pack.counts.products, deleted: pack.counts.deleted, since: bounds[i], until: bounds[i + 1], generated_at: pack.generated_at };
    created.push(entry); log(`包 #${entry.from_seq}→#${entry.to_seq}：${entry.products} 产品，删除 ${entry.deleted}，${(w.bytes / 1048576).toFixed(2)} MB，${name}`);
    seq = toSeq;
  }
  idx.packs.push(...created); idx.latest_seq = Math.max(latest, ...created.map(c => c.to_seq)); idx.dataset = dataset; idx.format = DELTA_INDEX_FORMAT; idx.version = 2;
  const top = created[created.length - 1]; idx.latest = top.url || top.file!; idx.until = top.until; idx.since = since; (idx as any).updated_at = now();
  if (o.seedTo) idx.seed_version = o.seedTo;
  const tmp = o.indexPath + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(idx, null, 2)); fs.renameSync(tmp, o.indexPath);
  return { index: idx, created };
}
