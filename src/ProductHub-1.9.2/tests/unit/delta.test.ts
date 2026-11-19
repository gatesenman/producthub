/** v1.9 增量更新：打包/发布/检查/下载/校验/合并/回滚 全链路单测 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { DB } from '../../src/server/db';
import { upsertProduct, deleteProduct } from '../../src/server/products';
import { buildDeltaPack, applyDelta, parseDelta, writeDeltaFile, serializeDelta, bodyChecksum, planUpdates, checkDelta, downloadVerified, sha256, localSeq, DeltaError } from '../../src/server/delta';
import { publishDelta } from '../../src/server/delta-publish';
import { DeltaJobs } from '../../src/server/delta-job';
import { queryProducts } from '../../src/server/filter';
import { syncFts } from '../../src/server/search/fts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-delta-'));
const T = (d: string) => `2099-01-${d}T00:00:00.000Z`;
const stamp = (db: DB, names: string[], ts: string) => db.run(`UPDATE products SET created_at=?, updated_at=? WHERE name IN (${names.map(() => '?').join(',')})`, [ts, ts, ...names]);
const fingerprint = (db: DB) => JSON.stringify([db.get<any>('SELECT COUNT(*) c, group_concat(guid||name||COALESCE(tagline,\'\'), \',\') h FROM (SELECT * FROM products ORDER BY guid)'), db.get<any>('SELECT COUNT(*) c FROM alt_rel'), db.getSetting('delta.seq')]);
const tomb = (db: DB, ts: string) => { db.run('UPDATE deleted_products SET deleted_at=?', [ts]); db.run('UPDATE deleted_alt_rel SET deleted_at=?', [ts]); };
const ftsHas = (db: DB, term: string) => { syncFts(db); return db.all<any>('SELECT rowid FROM products_fts WHERE products_fts MATCH ?', [`"${term}"`]).length > 0; };

/** 维护端库：基线（seq 0）+ 两轮变化 */
async function publisher() {
  const src = await DB.open(null);
  upsertProduct(src, { name: 'Base One', url: 'https://base.one', tagline: 'base' }); upsertProduct(src, { name: 'Will Delete', url: 'https://will.delete', tagline: 'gone soon' });
  upsertProduct(src, { name: 'Fav Target', url: 'https://fav.target', tagline: 'fav' });
  src.run('UPDATE products SET created_at=?, updated_at=?', [T('01'), T('01')]);
  return src;
}
/** 用户端库：与基线一致 + 收藏 / 备注 / 手动产品 */
async function client(file: string | null = null) {
  const dst = await DB.open(file);
  for (const p of [{ name: 'Base One', url: 'https://base.one', tagline: 'base' }, { name: 'Will Delete', url: 'https://will.delete', tagline: 'gone soon' }, { name: 'Fav Target', url: 'https://fav.target', tagline: 'fav' }]) upsertProduct(dst, p);
  const fav = dst.get<any>("SELECT guid FROM products WHERE name='Fav Target'").guid;
  dst.run('INSERT INTO favorites(product_guid, created_at) VALUES(?,?)', [fav, T('01')]);
  dst.run("UPDATE products SET notes='我的备注' WHERE name='Base One'");
  const m = upsertProduct(dst, { name: 'My Manual', url: 'https://my.manual', tagline: 'user-tagline' }, { origin: 'manual' });
  dst.run("UPDATE products SET origin='manual' WHERE guid=?", [m.guid]);
  return dst;
}

