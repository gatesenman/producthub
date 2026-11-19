import { DB } from '../src/server/db';
import { slugToName } from '../src/server/history-deep';
(async () => {
  const db = await DB.open('data/crawl/producthub.db');
  const rows = db.all<any>(`SELECT guid, name, description FROM products WHERE created_at >= '2026-11-09T15:08:00.000Z' AND url IS NULL AND description LIKE '%: http%'`);
  let n = 0;
  db.tx(() => { for (const r of rows) { const m = String(r.description).match(/https?:\/\/\S+$/); if (!m) continue; const nn = slugToName(m[0]); if (nn && nn !== r.name) { db.run('UPDATE products SET name=? WHERE guid=?', [nn, r.guid]); n++; } } });
  console.log('checked', rows.length, 'renamed', n); db.close();
})();
