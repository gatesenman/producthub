import { describe, it, expect, beforeEach } from 'vitest';
import { DB } from '../../src/server/db';
import { upsertProduct, getProduct, updateProduct, deleteProduct, mergeProducts, findDuplicateCandidates } from '../../src/server/products';
import { upsertSource } from '../../src/server/sources';
import { sourceGuid } from '../../src/server/util';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

let db: DB;
beforeEach(async () => { db = await DB.open(null); });

describe('产品入库 / 去重 / 版本', () => {
  it('新增产品自动分类、打标签、生成 GUID 与向量', () => {
    const r = upsertProduct(db, { name: 'Alpha', url: 'https://www.alpha.ai/?ref=ph', tagline: 'AI writing assistant, free open-source' });
    expect(r.status).toBe('inserted'); const p = getProduct(db, r.guid)!;
    expect(p.domain).toBe('alpha.ai'); expect(p.category).toBe('ai-writing'); expect(p.tags).toContain('开源');
    expect(p.versions).toHaveLength(1); expect(p.launch_count).toBe(1); expect((p as any).embedding).toBeUndefined();
  });
  it('同一官网在不同来源发布 → 合并为一个产品 + 多条版本记录', () => {
    upsertSource(db, { name: 'S1', url: 'https://s1.com' }); upsertSource(db, { name: 'S2', url: 'https://s2.com' });
    const a = upsertProduct(db, { name: 'Alpha', url: 'https://alpha.ai', tagline: 'v1' }, { sourceGuid: sourceGuid('https://s1.com') });
    const b = upsertProduct(db, { name: 'Alpha AI', url: 'http://www.alpha.ai/', tagline: 'v1', description: 'longer description here' }, { sourceGuid: sourceGuid('https://s2.com') });
    expect(b.guid).toBe(a.guid); expect(b.status).toBe('updated'); expect(b.newVersion).toBe(true);
    const p = getProduct(db, a.guid)!; expect(p.launch_count).toBe(2); expect(p.versions.map((v: any) => v.source_name).sort()).toEqual(['S1', 'S2']);
    expect(p.description).toBe('longer description here');
    expect(db.get<any>('SELECT COUNT(*) c FROM products').c).toBe(1);
  });
  it('重复抓取相同内容 → unchanged，不新增版本（增量）', () => {
    const a = upsertProduct(db, { name: 'X', url: 'https://x.io', tagline: 't' }, { sourceGuid: 's' });
    const b = upsertProduct(db, { name: 'X', url: 'https://x.io', tagline: 't' }, { sourceGuid: 's' });
    expect(b.status).toBe('unchanged'); expect(b.newVersion).toBe(false); expect(getProduct(db, a.guid)!.versions).toHaveLength(1);
  });
  it('同一来源再次发布（内容变化）→ 新版本', () => {
    const a = upsertProduct(db, { name: 'X', url: 'https://x.io', tagline: 'v1', launch_date: '2026-01-01' }, { sourceGuid: 's' });
    upsertProduct(db, { name: 'X', url: 'https://x.io', tagline: 'v2 relaunch', launch_date: '2026-06-01' }, { sourceGuid: 's' });
    expect(getProduct(db, a.guid)!.launch_count).toBe(2);
  });
  it('名称为空报错', () => { expect(() => upsertProduct(db, { name: '  ' })).toThrow(); });
  it('编辑、删除、合并、疑似重复', () => {
    const a = upsertProduct(db, { name: 'Same', url: 'https://same1.com' }); const b = upsertProduct(db, { name: 'Same', url: 'https://same2.com' });
    expect(findDuplicateCandidates(db)).toHaveLength(1);
    const u = updateProduct(db, a.guid, { tags: '免费, 开源', pricing: '$0', url: 'https://www.same1.com' })!; expect(u.tags).toEqual(['免费', '开源']); expect(u.domain).toBe('same1.com');
    const m = mergeProducts(db, a.guid, b.guid)!; expect(m.launch_count).toBe(2); expect(getProduct(db, b.guid)).toBeNull();
    deleteProduct(db, a.guid); expect(getProduct(db, a.guid)).toBeNull(); expect(db.get<any>('SELECT COUNT(*) c FROM product_versions').c).toBe(0);
  });
  it('数据库持久化到文件并可重新打开', async () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ph-')), 'a.db'); const d = await DB.open(f);
    upsertProduct(d, { name: 'Persist', url: 'https://p.com' }); d.setSetting('k', 'v'); d.close();
    const d2 = await DB.open(f); expect(d2.get<any>('SELECT name FROM products').name).toBe('Persist'); expect(d2.getSetting('k')).toBe('v');
  });
  it('事务回滚', () => { expect(() => db.tx(() => { upsertProduct(db, { name: 'T', url: 'https://t.com' }); throw new Error('x'); })).toThrow(); expect(db.get<any>('SELECT COUNT(*) c FROM products').c).toBe(0); });
});