describe('增量更新 v2：打包 / 合并策略', () => {
  it('新增 + 更新已有 + 删除（墓碑）+ alt_rel 增删 + FTS 同步', async () => {
    const src = await publisher();
    upsertProduct(src, { name: 'Brand New', url: 'https://brand.new', tagline: 'zebrafish analytics' }); stamp(src, ['Brand New'], T('05'));
    upsertProduct(src, { name: 'Base One', url: 'https://base.one', tagline: 'base', description: 'now with a much longer description' }); src.run("UPDATE products SET updated_at=? WHERE name='Base One'", [T('05')]);
    const nb = src.get<any>("SELECT guid FROM products WHERE name='Brand New'").guid; src.run('INSERT INTO alt_rel(target, product_guid, src) VALUES(?,?,?)', ['notion', nb, 't']);
    deleteProduct(src, src.get<any>("SELECT guid FROM products WHERE name='Will Delete'").guid); tomb(src, T('05'));
    const pack = buildDeltaPack(src, { since: T('02'), until: '2099-02-01T00:00:00.000Z', fromSeq: 0, toSeq: 1 });
    expect(pack.version).toBe(2); expect(pack.counts.products).toBe(2); expect(pack.counts.deleted).toBe(1); expect(pack.checksum?.body).toBe(bodyChecksum(pack));
    const dst = await client(); expect(ftsHas(dst, 'zebrafish')).toBe(false);
    const r = applyDelta(dst, pack);
    expect(r).toMatchObject({ status: 'applied', inserted: 1, updated: 1, deleted: 1, seq_before: 0, seq_after: 1, alt_rel_added: 1 });
    expect(dst.get<any>("SELECT description FROM products WHERE name='Base One'").description).toContain('much longer');
    expect(dst.get<any>("SELECT notes FROM products WHERE name='Base One'").notes).toBe('我的备注');
    expect(dst.get<any>("SELECT 1 x FROM products WHERE name='Will Delete'")).toBeUndefined();
    expect(ftsHas(dst, 'zebrafish')).toBe(true); expect(ftsHas(dst, 'gone')).toBe(false);
    expect(dst.get<any>("SELECT COUNT(*) c FROM alt_rel WHERE target='notion'").c).toBe(1);
    expect(localSeq(dst)).toBe(1);
    // 搜索可见
    const res: any = queryProducts(dst, { q: 'zebrafish' } as any); expect(JSON.stringify(res)).toContain('Brand New');
    // alt_rel 删除也能下发
    src.run("DELETE FROM alt_rel WHERE target='notion'"); tomb(src, '2099-03-01T00:00:00.000Z');
    const p2 = buildDeltaPack(src, { since: '2099-02-01T00:00:00.000Z', until: '2999-01-01T00:00:00.000Z', fromSeq: 1, toSeq: 2 });
    expect(p2.counts.alt_rel_deleted).toBe(1); const r2 = applyDelta(dst, p2); expect(r2.alt_rel_removed).toBe(1);
  });

  it('收藏 / 备注 / 手动产品不被覆盖，也不会被墓碑删除', async () => {
    const src = await publisher();
    // 包里同名手动产品（抓取到了同一产品，想覆盖 tagline）+ 删除收藏的产品 + 删除有备注的产品
    upsertProduct(src, { name: 'My Manual', url: 'https://my.manual', tagline: 'crawler-tagline', description: 'crawler-desc', pricing: 'Free' }); stamp(src, ['My Manual'], T('05'));
    deleteProduct(src, src.get<any>("SELECT guid FROM products WHERE name='Fav Target'").guid);
    deleteProduct(src, src.get<any>("SELECT guid FROM products WHERE name='Base One'").guid); tomb(src, T('05'));
    const pack = buildDeltaPack(src, { since: T('02'), until: '2999-01-01T00:00:00.000Z', fromSeq: 0, toSeq: 1 });
    const dst = await client(); const favBefore = dst.all('SELECT * FROM favorites');
    const r = applyDelta(dst, pack);
    const m = dst.get<any>("SELECT * FROM products WHERE name='My Manual'");
    expect(m.origin).toBe('manual'); expect(m.tagline).toBe('user-tagline'); expect(m.description).toBe('crawler-desc'); expect(m.pricing).toBe('Free');
    expect(r.delete_protected).toBe(2); expect(dst.all('SELECT * FROM favorites')).toEqual(favBefore);
    expect(dst.get<any>("SELECT notes FROM products WHERE name='Base One'").notes).toBe('我的备注');
    // 用户筛选、来源设置不变
  });

  it('来源：保留本地 enabled / interval_min / rule_json', async () => {
    const src = await publisher(); const dst = await client();
    for (const d of [src, dst]) d.run("INSERT INTO sources(guid,name,url,enabled,interval_min,rule_json) VALUES('s1','Src','https://src.x',1,1440,NULL)");
    dst.run("UPDATE sources SET enabled=0, interval_min=99, rule_json='{\"mode\":\"rss\"}' WHERE guid='s1'"); src.run("UPDATE sources SET name='Src Renamed', intro='new intro' WHERE guid='s1'");
    upsertProduct(src, { name: 'Sourced', url: 'https://sourced.x' }, { sourceGuid: 's1' }); stamp(src, ['Sourced'], T('05'));
    applyDelta(dst, buildDeltaPack(src, { since: T('02'), until: '2999-01-01T00:00:00.000Z', fromSeq: 0, toSeq: 1 }));
    expect(dst.get<any>("SELECT name,intro,enabled,interval_min,rule_json FROM sources WHERE guid='s1'")).toEqual({ name: 'Src Renamed', intro: 'new intro', enabled: 0, interval_min: 99, rule_json: '{"mode":"rss"}' });
  });
});

