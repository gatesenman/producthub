import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { DB } from '../../src/server/db';
import { startServer } from '../../src/server/server';
import { upsertProduct } from '../../src/server/products';
import { importSourcesCsv } from '../../src/server/sources';

let srv: Awaited<ReturnType<typeof startServer>>; let ro: Awaited<ReturnType<typeof startServer>>; let db: DB; let g: string[] = [];
const call = async (base: string, p: string, method = 'GET', body?: any) => { const r = await fetch(base + p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let data: any = t; try { data = JSON.parse(t); } catch {} return { status: r.status, data }; };
beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-v13-')); db = await DB.open(path.join(dir, 'x.db')); importSourcesCsv(db, fs.readFileSync('data/sources.csv', 'utf8'));
  const [s1, s2] = db.all<any>('SELECT guid FROM sources LIMIT 2').map(x => x.guid);
  for (const n of ['A1', 'A2', 'A3']) upsertProduct(db, { name: n, url: `https://${n}.io` }, { sourceGuid: s1 });
  upsertProduct(db, { name: 'B1', url: 'https://b1.io' }, { sourceGuid: s2 }); upsertProduct(db, { name: 'A1', url: 'https://A1.io' }, { sourceGuid: s2 });
  srv = await startServer({ db, dataDir: dir }); ro = await startServer({ db, dataDir: dir, readOnly: true });
  g = (await call(srv.url, '/api/products/query', 'POST', { sort: 'name' })).data.items.map((p: any) => p.guid);
});
afterAll(async () => { await srv.close(); await ro.close(); });

describe('v1.3 批量操作 / 导出选中 / 来源贡献 / 设置校验', () => {
  it('批量关注、加标签、移除标签、删除；参数校验；只读拒绝', async () => {
    expect((await call(srv.url, '/api/products/batch', 'POST', { guids: g.slice(0, 2), action: 'favorite' })).data).toEqual({ ok: true, count: 2 });
    expect((await call(srv.url, '/api/status')).data.favorites).toBe(2);
    await call(srv.url, '/api/products/batch', 'POST', { guids: g.slice(0, 3), action: 'tag', tag: '竞品' });
    expect((await call(srv.url, '/api/products/' + g[0])).data.tags).toContain('竞品');
    await call(srv.url, '/api/products/batch', 'POST', { guids: [g[0]], action: 'untag', tag: '竞品' });
    expect((await call(srv.url, '/api/products/' + g[0])).data.tags).not.toContain('竞品');
    expect((await call(srv.url, '/api/products/batch', 'POST', { guids: [], action: 'favorite' })).status).toBe(400);
    expect((await call(srv.url, '/api/products/batch', 'POST', { guids: g, action: 'nuke' })).status).toBe(400);
    expect((await call(srv.url, '/api/products/batch', 'POST', { guids: g, action: 'tag' })).status).toBe(400);
    expect((await call(ro.url, '/api/products/batch', 'POST', { guids: g, action: 'delete' })).status).toBe(403);
    const d = await call(srv.url, '/api/products/batch', 'POST', { guids: [g[3]], action: 'delete' }); expect(d.data.count).toBe(1);
    expect((await call(srv.url, '/api/products/' + g[3])).status).toBe(404);
  });
  it('导出选中：guid in 过滤', async () => {
    const f = encodeURIComponent(JSON.stringify({ type: 'cond', field: 'guid', op: 'in', value: g.slice(0, 2) }));
    const r = await call(srv.url, '/api/export?format=json&filter=' + f); const arr = (typeof r.data === 'string' ? JSON.parse(r.data) : r.data).products;
    expect(arr.map((p: any) => p.guid).sort()).toEqual(g.slice(0, 2).sort());
  });
  it('来源贡献按独有产品数排序并返回 uniq/n', async () => {
    const s = (await call(srv.url, '/api/analytics')).data.bySource; expect(s[0]).toMatchObject({ n: 3, uniq: 2 }); expect(s[1].uniq).toBeLessThanOrEqual(s[0].uniq);
  });
  it('设置：服务端校验 + 引导进度保存', async () => {
    expect((await call(srv.url, '/api/settings', 'POST', { 'scheduler.batch': 0 })).status).toBe(400);
    expect((await call(srv.url, '/api/settings', 'POST', { 'ai.baseUrl': 'ftp://x' })).status).toBe(400);
    expect((await call(srv.url, '/api/settings', 'POST', { 'app.onboardStep': '2' })).status).toBe(200);
    expect((await call(srv.url, '/api/settings')).data['app.onboardStep']).toBe('2');
  });
  it('HTML 报告：数字/分类列不折行', async () => {
    const r = await call(srv.url, '/api/report?format=html'); expect(r.data).toContain('table class="top"'); expect(r.data).toContain('white-space:nowrap');
  });
});
