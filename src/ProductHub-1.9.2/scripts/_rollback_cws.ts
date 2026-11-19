import { DB } from '../src/server/db';
(async () => {
  const db = await DB.open('data/crawl/producthub.db');
  const g = db.get<any>("SELECT guid FROM sources WHERE seq=236").guid;
  const rows = db.all<any>(`SELECT p.guid FROM products p WHERE p.created_at >= '2026-11-09T15:08:00.000Z' AND p.guid IN (SELECT product_guid FROM product_versions WHERE source_guid=?) AND NOT EXISTS (SELECT 1 FROM product_versions v WHERE v.product_guid=p.guid AND (v.source_guid IS NULL OR v.source_guid<>?))`, [g, g]);
  console.log('cws junk', rows.length);
  db.run('CREATE TEMP TABLE junk(guid TEXT PRIMARY KEY) WITHOUT ROWID');
  db.tx(() => { for (const r of rows) db.run('INSERT OR IGNORE INTO junk VALUES(?)', [r.guid]); });
  console.log('temp ok');
  db.tx(() => { db.run('DELETE FROM product_versions WHERE product_guid IN (SELECT guid FROM junk)'); db.run('DELETE FROM alt_rel WHERE product_guid IN (SELECT guid FROM junk)'); db.run('DELETE FROM products WHERE guid IN (SELECT guid FROM junk)'); db.run(`DELETE FROM deleted_products WHERE deleted_at >= '2026-11-09T15:08:00.000Z'`); });
  db.run("UPDATE crawl_state SET status='skipped', last_error='slug 截断且丢失扩展 ID、多为主题皮肤，回滚' WHERE source_guid=? AND strategy='deep-sitemap'", [g]);
  db.run("UPDATE sources SET product_count=(SELECT COUNT(DISTINCT product_guid) FROM product_versions WHERE source_guid=?) WHERE guid=?", [g, g]);
  console.log('after', db.get<any>('SELECT COUNT(*) c FROM products').c, 'tomb', db.get<any>('SELECT COUNT(*) c FROM deleted_products').c); db.close();
})();
