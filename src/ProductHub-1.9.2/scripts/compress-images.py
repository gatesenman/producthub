# 将预缓存图片缩放到 320px 以内，减小安装包体积（文件名不变）
import os, sys
from PIL import Image
d = sys.argv[1] if len(sys.argv) > 1 else 'data/seed/images'
for f in os.listdir(d):
    p = os.path.join(d, f)
    if f.endswith(('.svg', '.ico', '.img', '.avif')) or os.path.getsize(p) < 30000: continue
    try:
        im = Image.open(p); fmt = im.format
        if im.width > 320 or im.height > 320:
            im.thumbnail((320, 320))
            if fmt == 'JPEG': im.convert('RGB').save(p, 'JPEG', quality=82, optimize=True)
            elif fmt == 'PNG': im.save(p, 'PNG', optimize=True)
            elif fmt == 'WEBP': im.save(p, 'WEBP', quality=80)
    except Exception: pass
