import { DB } from '../src/server/db';
import { queryProducts } from '../src/server/filter';
import { search } from '../src/server/search/engine';
import { homeData } from '../src/server/home';
import { navAnalytics } from '../src/server/ai';
import { memoByRev } from '../src/server/util';

(async () => {
  const db = await DB.open('data/crawl/producthub.db');
  // 只读压测：不碰 fts_queue / settings，避开并行抓取写锁
  const rss = () => Math.round(process.memoryUsage().rss / 1e6);
  const ms = (fn: () => any) => { const t = performance.now(); const v = fn(); return { ms: +(performance.now() - t).toFixed(0), v }; };

  console.log('products', db.get<any>('SELECT COUNT(*) c FROM products').c, 'rss', rss());

  const coldSearch = ms(() => search(db, 'notion alternative', { limit: 40 }));
  const warmSearch: number[] = [];
  for (const q of ['ai writing', 'privacy email', 'kubernetes monitoring', 'video editor', 'crm', '项目管理', 'notion alternative', 'chrome extension']) {
    const r = ms(() => search(db, q, { limit: 40 }));
    warmSearch.push(r.ms);
    console.log('search', q, r.ms, 'total', r.v.total);
  }
  const browse1 = ms(() => queryProducts(db, { sort: 'updated', page: 1, pageSize: 40 }));
  const browse200 = ms(() => queryProducts(db, { sort: 'votes', page: 200, pageSize: 40 }));
  const browseCat = ms(() => queryProducts(db, { category: 'ai', sort: 'updated', page: 1, pageSize: 40 }));
  // home 可能因无 cutoff 想写 settings：已 try/catch
  const home1 = ms(() => homeData(db));
  const home2 = ms(() => homeData(db));
  const nav1 = ms(() => navAnalytics(db));
  const nav2 = ms(() => navAnalytics(db));
  const facets1 = ms(() => memoByRev(db, 'facetsBench', () => ({
    sources: db.all('SELECT guid, name, COALESCE(product_count,0) product_count FROM sources ORDER BY product_count DESC, name')
  })));
  const facets2 = ms(() => memoByRev(db, 'facetsBench', () => ({ sources: [] as any[] })));
  const enrich1 = ms(() => memoByRev(db, 'enrichBench', () => db.get<any>("SELECT SUM(enrich_status='ok') enriched, SUM(enrich_status LIKE 'error%') errors, COUNT(*) products FROM products")));
  const enrich2 = ms(() => memoByRev(db, 'enrichBench', () => db.get<any>('SELECT 1')));

  const sample = browse1.v.items[0] || {};
  const fatKeys = ['description','enrich_json','embedding','ai_analysis','notes'].filter(k => k in sample && sample[k] != null);
  console.log(JSON.stringify({
    coldSearchMs: coldSearch.ms,
    warmSearchMax: Math.max(...warmSearch),
    warmSearchAvg: Math.round(warmSearch.reduce((a,b)=>a+b,0)/warmSearch.length),
    browseHomeMs: browse1.ms,
    browsePage200Ms: browse200.ms,
    browseCatMs: browseCat.ms,
    homeColdMs: home1.ms,
    homeWarmMs: home2.ms,
    navColdMs: nav1.ms,
    navWarmMs: nav2.ms,
    facetsColdMs: facets1.ms,
    facetsWarmMs: facets2.ms,
    enrichColdMs: enrich1.ms,
    enrichWarmMs: enrich2.ms,
    listItemKeys: Object.keys(sample).sort(),
    leakedFatKeys: fatKeys,
    browseItems: browse1.v.items.length,
    rssMB: rss(),
  }, null, 2));
  try { (db as any).db.close(); } catch { db.close(); }
})().catch(e => { console.error(e); process.exit(1); });
