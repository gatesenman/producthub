/**
 * 增量更新端到端：准备客户端基线库 + 发布端更新源（真实历史抓取增量 + 合成用例包）
 *   npx tsx tests/e2e/delta-e2e-prep.ts --main data/crawl/producthub.db --since 2026-11-09T15:08:00.000Z --out /tmp/ph-delta-e2e [--big 60000]
 * 产物：<out>/client-data/producthub.db（用户已装好的 App 数据，#0）、<out>/pub/（index.json + 包）、<out>/meta.json
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DB } from '../../src/server/db';
import { buildDeltaPack, writeDeltaFile, sha256, type DeltaIndexPack } from '../../src/server/delta';
import { rebuildFts } from '../../src/server/search/fts';

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const MAIN = path.resolve(arg('--main', 'data/crawl/producthub.db')!); const SINCE = arg('--since')!; const OUT = path.resolve(arg('--out', '/tmp/ph-delta-e2e')!); const BIG = Number(arg('--big', '60000'));
const MOD = Number(arg('--mod', '40'));
(async () => {
  fs.rmSync(OUT, { recursive: true, force: true }); const CD = path.join(OUT, 'client-data'); const PUB = path.join(OUT, 'pub'); fs.mkdirSync(CD, { recursive: true }); fs.mkdirSync(PUB, { recursive: true });
  const t0 = Date.now(); const main = await DB.open(MAIN); main.db.pragma('query_only = 1');
  // —— 1) 真实增量包 #0→#1：今天历史深挖新增/更新的产品（前 BIG 条） ——
  const p1 = buildDeltaPack(main, { since: SINCE, limit: BIG, fromSeq: 0, toSeq: 1, seedVersionFrom: '1.9.0', seedVersionTo: '1.9.0' });
  const until1 = p1.products.length ? (p1.products[p1.products.length - 1].updated_at || p1.to.until) : p1.to.until; p1.to.until = until1;
  const f1 = path.join(PUB, 'producthub-delta-0000-0001.phdelta.json.gz'); const w1 = writeDeltaFile({ ...p1, checksum: p1.checksum }, f1);
  console.log('pack1', p1.counts, w1.bytes, Date.now() - t0, 'ms');
  const pack1Guids = new Set(p1.products.map(p => p.guid));
  // —— 2) 客户端基线库：主库中今天之前就有的产品的 1/MOD 抽样 + 全部来源 ——
  const cdb = path.join(CD, 'producthub.db'); const cli = await DB.open(cdb); main.db.close();
  cli.db.exec(`ATTACH DATABASE '${MAIN.replace(/'/g, "''")}' AS m`);
  cli.db.exec(`INSERT INTO sources SELECT * FROM m.sources`);
  const cols = cli.all<any>('PRAGMA table_info(products)').map(c => c.name).join(',');
  cli.db.exec(`INSERT INTO products(${cols}) SELECT ${cols} FROM m.products WHERE rowid % ${MOD} = 0 AND created_at < '${SINCE}'`);
  // 同时让包 1 里「更新已有产品」能命中：把包 1 中已存在于主库更早的部分产品放进基线（旧版本内容）
  cli.db.exec(`INSERT OR IGNORE INTO products(${cols}) SELECT ${cols} FROM m.products WHERE created_at < '${SINCE}' AND updated_at >= '${SINCE}' LIMIT 3000`);
  cli.db.exec(`UPDATE products SET tagline = '旧简介：' || COALESCE(tagline,''), updated_at='2026-11-01T00:00:00.000Z' WHERE created_at < '${SINCE}' AND guid IN (SELECT guid FROM m.products WHERE updated_at >= '${SINCE}' AND created_at < '${SINCE}' LIMIT 3000)`);
  cli.db.exec(`INSERT OR IGNORE INTO product_versions(product_guid,source_guid,version_label,launched_at,url,votes,snapshot,content_hash,created_at) SELECT v.product_guid,v.source_guid,v.version_label,v.launched_at,v.url,v.votes,v.snapshot,v.content_hash,v.created_at FROM m.product_versions v WHERE v.product_guid IN (SELECT guid FROM main.products)`);
  cli.db.exec(`INSERT OR IGNORE INTO alt_rel SELECT * FROM m.alt_rel WHERE product_guid IN (SELECT guid FROM main.products)`);
  cli.db.exec('DETACH DATABASE m'); cli.db.exec('DELETE FROM deleted_products; DELETE FROM deleted_alt_rel; DELETE FROM settings');
  // 用户自己的数据：收藏 / 备注 / 手动产品 / 筛选
  const pick = cli.all<any>("SELECT guid, name FROM products WHERE origin<>'manual' ORDER BY rowid LIMIT 5");
  const [favP, noteP, delP, delFavP, updP] = pick;
  cli.run('INSERT INTO favorites(product_guid, created_at) VALUES(?,?),(?,?)', [favP.guid, '2026-11-01T00:00:00Z', delFavP.guid, '2026-11-01T00:00:00Z']);
  cli.run("UPDATE products SET notes='我的备注：重点跟进' WHERE guid=?", [noteP.guid]);
  cli.run("INSERT INTO products(guid,dedup_key,name,url,domain,tagline,origin,notes,created_at,updated_at,first_seen,last_seen,tags,platforms) VALUES('manual-e2e-0001','manual:e2e','我的手动产品 Quillmark','https://quillmark.local','quillmark.local','我自己写的简介','manual','手动备注','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z','[]','[]')");
  cli.run("INSERT INTO saved_filters(name, filter_json, created_at) VALUES('我的筛选','{\"q\":\"AI\"}','2026-11-01T00:00:00Z')");
  // 去重用例：客户端本地已有（且收藏+备注）的产品，包里以不同 guid / URL 变体再次出现
  const lp = (g: string, k: string, name: string, url: string) => cli.run(`INSERT INTO products(guid,dedup_key,name,url,domain,tagline,origin,created_at,updated_at,first_seen,last_seen,tags,platforms) VALUES(?,?,?,?,?,?,'crawl','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z','[]','[]')`, [g, k, name, url, new URL(url).host, name + ' 本地旧条目']);
  lp('local-dupliquo', 'host:dupliquo.example', 'Dupliquo', 'https://dupliquo.example');
  lp('local-mergeon', 'url:github.com/mergeon/mergeon', 'Mergeon', 'https://github.com/mergeon/mergeon');
  cli.run("INSERT INTO favorites(product_guid, created_at) VALUES('local-dupliquo','2026-11-01T00:00:00Z'),('local-mergeon','2026-11-01T00:00:00Z')");
  cli.run("UPDATE products SET notes='去重后备注要保留' WHERE guid='local-mergeon'");
  const n0 = cli.get<any>('SELECT COUNT(*) c FROM products').c; console.log('client products', n0, 'fts', rebuildFts(cli)); cli.db.pragma('wal_checkpoint(TRUNCATE)');
  // —— 3) 合成包 #1→#2：新增 + 更新已有 + 下架（含被收藏 → 受保护）+ 手动产品同名 + alt_rel ——
  const syn = await DB.open(null); const ts = '2026-11-10T00:00:00.000Z';
  const ins = (g: string, k: string, name: string, url: string, tagline: string, origin = 'crawl-history') => syn.run(`INSERT INTO products(guid,dedup_key,name,url,domain,tagline,description,category,tags,platforms,origin,created_at,updated_at,first_seen,last_seen,launch_date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [g, k, name, url, new URL(url).host, tagline, tagline + '（增量 #2 合成用例）', 'ai', '["AI","效率"]', '["Web"]', origin, ts, ts, ts, ts, '2026-11-10']);
  ins('e2e-new-zephyrine', 'e2e:zephyrine', 'Zephyrine Atlas', 'https://zephyrine-atlas.example', 'Zephyrine 风格的 AI 地图笔记工具');
  ins('e2e-new-kestrelio', 'e2e:kestrelio', 'Kestrelio', 'https://kestrelio.example', 'Kestrelio 帮团队自动整理会议纪要');
  const updRow = cli.get<any>('SELECT * FROM products WHERE guid=?', [updP.guid]);
  ins(updRow.guid, updRow.dedup_key, updRow.name, updRow.url || 'https://updated.example', '【已更新】' + (updRow.tagline || updRow.name));
  ins('manual-e2e-0001', 'manual:e2e', '我的手动产品 Quillmark', 'https://quillmark.local', '抓取到的不同简介（不应覆盖）');
  syn.run("INSERT INTO alt_rel(target, product_guid, src) VALUES('notion','e2e-new-zephyrine','e2e')");
  // 去重：同一产品的 URL 变体（www/子域/utm，不同 guid）→ 客户端应并入本地那条；服务端整库去重产生的 merged_into 墓碑
  ins('e2e-dup-dupliquo', 'host:app.dupliquo.example', 'Dupliquo', 'http://www.app.dupliquo.example/?utm_source=launch', 'Dupliquo 官方简介（增量）');
  ins('e2e-mergeon-official', 'host:mergeon.example', 'Mergeon', 'https://mergeon.example', 'Mergeon 官网条目');
  syn.run('INSERT INTO deleted_products(guid, dedup_key, deleted_at, merged_into) VALUES(?,?,?,?)', ['local-mergeon', 'url:github.com/mergeon/mergeon', ts, 'e2e-mergeon-official']);
  for (const p of [delP, delFavP]) syn.run('INSERT INTO deleted_products(guid, dedup_key, deleted_at) VALUES(?,?,?)', [p.guid, null, ts]);
  const p2 = buildDeltaPack(syn, { since: '2026-11-09T23:59:00.000Z', until: '2026-11-10T01:00:00.000Z', fromSeq: 1, toSeq: 2, seedVersionFrom: '1.9.0', seedVersionTo: '1.9.0' });
  p2.products = p2.products.filter(p => p.origin !== 'manual'); // 发布端本来不导出 manual；这里保留同名抓取版本以测试「手动产品只补空」
  p2.products.push({ ...syn.get<any>("SELECT * FROM products WHERE guid='manual-e2e-0001'"), origin: 'crawl-history', tags: [], platforms: [], pricing: 'Freemium' } as any);
  const { bodyChecksum } = await import('../../src/server/delta'); p2.counts.products = p2.products.length; p2.checksum = { algo: 'sha256', body: bodyChecksum(p2) };
  const f2 = path.join(PUB, 'producthub-delta-0001-0002.phdelta.json.gz'); const w2 = writeDeltaFile(p2, f2);
  // #2→#3（自动检查 / 本地文件导入用）
  const syn3 = await DB.open(null); syn3.run(`INSERT INTO products(guid,dedup_key,name,url,domain,tagline,category,tags,platforms,origin,created_at,updated_at,first_seen,last_seen) VALUES('e2e-new-pelicanly','e2e:pelicanly','Pelicanly','https://pelicanly.example','pelicanly.example','Pelicanly 本地文件导入的增量产品','dev','[]','[]','crawl-history','2026-11-11T00:00:00.000Z','2026-11-11T00:00:00.000Z','2026-11-11T00:00:00.000Z','2026-11-11T00:00:00.000Z')`);
  const p3 = buildDeltaPack(syn3, { since: '2026-11-10T23:00:00.000Z', until: '2026-11-11T01:00:00.000Z', fromSeq: 2, toSeq: 3 }); const f3 = path.join(PUB, 'producthub-delta-0002-0003.phdelta.json.gz'); const w3 = writeDeltaFile(p3, f3);
  const entry = (f: string, w: any, p: any): DeltaIndexPack => ({ from_seq: p.from.seq, to_seq: p.to.seq, file: path.basename(f), sha256: w.sha256, size: w.bytes, products: p.counts.products, deleted: p.counts.deleted, since: p.from.since, until: p.to.until, generated_at: p.generated_at });
  const idx = (packs: DeltaIndexPack[]) => ({ format: 'producthub-delta-index', version: 2, dataset: 'producthub-main', latest_seq: Math.max(...packs.map(p => p.to_seq)), latest: packs[packs.length - 1].file, packs });
  const e1 = entry(f1, w1, p1), e2 = entry(f2, w2, p2), e3 = entry(f3, w3, p3);
  fs.writeFileSync(path.join(PUB, 'index.json'), JSON.stringify(idx([e1, e2]), null, 2));
  fs.writeFileSync(path.join(PUB, 'index-next.json'), JSON.stringify(idx([e1, e2, e3]), null, 2));
  // 坏包：截断的 gzip（索引里写它自己的 sha256 → 下载校验通过，但解析失败 → 拒绝、库不变）
  const bad = fs.readFileSync(f1).subarray(0, Math.floor(w1.bytes * 0.6)); fs.writeFileSync(path.join(PUB, 'bad.phdelta.json.gz'), bad);
  fs.writeFileSync(path.join(PUB, 'index-bad.json'), JSON.stringify(idx([{ ...e1, file: 'bad.phdelta.json.gz', sha256: sha256(bad), size: bad.length }]), null, 2));
  // 校验和不对：索引 sha256 与文件不符
  fs.writeFileSync(path.join(PUB, 'index-badsha.json'), JSON.stringify(idx([{ ...e1, sha256: 'f'.repeat(64) }]), null, 2));
  const sampleNew = p1.products.filter(p => !cli.get<any>('SELECT 1 x FROM products WHERE guid=?', [p.guid]) && /^[A-Za-z][A-Za-z0-9 .-]{4,24}$/.test(p.name)).slice(0, 5).map(p => p.name);
  const meta = { since: SINCE, client_products: n0, pack1: { ...e1, counts: p1.counts }, pack2: { ...e2, counts: p2.counts }, pack3: { ...e3, counts: p3.counts }, fav: favP, note: noteP, del: delP, delFav: delFavP, upd: { guid: updP.guid, name: updP.name }, sampleNew, ms: Date.now() - t0 };
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2)); console.log(JSON.stringify(meta, null, 2).slice(0, 1500));
  cli.close();
})().catch(e => { console.error(e); process.exit(1); });
