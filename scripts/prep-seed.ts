/** v1.8：种子预处理——复制库 → 建 FTS5 全文索引 → optimize → VACUUM（压实） */
import fs from 'node:fs'; import path from 'node:path';
import { DB } from '../src/server/db';
import { rebuildFts } from '../src/server/search/fts';
const SRC = path.resolve(process.env.SEED_SRC || 'data/crawl', 'producthub.db'); const OUT = path.resolve('build/seed-tmp/producthub.db');
(async () => {
  fs.rmSync(path.dirname(OUT), { recursive: true, force: true }); fs.mkdirSync(path.dirname(OUT), { recursive: true });
  // 省磁盘：在源库上重建 FTS（派生数据），再 VACUUM INTO 直接写出压实副本，避免“复制+VACUUM”双倍占用
  let t = Date.now(); const src = await DB.open(SRC); console.log('fts rows', rebuildFts(src), Date.now() - t, 'ms');
  src.db.exec('ANALYZE'); src.db.pragma('wal_checkpoint(TRUNCATE)'); t = Date.now();
  src.db.prepare('VACUUM INTO ?').run(OUT); src.close(); console.log('vacuum into', Date.now() - t, 'ms');
  const db = await DB.open(OUT); db.db.pragma('journal_mode = DELETE');
  // v1.9：种子即「最新数据版本」——写入增量序号，装好后只需要之后的增量包；种子里不需要历史墓碑（保留合并别名防止本地抓取再产生重复）
  try {
    const idxF = path.resolve(process.env.DELTA_INDEX || 'data/delta/index.json');
    const idx = fs.existsSync(idxF) ? JSON.parse(fs.readFileSync(idxF, 'utf8')) : null; const seq = idx?.latest_seq ?? 0;
    for (const k of ['delta.seq', 'delta.dataset', 'delta.history', 'delta.last_applied_at', 'delta.lastCheck', 'delta.last_check']) db.run('DELETE FROM settings WHERE key=?', [k]);
    db.setSetting('delta.seq', String(seq)); db.setSetting('delta.dataset', idx?.dataset || 'producthub-main');
    db.run('DELETE FROM deleted_products'); db.run('DELETE FROM deleted_alt_rel');
    console.log('seed delta.seq', seq, 'alias', db.get<any>('SELECT COUNT(*) c FROM product_alias').c);
  } catch (e) { console.error('seed delta meta failed', e); }
  console.log('products', db.get<any>('SELECT COUNT(*) n FROM products').n); db.db.close();
  console.log('size', (fs.statSync(OUT).size / 1e9).toFixed(2), 'GB');
})();
