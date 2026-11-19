// 回滚本次（RUN_SINCE 之后）某些来源新增的条目：npx tsx scripts/_rollback_src.ts 146 151
import { DB } from '../src/server/db';
const SINCE = '2026-11-09T15:08:00.000Z';
(async () => {
  const db = await DB.open('data/crawl/producthub.db'); const out: any = {};
  for (const seq of process.argv.slice(2).map(Number)) {
    const s = db.get<any>('SELECT guid, name FROM sources WHERE seq=?', [seq]); if (!s) continue; const g = s.guid;
    db.run('DROP TABLE IF EXISTS temp.junk'); db.run('CREATE TEMP TABLE junk(guid TEXT PRIMARY KEY) WITHOUT ROWID');
    db.run(`INSERT OR IGNORE INTO junk SELECT p.guid FROM products p WHERE p.created_at >= ? AND p.origin <> 'manual' AND EXISTS (SELECT 1 FROM product_versions v WHERE v.product_guid=p.guid AND v.source_guid=?) AND NOT EXISTS (SELECT 1 FROM product_versions v WHERE v.product_guid=p.guid AND (v.source_guid IS NULL OR v.source_guid<>?)) AND NOT EXISTS (SELECT 1 FROM favorites f WHERE f.product_guid=p.guid)`, [SINCE, g, g]);
    const n = db.get<any>('SELECT COUNT(*) c FROM junk').c;
    db.tx(() => {
      db.run('DELETE FROM product_versions WHERE product_guid IN (SELECT guid FROM junk)'); db.run('DELETE FROM alt_rel WHERE product_guid IN (SELECT guid FROM junk)');
      db.run('DELETE FROM products WHERE guid IN (SELECT guid FROM junk)'); db.run('DELETE FROM deleted_products WHERE guid IN (SELECT guid FROM junk)');
      db.run('DELETE FROM deleted_alt_rel WHERE product_guid IN (SELECT guid FROM junk)');
      const v = db.run('DELETE FROM product_versions WHERE source_guid=? AND created_at >= ?', [g, SINCE]).changes; out[seq] = { name: s.name, products_removed: n, versions_removed: v };
      db.run("UPDATE crawl_state SET status='skipped', last_error='非产品库，按规则不收（已回滚）' WHERE source_guid=? AND strategy LIKE 'deep-%'", [g]);
      db.run('UPDATE sources SET product_count=(SELECT COUNT(DISTINCT product_guid) FROM product_versions WHERE source_guid=?) WHERE guid=?', [g, g]);
    });
  }
  console.log(JSON.stringify(out), 'after', db.get<any>('SELECT COUNT(*) c FROM products').c); db.close();
})();
