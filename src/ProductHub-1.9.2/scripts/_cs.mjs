import Database from 'better-sqlite3';
const db = new Database('data/crawl/producthub.db',{readonly:true});
const rows=db.prepare(`select c.strategy,c.status,s.seq,s.name,s.host,s.product_count pc,c.items,length(c.cursor) L,substr(c.cursor,1,300) cur from crawl_state c join sources s on s.guid=c.source_guid where c.cursor like '%"total"%'`).all();
let out=[];
for(const r of rows){ let t=null,i=null,n=null; try{const j=JSON.parse(db.prepare('select cursor from crawl_state c join sources s on s.guid=c.source_guid where s.seq=? and c.strategy=?').get(r.seq,r.strategy).cursor); t=j.total;i=j.i;n=(j.urls||[]).length;}catch{}
 out.push({seq:r.seq,name:r.name,strategy:r.strategy,status:r.status,pc:r.pc,total:t,i,sliced:n,gap:(t||0)-r.pc});}
out.sort((a,b)=>b.gap-a.gap); console.table(out.slice(0,70)); console.log('rows',out.length,'sum gap>0',out.filter(x=>x.gap>0).reduce((a,x)=>a+x.gap,0));