describe('增量更新 v2：序号链 / 幂等 / 跳版本', () => {
  it('同一包重复导入幂等；按顺序连续应用；不连续拒绝且库不变；累积包可跳过中间版本', async () => {
    const src = await publisher(); const idxPath = path.join(tmp, 'chain', 'index.json');
    upsertProduct(src, { name: 'Wave1 A', url: 'https://w1.a' }); stamp(src, ['Wave1 A'], T('05'));
    const r1 = publishDelta(src, { indexPath: idxPath, since: T('02'), until: T('06') });
    upsertProduct(src, { name: 'Wave2 B', url: 'https://w2.b' }); stamp(src, ['Wave2 B'], T('08'));
    const r2 = publishDelta(src, { indexPath: idxPath, until: T('09') });
    expect(r1.created[0]).toMatchObject({ from_seq: 0, to_seq: 1, products: 1 }); expect(r2.created[0]).toMatchObject({ from_seq: 1, to_seq: 2, products: 1, since: T('06') });
    const file = (n: number) => fs.readFileSync(path.join(tmp, 'chain', r2.index.packs![n].file!));

    // 不连续：本地 #0 直接应用 #1→#2 → 拒绝，库不变
    const dst = await client(); const fp0 = fingerprint(dst);
    expect(() => applyDelta(dst, file(1))).toThrow(/不连续/); expect(fingerprint(dst)).toBe(fp0);
    // 顺序应用
    expect(applyDelta(dst, file(0)).status).toBe('applied'); expect(localSeq(dst)).toBe(1);
    const fp1 = fingerprint(dst);
    // 重复导入：幂等
    const again = applyDelta(dst, file(0)); expect(again.status).toBe('already-applied'); expect(fingerprint(dst)).toBe(fp1);
    expect(applyDelta(dst, file(1)).inserted).toBe(1); expect(localSeq(dst)).toBe(2);
    expect(applyDelta(dst, file(1)).status).toBe('already-applied');

    // 累积包 #0→#3：新用户（#0）一步到位，跳过中间版本
    upsertProduct(src, { name: 'Wave3 C', url: 'https://w3.c' }); stamp(src, ['Wave3 C'], T('10'));
    const r3 = publishDelta(src, { indexPath: idxPath, cumulativeFrom: 0, since: T('02'), until: T('11') });
    expect(r3.created[0]).toMatchObject({ from_seq: 0, to_seq: 3, products: 3 });
    const fresh = await client();
    expect(planUpdates(r3.index, 0).plan.map(p => `${p.from_seq}-${p.to_seq}`)).toEqual(['0-3']);
    expect(planUpdates(r3.index, 2).plan.map(p => `${p.from_seq}-${p.to_seq}`)).toEqual(['0-3']); // 累积包覆盖 #2 用户
    expect(planUpdates({ latest: '', latest_seq: 3, packs: [r1.created[0], { ...r3.created[0], from_seq: 2 }] } as any, 1).gap).toBe(true); // 缺 #1→#2：报缺口
    applyDelta(fresh, fs.readFileSync(path.join(tmp, 'chain', r3.created[0].file!))); expect(localSeq(fresh)).toBe(3);
    expect(fresh.get<any>("SELECT COUNT(*) c FROM products WHERE name IN ('Wave1 A','Wave2 B','Wave3 C')").c).toBe(3);
    // 再出一个常规包 #3→#4：#0 用户走 0→3→4 两步
    upsertProduct(src, { name: 'Wave4 D', url: 'https://w4.d' }); stamp(src, ['Wave4 D'], T('12'));
    const r4 = publishDelta(src, { indexPath: idxPath, until: T('13') });
    expect(r4.created[0]).toMatchObject({ from_seq: 3, to_seq: 4, since: T('11') });
    expect(planUpdates(r4.index, 0).plan.map(p => `${p.from_seq}-${p.to_seq}`)).toEqual(['0-3', '3-4']);
    expect(planUpdates(r4.index, 1).plan.map(p => `${p.from_seq}-${p.to_seq}`)).toEqual(['0-3', '3-4']);
    expect(planUpdates(r4.index, 4).plan).toEqual([]);
  });

  it('大包拆分：--split 生成首尾相接的多个包，顺序应用结果等于一次全量', async () => {
    const src = await publisher();
    for (let i = 0; i < 250; i++) { upsertProduct(src, { name: `Split Item ${i}`, url: `https://split${i}.dev` }); src.run('UPDATE products SET created_at=?, updated_at=? WHERE name=?', [`2099-01-05T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`, `2099-01-05T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`, `Split Item ${i}`]); }
    const idx = path.join(tmp, 'split', 'index.json');
    const r = publishDelta(src, { indexPath: idx, since: T('02'), until: T('06'), split: 100 });
    expect(r.created.length).toBe(3); expect(r.created.map(c => c.products || 0).reduce((a, b) => a + b, 0)).toBe(250);
    expect(r.created.map(c => `${c.from_seq}-${c.to_seq}`)).toEqual(['0-1', '1-2', '2-3']);
    const dst = await client(); for (const c of r.created) applyDelta(dst, fs.readFileSync(path.join(tmp, 'split', c.file!)));
    expect(dst.get<any>("SELECT COUNT(*) c FROM products WHERE name LIKE 'Split Item %'").c).toBe(250); expect(localSeq(dst)).toBe(3);
  });
});

