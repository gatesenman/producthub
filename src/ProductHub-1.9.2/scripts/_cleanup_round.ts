// 本轮新增的清洗：HN 非产品/无名条目删除；ITreview/Microlaunch 标题模板去壳；回滚后 launch_count 修正
import { DB } from '../src/server/db';
const SINCE = '2026-11-09T15:08:00.000Z';
const strip = (n: string) => String(n || '').replace(/^レビュー募集中！\s*(.+?)を紹介.*$/, '$1').replace(/^(.+?)の評判・口コミ.*$/, '$1').replace(/^(.+?)\s+is now on Microlaunch$/i, '$1').trim();
(async () => {
  const db = await DB.open('data/crawl/producthub.db'); const out: any = {};
  const hn = db.get<any>("SELECT guid FROM sources WHERE seq=162").guid;
  const rows = db.all<any>(`SELECT p.guid, p.name, p.url FROM products p WHERE p.created_at>=? AND p.origin<>'manual' AND EXISTS (SELECT 1 FROM product_versions v WHERE v.product_guid=p.guid AND v.source_guid=?) AND NOT EXISTS (SELECT 1 FROM product_versions v WHERE v.product_guid=p.guid AND (v.source_guid IS NULL OR v.source_guid<>?))`, [SINCE, hn, hn]);
  const bad = rows.filter(r => r.name === 'Item' || !r.url || /^(how|why|what|when|where|who|i|i'm|i've|my|we|we're|our|the case|ask hn|tell hn|a |an |is |are |do |does |can )\b/i.test(r.name) || /\b(story|journey|lessons|thoughts|blog|article|essay|guide|tutorial)\b/i.test(r.name) || /substack\.com|medium\.com|\/blog\//i.test(r.url || ''));
  db.tx(() => { for (const r of bad) { db.run('DELETE FROM product_versions WHERE product_guid=?', [r.guid]); db.run('DELETE FROM products WHERE guid=?', [r.guid]); db.run('DELETE FROM deleted_products WHERE guid=?', [r.guid]); } });
  out.hn_checked = rows.length; out.hn_removed = bad.length;
  let renamed = 0;
  db.tx(() => { for (const r of db.all<any>(`SELECT guid, name FROM products WHERE created_at>=? AND (name LIKE 'レビュー募集中！%' OR name LIKE '%の評判・口コミ%' OR name LIKE '% is now on Microlaunch')`, [SINCE])) { const n = strip(r.name); if (n && n !== r.name) { db.run('UPDATE products SET name=? WHERE guid=?', [n, r.guid]); renamed++; } } });
  out.renamed = renamed;
  out.launch_fixed = db.run(`UPDATE products SET launch_count=(SELECT COUNT(*) FROM product_versions v WHERE v.product_guid=products.guid) WHERE updated_at>=? OR created_at>=?`, [SINCE, SINCE]).changes;
  out.after = db.get<any>('SELECT COUNT(*) c FROM products').c; console.log(JSON.stringify(out)); db.close();
})();
