/** 对内置种子库中最有代表性的 N 个产品（默认 300）执行官网补齐。用法：npx tsx scripts/enrich-seed.ts [N] [并发] */
import path from 'node:path';
import { DB } from '../src/server/db';
import { enrichProduct } from '../src/server/enrich';

const N = +(process.argv[2] || 300); const C = +(process.argv[3] || 8);
(async () => {
  const file = path.resolve(__dirname, '../data/seed/producthub.db'); const db = await DB.open(file);
  // 同一域名下产品过多的多为聚合/资讯站，跳过
  const busy = new Set(db.all<any>("SELECT domain FROM products WHERE domain IS NOT NULL GROUP BY domain HAVING COUNT(*) > 2").map(r => r.domain));
  const rows = db.all<any>(`SELECT p.guid, p.name, p.domain, (SELECT COUNT(DISTINCT source_guid) FROM product_versions v WHERE v.product_guid=p.guid) srcs FROM products p
    WHERE p.url LIKE 'http%' AND COALESCE(p.enrich_status,'') <> 'ok' ORDER BY srcs DESC, p.launch_count DESC, (p.logo_url IS NOT NULL) DESC, LENGTH(COALESCE(p.description,'')) DESC`).filter(r => r.domain && !busy.has(r.domain)).slice(0, N);
  let ok = 0, fail = 0, i = 0; const t0 = Date.now(); const errs: Record<string, number> = {};
  await Promise.all(Array.from({ length: C }, async () => { while (i < rows.length) { const r = rows[i++]; const res = await enrichProduct(db, r.guid, undefined, { useLLM: false }); if (res.ok) ok++; else { fail++; const k = (res.error || '').replace(/\d{3}/, m => m).slice(0, 30); errs[k] = (errs[k] || 0) + 1; } if ((ok + fail) % 25 === 0) console.log(`${ok + fail}/${rows.length} 成功 ${ok} 失败 ${fail} ${Math.round((Date.now() - t0) / 1000)}s`); } }));
  db.saveNow(); console.log(JSON.stringify({ attempted: rows.length, ok, fail, errs, seconds: Math.round((Date.now() - t0) / 1000) }));
  const s = db.get<any>("SELECT SUM(enrich_status='ok') ok, SUM(json_extract(enrich_json,'$.pricing.hasFree')=1) free, SUM(json_array_length(json_extract(enrich_json,'$.pricing.tiers'))>0) tiers, SUM(json_array_length(json_extract(enrich_json,'$.features'))>0) feats, SUM(json_extract(enrich_json,'$.company.name') IS NOT NULL) company FROM products");
  console.log(s);
})();
