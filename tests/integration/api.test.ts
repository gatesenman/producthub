import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { DB } from '../../src/server/db';
import { startServer } from '../../src/server/server';
import { mockFetcher } from '../fixtures/pages';

let srv: Awaited<ReturnType<typeof startServer>>; let ro: Awaited<ReturnType<typeof startServer>>; let db: DB;
const call = async (base: string, p: string, method = 'GET', body?: any, raw?: any) => { const r = await fetch(base + p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: raw ?? (body ? JSON.stringify(body) : undefined) }); const ct = r.headers.get('content-type') || ''; return { status: r.status, ct, headers: r.headers, data: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) }; };
beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-api-')); fs.mkdirSync(path.join(dir, 'ui')); fs.writeFileSync(path.join(dir, 'ui', 'index.html'), '<html>UI</html>');
  db = await DB.open(path.join(dir, 'x.db'));
  srv = await startServer({ db, dataDir: dir, uiDir: path.join(dir, 'ui'), fetcher: mockFetcher() });
  ro = await startServer({ db, dataDir: dir, uiDir: path.join(dir, 'ui'), readOnly: true });
});
afterAll(async () => { await srv.close(); await ro.close(); });

describe('REST API 端到端流程', () => {
  it('meta', async () => { const r = await call(srv.url, '/api/meta'); expect(r.data).toMatchObject({ readOnly: false, aiEnabled: false }); expect(r.data.categories.length).toBeGreaterThan(10); });
  it('添加来源 → 抓取 → 产品入库 → 查询 → 详情 → 相似 → 分析', async () => {
    const s = (await call(srv.url, '/api/sources', 'POST', { name: 'Launch', url: 'https://launch.example.com/' })).data; expect(s.guid).toBeTruthy();
    const c = (await call(srv.url, `/api/sources/${s.guid}/crawl`, 'POST')).data; expect(c).toMatchObject({ found: 3, inserted: 3 });
    const q = (await call(srv.url, '/api/products/query', 'POST', { q: 'Zeta' })).data; expect(q.total).toBe(1);
    const g = q.items[0].guid; const d = (await call(srv.url, '/api/products/' + g)).data; expect(d.versions[0].source_name).toBe('Launch');
    expect(Array.isArray((await call(srv.url, `/api/products/${g}/similar`)).data)).toBe(true);
    const a = (await call(srv.url, `/api/products/${g}/analyze`, 'POST')).data; expect(a.ai_summary).toContain('Zeta'); expect(a.ai_analysis.dimensions).toHaveLength(6);
    expect((await call(srv.url, '/api/sources/' + s.guid + '/runs')).data).toHaveLength(1);
    expect((await call(srv.url, '/api/products/' + 'nope')).status).toBe(404);
  });
  it('GET /api/products 支持 filter 参数', async () => { const f = encodeURIComponent(JSON.stringify({ type: 'group', op: 'OR', children: [{ type: 'cond', field: 'name', op: 'eq', value: 'Eta Design' }, { type: 'cond', field: 'name', op: 'eq', value: 'Theta Shop' }] })); expect((await call(srv.url, '/api/products?filter=' + f)).data.total).toBe(2); });
  it('手动添加：重复官网合并为新版本', async () => {
    const a = (await call(srv.url, '/api/products', 'POST', { name: 'Manual', url: 'https://manual.io', tagline: 'hand', category: 'design' })).data; expect(a.status).toBe('inserted'); expect(a.product.category).toBe('design'); expect(a.product.origin).toBe('manual');
    const b = (await call(srv.url, '/api/products', 'POST', { name: 'Manual 2', url: 'https://www.manual.io/', tagline: 'relaunch' })).data; expect(b.guid).toBe(a.guid); expect(b.product.launch_count).toBe(2);
    expect((await call(srv.url, '/api/products/' + a.guid, 'PATCH', { pricing: '免费' })).data.pricing).toBe('免费');
    expect((await call(srv.url, '/api/products', 'POST', { name: '' })).status).toBe(500);
  });
  it('导出 CSV/XLSX/JSON 并重新导入', async () => {
    for (const f of ['csv', 'xlsx', 'json']) { const r = await call(srv.url, '/api/export?format=' + f); expect(r.status).toBe(200); expect(r.headers.get('content-disposition')).toContain('.' + f);
      const imp = (await call(srv.url, '/api/import?format=' + f, 'POST', undefined, Buffer.isBuffer(r.data) ? r.data : JSON.stringify(r.data))).data; expect(imp, f).toMatchObject({ inserted: 0 }); expect(imp.total).toBeGreaterThan(3); }
  });
  it('保存筛选、设置、调度、规则生成/测试、去重、统计', async () => {
    await call(srv.url, '/api/filters', 'POST', { name: 'AI', filter: { type: 'group', op: 'AND', children: [] } }); const fl = (await call(srv.url, '/api/filters')).data; expect(fl[0].name).toBe('AI');
    await call(srv.url, '/api/filters/' + fl[0].id, 'DELETE'); expect((await call(srv.url, '/api/filters')).data).toHaveLength(0);
    await call(srv.url, '/api/settings', 'POST', { 'ai.model': 'deepseek-chat', 'ai.apiKey': 'sk-abcdefgh1234' }); const st = (await call(srv.url, '/api/settings')).data; expect(st['ai.apiKeyMasked']).toBe('sk-****1234'); expect(JSON.stringify(st)).not.toContain('abcdefgh');
    await call(srv.url, '/api/settings', 'POST', { 'ai.apiKey': '' });
    expect((await call(srv.url, '/api/scheduler', 'POST', { enabled: false, batch: 3 })).data).toMatchObject({ enabled: false, batch: 3 });
    const gen = (await call(srv.url, '/api/rules/generate', 'POST', { url: 'https://ld.example.com/' })).data; expect(gen.rule.mode).toBe('jsonld');
    const t = (await call(srv.url, '/api/rules/test', 'POST', { url: 'https://launch.example.com/', rule: { mode: 'html', itemSelector: 'article.product-card', fields: { name: { selector: 'h3' } } } })).data; expect(t.count).toBe(5);
    expect(Array.isArray((await call(srv.url, '/api/duplicates')).data)).toBe(true);
    const an = (await call(srv.url, '/api/analytics')).data; expect(an.totals.products).toBeGreaterThan(3);
    const ask = (await call(srv.url, '/api/ai/ask', 'POST', { question: 'sales agent' })).data; expect(ask.products[0].name).toBe('Zeta Agent');
    expect((await call(srv.url, '/api/scheduler/run', 'POST', { limit: 1 })).data.results).toBeDefined();
  });
  it('静态 UI / SPA 回退 / 图片 404 / 未知 API', async () => {
    expect((await call(srv.url, '/some/route')).data.toString()).toContain('UI'); expect((await call(srv.url, '/images/none.png')).status).toBe(404); expect((await call(srv.url, '/api/zzz')).status).toBe(404);
    expect((await call(srv.url, '/../../etc/passwd')).data.toString()).toContain('UI');
  });
  it('内部预览站点：只读，写操作 403，查询/AI 检索可用', async () => {
    expect((await call(ro.url, '/api/meta')).data.readOnly).toBe(true);
    expect((await call(ro.url, '/api/products', 'POST', { name: 'x' })).status).toBe(403);
    expect((await call(ro.url, '/api/sources/x/crawl', 'POST')).status).toBe(403);
    expect((await call(ro.url, '/api/settings', 'POST', {})).status).toBe(403);
    expect((await call(ro.url, '/api/products/query', 'POST', {})).status).toBe(200);
    expect((await call(ro.url, '/api/ai/ask', 'POST', { question: 'x' })).status).toBe(200);
  });
});
