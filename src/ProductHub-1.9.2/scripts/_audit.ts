import { DB } from '../src/server/db';
import fs from 'node:fs';
(async () => {
  const db = await DB.open('data/crawl/producthub.db');
  const by = db.all<any>(`SELECT s.seq, s.name, s.guid, COUNT(*) n FROM products p JOIN product_versions v ON v.product_guid=p.guid AND v.created_at>='2026-11-09T15:08:00Z' JOIN sources s ON s.guid=v.source_guid WHERE p.created_at>='2026-11-09T15:08:00Z' GROUP BY s.guid ORDER BY n DESC`);
  const out: any[] = [];
  for (const s of by.filter(x => x.n >= 300)) {
    const rows = db.all<any>(`SELECT p.name, p.url, substr(COALESCE(p.tagline, p.description),1,80) t FROM products p WHERE p.created_at>='2026-11-09T15:08:00Z' AND p.guid IN (SELECT product_guid FROM product_versions WHERE source_guid=?) ORDER BY random() LIMIT 30`, [s.guid]);
    out.push({ seq: s.seq, name: s.name, added: s.n, sample: rows });
  }
  fs.writeFileSync('data/delta/audit-sources.json', JSON.stringify({ all: by.map(({ guid, ...r }) => r), audit: out }, null, 2));
  for (const s of out) { console.log(`\n== ${s.seq} ${s.name} +${s.added}`); for (const r of s.sample.slice(0, 12)) console.log('  ', String(r.name).slice(0, 40), '|', r.url || '-', '|', String(r.t || '').slice(0, 60)); }
  console.log('\nsmall:', by.filter(x => x.n < 300).map(x => `${x.name}+${x.n}`).join(', '));
})();
