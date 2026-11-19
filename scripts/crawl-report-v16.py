#!/usr/bin/env python3
"""v1.6 抓取报告：按来源统计（状态/产品数/最早日期/策略/失败原因）→ docs/crawl-report-v1.6.md + .csv"""
import sqlite3, sys, csv, json
db = sys.argv[1] if len(sys.argv) > 1 else 'data/crawl/producthub.db'
c = sqlite3.connect(db)
NEWS = {152,154,173,174,175,182,183,185,186,187,189,190,191,192,193,194,195,196,197,198,203,204,205,206,207,208}
rows = []
for g, seq, name, cat, status, err in c.execute('select guid,seq,name,category,last_status,last_error from sources order by seq'):
    n = c.execute('select count(distinct product_guid) from product_versions where source_guid=?', (g,)).fetchone()[0]
    e1 = c.execute("select min(substr(p.launch_date,1,10)) from products p join product_versions v on v.product_guid=p.guid where v.source_guid=? and p.launch_date >= '1995'", (g,)).fetchone()[0]
    st = c.execute("select group_concat(strategy||':'||items||(case when status!='done' then '('||status||')' else '' end), ' ') from crawl_state where source_guid=? and strategy not in ('source','probe')", (g,)).fetchone()[0] or ''
    probe = c.execute("select last_error from crawl_state where source_guid=? and strategy='probe'", (g,)).fetchone()
    srcst = c.execute("select status,last_error from crawl_state where source_guid=? and strategy='source'", (g,)).fetchone()
    if seq in NEWS: res, why = '跳过(媒体)', '新闻/文章来源，不做历史回溯'
    elif n > 0: res, why = '成功', ''
    else: res, why = '失败', (srcst[1] if srcst and srcst[1] else '') or (probe[0] if probe else '') or (err or '无可识别产品列表')
    rows.append([seq, name, cat, res, n, e1 or '', st, (why or '')[:120]])
with open('docs/crawl-report-v1.6.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['seq','来源','分类','结果','产品数','最早日期','策略:条目','失败原因']); w.writerows(rows)
tot = c.execute('select count(*), sum(logo_local is not null), min(launch_date) from products where 1').fetchone()
vers = c.execute('select count(*) from product_versions').fetchone()[0]
ok = sum(r[3]=='成功' for r in rows); fail = sum(r[3]=='失败' for r in rows); skip = sum(r[3].startswith('跳过') for r in rows)
md = [f'# v1.6 全量历史抓取报告', '', f'- 来源：成功 {ok} / 失败 {fail} / 跳过(媒体) {skip} / 共 {len(rows)}', f'- 产品 {tot[0]}，发布记录(版本) {vers}，本地图片 {tot[1]}', '',
      '| # | 来源 | 结果 | 产品数 | 最早日期 | 策略 | 原因 |', '|---|---|---|---|---|---|---|']
md += [f'| {r[0]} | {r[1]} | {r[3]} | {r[4]} | {r[5]} | {r[6]} | {r[7]} |' for r in rows]
open('docs/crawl-report-v1.6.md', 'w').write('\n'.join(md) + '\n')
print(md[2]); print(md[3])
