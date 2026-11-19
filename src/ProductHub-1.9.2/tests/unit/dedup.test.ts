/** v1.9 去重：规范化 URL / 同域名同名 / 共享域名 / 无网址条目 / 用户数据保护 / 增量导入不产生重复 */
import { describe, it, expect } from 'vitest';
import { DB } from '../../src/server/db';
import { upsertProduct } from '../../src/server/products';
import { normalizeUrl } from '../../src/server/util';
import { clusterSameName, mergeGroup, nameKey, regDomain } from '../../src/server/dedup';
import { buildDeltaPack, applyDelta } from '../../src/server/delta';
import { syncFts } from '../../src/server/search/fts';

const cnt = (db: DB, name: string) => db.get<any>('SELECT COUNT(*) c FROM products WHERE name_key=?', [nameKey(name)]).c;
const mk = async () => DB.open(null);

describe('URL 规范化', () => {
  it('http/www/尾斜杠/utm/跟踪参数/index.html 归一', () => {
    const want = 'https://foo.com/app';
    for (const u of ['http://www.foo.com/app/', 'https://foo.com/app?utm_source=x&utm_medium=y', 'foo.com/app#top', 'https://FOO.com/app?fbclid=1&gclid=2&ref=ph', 'https://foo.com:443/app/', 'https://www.foo.com/app?_hsenc=1&mkt_tok=2']) expect(normalizeUrl(u)).toBe(want);
    expect(normalizeUrl('https://foo.com/index.html')).toBe('https://foo.com');
    expect(normalizeUrl('https://foo.com/?page=2')).toBe('https://foo.com/?page=2');
    expect(regDomain('app.foo.co.uk')).toBe('foo.co.uk'); expect(regDomain('alice.github.io')).toBe('alice.github.io'); expect(regDomain('shop.lemonsqueezy.com')).toBe('shop.lemonsqueezy.com'); expect(regDomain('a.b.foo.com')).toBe('foo.com');
  });
});

describe('入库即去重（upsertProduct）', () => {
  it('同规范化 URL / 同可注册域名+同名 → 一条；不同域名同名 → 不合并', async () => {
    const db = await mk();
    upsertProduct(db, { name: 'Foo', url: 'http://www.foo.com/?utm_source=a' });
    upsertProduct(db, { name: 'Foo', url: 'https://foo.com/' });
    upsertProduct(db, { name: 'Foo', url: 'https://app.foo.com' });
    expect(cnt(db, 'Foo')).toBe(1);
    upsertProduct(db, { name: 'Foo', url: 'https://foo.io' });
    expect(cnt(db, 'Foo')).toBe(2);
    upsertProduct(db, { name: 'Atomic Agents', url: 'https://alice.github.io/atomic-agents' });
    upsertProduct(db, { name: 'Atomic Agents', url: 'https://bob.github.io/atomic-agents' });
    upsertProduct(db, { name: 'GetX API', url: 'https://a.lemonsqueezy.com' }); upsertProduct(db, { name: 'GetX API', url: 'https://b.lemonsqueezy.com' });
    expect(cnt(db, 'Atomic Agents')).toBe(2); expect(cnt(db, 'GetX API')).toBe(2);
  });
  it('共享域名只按完整路径：github 不同仓库同名不合并；owner 与官网一致才并入官网', async () => {
    const db = await mk();
    upsertProduct(db, { name: 'Atlas', url: 'https://github.com/foo/atlas' });
    upsertProduct(db, { name: 'Atlas', url: 'https://github.com/bar/atlas' });
    expect(cnt(db, 'Atlas')).toBe(2);
    upsertProduct(db, { name: 'Atlas', url: 'https://atlas.com' });
    expect(cnt(db, 'Atlas')).toBe(3);
    upsertProduct(db, { name: 'Ollama', url: 'https://ollama.com' });
    upsertProduct(db, { name: 'Ollama', url: 'https://github.com/ollama/ollama' });
    expect(cnt(db, 'Ollama')).toBe(1);
    upsertProduct(db, { name: 'Cool Tool', url: 'https://producthunt.com/posts/cool-tool' });
    upsertProduct(db, { name: 'Cool Tool', url: 'https://producthunt.com/posts/cool-tool-2' });
    expect(db.get<any>("SELECT COUNT(*) c FROM products WHERE name='Cool Tool'").c).toBe(2);
  });
  it('无网址条目：唯一候选才并入，有歧义保留', async () => {
    const db = await mk();
    upsertProduct(db, { name: 'Zealos AI', url: 'https://zealos.ai' });
    upsertProduct(db, { name: 'Zealos-AI', description: 'Toolify: https://toolify.ai/tool/zealos-ai' });
    expect(cnt(db, 'Zealos AI')).toBe(1);
    upsertProduct(db, { name: 'Nova', url: 'https://nova.com' }); upsertProduct(db, { name: 'Nova', url: 'https://nova.dev' });
    upsertProduct(db, { name: 'Nova' });
    expect(cnt(db, 'Nova')).toBe(3);
    // 先有无网址条目、后来有官网：并入已有那条并补上网址
    upsertProduct(db, { name: 'Pixbulk' }); upsertProduct(db, { name: 'Pixbulk', url: 'https://pixbulk.com', tagline: 'bulk images' });
    expect(cnt(db, 'Pixbulk')).toBe(1);
    expect(db.get<any>("SELECT url FROM products WHERE name_key='pixbulk'").url).toBe('https://pixbulk.com');
  });
});