describe('增量更新 v2：拒绝坏包且库不变（事务回滚）', () => {
  let pack: any; let gz: Buffer;
  beforeAll(async () => { const src = await publisher(); upsertProduct(src, { name: 'Good New', url: 'https://good.new' }); stamp(src, ['Good New'], T('05')); pack = buildDeltaPack(src, { since: T('02'), until: '2999-01-01T00:00:00.000Z', fromSeq: 0, toSeq: 1 }); gz = zlib.gzipSync(serializeDelta(pack)); });
  const cases: [string, () => Buffer | any, RegExp][] = [
    ['gzip 截断', () => gz.subarray(0, Math.floor(gz.length / 2)), /解压失败|损坏/],
    ['随机字节', () => Buffer.from('not a pack at all'), /不是合法 JSON/],
    ['内容被改但校验和没改', () => { const j = JSON.parse(JSON.stringify(pack)); j.products[0].name = 'Tampered'; return Buffer.from(JSON.stringify(j)); }, /校验和不匹配/],
    ['缺校验和', () => { const j = JSON.parse(JSON.stringify(pack)); delete j.checksum; return Buffer.from(JSON.stringify(j)); }, /缺少校验和/],
    ['包版本不支持', () => { const j = JSON.parse(JSON.stringify(pack)); j.version = 99; return Buffer.from(JSON.stringify(j)); }, /不支持的增量包版本/],
    ['格式不对', () => Buffer.from(JSON.stringify({ format: 'other', version: 2, products: [] })), /不支持的增量包格式/],
    ['数据集不匹配', () => { const j = JSON.parse(JSON.stringify(pack)); j.dataset = 'someone-else'; return Buffer.from(JSON.stringify(j)); }, /数据集/],
  ];
  for (const [name, mk, re] of cases) it(name, async () => { const dst = await client(); const fp = fingerprint(dst); expect(() => applyDelta(dst, mk())).toThrow(re); expect(fingerprint(dst)).toBe(fp); });
  it('文件 SHA256 / 大小与索引不符', async () => { const dst = await client(); const fp = fingerprint(dst);
    expect(() => applyDelta(dst, gz, undefined, { sha256: 'a'.repeat(64) })).toThrow(/SHA256/); expect(() => applyDelta(dst, gz, undefined, { size: gz.length + 1 })).toThrow(/大小不符/); expect(fingerprint(dst)).toBe(fp); });
  it('合并中途出错 → 整个包回滚（已写入的产品、seq 都撤销）', async () => {
    const j = JSON.parse(JSON.stringify(pack)); j.deleted = [{ guid: { bad: 1 } }]; j.checksum.body = bodyChecksum(j);
    const dst = await client(); const fp = fingerprint(dst);
    expect(() => applyDelta(dst, j)).toThrow(); expect(fingerprint(dst)).toBe(fp); expect(dst.get<any>("SELECT 1 x FROM products WHERE name='Good New'")).toBeUndefined(); expect(localSeq(dst)).toBe(0);
  });
});

