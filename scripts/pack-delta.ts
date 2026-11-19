/**
 * 维护端：生成增量包并发布到索引（不整库复制）
 *
 *   # 接着索引里最新的包继续出下一个包（since 自动取上一个包的 until）
 *   npx tsx scripts/pack-delta.ts --db data/crawl/producthub.db --index data/delta/index.json [--split 60000] [--to-seed 1.9.0]
 *   # 第一个包 / 指定起点
 *   npx tsx scripts/pack-delta.ts --index data/delta/index.json --since 2026-11-09T15:08:00.000Z
 *   # 累积包（任何 >= N 的用户一步到最新）
 *   npx tsx scripts/pack-delta.ts --index data/delta/index.json --cumulative-from 0 --since <种子截止>
 *   # 小样例（不入索引）
 *   npx tsx scripts/pack-delta.ts --sample --since <ISO> --limit 20 --out data/delta/sample.phdelta.json
 */
import path from 'node:path';
import { DB } from '../src/server/db';
import { buildDeltaPack, writeDeltaFile } from '../src/server/delta';
import { publishDelta } from '../src/server/delta-publish';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : undefined; };
(async () => {
  const db = await DB.open(path.resolve(arg('--db') || 'data/crawl/producthub.db'));
  if (process.argv.includes('--sample')) {
    const since = arg('--since'); if (!since) throw new Error('需要 --since');
    const pack = buildDeltaPack(db, { since, limit: Number(arg('--limit') || 20), fromSeq: Number(arg('--from-seq') || 0), toSeq: Number(arg('--to-seq') || 1) });
    const out = path.resolve(arg('--out') || 'data/delta/sample.phdelta.json'); const w = writeDeltaFile(pack, out);
    console.log(JSON.stringify({ out, ...w, counts: pack.counts }, null, 2)); return;
  }
  const t = Date.now();
  const r = publishDelta(db, { indexPath: path.resolve(arg('--index') || 'data/delta/index.json'), outDir: arg('--out-dir') ? path.resolve(arg('--out-dir')!) : undefined, since: arg('--since'), until: arg('--until'),
    seedFrom: arg('--from-seed') || null, seedTo: arg('--to-seed') || null, cumulativeFrom: arg('--cumulative-from') != null ? Number(arg('--cumulative-from')) : undefined, split: arg('--split') ? Number(arg('--split')) : undefined,
    baseUrl: arg('--base-url'), prefix: arg('--prefix'), log: s => console.log(s) });
  console.log(JSON.stringify({ ms: Date.now() - t, latest_seq: r.index.latest_seq, created: r.created }, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
