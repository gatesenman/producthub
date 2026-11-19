#!/usr/bin/env python3
"""v1.5 批量缓存产品图片：并发下载（每主机≤4并发），立即缩放到 ≤128px，限时；断点续跑（已存在文件跳过）。"""
import sqlite3, hashlib, os, io, sys, time, threading, urllib.request
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse
from PIL import Image
DB = sys.argv[1]; IMG = sys.argv[2]; LIMIT_S = int(sys.argv[3]) if len(sys.argv) > 3 else 720
os.makedirs(IMG, exist_ok=True); t0 = time.time()
c = sqlite3.connect(DB); rows = c.execute("select guid, logo_url from products where logo_local is null and logo_url like 'http%' order by votes desc").fetchall()
have = {f.split('.')[0]: f for f in os.listdir(IMG)}
sems = {}; lock = threading.Lock(); done = []; ok = 0
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
def job(r):
    guid, url = r; key = hashlib.sha1(url.encode()).hexdigest()
    if key in have: return guid, have[key]
    if time.time() - t0 > LIMIT_S: return guid, None
    h = urlparse(url).netloc
    with lock: s = sems.setdefault(h, threading.Semaphore(4))
    with s:
        try:
            data = urllib.request.urlopen(urllib.request.Request(url, headers={'user-agent': UA}), timeout=12).read(3_000_000)
            im = Image.open(io.BytesIO(data)); im.load()
            if getattr(im, 'n_frames', 1) > 1: im.seek(0)
            im = im.convert('RGBA'); im.thumbnail((128, 128), Image.LANCZOS)
            f = key + '.webp'; im.save(os.path.join(IMG, f), 'WEBP', quality=80); return guid, f
        except Exception: return guid, None
with ThreadPoolExecutor(48) as ex:
    for i, (g, f) in enumerate(ex.map(job, rows)):
        if f: done.append((f, g)); ok += 1
        if i % 2000 == 0: print(f'{time.strftime("%H:%M:%S")} {i}/{len(rows)} ok={ok}', flush=True)
c.executemany('update products set logo_local=? where guid=?', done); c.commit()
print(f'done ok={ok}/{len(rows)} in {time.time()-t0:.0f}s', flush=True)
