#!/usr/bin/env python3
"""打包种子：DB gzip + 图片压缩 → build/seed-pack/（electron-builder extraResources → seed）
环境变量 SEED_SRC 默认 data/crawl（v1.6 全量），可改 data/seed。"""
import gzip, os, shutil, io, sys
from PIL import Image
src = os.environ.get('SEED_SRC', 'data/crawl')
dst = 'build/seed-pack'; MAX = 96
db = os.environ.get('SEED_DB') or f'{src}/producthub.db'
if not os.path.exists(db):
    print('missing', db, file=sys.stderr); sys.exit(1)
shutil.rmtree(dst, ignore_errors=True); os.makedirs(dst + '/images', exist_ok=True)
print(f'gzip {db} ({os.path.getsize(db)/1e9:.2f}GB) → {dst}/producthub.db.gz ...', flush=True)
with open(db, 'rb') as f, gzip.open(f'{dst}/producthub.db.gz', 'wb', compresslevel=6) as g:
    while True:
        chunk = f.read(8 * 1024 * 1024)
        if not chunk: break
        g.write(chunk)
print(f'db.gz {os.path.getsize(dst + "/producthub.db.gz")/1e6:.1f}MB', flush=True)
img_src = f'{src}/images'
before = after = n = 0
if os.path.isdir(img_src):
    files = os.listdir(img_src)
    print(f'images {len(files)} files...', flush=True)
    for i, name in enumerate(files):
        p = f'{img_src}/{name}'; q = f'{dst}/images/{name}'
        if not os.path.isfile(p): continue
        before += os.path.getsize(p); ext = name.rsplit('.', 1)[-1].lower()
        try:
            if ext in ('png', 'jpg', 'jpeg', 'webp'):
                im = Image.open(p); im.load()
                if max(im.size) > MAX: im.thumbnail((MAX, MAX), Image.LANCZOS)
                buf = io.BytesIO()
                if ext == 'png':
                    if im.mode not in ('RGBA', 'LA', 'P'): im = im.convert('RGBA') if 'transparency' in im.info else im.convert('RGB')
                    im = im.convert('RGBA').quantize(256, method=Image.FASTOCTREE) if im.mode in ('RGBA', 'LA') else im.quantize(256)
                    im.save(buf, 'PNG', optimize=True)
                elif ext == 'webp': im.save(buf, 'WEBP', quality=80)
                else: im.convert('RGB').save(buf, 'JPEG', quality=80, optimize=True)
                data = buf.getvalue()
                if len(data) >= os.path.getsize(p): shutil.copy(p, q)
                else: open(q, 'wb').write(data)
            else: shutil.copy(p, q)
        except Exception: shutil.copy(p, q)
        after += os.path.getsize(q); n += 1
        if (i + 1) % 2000 == 0: print(f'  images {i+1}/{len(files)}', flush=True)
print(f'images {n}: {before/1e6:.1f}MB -> {after/1e6:.1f}MB; db.gz {os.path.getsize(dst + "/producthub.db.gz")/1e6:.1f}MB', flush=True)
# 种子版本（升级时用于检测并替换旧库）
open(f'{dst}/seed-version.txt', 'w').write(os.environ.get('SEED_VERSION') or __import__('json').load(open('package.json'))['version'])
print('seed-version', open(f'{dst}/seed-version.txt').read())
