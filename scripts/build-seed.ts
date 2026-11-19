/** 构建预缓存历史数据：导入来源 → 抓取样本站点 → 本地 AI 分析 → 写入 data/seed */
import path from 'node:path';
import fs from 'node:fs';
import { DB } from '../src/server/db';
import { importSourcesCsv } from '../src/server/sources';
import { crawlSource, pool } from '../src/server/crawler';
import { getProduct } from '../src/server/products';
import { analyzeProduct, findSimilar } from '../src/server/ai';

(async () => {
  const dir = path.resolve('data/seed'); fs.mkdirSync(dir, { recursive: true });
  const limit = +(process.argv[2] || 240); const fresh = process.argv.includes('--fresh');
  if (fresh) fs.rmSync(path.join(dir, 'producthub.db'), { force: true });
  const db = await DB.open(path.join(dir, 'producthub.db'));
  console.log(importSourcesCsv(db, fs.readFileSync('data/sources.csv', 'utf8')));
  const srcs = db.all<any>('SELECT guid,name,url FROM sources WHERE last_crawl_at IS NULL ORDER BY seq LIMIT ?', [limit]);
  let done = 0;
  await pool(srcs, 8, async s => {
    const r = await crawlSource(db, s.guid, { imageDir: path.join(dir, 'images') });
    console.log(`[${++done}/${srcs.length}] ${s.name} ${s.url} →`, r.error ? 'ERR ' + r.error : `found=${r.found} new=${r.inserted} rule=${r.rule?.mode}`);
  });
  for (const x of db.all<any>('SELECT guid FROM products WHERE ai_summary IS NULL')) { const p = getProduct(db, x.guid); const a = await analyzeProduct(db, p, findSimilar(db, { guid: x.guid, limit: 5 })); db.run('UPDATE products SET ai_summary=?, ai_analysis=? WHERE guid=?', [a.summary, JSON.stringify(a), x.guid]); }
  db.setSetting('seed.builtAt', new Date().toISOString());
  console.log(db.get('SELECT (SELECT COUNT(*) FROM products) products, (SELECT COUNT(*) FROM product_versions) versions, (SELECT COUNT(*) FROM sources WHERE last_status=\'ok\') ok_sources, (SELECT COUNT(*) FROM sources WHERE last_status=\'error\') err, (SELECT COUNT(*) FROM products WHERE logo_local IS NOT NULL) imgs'));
  db.close();
})();
