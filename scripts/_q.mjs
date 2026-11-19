import Database from 'better-sqlite3';
const db = new Database(process.argv[2]||'data/crawl/producthub.db',{readonly:true});
for (const s of process.argv.slice(3)) { try{ const r=db.prepare(s).all(); console.log(s.slice(0,80)); console.table(r);}catch(e){console.log('ERR',s,e.message)} }
