/** 搜索质量评测：对比 v1.3 LIKE 检索（修复前）与 v1.4 搜索引擎（修复后）。用法：npx tsx scripts/search-eval.ts [--json out.json] */
import fs from 'node:fs';
import path from 'node:path';
import { DB } from '../src/server/db';
import { queryProductsLegacy } from '../src/server/filter';
import { search } from '../src/server/search/engine';

const root = path.resolve(__dirname, '..');
const setFile = process.argv.includes('--holdout') ? 'tests/eval/search-eval-holdout.json' : 'tests/eval/search-eval.json';
const set = JSON.parse(fs.readFileSync(path.join(root, setFile), 'utf8')).queries as { q: string; type: string; expected: string[] }[];
const isHit = (name: string, exp: string) => name.toLowerCase().startsWith(exp.toLowerCase());
function metrics(names: string[], exp: string[]) {
  const top = names.slice(0, 10); const found = exp.filter(e => top.some(n => isHit(n, e)));
  const firstRel = names.findIndex(n => exp.some(e => isHit(n, e)));
  const used = new Set<string>(); const rels = top.map(n => { const e = exp.find(x => !used.has(x) && isHit(n, x)); if (e) { used.add(e); return 1; } return 0; });
  const dcg = rels.reduce((s: number, r, i) => s + r / Math.log2(i + 2), 0); const ideal = Array.from({ length: Math.min(exp.length, 10) }, (_, i) => 1 / Math.log2(i + 2)).reduce((a, b) => a + b, 0);
  return { recall: found.length / Math.min(exp.length, 10), hit: found.length ? 1 : 0, mrr: firstRel >= 0 && firstRel < 10 ? 1 / (firstRel + 1) : 0, ndcg: ideal ? dcg / ideal : 0, zero: names.length === 0 ? 1 : 0 };
}
(async () => {
  const db = await DB.open(null, path.join(root, 'data/seed/producthub.db'));
  const nameOf = new Map(db.all<any>('SELECT guid,name FROM products').map(r => [r.guid, r.name]));
  const rows: any[] = []; search(db, 'warmup');
  for (const it of set) {
    const t0 = Date.now(); const before = queryProductsLegacy(db, { q: it.q, pageSize: 10 }).items.map((p: any) => p.name); const tb = Date.now() - t0;
    const t1 = Date.now(); const after = search(db, it.q, { limit: 10 }).hits.map(h => nameOf.get(h.guid)!); const ta = Date.now() - t1;
    rows.push({ ...it, before: { ...metrics(before, it.expected), top3: before.slice(0, 3), ms: tb }, after: { ...metrics(after, it.expected), top3: after.slice(0, 3), ms: ta } });
  }
  const agg = (k: 'before' | 'after', f = (_r: any) => true) => { const rs = rows.filter(f); const avg = (m: string) => rs.reduce((s, r) => s + r[k][m], 0) / rs.length; return { n: rs.length, recall10: avg('recall'), hit10: avg('hit'), mrr: avg('mrr'), ndcg10: avg('ndcg'), zero: avg('zero'), ms: avg('ms') }; };
  const types = [...new Set(set.map(s => s.type))];
  const out = { total: { before: agg('before'), after: agg('after') }, byType: Object.fromEntries(types.map(t => [t, { before: agg('before', r => r.type === t), after: agg('after', r => r.type === t) }])), rows };
  const pct = (x: number) => (x * 100).toFixed(1) + '%';
  console.log('类型      数量  Recall@10(前→后)    Hit@10(前→后)      MRR(前→后)       nDCG@10(前→后)    零结果率(前→后)');
  for (const [k, v] of [['全部', out.total], ...Object.entries(out.byType)] as any) console.log(`${k.padEnd(8)} ${String(v.before.n).padStart(4)}  ${pct(v.before.recall10)} → ${pct(v.after.recall10)}   ${pct(v.before.hit10)} → ${pct(v.after.hit10)}   ${v.before.mrr.toFixed(3)} → ${v.after.mrr.toFixed(3)}   ${v.before.ndcg10.toFixed(3)} → ${v.after.ndcg10.toFixed(3)}   ${pct(v.before.zero)} → ${pct(v.after.zero)}`);
  for (const r of rows) if (r.after.recall < 1) console.log(`  [${r.type}] ${r.q}  R=${pct(r.after.recall)}  top3=${r.after.top3.join(' / ')}`);
  const j = process.argv.indexOf('--json'); if (j > 0) fs.writeFileSync(process.argv[j + 1], JSON.stringify(out, null, 2));
})();
