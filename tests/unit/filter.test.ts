import { describe, it, expect, beforeAll } from 'vitest';
import { DB } from '../../src/server/db';
import { compile, queryProducts, Group } from '../../src/server/filter';
import { upsertProduct } from '../../src/server/products';
import { upsertSource } from '../../src/server/sources';
import { sourceGuid } from '../../src/server/util';

let db: DB;
beforeAll(async () => {
  db = await DB.open(null); upsertSource(db, { name: 'S1', url: 'https://s1.com' });
  upsertProduct(db, { name: 'Alpha', url: 'https://alpha.ai', tagline: 'AI writing assistant', tags: ['免费'], votes: 100, launch_date: '2026-01-10' }, { sourceGuid: sourceGuid('https://s1.com') });
  upsertProduct(db, { name: 'Beta', url: 'https://beta.dev', tagline: 'Open-source CLI for developers', votes: 5, launch_date: '2026-05-01' });
  upsertProduct(db, { name: 'Gamma', url: 'https://gamma.fit', tagline: 'Workout tracker', votes: 50, launch_date: '2026-09-01', logo_url: 'https://x/y.png' });
  upsertProduct(db, { name: 'Delta 100% sale_', tagline: 'payment invoice' });
});
const names = (f: Group | null, extra: any = {}) => queryProducts(db, { filter: f, sort: 'name', ...extra }).items.map((p: any) => p.name);

describe('复杂筛选', () => {
  it('AND / OR / NOT 嵌套', () => {
    expect(names({ type: 'group', op: 'AND', children: [{ type: 'cond', field: 'votes', op: 'gte', value: 10 }, { type: 'cond', field: 'name', op: 'contains', value: 'a' }] })).toEqual(['Alpha', 'Gamma']);
    expect(names({ type: 'group', op: 'OR', children: [{ type: 'cond', field: 'category', op: 'in', value: ['dev'] }, { type: 'group', op: 'AND', children: [{ type: 'cond', field: 'votes', op: 'between', value: [40, 60] }] }] })).toEqual(['Beta', 'Gamma']);
    expect(names({ type: 'group', op: 'AND', not: true, children: [{ type: 'cond', field: 'votes', op: 'gt', value: 0 }] })).toEqual(['Delta 100% sale_']);
  });
  it('标签数组、布尔、日期、渠道、空值', () => {
    expect(names({ type: 'group', op: 'AND', children: [{ type: 'cond', field: 'tags', op: 'has_any', value: ['免费'] }] })).toEqual(['Alpha']);
    expect(names({ type: 'group', op: 'AND', children: [{ type: 'cond', field: 'has_logo', op: 'is_true' }] })).toEqual(['Gamma']);
    expect(names({ type: 'group', op: 'AND', children: [{ type: 'cond', field: 'launch_date', op: 'between', value: ['2026-04-01', '2026-09-30'] }] })).toEqual(['Beta', 'Gamma']);
    expect(names({ type: 'group', op: 'AND', children: [{ type: 'cond', field: 'source', op: 'in', value: [sourceGuid('https://s1.com')] }] })).toEqual(['Alpha']);
    expect(names({ type: 'group', op: 'AND', children: [{ type: 'cond', field: 'url', op: 'empty' }] })).toEqual(['Delta 100% sale_']);
  });
  it('LIKE 通配符被转义；参数化防注入', () => {
    expect(names({ type: 'group', op: 'AND', children: [{ type: 'cond', field: 'name', op: 'contains', value: '100%' }] })).toEqual(['Delta 100% sale_']);
    expect(names({ type: 'group', op: 'AND', children: [{ type: 'cond', field: 'name', op: 'eq', value: "x' OR 1=1 --" }] })).toEqual([]);
    expect(() => compile({ type: 'cond', field: 'name; DROP', op: 'eq' } as any, [])).toThrow(); expect(() => compile({ type: 'cond', field: 'name', op: 'bad' } as any, [])).toThrow();
  });
  it('关键词搜索 + 分类(含子类) + 分页 + 排序', () => {
    expect(names(null, { q: 'writing' })).toEqual(['Alpha']);
    expect(names(null, { category: 'ai' })).toEqual(['Alpha']);
    const r = queryProducts(db, { sort: 'votes', page: 2, pageSize: 2 }); expect(r.total).toBe(4); expect(r.items.map((p: any) => p.name)).toEqual(['Beta', 'Delta 100% sale_']);
  });
});