describe('整库去重（clusterSameName + mergeGroup）', () => {
  it('合并：保留信息最全/收藏/备注/手动；来源版本与 alt_rel 重定向；别名防止再次产生重复；FTS 同步', async () => {
    const db = await mk();
    // 模拟旧数据：key 规则变更前留下的重复（直接插入绕过入库去重）
    const ins = (guid: string, key: string, name: string, url: string | null, extra: any = {}) => db.run(`INSERT INTO products(guid,dedup_key,name,url,domain,tagline,description,category,tags,platforms,launch_count,origin,notes,first_seen,last_seen,launch_date,created_at,updated_at,name_key) VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?)`,
      [guid, key, name, url, url ? new URL(url).hostname : null, extra.tagline || null, extra.description || null, 'other', JSON.stringify(extra.tags || []), '[]', extra.origin || 'crawl', extra.notes || null, extra.first_seen || '2026-01-02', '2026-01-02', extra.first_seen || '2026-01-02', '2026-01-02', '2026-01-02', nameKey(name)]);
    ins('g1', 'host:acme.com', 'Acme', 'https://acme.com', { tagline: 'short', tags: ['a'] });
    ins('g2', 'host:app.acme.com', 'ACME', 'https://app.acme.com', { description: 'long description here', tags: ['b'], first_seen: '2025-05-05' });
    ins('g3', 'name:acme', 'acme', null, { notes: '我的备注' });
    ins('g4', 'host:acme.io', 'Acme', 'https://acme.io');
    db.run("INSERT INTO favorites(product_guid, created_at) VALUES('g2','2026-01-01')");
    db.run("INSERT INTO alt_rel(target, product_guid, src) VALUES('slack','g3','t')");
    db.run("INSERT INTO product_versions(product_guid, source_guid, launched_at, content_hash, created_at) VALUES('g1','s1','2026-01-01','h1','x'),('g2','s2','2026-01-01','h2','x')");
    const rows = db.all<any>("SELECT guid, dedup_key, domain, origin FROM products WHERE name_key='acme'");
    const groups = clusterSameName(rows);
    // acme.com 与 app.acme.com 同可注册域名 → 一簇；acme.io 是另一个域名；无网址的 g3 因有两个域名簇而有歧义，不并
    expect(groups.length).toBe(1); expect(groups[0].guids.sort()).toEqual(['g1', 'g2']); expect(groups[0].rule).toContain('R2');
    const m = mergeGroup(db, groups[0].guids)!;
    expect(m.winner).toBe('g2'); // 收藏优先
    const w = db.get<any>("SELECT * FROM products WHERE guid='g2'");
    expect(w.tagline).toBe('short'); expect(JSON.parse(w.tags).sort()).toEqual(['a', 'b']); expect(w.first_seen).toBe('2025-05-05'); expect(w.launch_count).toBe(2);
    expect(db.get<any>("SELECT COUNT(*) c FROM products WHERE guid='g1'").c).toBe(0);
    expect(db.get<any>("SELECT merged_into FROM deleted_products WHERE guid='g1'").merged_into).toBe('g2');
    expect(db.get<any>("SELECT guid FROM product_alias WHERE alias='g1'").guid).toBe('g2');
    // 无网址条目在 acme.io 之外只剩一个簇时可以并入；备注保留
    mergeGroup(db, ['g2', 'g3']);
    const w2 = db.get<any>("SELECT notes FROM products WHERE guid='g2'"); expect(w2.notes).toBe('我的备注');
    expect(db.get<any>("SELECT product_guid FROM alt_rel WHERE target='slack'").product_guid).toBe('g2');
    // 抓取再遇到被合并方的 key → 走别名，不重新产生
    upsertProduct(db, { name: 'Acme', url: 'https://acme.com' });
    expect(db.get<any>("SELECT COUNT(*) c FROM products WHERE name_key='acme'").c).toBe(2); // g2 + acme.io
    syncFts(db);
  });
  it('手动产品永远保留为主条目，两个手动产品不合并', async () => {
    const db = await mk();
    db.run(`INSERT INTO products(guid,dedup_key,name,url,domain,origin,launch_count,first_seen,last_seen,created_at,updated_at,name_key,tags,platforms) VALUES('m1','host:beta.com#m','Beta','https://beta.com','beta.com','manual',0,'x','x','x','x','beta','[]','[]'),('c1','host:beta.com','Beta','https://beta.com','beta.com','crawl',3,'x','x','x','x','beta','[]','[]'),('m2','name:beta#2','Beta',NULL,NULL,'manual',0,'x','x','x','x','beta','[]','[]')`);
    const r = mergeGroup(db, ['c1', 'm1', 'm2'])!;
    expect(r.winner).toBe('m1'); expect(r.losers).toEqual(['c1']);
    expect(db.get<any>("SELECT COUNT(*) c FROM products WHERE origin='manual'").c).toBe(2);
  });
});

