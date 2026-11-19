/** 大包（≥5 万条）合并耗时 + FTS 可搜 + 单事务 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { DB } from '../../src/server/db';
import { upsertProduct } from '../../src/server/products';
import { buildDeltaPack, writeDeltaFile, applyDelta } from '../../src/server/delta';
import { queryProducts } from '../../src/server/filter';

const N = Number(process.env.PH_BIG_N || 50_000);
describe('大包合并', () => {
  it(`${N} 条产品增量包：生成 / 合并耗时 / 搜索可见`, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-big-'));
    const src = await DB.open(path.join(tmp, 'src.db'));
    let t = Date.now();
    src.tx(() => { for (let i = 0; i < N; i++) upsertProduct(src, { name: `BigTool ${i} Ocelot${i % 97}`, url: `https://bigtool-${i}.example.com`, tagline: `tool number ${i} for ocelot${i % 97} workflows`, description: `Long description ${i} `.repeat(6), tags: ['AI', `t${i % 13}`] }, { sourceGuid: 'src-big', versionLabel: 'big' }); });
    src.run("UPDATE products SET created_at='2099-01-05T00:00:00.000Z', updated_at='2099-01-05T00:00:00.000Z'");
    const seedMs = Date.now() - t; t = Date.now();
    const pack = buildDeltaPack(src, { since: '2099-01-01T00:00:00.000Z', until: '2999-01-01T00:00:00.000Z', fromSeq: 0, toSeq: 1 }); const packMs = Date.now() - t;
    const file = path.join(tmp, 'big.phdelta.json.gz'); t = Date.now(); const w = writeDeltaFile(pack, file); const writeMs = Date.now() - t;
    const dst = await DB.open(path.join(tmp, 'dst.db'));
    const phases: string[] = []; t = Date.now();
    const r = applyDelta(dst, fs.readFileSync(file), p => { if (!phases.includes(p.phase)) phases.push(p.phase); });
    const applyMs = Date.now() - t;
    expect(r.inserted).toBe(N); expect(r.fts_synced).toBeGreaterThanOrEqual(N); expect(phases).toEqual(['products', 'fts', 'done']);
    t = Date.now(); const q: any = queryProducts(dst, { q: 'ocelot42' } as any); const searchMs = Date.now() - t;
    expect(q.total ?? q.items?.length).toBeGreaterThan(0);
    const out = { N, seedMs, packMs, writeMs, bytes: w.bytes, applyMs, ftsSynced: r.fts_synced, searchMs, perItemUs: Math.round(applyMs * 1000 / N) };
    fs.mkdirSync('test-results', { recursive: true }); fs.writeFileSync('test-results/delta-big.json', JSON.stringify(out, null, 2)); console.log(out);
    src.close(); dst.close(); fs.rmSync(tmp, { recursive: true, force: true });
  }, 600_000);
});
