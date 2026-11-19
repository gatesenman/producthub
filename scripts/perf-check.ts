/** v1.5 大数据性能检查：DB 加载、索引构建、搜索延迟 */
import path from 'node:path';
import { DB } from '../src/server/db';
import { search } from '../src/server/search/engine';
import { queryProducts } from '../src/server/filter';
(async () => {
  const f = path.resolve(process.argv[2] || 'data/crawl/producthub.db');
  let t = performance.now(); const db = await DB.open(f); const load = performance.now() - t;
  const n = db.get<any>('SELECT COUNT(*) c FROM products').c;
  t = performance.now(); search(db, 'warmup'); const idx = performance.now() - t;
  const qs = ['note taking app', 'open source analytics', 'AI writing assistant free', '项目管理 工具', 'privacy friendly email', 'kubernetes monitoring', 'notion alternative', 'chrome extension for screenshots', 'video editor ai', 'crm for startups'];
  const lat: number[] = []; for (let r = 0; r < 3; r++) for (const q of qs) { t = performance.now(); search(db, q + (r ? " " : ""), { limit: 50 }); lat.push(performance.now() - t); }
  for (const q of qs) { t = performance.now(); const r = search(db, q, { limit: 50 }); console.log(q, (performance.now() - t).toFixed(0), r.total); }
  const ql: Record<string, number> = {}; for (const q of ['app', 'ai', 'free tool', 'notion alternative', 'open source analytics', '工具']) { t = performance.now(); const r = queryProducts(db, { q, pageSize: 50 } as any); ql[q + ' (' + r.total + ')'] = Math.round(performance.now() - t); }
  for (const sort of ['updated', 'votes', 'name']) { t = performance.now(); queryProducts(db, { sort, pageSize: 50, page: 200 } as any); ql['browse:' + sort] = Math.round(performance.now() - t); }
  console.log('queryProducts ms', JSON.stringify(ql));
  lat.sort((a, b) => a - b); const p = (x: number) => lat[Math.floor(x * (lat.length - 1))].toFixed(1);
  console.log(JSON.stringify({ products: n, loadMs: Math.round(load), indexBuildMs: Math.round(idx), p50: p(0.5), p95: p(0.95), max: p(1), rssMB: Math.round(process.memoryUsage().rss / 1e6) }));
})();
