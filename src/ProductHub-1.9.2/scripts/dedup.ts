/**
 * 整库彻底去重（v1.9）：规则见 src/server/dedup.ts
 *   npx tsx scripts/dedup.ts [--db data/crawl/producthub.db] [--dry] [--samples 20] [--out data/delta/dedup-report.json]
 * --dry：只统计和抽样，不写库
 */
import fs from 'node:fs';
import path from 'node:path';
import { DB } from '../src/server/db';
import { nameKey, clusterSameName, mergeGroup, keyKind } from '../src/server/dedup';
import { productDedupKey } from '../src/server/util';
import { syncFts } from '../src/server/search/fts';

const ARGS = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? '1']));
const DBF = path.resolve(String(ARGS.db || 'data/crawl/producthub.db')); const DRY = !!ARGS.dry; const NS = +(ARGS.samples || 20);
const OUT = path.resolve(String(ARGS.out || (DRY ? 'data/delta/dedup-dryrun.json' : 'data/delta/dedup-report.json')));
const log = (...a: any[]) => console.log(new Date().toLocaleTimeString('zh-CN', { hour12: false }), ...a);

(async () => {
  const db = await DB.open(DBF); const raw = (db as any).db;
  raw.function('ph_nk', { deterministic: true }, (n: string) => nameKey(n));
  raw.function('ph_dk', { deterministic: true }, (n: string, u: string) => productDedupKey({ name: n, url: u }));
  const t0 = Date.now(); const before = db.get<any>('SELECT COUNT(*) c FROM products').c; log('去重开始', DRY ? '(dry-run)' : '', '产品', before);
  if (!DRY) { const n = db.run('UPDATE products SET name_key=ph_nk(name) WHERE name_key IS NOT ph_nk(name)').changes; log('name_key 回填', n); }
  const NK = DRY ? 'ph_nk(name)' : 'name_key';
  const groups: { guids: string[]; rule: string }[] = [];
  // Pass A：按当前规范化规则重算 key，key 相同（旧数据残留/规范化升级）→ 合并
  const a = db.all<any>(`SELECT k, group_concat(guid, char(9)) gs FROM (SELECT ph_dk(name, url) k, guid FROM products) GROUP BY k HAVING COUNT(*) > 1`);
  const inA = new Set<string>();
  for (const r of a) { const gs = String(r.gs).split('\t'); if (keyKind(r.k) === 'name') continue; groups.push({ guids: gs, rule: 'R1' }); gs.forEach(g => inA.add(g)); }
  log('Pass A（规范化 URL 相同）', a.length, '组');
  // Pass B：同名称键 → 按簇规则
  const b = db.all<any>(`SELECT nk, group_concat(guid, char(9)) gs, COUNT(*) n FROM (SELECT ${NK} nk, guid FROM products) WHERE nk IS NOT NULL GROUP BY nk HAVING COUNT(*) > 1`);
  log('Pass B 同名称键', b.length, '组，检查中');
  let ambiguous = 0;
  for (const r of b) {
    const gs = String(r.gs).split('\t'); const rows = gs.map(g => db.get<any>('SELECT guid, dedup_key, domain, origin FROM products WHERE guid=?', [g])).filter(Boolean);
    const cl = clusterSameName(rows);
    const covered = new Set(cl.flatMap(c => c.guids)); if (covered.size < rows.length && rows.some(x => keyKind(x.dedup_key) === 'name' && !covered.has(x.guid))) ambiguous++;
    for (const c of cl) { if (c.guids.every(g => inA.has(g))) continue; groups.push(c); }
  }
  // 合并重叠组（并查集）
  const parent = new Map<string, string>(); const find = (x: string): string => { const p = parent.get(x); if (!p || p === x) return x; const r = find(p); parent.set(x, r); return r; };
  const ruleOf = new Map<string, Set<string>>();
  for (const g of groups) { for (const x of g.guids) if (!parent.has(x)) parent.set(x, x); const r0 = find(g.guids[0]); for (const x of g.guids.slice(1)) { const rx = find(x); if (rx !== r0) parent.set(rx, r0); } }
  const comps = new Map<string, string[]>(); for (const x of parent.keys()) { const r = find(x); comps.set(r, [...(comps.get(r) || []), x]); }
  for (const g of groups) { const r = find(g.guids[0]); const s = ruleOf.get(r) || new Set(); g.rule.split('+').forEach(x => s.add(x)); ruleOf.set(r, s); }
  const list = [...comps.entries()].map(([r, gs]) => ({ guids: gs, rule: [...(ruleOf.get(r) || [])].sort().join('+') }));
  const byRule: Record<string, { groups: number; removed: number }> = {};
  for (const c of list) { const e = byRule[c.rule] || (byRule[c.rule] = { groups: 0, removed: 0 }); e.groups++; e.removed += c.guids.length - 1; }
  const toRemove = list.reduce((s, c) => s + c.guids.length - 1, 0);
  log('待合并', list.length, '组，将去掉', toRemove, '条', JSON.stringify(byRule), '歧义保留的同名组', ambiguous);
  // 抽样：各规则均匀抽
  const detail = (g: string) => db.get<any>(`SELECT p.guid, p.name, p.url, p.domain, p.dedup_key, p.origin, (SELECT group_concat(DISTINCT s.name) FROM product_versions v JOIN sources s ON s.guid=v.source_guid WHERE v.product_guid=p.guid) sources FROM products p WHERE guid=?`, [g]);
  const rules = Object.keys(byRule); const samples: any[] = []; let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const pool = rules.map(r => list.filter(c => c.rule === r)); let i = 0;
  while (samples.length < NS && pool.some(p => p.length)) { const p = pool[i++ % pool.length]; if (!p.length) continue; const c = p.splice(Math.floor(rnd() * p.length), 1)[0]; samples.push({ rule: c.rule, members: c.guids.slice(0, 6).map(detail) }); }
  let merged = 0, removed = 0;
  if (!DRY) {
    const B = 2000;
    for (let k = 0; k < list.length; k += B) {
      db.tx(() => { for (const c of list.slice(k, k + B)) { const m = mergeGroup(db, c.guids); if (m) { merged++; removed += m.losers.length; } } });
      if ((k / B) % 10 === 0) log('合并进度', Math.min(k + B, list.length), '/', list.length);
    }
    log('同步全文索引'); const f = syncFts(db); log('FTS 同步', f);
    db.run('UPDATE sources SET product_count=(SELECT COUNT(DISTINCT product_guid) FROM product_versions v WHERE v.source_guid=sources.guid)');
    db.saveNow();
  }
  const after = db.get<any>('SELECT COUNT(*) c FROM products').c;
  const rep = { at: new Date().toISOString(), dry: DRY, before, after, planned_groups: list.length, planned_removed: toRemove, merged_groups: merged, removed, byRule, ambiguous_name_groups: ambiguous, ms: Date.now() - t0, samples };
  fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(rep, null, 2));
  log('完成', before, '→', after, '报告', OUT); db.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
