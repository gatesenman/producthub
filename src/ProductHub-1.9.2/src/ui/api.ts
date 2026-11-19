export async function api<T = any>(path: string, opts: { method?: string; body?: any; raw?: BodyInit; signal?: AbortSignal } = {}): Promise<T> {
  let r: Response;
  try { r = await fetch(path, { method: opts.method || (opts.body || opts.raw ? 'POST' : 'GET'), headers: opts.body ? { 'content-type': 'application/json' } : undefined, body: opts.raw ?? (opts.body ? JSON.stringify(opts.body) : undefined), signal: opts.signal }); }
  catch (e) { if ((e as Error).name === 'AbortError') throw e; throw new Error('无法连接本地服务，请稍后重试'); }
  const t = await r.text(); const j = t ? JSON.parse(t) : null;
  if (!r.ok) throw new Error(j?.error || r.statusText); return j as T;
}
export const img = (p: any) => p?.logo_local ? '/images/' + p.logo_local : p?.logo_url || '';
export const fmtDate = (s?: string | null) => s ? s.slice(0, 10) : '—';
