import { DB } from '../src/server/db';
import { findSimilar, libraryAnalytics, navAnalytics } from '../src/server/ai';
import { queryProducts } from '../src/server/filter';
import { syncFts, useFts } from '../src/server/search/fts';

(async () => {
  const db = await DB.open('data/crawl/producthub.db');
  console.log('products', db.get<any>('SELECT COUNT(*) c FROM products').c, 'fts', useFts(db));
  const tSync = Date.now();
  try { syncFts(db); } catch (e) { console.log('syncFts', (e as Error).message); }
  console.log('syncFts ms', Date.now()-tSync);

  const notion = db.get<any>("SELECT guid,name FROM products WHERE domain='notion.so' OR name='Notion' LIMIT 1");
  console.log('notion', notion);

  function time(label: string, fn: () => any) {
    const t0 = Date.now();
    const v = fn();
    const ms = Date.now()-t0;
    console.log(label, ms + 'ms', Array.isArray(v) ? `n=${v.length}` : typeof v === 'object' && v?.items ? `items=${v.items.length} total=${v.total}` : '');
    return { ms, v };
  }

  time('navAnalytics cold', () => navAnalytics(db));
  time('navAnalytics warm', () => navAnalytics(db));
  time('libraryAnalytics cold', () => libraryAnalytics(db));
  time('libraryAnalytics warm', () => libraryAnalytics(db));
  time('browse category=ai', () => queryProducts(db, { category: 'ai', page: 1, pageSize: 40, sort: 'updated' }));
  time('browse category=dev', () => queryProducts(db, { category: 'dev', page: 1, pageSize: 40, sort: 'updated' }));
  if (notion) {
    time('findSimilar notion cold', () => findSimilar(db, { guid: notion.guid, limit: 10 }));
    time('findSimilar notion warm', () => findSimilar(db, { guid: notion.guid, limit: 10 }));
  }
  time('search alternative to notion', () => queryProducts(db, { q: 'alternative to notion', page: 1, pageSize: 20 }));
  time('home-ish newest', () => queryProducts(db, { page: 1, pageSize: 40, sort: 'newest' }));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
