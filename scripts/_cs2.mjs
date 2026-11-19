import Database from 'better-sqlite3';
const db = new Database('data/crawl/producthub.db',{readonly:true});
for (const seq of [123,124,7,139,90,74,87,147,25,6,94,12,134]) { const r=db.prepare("select c.cursor,s.name from crawl_state c join sources s on s.guid=c.source_guid where s.seq=? and c.strategy='sitemap'").get(seq); const j=JSON.parse(r.cursor); console.log(seq,r.name,j.seg,j.urls.slice(j.i,j.i+3).map(x=>x.loc).join(' | '));}
