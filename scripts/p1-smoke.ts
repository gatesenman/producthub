import { DB } from '../src/server/db';
import { search } from '../src/server/search/engine';
import { findSimilar } from '../src/server/ai';
import { isGenericProductName } from '../src/server/search/text';
import { startServer } from '../src/server/server';

(async () => {
  const t0 = Date.now();
  const db = await DB.open('data/crawl/producthub.db');
  console.log('open', Date.now() - t0, 'ms', 'rssMB', (process.memoryUsage().rss / 1e6).toFixed(0));

  const t1 = Date.now();
  const r = search(db, 'alternative to notion', { limit: 15 });
  console.log('search took', r.tookMs, 'wall', Date.now() - t1, 'total', r.total, 'similarTo', r.similarTo);
  for (const h of r.hits.slice(0, 12)) {
    const p = db.get<any>('SELECT name,category,domain,substr(tagline,1,50) t FROM products WHERE guid=?', [h.guid]);
    console.log(' ', h.score.toFixed(2), p.name, '[' + p.category + ']', p.domain || '-', isGenericProductName(p.name) ? 'GENERIC' : '', '|', (p.t || '').slice(0, 40));
  }

  const notion = db.get<any>("SELECT guid,name,domain,category FROM products WHERE name=? COLLATE NOCASE AND domain LIKE ? ORDER BY launch_count DESC", ['Notion', 'notion%']);
  console.log('notion pick', notion);
  const t2 = Date.now();
  const sim = findSimilar(db, { guid: notion.guid, limit: 12 });
  console.log('findSimilar took', Date.now() - t2);
  for (const s of sim) console.log(' ', s.score, s.name, '[' + s.category + ']', s.domain || '-');

  const srv = await startServer({ db, dataDir: 'data/crawl', readOnly: true, noWarm: false, port: 8799 });
  await new Promise(r => setTimeout(r, 2500));
  console.log('after warm rssMB', (process.memoryUsage().rss / 1e6).toFixed(0));
  const st = await fetch(srv.url + '/api/status').then(r => r.json()) as any;
  console.log('status products', st.products, 'meta', await fetch(srv.url + '/api/meta').then(r => r.json()).then((m: any) => m.version));
  await srv.close();
  console.log('final rssMB', (process.memoryUsage().rss / 1e6).toFixed(0));
})();
