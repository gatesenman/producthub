/** 清理预缓存中启发式误抓的导航项（如虎嗅频道列表），并停用该来源 */
import { DB } from '../src/server/db';
(async () => { const db = await DB.open('data/seed/producthub.db');
  const bad = db.all<any>("SELECT guid FROM sources WHERE name IN ('虎嗅')");
  for (const s of bad) { const ps = db.all<any>('SELECT product_guid g FROM product_versions WHERE source_guid=?', [s.guid]);
    db.tx(() => { for (const p of ps) { db.run('DELETE FROM product_versions WHERE product_guid=? AND source_guid=?', [p.g, s.guid]); if (!db.get<any>('SELECT COUNT(*) c FROM product_versions WHERE product_guid=?', [p.g]).c) db.run('DELETE FROM products WHERE guid=?', [p.g]); }
      db.run("UPDATE sources SET enabled=0, rule_json=NULL, product_count=0, last_status='empty' WHERE guid=?", [s.guid]); }); }
  db.close(); console.log('cleaned', bad.length); })();
