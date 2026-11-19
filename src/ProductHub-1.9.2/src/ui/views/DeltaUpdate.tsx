/** 设置 → 增量更新：检查更新 / 下载并更新（后台、可看进度）/ 从本地文件合并 / 自动检查开关 */
import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Download, RefreshCw, FileUp, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '../api';
import { Button } from '../components/ui/button';
import { Input, Label } from '../components/ui/input';
import { Badge } from '../components/ui/badge';

const fmtT = (s?: string) => s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '—';
const mb = (n: number) => (n / 1048576).toFixed(n > 10 * 1048576 ? 0 : 1) + ' MB';
const PHASE: Record<string, string> = { start: '准备', check: '检查更新', download: '下载', apply: '合并', products: '合并产品', deleted: '处理下架', fts: '同步搜索索引', done: '完成' };

export function DeltaUpdate({ s, setS, orig, toast, onChanged }: { s: any; setS: (x: any) => void; orig: any; toast: (m: string, k?: any) => void; onChanged: () => void }) {
  const [st, setSt] = useState<any>(s.delta || null); const [check, setCheck] = useState<any>(null); const [job, setJob] = useState<any>(null); const [busy, setBusy] = useState(''); const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null); const poll = useRef<any>(null);
  const url = String(s['delta.updateUrl'] || '').trim(); const dirty = String(s['delta.updateUrl'] ?? '') !== String(orig?.['delta.updateUrl'] ?? '');
  const refresh = () => api<any>('/api/delta/status').then(x => { setSt(x); if (x.job) setJob(x.job); return x; }).catch(() => null);
  const watch = () => { clearInterval(poll.current); poll.current = setInterval(async () => { const j = await api<any>('/api/delta/job').catch(() => null); if (!j) return; setJob(j); if (j.state !== 'running') { clearInterval(poll.current); setBusy(''); refresh(); onChanged();
    if (j.state === 'done') toast(j.message || '增量更新完成'); else toast('增量更新失败：' + (j.error?.message || j.message), 'err'); } }, 400); };
  useEffect(() => { refresh().then(x => { if (x?.job?.state === 'running') { setBusy('job'); watch(); } }); return () => clearInterval(poll.current); }, []);
  const doCheck = async () => { setBusy('check'); setCheck(null); try { const r = await api<any>('/api/delta/check', { body: { url: url || undefined } }); setCheck(r); toast(r.message || '检查完成'); refresh(); } catch (e) { setCheck({ error: (e as Error).message }); toast('检查失败：' + (e as Error).message, 'err'); } finally { setBusy(''); } };
  const doUpdate = async () => { setBusy('job'); setJob(null); try { const j = await api<any>('/api/delta/update', { body: { url: url || undefined } }); setJob(j); watch(); } catch (e) { setBusy(''); toast('无法开始更新：' + (e as Error).message, 'err'); } };
  const doFile = async (f: File) => { setBusy('job'); setJob(null); try { const j = await api<any>('/api/delta/apply?wait=0', { raw: await f.arrayBuffer() }); setJob(j); watch(); } catch (e) { setBusy(''); toast('合并失败：' + (e as Error).message, 'err'); } };
  const saveUrl = async () => { setSaving(true); try { await api('/api/settings', { body: { 'delta.updateUrl': url } }); toast('增量地址已保存'); onChanged(); } catch (e) { toast('保存失败：' + (e as Error).message, 'err'); } finally { setSaving(false); } };
  const toggleAuto = async (on: boolean) => { const prev = st; setSt({ ...st, autoCheck: on }); try { await api('/api/settings', { body: { 'delta.autoCheck': on ? '1' : '0' } }); toast(on ? '已开启自动检查更新（启动后与每 6 小时检查一次，只提示不自动合并）' : '已关闭自动检查更新'); } catch (e) { setSt(prev); toast('保存失败：' + (e as Error).message, 'err'); } };
  const last = st?.lastCheck; const running = job?.state === 'running';
  const pct = running ? (job.phase === 'download' && job.totalBytes ? Math.round(job.bytes * 100 / job.totalBytes) : job.total ? Math.round(job.done * 100 / job.total) : 5) : job?.state === 'done' ? 100 : 0;
  const sum = (k: string) => (job?.results || []).reduce((a: number, r: any) => a + (r[k] || 0), 0);
  return <>
    <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs space-y-1" data-testid="delta-status">
      <div>数据版本：<span className="font-mono" data-testid="delta-seq">#{st?.seq ?? 0}</span>　种子：<span className="font-mono">{st?.seedVersion || '—'}</span>　产品数：<span data-testid="delta-count">{(st?.productCount ?? 0).toLocaleString()}</span></div>
      <div>上次增量：{st?.lastAppliedAt ? fmtT(st.lastAppliedAt) : '尚未应用'}{st?.lastUntil ? `（数据截至 ${String(st.lastUntil).slice(0, 10)}）` : ''}</div>
      <div data-testid="delta-last-check">上次检查：{st?.lastCheckAt ? fmtT(st.lastCheckAt) : '—'}{last ? (last.error ? <span className="text-destructive">　{last.error}</span> : last.upToDate ? '　已是最新' : last.plan?.length ? <span className="text-brand">　有 {last.plan.length} 个更新可用（#{last.localSeq} → #{last.latestSeq}）</span> : '') : ''}</div>
    </div>
    <div className="space-y-1"><Label htmlFor="set-delta-url">更新地址（index.json 或增量包 URL / 本地路径）</Label>
      <Input id="set-delta-url" data-testid="set-delta-url" value={s['delta.updateUrl'] || ''} placeholder="https://…/index.json、D:\\更新\\index.json 或 .phdelta.json.gz" onChange={e => setS({ ...s, 'delta.updateUrl': e.target.value })} />
      <label className="flex items-center gap-2 pt-1 text-xs"><input type="checkbox" data-testid="delta-auto" checked={st?.autoCheck !== false} onChange={e => toggleAuto(e.target.checked)} />自动检查更新（只提示，不自动合并）</label>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" disabled={!dirty || saving} data-testid="set-save-delta" onClick={saveUrl}>保存地址</Button>
      <Button variant="outline" disabled={!!busy || !url} data-testid="delta-check" onClick={doCheck}>{busy === 'check' ? <Loader2 className="animate-spin" /> : <RefreshCw />}检查更新</Button>
      <Button variant="brand" disabled={!!busy || !url || dirty} title={dirty ? '请先保存地址' : ''} data-testid="delta-apply-url" onClick={doUpdate}>{busy === 'job' && job?.kind !== 'apply' ? <Loader2 className="animate-spin" /> : <Download />}下载并更新</Button>
      <Button variant="outline" disabled={!!busy} data-testid="delta-apply-file" onClick={() => fileRef.current?.click()}><FileUp />从本地文件合并</Button>
      <input ref={fileRef} type="file" accept=".json,.gz,.phdelta,application/gzip,application/json" className="hidden" data-testid="delta-file" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) doFile(f); }} />
    </div>
    {check && <div className="rounded-md border px-3 py-2 text-xs space-y-1" data-testid="delta-check-result">
      {check.error ? <div className="text-destructive"><AlertTriangle className="mr-1 inline size-3.5" />{check.error}</div> : <>
        <div className={check.upToDate ? 'text-success' : check.gap ? 'text-destructive' : 'text-brand'}>{check.message}</div>
        {!!check.plan?.length && <ul className="list-disc pl-4 text-muted-foreground">{check.plan.map((p: any) => <li key={p.from_seq + '-' + p.to_seq}>#{p.from_seq} → #{p.to_seq}：{(p.products || 0).toLocaleString()} 条，{mb(p.size || 0)}</li>)}</ul>}
      </>}
    </div>}
    {job && job.state && job.state !== 'idle' && <div className="rounded-md border px-3 py-2 text-xs space-y-1.5" data-testid="delta-job" data-state={job.state}>
      <div className="flex items-center gap-2">{running ? <Loader2 className="size-3.5 animate-spin" /> : job.state === 'done' ? <CheckCircle2 className="size-3.5 text-success" /> : <AlertTriangle className="size-3.5 text-destructive" />}
        <span className="font-medium">{running ? `${PHASE[job.phase] || job.phase}${job.steps > 1 ? `（${job.step}/${job.steps}）` : ''}` : job.state === 'done' ? '完成' : '失败'}</span><span className="text-muted-foreground truncate">{job.message}</span></div>
      <div className="h-1.5 w-full overflow-hidden rounded bg-muted"><div className={'h-full transition-all ' + (job.state === 'error' ? 'bg-destructive' : 'bg-brand')} style={{ width: pct + '%' }} data-testid="delta-progress" /></div>
      {running && job.phase === 'download' && <div className="text-muted-foreground">{mb(job.bytes || 0)} / {mb(job.totalBytes || 0)}（支持断点续传，网络中断会自动重试）</div>}
      {running && job.total > 0 && job.phase !== 'download' && <div className="text-muted-foreground">{(job.done || 0).toLocaleString()} / {job.total.toLocaleString()}　后台线程合并，界面可继续使用</div>}
      {job.state === 'done' && !!job.results?.length && <div data-testid="delta-result" className="space-y-1">
        <div>新增 <Badge variant="success">{sum('inserted')}</Badge>　更新 <Badge variant="brand">{sum('updated')}</Badge>　下架 {sum('deleted')}　未变 {sum('unchanged')}　保护跳过 {sum('skipped_manual') + sum('delete_protected')}</div>
        <div>产品总数 {Number(job.product_count_before || 0).toLocaleString()} → {Number(job.product_count_after || 0).toLocaleString()}　数据版本 #{job.results[0]?.seq_before} → #{job.results[job.results.length - 1]?.seq_after}　用时 {((Date.parse(job.finished_at) - Date.parse(job.started_at)) / 1000).toFixed(1)} 秒</div>
      </div>}
      {job.state === 'error' && <div className="text-destructive" data-testid="delta-error">{job.error?.message}（本地数据未改动）</div>}
    </div>}
  </>;
}
