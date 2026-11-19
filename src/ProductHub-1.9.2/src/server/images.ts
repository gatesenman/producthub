import fs from 'node:fs';
import path from 'node:path';
import { sha1 } from './util';
import { request } from './net';

const EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico', 'image/avif': '.avif' };
/** 下载并缓存图片到本地，返回文件名；已缓存则直接返回 */
export async function cacheImage(url: string, dir: string, fetchImpl?: typeof fetch): Promise<string | null> {
  if (!url || !/^https?:/.test(url)) return null;
  fs.mkdirSync(dir, { recursive: true });
  const key = sha1(url); const existing = fs.readdirSync(dir).find(f => f.startsWith(key + '.')); if (existing) return existing;
  try {
    let ct: string, buf: Buffer;
    if (fetchImpl) { const r = await fetchImpl(url, { headers: { 'user-agent': 'Mozilla/5.0 ProductHub/1.0' }, signal: AbortSignal.timeout(15000) }); if (!r.ok) return null; ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(); buf = Buffer.from(await r.arrayBuffer()); }
    else { const r = await request(url, { raw: true, retries: 0, timeoutMs: 15000, intervalMs: 0, maxBytes: 1_600_000, headers: { accept: 'image/*' } }); if (r.status >= 400) return null; ct = (r.headers['content-type'] || '').split(';')[0].trim().toLowerCase(); buf = r.body; }
    const ext = EXT[ct] || (ct.startsWith('image/') ? '.img' : null); if (!ext) return null; if (buf.length < 50 || buf.length > 1_500_000) return null;
    const file = key + ext; fs.writeFileSync(path.join(dir, file), buf); return file;
  } catch { return null; }
}
export const MIME: Record<string, string> = Object.fromEntries(Object.entries(EXT).map(([k, v]) => [v, k]));
