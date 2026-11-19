import { DB } from '../src/server/db';
(async()=>{const db=await DB.open('data/crawl/producthub.db');
const rows=db.all<any>("SELECT s.seq,s.name,s.last_status,c.strategy,c.status,c.items,c.cursor,c.earliest,c.last_error FROM crawl_state c JOIN sources s ON s.guid=c.source_guid ORDER BY s.seq");
const reopen=new Set<string>();
for(const r of rows){ if(r.strategy==='source')continue;
 const capped=(r.items||0)>=3900||r.status==='partial'||r.status==='running'||(r.cursor&&r.cursor!=='null');
 if(capped){reopen.add(r.seq); }}
const failed=db.all<any>("SELECT seq FROM sources WHERE last_status!='ok'").map(x=>x.seq);
failed.forEach(x=>reopen.add(x));
const q=[...reopen];
console.log('reopen',q.length,q.join(','));
for(const seq of q){const g=db.get<any>('SELECT guid FROM sources WHERE seq=?',[seq]).guid;
 db.run("UPDATE crawl_state SET status='partial' WHERE source_guid=? AND status='done' AND strategy NOT IN ('source','probe') AND cursor IS NOT NULL",[g]);
 db.run("DELETE FROM crawl_state WHERE source_guid=? AND strategy IN ('source','probe')",[g]);}
db.saveNow();})();
