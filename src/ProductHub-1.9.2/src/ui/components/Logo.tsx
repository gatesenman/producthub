import React, { useState } from 'react';
import { img } from '../api';
import { initials, avatarGradient } from '../lib/avatar';
/** 产品 Logo：有图显示图片；加载失败或图片明显不是 Logo（宽高比 >1.6，多为网站截图/OG 封面）时回落为渐变首字母头像（v2 #34） */
export function Logo({ p, size = 32 }: { p: any; size?: number }) {
  const [bad, setBad] = useState(false); const src = img(p); const name = String(p?.name || '?');
  const r = Math.max(4, Math.round(size * 0.24));
  if (!src || bad) { const t = initials(name);
    return <div data-testid="avatar" aria-hidden className="flex shrink-0 select-none items-center justify-center font-semibold tracking-tight text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.12)]" style={{ width: size, height: size, borderRadius: r, background: avatarGradient(name), fontSize: Math.round(size * (t.length > 1 ? 0.38 : 0.46)), lineHeight: 1 }}>{t}</div>; }
  return <img className="shrink-0 bg-muted object-cover ring-1 ring-border" style={{ width: size, height: size, borderRadius: r }} src={src} loading="lazy" onError={() => setBad(true)} onLoad={e => { const i = e.currentTarget; const r = i.naturalWidth / Math.max(1, i.naturalHeight); if (r > 1.6 || r < 0.6) setBad(true); }} alt="" />;
}
