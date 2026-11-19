import React, { useState } from 'react';
import { Plus, RefreshCw, Play, Pause, ScrollText, Workflow, Power, Copy, ExternalLink, Search, Loader2, Settings2, RotateCw, Globe2, FlaskConical } from 'lucide-react';
import { Checkbox } from '../components/ui/checkbox';
import { SourceSettingsDialog, METHOD_SHORT, METHOD_OPTS, INTERVAL_OPTS } from './SourceSettings';
import { ErrorState } from '../components/EmptyState';
import { api } from '../api';
import { useMeta, useToast, useAsync, useActions } from '../App';
import { Page } from '../components/Page';
import { Button } from '../components/ui/button';
import { Input, Label } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Tip } from '../components/ui/tooltip';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '../components/ui/dropdown-menu';

const ST: Record<string, [string, any]> = { ok: ['正常', 'success'], empty: ['无数据', 'warning'], error: ['失败', 'destructive'] };
const INTERVALS = INTERVAL_OPTS;
const KIND_OPTS = [['network', '网络连不上'], ['dns', '域名解析失败'], ['timeout', '超时'], ['proxy', '代理问题'], ['tls', 'TLS 证书'], ['challenge', '人机验证'], ['forbidden', '拒绝访问 403'], ['rate_limited', '被限流'], ['not_found', '页面不存在'], ['server', '服务器出错'], ['js_required', '需要浏览器'], ['empty', '没识别到产品'], ['code', '程序异常']].map(([value, label]) => ({ value, label }));
export function SourcesView({ onEditRule, initialStatus = '' }: { onEditRule: (s: any) => void; initialStatus?: string }) {
  const meta = useMeta(); const toast = useToast(); const a = useActions();
  const src = useAsync(() => api<any[]>('/api/sources'), []); const sch = useAsync(() => api<any>('/api/scheduler'), []);
  const [kind, setKind] = useState(''); const [sel, setSel] = useState<Set<string>>(new Set()); const [cfg, setCfg] = useState<string | null>(null); const [netInfo, setNetInfo] = useState<any>(null);
  React.useEffect(() => { api<any>('/api/net').then(setNetInfo).catch(() => {}); }, []);
  React.useEffect(() => { if (!sch.data?.job || sch.data.job.finishedAt) return; const t = setInterval(() => { sch.reload(); src.reload(); }, 3000); return () => clearInterval(t); }, [sch.data?.job?.finishedAt, sch.data?.job?.done]);
  const [q, setQ] = useState(''); const [st, setSt] = useState(initialStatus); React.useEffect(() => setSt(initialStatus), [initialStatus]); const [busy, setBusy] = useState<Record<string, boolean>>({}); const [adding, setAdding] = useState(false); const [runs, setRuns] = useState<any[] | null>(null);
  const crawl = async (s: any) => { setBusy(b => ({ ...b, [s.guid]: true })); try { const r = await api<any>(`/api/sources/${s.guid}/crawl`, { method: 'POST' }); toast(r.error ? `${s.name} 抓取失败：${r.error.replace(/^\[\w+\]\s*/, '')}` : !r.found ? `${s.name}：没识别到产品，可在「来源设置」里换抓取方式` : `${s.name}：发现 ${r.found}，新增 ${r.inserted}，更新 ${r.updated}${r.method ? '（' + (METHOD_SHORT[r.method] || r.method) + '）' : ''}`, r.error ? 'err' : 'ok'); src.reload(); a.refreshStatus(); } finally { setBusy(b => ({ ...b, [s.guid]: false })); } };
  const patch = async (s: any, body: any) => { await api('/api/sources/' + s.guid, { method: 'PATCH', body }); src.reload(); };
  const runNow = async () => { toast('开始增量更新…'); const r = await api<any>('/api/scheduler/run', { body: { limit: 5 } }); toast(`完成 ${r.results?.length || 0} 个来源`); src.reload(); sch.reload(); a.refreshStatus(); };
  const rows = (src.data || []).filter(s => (!q || (s.name + s.url + (s.category || '')).toLowerCase().includes(q.toLowerCase())) && (!st || (s.last_status || 'never') === st) && (!kind || s.fail_kind === kind));
  const failed = (src.data || []).filter(s => s.enabled && s.last_status === 'error');
  const retryFailed = async () => { try { const r = await api<any>('/api/sources/retry-failed', { body: kind ? { kinds: [kind] } : {} }); if (!r.total) return toast(r.message || '没有失败的来源'); toast(`开始重试 ${r.total} 个失败的来源（后台进行）`); sch.reload(); } catch (e) { toast((e as Error).message, 'err'); } };
  const batch = async (action: string, value?: any) => { const guids = [...sel]; if (!guids.length) return; try { if (action === 'crawl') { const r = await api<any>('/api/sources/batch-crawl', { body: { guids } }); toast(`开始抓取 ${r.total} 个来源（后台进行）`); sch.reload(); return; } const r = await api<any>('/api/sources/batch', { body: { guids, action, value } }); toast(`已更新 ${r.count} 个来源`); src.reload(); a.refreshStatus(); } catch (e) { toast((e as Error).message, 'err'); } };
  const allSel = rows.length > 0 && rows.every(r => sel.has(r.guid)); const toggleAll = () => setSel(allSel ? new Set() : new Set(rows.map(r => r.guid)));
  const toggle = (g: string) => setSel(p => { const n = new Set(p); n.has(g) ? n.delete(g) : n.add(g); return n; });
  const job = sch.data?.job;
  const s = sch.data;
  return (
    <Page title="来源列表" testId="sources" className="p-0" desc={s ? <span className="inline-flex items-center gap-1.5"><span className={'h-1.5 w-1.5 rounded-full ' + (s.enabled ? 'bg-success' : 'bg-muted-foreground')} />定时增量更新{s.enabled ? '已开启' : '已暂停'} · 每批 {s.batch} 个 · 待更新 {s.due} 个{s.running && ' · 运行中'}</span> : '—'}
      actions={<div className="flex items-center gap-1.5">
        <Button variant="outline" size="sm" onClick={async () => setRuns(await api('/api/crawl/runs'))}><ScrollText />抓取日志</Button>
        {!meta.readOnly && netInfo?.browser && <Button variant="outline" size="sm" data-testid="open-browser" onClick={async () => { const url = window.prompt('在内置浏览器中打开（可在里面登录、完成验证；Cookie 会保留给抓取用）', 'https://www.producthunt.com/'); if (url) { try { await api('/api/browser/open', { body: { url } }); } catch (e) { toast((e as Error).message, 'err'); } } }}><Globe2 />内置浏览器</Button>}
        {!meta.readOnly && <Button variant="outline" size="sm" data-testid="retry-failed" onClick={retryFailed} disabled={!!job && !job.finishedAt}><RotateCw />只重试失败的源{failed.length ? ` (${failed.length})` : ''}</Button>}
        {!meta.readOnly && <><Button variant="outline" size="sm" onClick={async () => { await api('/api/scheduler', { body: { enabled: !s?.enabled } }); sch.reload(); a.refreshStatus(); }}>{s?.enabled ? <Pause /> : <Play />}{s?.enabled ? '暂停' : '开启'}</Button>
          <Button variant="outline" size="sm" onClick={runNow}><RefreshCw />立即更新</Button><Button size="sm" variant="brand" onClick={() => setAdding(true)} data-testid="add-source"><Plus />自定义监控</Button></>}</div>}>
      <div className="flex items-center gap-2 border-b px-5 py-2">
        <div className="relative w-64"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" /><Input className="pl-8" placeholder="搜索名称、网址、类别…" value={q} onChange={e => setQ(e.target.value)} /></div>
        <Select testId="src-status" value={st} onValueChange={setSt} className="w-[120px]" placeholder="全部状态" options={[{ value: 'ok', label: '正常' }, { value: 'empty', label: '无数据' }, { value: 'error', label: '失败' }, { value: 'never', label: '未抓取' }]} />
        <Select testId="src-kind" value={kind} onValueChange={setKind} className="w-[140px]" placeholder="全部失败原因" options={KIND_OPTS} />
        <span className="text-xs text-muted-foreground">{rows.length} / {src.data?.length || 0} 个来源 · 右键行可查看更多操作</span>
        {job && <span className="ml-auto text-xs text-muted-foreground" data-testid="job-status">{job.finishedAt ? `上次批量：${job.done}/${job.total}，成功 ${job.ok}，失败 ${job.failed}` : `正在抓取 ${job.done}/${job.total}${job.current ? '：' + job.current : ''}…`}</span>}
      </div>
      {sel.size > 0 && !meta.readOnly && <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/40 px-5 py-1.5 text-xs" data-testid="batch-bar">已选 {sel.size} 个
        <Button size="sm" variant="outline" onClick={() => batch('enable')}>批量启用</Button><Button size="sm" variant="outline" onClick={() => batch('disable')}>批量停用</Button>
        <Button size="sm" variant="outline" onClick={() => batch('crawl')}><RefreshCw />批量抓取</Button>
        <Select value="" onValueChange={v => v && batch('method', v)} className="h-7 w-[150px] text-xs" placeholder="改抓取方式…" options={METHOD_OPTS} />
        <Select value="" onValueChange={v => v && batch('proxy', v)} className="h-7 w-[130px] text-xs" placeholder="改代理…" options={[{ value: 'inherit', label: '按全局' }, { value: 'proxy', label: '走代理' }, { value: 'direct', label: '直连' }]} />
        <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>取消选择</Button></div>}
      {src.error && !src.data ? <ErrorState error={src.error} retry={src.reload} /> : src.loading ? <div className="space-y-2 p-5">{Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="h-8" />)}</div> :
        <div data-testid="source-table"><Table><TableHeader><TableRow><TableHead className="w-8"><Checkbox checked={allSel} onCheckedChange={toggleAll} aria-label="全选" /></TableHead><TableHead className="w-10 text-right">#</TableHead><TableHead>名称</TableHead><TableHead>类别</TableHead><TableHead>地区</TableHead><TableHead>方式</TableHead><TableHead>频率</TableHead><TableHead className="text-right">产品</TableHead><TableHead>状态 / 原因</TableHead><TableHead>最近抓取</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
          <TableBody>{rows.map(x => { const rule = x.rule_json ? JSON.parse(x.rule_json) : null; const [l, v] = ST[x.last_status] || ['未抓取', 'outline'];
            return <ContextMenu key={x.guid}><ContextMenuTrigger asChild><TableRow className={'group ' + (x.enabled ? '' : 'opacity-50')}>
              <TableCell><Checkbox checked={sel.has(x.guid)} onCheckedChange={() => toggle(x.guid)} aria-label="选择" /></TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">{x.seq}</TableCell>
              <TableCell className="max-w-[260px]"><Tip label={<span className="font-mono">{x.guid}</span>}><div className="truncate font-medium">{x.name}</div></Tip><a className="block truncate text-xs text-muted-foreground hover:text-brand" href={x.url} target="_blank" rel="noreferrer">{x.host || x.url}</a></TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{x.category}</TableCell><TableCell className="whitespace-nowrap text-xs text-muted-foreground">{x.region}</TableCell>
              <TableCell><Tip label={`抓取方式：${METHOD_SHORT[x.method] || x.method}${rule ? ' · 规则 ' + rule.mode : ''}${x.proxy !== 'inherit' ? ' · ' + (x.proxy === 'direct' ? '直连' : '走代理') : ''}${x.last_method ? ' · 上次用 ' + (METHOD_SHORT[x.last_method] || x.last_method) : ''}`}><Badge variant="outline" className="whitespace-nowrap">{METHOD_SHORT[x.method] || 'AUTO'}{x.last_method && x.last_method !== x.method ? '→' + METHOD_SHORT[x.last_method] : ''}</Badge></Tip></TableCell>
              <TableCell><Select disabled={meta.readOnly} value={String(x.interval_min)} onValueChange={v => patch(x, { interval_min: +v })} options={INTERVALS} className="h-7 w-[104px] text-xs shadow-none" /></TableCell>
              <TableCell className="text-right tabular-nums">{x.product_count}</TableCell>
              <TableCell className="max-w-[220px]"><Tip label={(x.last_error || l) + (x.fail_count ? ` · 成功 ${x.ok_count} / 失败 ${x.fail_count}` : '')}><div className="flex items-center gap-1.5"><Badge variant={v}>{l}</Badge>{x.fail_label && x.last_status !== 'ok' && <span className="truncate text-xs text-muted-foreground" data-testid="fail-label">{x.fail_label}</span>}</div></Tip></TableCell>
              <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{x.last_crawl_at ? new Date(x.last_crawl_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</TableCell>
              <TableCell>{!meta.readOnly && <div className="flex justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                <Tip label="立即抓取"><Button variant="ghost" size="icon" disabled={busy[x.guid]} onClick={() => crawl(x)}>{busy[x.guid] ? <Loader2 className="animate-spin" /> : <RefreshCw />}</Button></Tip>
                <Tip label="来源设置 / 单源测试"><Button variant="ghost" size="icon" data-testid="source-settings-btn" onClick={() => setCfg(x.guid)}><Settings2 /></Button></Tip>
                <Tip label="编辑抓取规则"><Button variant="ghost" size="icon" onClick={() => onEditRule(x)}><Workflow /></Button></Tip>
                <Tip label={x.enabled ? '停用' : '启用'}><Button variant="ghost" size="icon" onClick={() => patch(x, { enabled: x.enabled ? 0 : 1 })}><Power /></Button></Tip></div>}</TableCell>
            </TableRow></ContextMenuTrigger>
              <ContextMenuContent>
                {!meta.readOnly && <><ContextMenuItem onSelect={() => crawl(x)}><RefreshCw />立即抓取</ContextMenuItem><ContextMenuItem onSelect={() => setCfg(x.guid)}><Settings2 />来源设置 / 单源测试</ContextMenuItem><ContextMenuItem onSelect={() => onEditRule(x)}><Workflow />编辑规则</ContextMenuItem><ContextMenuItem onSelect={() => patch(x, { enabled: x.enabled ? 0 : 1 })}><Power />{x.enabled ? '停用' : '启用'}</ContextMenuItem><ContextMenuSeparator /></>}
                <ContextMenuItem onSelect={() => a.setNav({ kind: 'source', value: x.guid, label: x.name })}>查看该来源的产品</ContextMenuItem>
                <ContextMenuItem onSelect={() => window.open(x.url, '_blank')}><ExternalLink />打开网站</ContextMenuItem>
                <ContextMenuItem onSelect={() => { navigator.clipboard?.writeText(x.guid); toast('已复制 GUID'); }}><Copy />复制 GUID</ContextMenuItem>
              </ContextMenuContent></ContextMenu>; })}</TableBody></Table></div>}
      <SourceSettingsDialog guid={cfg} onClose={() => setCfg(null)} toast={toast} onSaved={() => src.reload()} browser={!!netInfo?.browser} />
      <AddSource open={adding} onOpenChange={setAdding} onDone={() => { setAdding(false); src.reload(); toast('已添加来源'); a.refreshStatus(); }} />
      <Dialog open={!!runs} onOpenChange={o => !o && setRuns(null)}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>最近抓取日志</DialogTitle></DialogHeader><div className="min-h-0 overflow-auto">
        <Table><TableHeader><TableRow><TableHead>时间</TableHead><TableHead>来源</TableHead><TableHead>状态</TableHead><TableHead className="text-right">发现</TableHead><TableHead className="text-right">新增</TableHead><TableHead className="text-right">更新</TableHead><TableHead>错误</TableHead></TableRow></TableHeader>
          <TableBody>{runs?.map(r => <TableRow key={r.id}><TableCell className="whitespace-nowrap text-xs">{new Date(r.started_at).toLocaleString('zh-CN')}</TableCell><TableCell>{r.source_name}</TableCell><TableCell><Badge variant={(ST[r.status] || [0, 'outline'])[1]}>{r.status}</Badge></TableCell><TableCell className="text-right tabular-nums">{r.found}</TableCell><TableCell className="text-right tabular-nums">{r.inserted}</TableCell><TableCell className="text-right tabular-nums">{r.updated}</TableCell><TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">{r.error}</TableCell></TableRow>)}</TableBody></Table></div></DialogContent></Dialog>
    </Page>
  );
}
function AddSource({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', url: '', category: '自定义', interval_min: 1440 }); const toast = useToast();
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogHeader><DialogTitle>添加自定义监控网站</DialogTitle><DialogDescription>系统会自动发现 RSS / JSON-LD / 列表结构；也可在「抓取规则」中用 AI 生成精确规则。</DialogDescription></DialogHeader>
    <form onSubmit={async e => { e.preventDefault(); try { await api('/api/sources', { body: f }); setF({ name: '', url: '', category: '自定义', interval_min: 1440 }); onDone(); } catch (er) { toast((er as Error).message, 'err'); } }}>
      <div className="space-y-3 px-5 py-4">
        <div className="space-y-1"><Label>名称</Label><Input required autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} data-testid="s-name" /></div>
        <div className="space-y-1"><Label>列表页 URL</Label><Input required value={f.url} onChange={e => setF({ ...f, url: e.target.value })} placeholder="https://example.com/new" data-testid="s-url" /></div>
        <div className="grid grid-cols-2 gap-3"><div className="space-y-1"><Label>类别</Label><Input value={f.category} onChange={e => setF({ ...f, category: e.target.value })} /></div>
          <div className="space-y-1"><Label>抓取频率</Label><Select value={String(f.interval_min)} onValueChange={v => setF({ ...f, interval_min: +v })} options={INTERVALS} /></div></div>
      </div>
      <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button variant="brand" data-testid="s-submit">添加</Button></DialogFooter></form>
  </DialogContent></Dialog>;
}
