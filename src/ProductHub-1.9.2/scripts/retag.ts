/** 用最新的分类/标签规则重新计算抓取产品的分类与标签 */
import { DB } from '../src/server/db';
import { autoTags, classify } from '../src/server/taxonomy';
(async () => { const db = await DB.open(process.argv[2] || 'data/seed/producthub.db');
  db.tx(() => { for (const p of db.all<any>("SELECT guid,name,tagline,description FROM products WHERE origin='crawl'")) { const t = [p.name, p.tagline, p.description].filter(Boolean).join(' '); db.run('UPDATE products SET tags=?, category=? WHERE guid=?', [JSON.stringify(autoTags(t)), classify(t), p.guid]); } });
  db.close(); console.log('retagged'); })();
