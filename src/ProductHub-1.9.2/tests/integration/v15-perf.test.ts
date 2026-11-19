import { describe, it, expect } from 'vitest';
import { DB } from '../../src/server/db';
import { search, buildIndex } from '../../src/server/search/engine';
import { syncFts } from '../../src/server/search/fts';
import { queryProducts } from '../../src/server/filter';

describe('v1.5 大数据量性能（合成 30k 产品）', () => {
  it('倒排索引 + 候选打分：搜索与分页在合理阈值内', async () => {
    const db = await DB.open(null as any);
    const words = ['note', 'analytics', 'email', 'crm', 'video', 'editor', 'ai', 'writing', 'monitoring', 'kubernetes', 'privacy', 'design', 'chat', 'invoice', 'calendar', 'todo', 'seo', 'database', 'api', 'browser'];
    db.tx(() => { for (let i = 0; i < 30000; i++) { const a = words[i % 20], b = words[(i * 7) % 20], c = words[(i * 13) % 20];
      db.run('INSERT INTO products(guid,name,tagline,description,domain,votes,launch_count,first_seen,updated_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', [`g${i}`, `${a}${i} ${b}`, `${a} ${b} tool for ${c}`, `A ${c} app that helps with ${a} and ${b}.`, `p${i}.com`, i % 500, 1, '2024-01-01', `2024-01-${String(1 + (i % 28)).padStart(2, '0')}`, '2024-01-01']); } });
    // 预同步 FTS，不把建索引算进搜索延迟
    const tSync = performance.now(); const synced = syncFts(db); const syncMs = performance.now() - tSync;
    const t0 = performance.now(); buildIndex(db, undefined); const build = performance.now() - t0;
    // 预热一次后再测
    search(db, 'ai writing', { limit: 50 });
    const lat: number[] = [];
    for (const q of ['ai writing', 'privacy email', 'kubernetes monitoring', 'video editor ai', 'crm']) {
      const t = performance.now(); const r = search(db, q, { limit: 50 }); lat.push(performance.now() - t);
      expect(r.total).toBeGreaterThan(0);
    }
    const t1 = performance.now(); const page = queryProducts(db, { sort: 'votes', page: 300, pageSize: 50 }); const browse = performance.now() - t1;
    expect(page.items.length).toBe(50);
    // 本机实测暖搜索常落在 150–450ms；给共享 box 留余量，但仍约束在 1s 内
    expect(Math.max(...lat)).toBeLessThan(800);
    expect(browse).toBeLessThan(300);
    console.log(`syncFTS ${synced} rows ${syncMs.toFixed(0)}ms, build ${build.toFixed(0)}ms, search max ${Math.max(...lat).toFixed(0)}ms avg ${(lat.reduce((a,b)=>a+b,0)/lat.length).toFixed(0)}ms, browse ${browse.toFixed(0)}ms`);
  }, 180000);
});
