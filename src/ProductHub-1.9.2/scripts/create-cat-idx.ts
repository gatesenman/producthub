import { DB } from '../src/server/db';
(async () => {
  const db = await DB.open('data/crawl/producthub.db');
  const t0 = Date.now();
  console.log('creating idx_products_cat_updated...');
  db.db.exec('CREATE INDEX IF NOT EXISTS idx_products_cat_updated ON products(category, updated_at DESC)');
  console.log('done in', Date.now() - t0, 'ms');
  console.log(db.all("SELECT name, sql FROM sqlite_master WHERE name='idx_products_cat_updated'"));
  // quick category browse timing
  const t1 = Date.now();
  const n = db.get<any>("SELECT COUNT(*) c FROM products WHERE category='ai'").c;
  console.log('count ai', n, 'ms', Date.now()-t1);
  const t2 = Date.now();
  const rows = db.all("SELECT guid FROM products WHERE category='ai' ORDER BY updated_at DESC LIMIT 40");
  console.log('browse ai page1', rows.length, 'ms', Date.now()-t2);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
