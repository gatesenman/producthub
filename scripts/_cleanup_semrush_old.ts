// 1.9.0：清理旧轮次（10 月）残留的 SEMrush / Webflow showcase / BuiltWith 非产品条目
//  - 只来自这些来源、无网址的条目 → 删除（墓碑保留，客户端增量会同步下架）；收藏/备注/手动条目一律不动
//  - 同时有其它来源的条目 → 只摘掉这些来源的版本记录，产品保留
//   npx tsx scripts/_cleanup_semrush_old.ts
import { DB } from '../src/server/db';
import { syncFts } from '../src/server/search/fts';
(async () => {
  const db = await DB.open('data/crawl/producthub.db'); const out: any = { before: db.get<any>('SELECT COUNT(*) c FROM products').c };
  for (const seq of [604, 528, 314]) {
    const s = db.get<any>('SELECT guid, name FROM sources WHERE seq=?', [seq]); if (!s) continue; const g = s.guid;
    db.run('DROP TABLE IF EXISTS temp.junk'); db.run('CREATE TEMP TABLE junk(guid TEXT PRIMARY KEY) WITHOUT ROWID');
    db.run(`INSERT OR IGNORE INTO junk SELECT p.guid FROM products p WHERE (p.url IS NULL OR p.url='') AND p.origin<>'manual' AND (p.notes IS NULL OR p.notes='')
      AND EXISTS (SELECT 1 FROM product_versions v WHERE v.product_guid=p.guid AND v.source_guid=?)
      AND NOT EXISTS (SELECT 1 FROM product_versions v WHERE v.product_guid=p.guid AND (v.source_guid IS NULL OR v.source_guid<>?))
      AND NOT EXISTS (SELECT 1 FROM favorites f WHERE f.product_guid=p.guid)`, [g, g]);
    const names = db.all<any>('SELECT p.name FROM junk j JOIN products p ON p.guid=j.guid').map(r => r.name);
    db.tx(() => {
      db.run('DELETE FROM alt_rel WHERE product_guid IN (SELECT guid FROM junk)');
      db.run('DELETE FROM product_versions WHERE product_guid IN (SELECT guid FROM junk)');
      const removed = db.run('DELETE FROM products WHERE guid IN (SELECT guid FROM junk)').changes;
      const detached = db.run('DELETE FROM product_versions WHERE source_guid=?', [g]).changes;
      db.run("UPDATE products SET launch_count=(SELECT COUNT(*) FROM product_versions v WHERE v.product_guid=products.guid) WHERE guid IN (SELECT product_guid FROM product_versions WHERE 0)");
      db.run('UPDATE sources SET product_count=0 WHERE guid=?', [g]);
      out[seq] = { name: s.name, removed, versions_detached: detached, removed_names: names };
    });
  }
  out.fts = syncFts(db); out.after = db.get<any>('SELECT COUNT(*) c FROM products').c; db.saveNow?.(); db.close();
  console.log(JSON.stringify(out, null, 1));
  require('node:fs').writeFileSync('data/delta/cleanup-semrush-old.json', JSON.stringify(out, null, 2));
})();
