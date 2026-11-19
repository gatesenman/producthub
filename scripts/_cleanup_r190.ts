// 1.9.0 补抓后清理：MCP Market 只有 slug、名称带数字后缀（"Shopify 13" 等无法区分）的条目回滚；ITreview 模板简介清空
import fs from 'node:fs';
import { DB } from '../src/server/db';
import { syncFts } from '../src/server/search/fts';
const SINCE = '2026-11-10T09:04:00';
(async () => {
  const db = await DB.open('data/crawl/producthub.db'); const out: any = { before: db.get<any>('SELECT COUNT(*) c FROM products').c };
  const g = db.get<any>('SELECT guid FROM sources WHERE seq=124').guid;
  db.run('DROP TABLE IF EXISTS temp.junk'); db.run('CREATE TEMP TABLE junk(guid TEXT PRIMARY KEY) WITHOUT ROWID');
  const cand = db.all<any>(`SELECT p.guid, p.name FROM products p WHERE p.created_at>=? AND (p.url IS NULL OR p.url='') AND (p.tagline IS NULL OR p.tagline='') AND p.origin<>'manual' AND (p.notes IS NULL OR p.notes='')
    AND EXISTS (SELECT 1 FROM product_versions v WHERE v.product_guid=p.guid AND v.source_guid=?)
    AND NOT EXISTS (SELECT 1 FROM product_versions v WHERE v.product_guid=p.guid AND (v.source_guid IS NULL OR v.source_guid<>?))
    AND NOT EXISTS (SELECT 1 FROM favorites f WHERE f.product_guid=p.guid)`, [SINCE, g, g]).filter(r => / \d+$/.test(r.name));
  db.tx(() => {
    for (const r of cand) db.run('INSERT OR IGNORE INTO junk VALUES(?)', [r.guid]);
    db.run('DELETE FROM alt_rel WHERE product_guid IN (SELECT guid FROM junk)'); db.run('DELETE FROM product_versions WHERE product_guid IN (SELECT guid FROM junk)');
    out.mcp_market_removed = db.run('DELETE FROM products WHERE guid IN (SELECT guid FROM junk)').changes;
    db.run('DELETE FROM deleted_products WHERE guid IN (SELECT guid FROM junk)'); // 本轮新增从未发布，不留墓碑
    out.mcp_market_samples = cand.slice(0, 15).map(r => r.name);
    out.itreview_tagline_cleared = db.run("UPDATE products SET tagline=NULL, updated_at=? WHERE tagline LIKE '%におけるITreview独自の最新ユーザーレビュー%'", [new Date().toISOString()]).changes;
    out.itreview_desc_cleared = db.run("UPDATE products SET description=NULL WHERE description LIKE '%におけるITreview独自の最新ユーザーレビュー%'").changes;
    db.run('UPDATE sources SET product_count=(SELECT COUNT(DISTINCT product_guid) FROM product_versions v WHERE v.source_guid=sources.guid) WHERE seq IN (124,586)');
  });
  out.fts = syncFts(db); out.after = db.get<any>('SELECT COUNT(*) c FROM products').c; db.saveNow?.(); db.close();
  fs.writeFileSync('data/delta/cleanup-r190.json', JSON.stringify(out, null, 2)); console.log(JSON.stringify(out));
})();
