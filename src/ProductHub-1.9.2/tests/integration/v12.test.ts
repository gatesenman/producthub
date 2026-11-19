import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import zlib from 'node:zlib';
import { DB } from '../../src/server/db';
import { startServer } from '../../src/server/server';
import { upsertProduct } from '../../src/server/products';
import { boot } from '../../src/server/main';

let srv: Awaited<ReturnType<typeof startServer>>; let ro: Awaited<ReturnType<typeof startServer>>; let db: DB; let dir: string;
const call = async (base: string, p: string, method = 'GET', body?: any) => { const r = await fetch(base + p, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }); const ct = r.headers.get('content-type') || ''; return { status: r.status, headers: r.headers, data: ct.includes('json') ? await r.json() : await r.text() }; };
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-v12-')); db = await DB.open(path.join(dir, 'x.db'));
  for (const n of ['Alpha', 'Beta', 'Gamma']) upsertProduct(db, { name: n, url: `https://${n.toLowerCase()}.io`, tagline: n + ' tool', launch_date: '2026-10-01' });
  srv = await startServer({ db, dataDir: dir }); ro = await startServer({ db, dataDir: dir, readOnly: true });
});
afterAll(async () => { await srv.close(); await ro.close(); });

describe('v1.2 首页 / 关注 / 报告 / 引导', () => {
  it('首页：已有数据作为基线，之后添加的才算今日新增', async () => {
    const h0 = (await call(srv.url, '/api/home')).data; expect(h0).toMatchObject({ mode: 'recent', newToday: 0, total: 3 }); expect(h0.items).toHaveLength(3);
    await new Promise(r => setTimeout(r, 5));
    await call(srv.url, '/api/products', 'POST', { name: 'Delta', url: 'https://delta.io' });
    const h1 = (await call(srv.url, '/api/home')).data; expect(h1).toMatchObject({ mode: 'new', newToday: 1, newAll: 1 }); expect(h1.items[0].name).toBe('Delta');
  });
  it('关注：PUT/DELETE、列表标记、按关注筛选、状态计数', async () => {
    const g = (await call(srv.url, '/api/products/query', 'POST', { q: 'Alpha' })).data.items[0].guid;
    expect((await call(srv.url, '/api/favorites/' + g, 'PUT')).data).toEqual({ favorite: true });
    expect((await call(srv.url, '/api/products/' + g)).data.favorite).toBe(true);
    const q = (await call(srv.url, '/api/products/query', 'POST', { filter: { type: 'cond', field: 'favorite', op: 'is_true' } })).data; expect(q.total).toBe(1); expect(q.items[0].favorite).toBe(true);
    expect((await call(srv.url, '/api/status')).data.favorites).toBe(1);
    expect((await call(ro.url, '/api/favorites/' + g, 'DELETE')).status).toBe(403);
    await call(srv.url, '/api/favorites/' + g, 'DELETE'); expect((await call(srv.url, '/api/products/' + g)).data.favorite).toBe(false);
  });
  it('关注的产品再次发布 → 首页「新动态」', async () => {
    const g = (await call(srv.url, '/api/products/query', 'POST', { q: 'Beta' })).data.items[0].guid; await call(srv.url, '/api/favorites/' + g, 'PUT');
    await new Promise(r => setTimeout(r, 5)); upsertProduct(db, { name: 'Beta', url: 'https://beta.io', tagline: 'Beta 2.0 发布' }, { versionLabel: 'v2' });
    expect((await call(srv.url, '/api/home')).data.favUpdates.map((p: any) => p.name)).toContain('Beta');
  });
  it('分析报告：HTML / Markdown，中文文件名', async () => {
    const h = await call(srv.url, '/api/report?format=html'); expect(h.status).toBe(200); expect(h.data).toContain('统一产品库分析报告'); expect(h.headers.get('content-disposition')).toContain("filename*=UTF-8''");
    const m = await call(srv.url, '/api/report?format=md'); expect(m.data).toMatch(/^# 统一产品库分析报告/); expect(m.data).toContain('| 1 |');
  });
  it('引导完成标记写入设置', async () => {
    expect((await call(srv.url, '/api/settings')).data['app.onboarded']).toBe('');
    await call(srv.url, '/api/settings', 'POST', { 'app.onboarded': '1' }); expect((await call(srv.url, '/api/settings')).data['app.onboarded']).toBe('1');
  });
  it('安装包内 gzip 种子库首次启动自动解压', async () => {
    const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-seed-')); db.saveNow();
    fs.writeFileSync(path.join(seedDir, 'producthub.db.gz'), zlib.gzipSync(fs.readFileSync(path.join(dir, 'x.db'))));
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-data-'));
    const b = await boot({ dataDir: data, port: 0, host: '127.0.0.1', seedDb: path.join(seedDir, 'producthub.db'), scheduler: false });
    expect((await call(b.url, '/api/status')).data.products).toBe(4); await b.close();
  });
});

describe('v1.2 搜索排序', () => {
  it('名称匹配优先于仅描述匹配', async () => {
    await call(srv.url, '/api/products', 'POST', { name: 'Notes Helper', url: 'https://noteshelper.io', tagline: 'like notion but simpler' });
    await call(srv.url, '/api/products', 'POST', { name: 'Notion', url: 'https://notion.so', tagline: 'workspace' });
    const r = (await call(srv.url, '/api/products/query', 'POST', { q: 'notion' })).data; expect(r.items[0].name).toBe('Notion'); expect(r.total).toBe(2);
  });
});
