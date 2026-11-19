/** v1.5：为种子库计算并以 q8 紧凑格式写入向量（使首次“相似产品”无需现算） */
import { DB } from '../src/server/db';
import { localEmbed, packVec } from '../src/server/ai';
(async () => { const db = await DB.open(process.argv[2] || 'data/seed/producthub.db'); const rows = db.all<any>('SELECT guid,name,tagline,description FROM products');
  db.tx(() => { for (const r of rows) db.run('UPDATE products SET embedding=? WHERE guid=?', [packVec(localEmbed([r.name, r.tagline, r.description].join(' '))), r.guid]); });
  db.saveNow(); console.log('packed', rows.length); process.exit(0); })();
