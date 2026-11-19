import React, { useEffect, useState } from 'react';
import { Loader2, Wifi, Globe } from 'lucide-react';
import { api } from '../api';
import { Button } from '../components/ui/button';
import { Input, Label } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Select } from '../components/ui/select';

/** v1.9.1 设置 → 网络与代理（抓取 / 存档 / 图片 / AI 请求都走这里） */
export function NetSettings({ toast }: { toast: (m: string, k?: any) => void }) {
  const [n, setN] = useState<any>(null); const [c, setC] = useState<any>(null); const [busy, setBusy] = useState(''); const [res, setRes] = useState<any>(null);
  const load = () => api<any>('/api/net').then(x => { setN(x); setC(x.config); }).catch(e => toast('读取网络设置失败：' + e.message, 'err'));
  useEffect(() => { load(); }, []);
  if (!c) return <div className="h-16 animate-pulse rounded-lg bg-muted" />;
  const dirty = JSON.stringify(c) !== JSON.stringify(n.config);
  const save = async () => { setBusy('save'); try { const r = await api<any>('/api/net', { body: c }); setN({ ...n, config: r.config }); setC(r.config); toast('网络设置已保存，立即生效'); } catch (e) { toast('保存失败：' + (e as Error).message, 'err'); } finally { setBusy(''); } };
  const test = async () => { setBusy('test'); setRes(null); try { setRes(await api<any>('/api/net/test', { body: { config: c } })); } catch (e) { toast('测试失败：' + (e as Error).message, 'err'); } finally { setBusy(''); } };
  const num = (k: string, label: string, hint: string, min: number, max: number, scale = 1) => <div className="space-y-1"><Label>{label}</Label><Input type="number" min={min} max={max} value={Math.round(c[k] / scale)} onChange={e => setC({ ...c, [k]: Number(e.target.value) * scale })} data-testid={'net-' + k} /><p className="text-xs text-muted-foreground">{hint}</p></div>;
  return <div className="space-y-3" data-testid="net-settings">
    <div className="space-y-1"><Label>代理</Label>
      <Select testId="net-proxy-mode" value={c.proxyMode} onValueChange={v => setC({ ...c, proxyMode: v })} options={[{ value: 'system', label: '跟随系统代理（推荐：Clash / V2Ray 开着系统代理时）' }, { value: 'manual', label: '手动填写（HTTP / SOCKS5）' }, { value: 'none', label: '不用代理（直连）' }]} />
      {c.proxyMode === 'manual' && <Input data-testid="net-proxy-url" value={c.proxyUrl} onChange={e => setC({ ...c, proxyUrl: e.target.value })} placeholder="127.0.0.1:7897 或 socks5://127.0.0.1:7898" />}
      <p className="text-xs leading-4 text-muted-foreground">很多海外网站在国内直连不稳定。Clash Verge 默认混合端口 7897（HTTP 和 SOCKS5 都能用）。每个来源也能单独设置走不走代理。当前网络通道：<Badge variant="outline">{n.transport === 'chromium' ? '桌面内核（支持系统代理 / PAC）' : 'Node（读取 HTTPS_PROXY 环境变量）'}</Badge></p>
    </div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {num('timeoutMs', '超时（秒）', '单次请求最长等待', 3, 180, 1000)}
      {num('retries', '重试次数', '超时 / 断网 / 限流 / 5xx 自动退避重试', 0, 6)}
      {num('concurrency', '并发数', '同时进行的请求数', 1, 16)}
      {num('intervalMs', '请求间隔（毫秒）', '同一网站两次请求的最小间隔', 0, 60000)}
    </div>
    <div className="space-y-1"><Label>User-Agent（可选）</Label><Input data-testid="net-ua" value={c.userAgent} onChange={e => setC({ ...c, userAgent: e.target.value })} placeholder={n.defaultUserAgent} /></div>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="brand" onClick={save} disabled={!dirty || !!busy} data-testid="net-save">{busy === 'save' && <Loader2 className="animate-spin" />}保存</Button>
      <Button variant="outline" onClick={test} disabled={!!busy} data-testid="net-test">{busy === 'test' ? <Loader2 className="animate-spin" /> : <Wifi />}测试连通</Button>
      {dirty && <span className="text-xs text-muted-foreground">有未保存的修改（测试会先用当前填写的设置）</span>}
    </div>
    {res && <div className="rounded-md border text-xs" data-testid="net-test-result">{res.results.map((r: any) => <div key={r.url} className="flex items-center gap-2 border-b px-3 py-1.5 last:border-0"><Globe className="h-3.5 w-3.5 text-muted-foreground" /><span className="w-52 truncate font-mono">{r.url.replace(/^https?:\/\//, '')}</span>
      <Badge variant={r.ok ? (r.kind ? 'warning' : 'success') : 'destructive'}>{r.ok ? (r.kind ? '能连上（有人机验证）' : `正常 ${r.status}`) : '连不上'}</Badge><span className="tabular-nums text-muted-foreground">{(r.ms / 1000).toFixed(1)}s</span><span className="truncate text-muted-foreground">{!r.ok && r.message}</span></div>)}
      <div className="px-3 py-1.5 text-muted-foreground">代理：{res.proxy.kind === 'system' ? '跟随系统' : res.proxy.kind === 'direct' ? '直连' : res.proxy.url}</div></div>}
  </div>;
}
