"""合并同一来源下指向同一目录链接的重复产品（SaaSworthy/Serchen 等详情名 vs slug 名）。
python3 scripts/dedupe-dirlinks.py data/crawl/producthub.db [seq ...]"""
import sqlite3,re,sys,collections
db=sys.argv[1]; seqs=[int(x) for x in sys.argv[2:]] or [75,80,58,84]
c=sqlite3.connect(db); tot=0
for seq in seqs:
  g=c.execute('select guid,name from sources where seq=?',(seq,)).fetchone()
  if not g: continue
  d=collections.defaultdict(set)
  for pg,snap in c.execute('select product_guid,snapshot from product_versions where source_guid=?',(g[0],)):
    m=re.search(r'(?:SaaSworthy|Serchen|WebCatalog|SoftwareWorld): (https?://[^\s"\\]+)',snap or '')
    if m: d[m.group(1).rstrip('/').lower()].add(pg)
  n=0
  for grp in d.values():
    if len(grp)<2: continue
    info=[(pg,)+r for pg in grp for r in [c.execute('select (select count(*) from product_versions where product_guid=?),length(coalesce(description,\'\')),tagline,description from products where guid=?',(pg,pg)).fetchone()] if r]
    if len(info)<2: continue
    info.sort(key=lambda x:(-x[1],-x[2])); keep=info[0][0]
    for pg,_,_,tg,ds in info[1:]:
      c.execute('update products set tagline=coalesce(tagline,?),description=case when length(coalesce(description,\'\'))<length(coalesce(?,\'\')) then ? else description end where guid=?',(tg,ds,ds,keep))
      c.execute('update product_versions set product_guid=? where product_guid=?',(keep,pg))
      c.execute('update favorites set product_guid=? where product_guid=?',(keep,pg)) if 'product_guid' in [r[1] for r in c.execute('pragma table_info(favorites)')] else None
      c.execute('delete from products where guid=?',(pg,)); n+=1
    c.execute('update products set launch_count=(select count(*) from product_versions where product_guid=?) where guid=?',(keep,keep))
  pc=c.execute('select count(distinct product_guid) from product_versions where source_guid=?',(g[0],)).fetchone()[0]
  c.execute('update sources set product_count=? where guid=?',(pc,g[0]))
  print(g[1],'removed',n,'source_products',pc); tot+=n
c.commit(); print('total removed',tot,'products',c.execute('select count(*) from products').fetchone()[0])
