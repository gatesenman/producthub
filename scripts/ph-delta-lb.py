#!/usr/bin/env python3
"""Fetch Product Hunt daily leaderboard for missing days up to today (Asia/Shanghai)."""
import urllib.request, urllib.error, re, json, os, time, datetime, sys
sys.stdout.reconfigure(line_buffering=True)
ROOT = '/workspace/ph'
LB = os.path.join(ROOT, 'lb')
os.makedirs(LB, exist_ok=True)
UA = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}
P = re.compile(
  r'"__typename":"Post","id":"(\d+)","name":"((?:\\.|[^"\\])*)","slug":"([a-z0-9-]+)","tagline":"((?:\\.|[^"\\])*)"',
)
START = datetime.date(2026, 10, 21)
# today Asia/Shanghai
END = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).date()

def fetch(d):
  u = f'https://www.producthunt.com/leaderboard/daily/{d.year}/{d.month}/{d.day}/all'
  for t in range(6):
    try:
      return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60).read().decode('utf8', 'ignore')
    except urllib.error.HTTPError as e:
      if e.code == 429:
        w = 90 * (t + 1); print('429 sleep', w, d, flush=True); time.sleep(w); continue
      if e.code == 403:
        print('403', d, flush=True); time.sleep(120); continue
      print('HTTP', e.code, d, flush=True); time.sleep(10)
    except Exception as e:
      print('err', d, e, flush=True); time.sleep(10)
  return None

days = []
d = START
while d <= END:
  days.append(d); d += datetime.timedelta(days=1)
# newest first for freshness priority
days = list(reversed(days))
done = 0; failed = []
for d in days:
  f = os.path.join(LB, f'{d}.json')
  if os.path.exists(f) and os.path.getsize(f) > 10:
    print('skip', d, flush=True); continue
  h = fetch(d)
  if h is None:
    open(os.path.join(ROOT, 'lb-delta-errors.log'), 'a').write(f'{d}\n'); failed.append(str(d)); continue
  rows = {}
  for m in P.finditer(h):
    nx = h.find('"__typename":"Post"', m.start() + 20)
    seg = h[m.start():(nx if nx > 0 else m.start() + 3000)]
    pm = re.search(r'"redirectToProduct":\{"__typename":"Product","id":"\d+","slug":"([a-z0-9-]+)"', seg)
    try:
      name = json.loads('"' + m.group(2) + '"')
      tagline = json.loads('"' + m.group(4) + '"')
    except Exception:
      name, tagline = m.group(2), m.group(4)
    rows[m.group(3)] = {'id': m.group(1), 'name': name, 'tagline': tagline, 'product': pm.group(1) if pm else None}
  json.dump({'date': str(d), 'posts': rows}, open(f, 'w'))
  done += 1
  print('ok', done, d, 'posts', len(rows), flush=True)
  time.sleep(2.5)
print(json.dumps({'fetched': done, 'failed': failed, 'range': [str(START), str(END)]}))
# Build ingest rows from ALL days in range (incl. existing)
rows = []
seen = set()
d = START
while d <= END:
  f = os.path.join(LB, f'{d}.json')
  if os.path.exists(f):
    data = json.load(open(f))
    for k, v in data.get('posts', {}).items():
      slug = v.get('product') or k
      if slug in seen: continue
      seen.add(slug)
      rows.append({
        'name': v.get('name') or slug,
        'url': f'https://www.producthunt.com/products/{slug}',
        'tagline': v.get('tagline'),
        'description': v.get('tagline'),
        'date': data.get('date'),
      })
  d += datetime.timedelta(days=1)
out = {'seq': 1, 'strategy': 'ph-lb-delta-2026-11-09', 'rows': rows}
outp = '/workspace/product-hub/data/delta/ph-lb-delta.json'
json.dump(out, open(outp, 'w'), ensure_ascii=False)
print('wrote', outp, 'rows', len(rows), flush=True)
