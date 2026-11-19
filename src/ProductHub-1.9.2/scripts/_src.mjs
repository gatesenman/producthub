import Database from 'better-sqlite3';
const db = new Database('data/crawl/producthub.db',{readonly:true});
const t=Date.now();
const rows=db.prepare(`select s.seq,s.name,s.host,s.url,s.product_count pc,s.last_status st,s.enabled en,
 (select count(distinct product_guid) from product_versions v where v.source_guid=s.guid) vc,
 (select min(launched_at) from product_versions v where v.source_guid=s.guid and launched_at>'1990') mn,
 (select max(launched_at) from product_versions v where v.source_guid=s.guid) mx
 from sources s order by vc desc`).all();
console.error('ms',Date.now()-t);
require_fs: {
 const fs=await import('node:fs'); fs.writeFileSync('/tmp/src.json',JSON.stringify(rows));
}
for (const r of rows) console.log([r.seq,r.name,r.host,r.pc,r.vc,r.st,r.en,(r.mn||'').slice(0,10),(r.mx||'').slice(0,10)].join('\t'));
