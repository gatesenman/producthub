import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { DB } from '../../src/server/db';
import { exportProducts, importProducts } from '../../src/server/importexport';
import { importSourcesCsv, listSources, updateSource, deleteSource } from '../../src/server/sources';
import { upsertProduct } from '../../src/server/products';
import { Scheduler } from '../../src/server/scheduler';

const seed = async () => { const db = await DB.open(null); upsertProduct(db, { name: 'Alpha', url: 'https://alpha.ai', tagline: 'AI writer, "quoted", 逗号，', tags: ['免费'] }); upsertProduct(db, { name: '中文产品', url: 'https://zh.cn', tagline: '效率工具' }); return db; };

describe('导入导出', () => {
  for (const fmt of ['csv', 'xlsx', 'json'] as const) it(`${fmt} 往返：导出后导入到新库数据一致、重复导入不产生新产品`, async () => {
    const a = await seed(); const out = exportProducts(a, fmt);
    const b = await DB.open(null); const r = importProducts(b, fmt, Buffer.isBuffer(out.body) ? out.body : Buffer.from(out.body));
    expect(r).toMatchObject({ total: 2, inserted: 2 });
    const x = b.get<any>("SELECT * FROM products WHERE name='Alpha'"); expect(x.tagline).toBe('AI writer, "quoted", 逗号，'); expect(JSON.parse(x.tags)).toContain('免费');
    expect(x.guid).toBe(a.get<any>("SELECT guid FROM products WHERE name='Alpha'").guid);
    const r2 = importProducts(b, fmt, Buffer.isBuffer(out.body) ? out.body : Buffer.from(out.body)); expect(r2.inserted).toBe(0); expect(b.get<any>('SELECT COUNT(*) c FROM products').c).toBe(2);
  });
  it('支持英文列名、跳过无名称行', async () => {
    const db = await DB.open(null); const r = importProducts(db, 'csv', 'name,url,category\nFoo,foo.com,开发者工具\n,bar.com,\n');
    expect(r).toMatchObject({ inserted: 1, skipped: 1 }); expect(db.get<any>('SELECT category FROM products').category).toBe('dev');
  });
  it('导出按筛选条件', async () => { const db = await seed(); const out = exportProducts(db, 'json', { q: 'Alpha' }); expect(JSON.parse(out.body as string).count).toBe(1); });
  it('xlsx 表头为中文', async () => { const db = await seed(); const wb = XLSX.read(exportProducts(db, 'xlsx').body, { type: 'buffer' }); expect(Object.keys(XLSX.utils.sheet_to_json<any>(wb.Sheets['产品'])[0])).toContain('名称'); });
});

describe('来源 & 调度', () => {
  it('导入用户提供的 241 个来源 CSV，GUID 稳定，可重复导入', async () => {
    const db = await DB.open(null); const csv = fs.readFileSync('data/sources.csv', 'utf8');
    const r = importSourcesCsv(db, csv); expect(r.total).toBe(241); const n = listSources(db).length; expect(n).toBeGreaterThan(230);
    const r2 = importSourcesCsv(db, csv); expect(r2.inserted).toBe(0); expect(listSources(db).length).toBe(n);
    const ph = listSources(db).find((s: any) => s.name === 'Product Hunt'); expect(ph.category).toBe('产品发布平台'); expect(ph.guid).toMatch(/^[0-9a-f-]{36}$/);
    expect(updateSource(db, ph.guid, { enabled: 0, interval_min: 60, rule_json: { mode: 'rss' } }).interval_min).toBe(60);
    deleteSource(db, ph.guid); expect(listSources(db).length).toBe(n - 1);
  });
  it('调度器只挑选到期且启用的来源，失败退避', async () => {
    const db = await DB.open(null); importSourcesCsv(db, '序号,名称,网址\n1,A,https://a.com\n2,B,https://b.com\n3,C,https://c.com\n');
    const s = new Scheduler(db, '/tmp'); expect(s.dueSources(10)).toHaveLength(3);
    db.run("UPDATE sources SET last_crawl_at=datetime('now'), last_status='ok' WHERE name='A'"); db.run("UPDATE sources SET enabled=0 WHERE name='B'");
    db.run("UPDATE sources SET last_crawl_at=datetime('now','-2 days'), last_status='error', interval_min=1440 WHERE name='C'");
    expect(s.dueSources(10)).toHaveLength(0);
    db.run("UPDATE sources SET last_crawl_at=datetime('now','-4 days') WHERE name='C'"); expect(s.dueSources(10).map((x: any) => x.name)).toEqual(['C']);
    expect(s.status()).toMatchObject({ enabled: true, due: 1 });
  });
});
