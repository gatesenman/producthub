import sqlite3
a=sqlite3.connect('/workspace/producthub-v15-backup.db');b=sqlite3.connect('data/crawl/producthub.db')
q='select s.seq,s.name,count(distinct v.product_guid) from sources s left join product_versions v on v.source_guid=s.guid group by s.guid'
A={r[0]:r[2] for r in a.execute(q)};rows=[(r[0],r[1],A.get(r[0],0),r[2]) for r in b.execute(q)]
rows=sorted([r for r in rows if r[3]!=r[2]],key=lambda r:r[2]-r[3])
t=lambda c:c.execute('select (select count(*) from products),(select count(*) from product_versions)').fetchone()
pa,pb=t(a),t(b)
o=open('docs/crawl-report-v1.6.md','a');o.write(f"\n\n## v1.6 增量（相对 v1.5）\n\n产品 {pa[0]} → {pb[0]}（+{pb[0]-pa[0]}），版本 {pa[1]} → {pb[1]}（+{pb[1]-pa[1]}）\n\n|seq|来源|v1.5|当前|新增|\n|-|-|-|-|-|\n")
for r in rows:o.write(f"|{r[0]}|{r[1]}|{r[2]}|{r[3]}|+{r[3]-r[2]}|\n")
print(pb, pb[0]-pa[0], pb[1]-pa[1]); [print(r) for r in rows[:15]]
