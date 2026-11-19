/** 批量导入外部抓取结果（可重复执行，upsert 去重）
 *  npx tsx scripts/ingest-json.ts file1.json [file2.json ...]
 *  file: { seq:number, strategy:string, rows:[{name,url?,tagline?,description?,date?,votes?,image?}] }  */
import fs from 'node:fs'; import path from 'node:path';
import { DB, now } from '../src/server/db';
import { upsertProduct } from '../src/server/products';
import { normalize } from '../src/server/search/text';
const DBF = path.resolve('data/crawl/producthub.db');
(async () => {
  const db = await DB.open(DBF);
  const cnt = () => db.get<any>('SELECT COUNT(*) n FROM products').n;
  const before = cnt(); console.log('products before', before);
  for (const f of process.argv.slice(2)) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const src = db.get<any>('SELECT * FROM sources WHERE seq=?', [j.seq]); if (!src) { console.log('no source', j.seq); continue; }
    let n = 0, ins = 0, upd = 0; let earliest: string | null = null;
    for (let i = 0; i < j.rows.length; i += 2000) db.tx(() => { for (const it of j.rows.slice(i, i + 2000)) {
      if (!it.name || String(it.name).trim().length < 2) continue;
      const date = it.date && /^\d{4}-\d\d-\d\d/.test(it.date) ? String(it.date).slice(0, 10) : null; if (date && (!earliest || date < earliest)) earliest = date;
      try { const r = upsertProduct(db, { name: it.name, url: it.url || null, tagline: it.tagline || null, description: it.description || null, category: it.category || null, tags: it.tags || null, pricing: it.pricing || null, platforms: it.platforms || null, logo_url: it.image || null, votes: it.votes ?? null, launch_date: date }, { sourceGuid: src.guid, origin: 'crawl-history', versionLabel: src.name }); n++; for (const t of (it.alts_of || [])) { const tn = normalize(String(t)).trim(); if (tn) db.run('INSERT OR IGNORE INTO alt_rel(target, product_guid, src) VALUES (?,?,?)', [tn, (r as any).guid, j.strategy]); } if (r.status === 'inserted') ins++; else upd++; } catch { /* skip */ }
    } });
    const pc = db.get<any>('SELECT COUNT(DISTINCT product_guid) n FROM product_versions WHERE source_guid=?', [src.guid]).n;
    db.run('UPDATE sources SET last_crawl_at=?, last_status=?, last_error=NULL, product_count=? WHERE guid=?', [now(), 'ok', pc, src.guid]);
    db.run('INSERT OR REPLACE INTO crawl_state(source_guid,strategy,cursor,pages,items,inserted,status,earliest,last_error,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', [src.guid, j.strategy, null, 1, n, ins, 'done', earliest, null, now()]);
    console.log(`${src.name} (${j.strategy}): rows ${j.rows.length} upserted ${n} new ${ins} merged ${upd} source_products ${pc}`);
  }
  db.saveNow(); console.log('products after', cnt(), 'delta', cnt() - before);
})();