describe('增量导入不产生重复', () => {
  it('包内 guid 不同但为同一产品 → 并入本地；去重墓碑（merged_into）把本地收藏/备注迁到保留方', async () => {
    const srv = await mk(); const cli = await mk();
    // 客户端本地自己抓到一条（www + utm 变体，key 相同 → guid 相同），以及一条另一个子域的同名产品并收藏
    upsertProduct(cli, { name: 'Gizmo', url: 'https://app.gizmo.com' });
    const local = cli.get<any>("SELECT guid FROM products WHERE name='Gizmo'").guid;
    cli.run('INSERT INTO favorites(product_guid, created_at) VALUES(?,?)', [local, 'x']); cli.run('UPDATE products SET notes=? WHERE guid=?', ['关注', local]);
    upsertProduct(cli, { name: 'Widgetly', url: 'https://widgetly.com' });
    // 服务端：Gizmo 官网（不同 guid）、Widgetly 规范化前的另一个 key 变体
    upsertProduct(srv, { name: 'Gizmo', url: 'https://gizmo.com', tagline: '官方' });
    srv.run("INSERT INTO products(guid,dedup_key,name,url,domain,origin,launch_count,first_seen,last_seen,created_at,updated_at,tags,platforms) VALUES('wx','host:widgetly.com#old','Widgetly','https://www.widgetly.com/?utm_source=x','widgetly.com','crawl',1,'x','x','2099-01-01','2099-01-01','[]','[]')");
    srv.run("UPDATE products SET created_at='2099-01-01', updated_at='2099-01-01'");
    // 服务端整库去重时把另一个 guid（客户端那条）记为并入官网
    srv.run('INSERT INTO deleted_products(guid, dedup_key, deleted_at, merged_into) VALUES(?,?,?,?)', [local, 'host:app.gizmo.com', '2099-01-01T00:00:00.000Z', srv.get<any>("SELECT guid FROM products WHERE name='Gizmo'").guid]);
    const pack = buildDeltaPack(srv, { since: '2099-01-01', until: '2099-12-31', fromSeq: 0, toSeq: 1 });
    const r = applyDelta(cli, pack);
    expect(cli.get<any>("SELECT COUNT(*) c FROM products WHERE name='Gizmo'").c).toBe(1);
    expect(cli.get<any>("SELECT COUNT(*) c FROM products WHERE name='Widgetly'").c).toBe(1);
    const g = cli.get<any>("SELECT guid, notes, tagline FROM products WHERE name='Gizmo'");
    expect(g.notes).toBe('关注'); expect(g.tagline).toBe('官方');
    expect(cli.get<any>('SELECT COUNT(*) c FROM favorites WHERE product_guid=?', [g.guid]).c).toBe(1);
    expect((r.deduped || 0) + (r.merged || 0)).toBeGreaterThanOrEqual(1);
    // 再导入一次：幂等，仍无重复
    applyDelta(cli, { ...pack });
    expect(cli.get<any>("SELECT COUNT(*) c FROM products WHERE name IN ('Gizmo','Widgetly')").c).toBe(2);
  });
});