describe('增量更新 v2：下载（断点续传 / 校验 / 无半包落库）', () => {
  let srv: http.Server; let base = ''; let body = Buffer.alloc(0); let mode = 'ok'; let hits: string[] = [];
  beforeAll(async () => {
    body = Buffer.from(Array.from({ length: 300_000 }, (_, i) => i % 251));
    srv = http.createServer((req, res) => {
      const range = req.headers.range; hits.push(`${mode}:${range || 'full'}`);
      let start = 0; if (range) start = Number(/bytes=(\d+)-/.exec(range)![1]);
      const chunk = body.subarray(start);
      if (mode === 'drop-once' || mode === 'drop-always') {
        res.writeHead(range ? 206 : 200, { 'content-length': String(chunk.length), ...(range ? { 'content-range': `bytes ${start}-${body.length - 1}/${body.length}` } : {}) });
        res.write(chunk.subarray(0, 100_000)); if (mode === 'drop-once') mode = 'ok'; setTimeout(() => res.destroy(), 20); return;
      }
      const data = mode === 'wrong' ? Buffer.from(chunk).fill(7) : chunk;
      res.writeHead(range ? 206 : 200, { 'content-length': String(data.length), ...(range ? { 'content-range': `bytes ${start}-${body.length - 1}/${body.length}` } : {}) }); res.end(data);
    });
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r())); base = `http://127.0.0.1:${(srv.address() as any).port}`;
  });
  afterAll(() => srv.close());
  it('下载中断 → 自动重试并用 Range 续传，校验通过才落盘', async () => {
    mode = 'drop-once'; hits = []; const dest = path.join(tmp, 'dl', 'a.bin');
    const r = await downloadVerified(`${base}/a`, dest, { sha256: sha256(body), size: body.length }, { retryDelayMs: 10 });
    expect(r.resumed).toBeGreaterThan(0); expect(r.attempts).toBe(2); expect(hits[1]).toMatch(/bytes=\d+-/); expect(sha256(fs.readFileSync(dest))).toBe(sha256(body)); expect(fs.existsSync(dest + '.part')).toBe(false);
  });
  it('内容校验失败 → 丢弃，不留正式文件', async () => {
    mode = 'wrong'; const dest = path.join(tmp, 'dl', 'b.bin');
    await expect(downloadVerified(`${base}/b`, dest, { sha256: sha256(body), size: body.length }, { retries: 1, retryDelayMs: 10 })).rejects.toThrow(/SHA256/);
    expect(fs.existsSync(dest)).toBe(false); expect(fs.existsSync(dest + '.part')).toBe(false);
  });
  it('一直中断 → 重试耗尽报错，不留正式文件', async () => {
    mode = 'drop-always'; const dest = path.join(tmp, 'dl', 'c.bin');
    await expect(downloadVerified(`${base}/c`, dest, { sha256: sha256(body), size: body.length }, { retries: 1, retryDelayMs: 10 })).rejects.toThrow(/中断|下载/); expect(fs.existsSync(dest)).toBe(false); mode = 'ok';
  });
});

describe('增量更新 v2：后台任务端到端（索引 URL → 检查 → 下载 → 合并 → 搜索 → 重启仍在）', () => {
  it('HTTP 索引更新链 + 重启持久化', async () => {
    const src = await publisher(); const dir = path.join(tmp, 'pub'); const idx = path.join(dir, 'index.json');
    upsertProduct(src, { name: 'Quokka Notes', url: 'https://quokka.notes', tagline: 'quokka powered notes' }); stamp(src, ['Quokka Notes'], T('05')); publishDelta(src, { indexPath: idx, since: T('02'), until: T('06') });
    upsertProduct(src, { name: 'Narwhal CRM', url: 'https://narwhal.crm', tagline: 'narwhal sales crm' }); stamp(src, ['Narwhal CRM'], T('08')); publishDelta(src, { indexPath: idx, until: T('09') });
    const srv = http.createServer((req, res) => { const f = path.join(dir, decodeURIComponent(req.url!.slice(1))); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); } const b = fs.readFileSync(f); res.writeHead(200, { 'content-length': String(b.length) }); res.end(b); });
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r())); const url = `http://127.0.0.1:${(srv.address() as any).port}/index.json`;
    const file = path.join(tmp, 'client.db'); const dataDir = path.join(tmp, 'client-data'); fs.mkdirSync(dataDir, { recursive: true });
    let dst = await client(file);
    const c = await checkDelta(dst, url); expect(c).toMatchObject({ localSeq: 0, latestSeq: 2, upToDate: false }); expect(c.plan.length).toBe(2);
    const jobs = new DeltaJobs(dst, dataDir); jobs.startUpdate(url); expect(() => jobs.startUpdate(url)).toThrow(/进行中/);
    const j = await jobs.wait(); expect(j.state).toBe('done'); expect(j.results.map(r => r.seq_after)).toEqual([1, 2]);
    expect(JSON.stringify(queryProducts(dst, { q: 'narwhal' } as any))).toContain('Narwhal CRM');
    expect((await checkDelta(dst, url)).upToDate).toBe(true);
    dst.close(); dst = await DB.open(file); // 重启
    expect(localSeq(dst)).toBe(2); expect(JSON.stringify(queryProducts(dst, { q: 'quokka' } as any))).toContain('Quokka Notes');
    const j2 = new DeltaJobs(dst, dataDir); j2.startUpdate(url); expect((await j2.wait()).message).toMatch(/已是最新/);
    srv.close(); dst.close();
  });
});
