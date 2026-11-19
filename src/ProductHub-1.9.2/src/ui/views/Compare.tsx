import React, { useMemo, useState } from 'react';
import { GitCompare, X, Download, ArrowLeft, DatabaseZap, ExternalLink, Trophy } from 'lucide-react';
import { api } from '../api';
import { useAsync, useActions, useMeta, useToast } from '../App';
import { Page } from '../components/Page';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Checkbox } from '../components/ui/checkbox';
import { Logo } from '../components/Logo';
import { ErrorState, EmptyState } from '../components/EmptyState';
import { Tip } from '../components/ui/tooltip';
import { cn } from '@/lib/utils';

/** 产品对比：属性行 × 产品列，差异行高亮，可只看差异、导出 xlsx / Markdown */
export function CompareView({ guids, setGuids }: { guids: string[]; setGuids: (g: string[]) => void }) {
  const a = useActions(); const meta = useMeta(); const toast = useToast();
  const key = guids.join(',');
  const c = useAsync(() => (guids.length >= 2 ? api<any>('/api/compare?guids=' + encodeURIComponent(key)) : Promise.resolve(null)), [key]);
  const [diffOnly, setDiffOnly] = useState(false);
  const rows = useMemo(() => (c.data?.rows || []).filter((r: any) => !diffOnly || r.differs), [c.data, diffOnly]);
  const groups = useMemo(() => { const m = new Map<string, any[]>(); rows.forEach((r: any) => { if (!m.has(r.group)) m.set(r.group, []); m.get(r.group)!.push(r); }); return [...m]; }, [rows]);
  const exp = (f: string) => { location.href = `/api/compare/export?format=${f}&guids=${encodeURIComponent(key)}`; toast(`正在导出对比表（${f === 'md' ? 'Markdown' : 'Excel'}）`); };
  const missing = (c.data?.products || []).filter((p: any) => !p.enriched).map((p: any) => p.guid);
  const enrich = async () => { try { await api('/api/enrich', { body: { guids: missing } }); toast(`正在补齐 ${missing.length} 个产品的官网信息，完成后自动刷新`); const t0 = Date.now(); const poll = async () => { const s = await api<any>('/api/enrich/status'); if (s.active && Date.now() - t0 < 60000) setTimeout(poll, 1200); else { c.reload(); a.refreshStatus(); } }; setTimeout(poll, 1200); } catch (e) { toast('补齐失败：' + (e as Error).message, 'err'); } };
  const back = <Button variant="outline" size="sm" onClick={() => a.go('products')}><ArrowLeft />返回产品库</Button>;
  if (guids.length < 2) return <Page title="产品对比" testId="compare"><EmptyState icon={GitCompare} title="选择 2–5 个产品开始对比" desc="在产品库勾选 2–5 个产品，点击批量操作条上的「对比」。" action={back} /></Page>;
  const n = guids.length;
  return <Page title="产品对比" testId="compare" desc={c.data ? <>共 {c.data.rows.length} 项属性，其中 <b className="font-semibold text-foreground">{c.data.diffCount}</b> 项存在差异（已高亮）</> : '正在加载…'}
    actions={<div className="flex items-center gap-1.5">
      <label className="mr-1 flex cursor-pointer items-center gap-1.5 text-xs"><Checkbox checked={diffOnly} onCheckedChange={v => setDiffOnly(v === true)} data-testid="diff-only" />只看差异</label>
      {!meta.readOnly && missing.length > 0 && <Button variant="outline" size="sm" onClick={enrich} data-testid="compare-enrich"><DatabaseZap />补齐缺失信息（{missing.length}）</Button>}
      <Button variant="outline" size="sm" onClick={() => exp('xlsx')} data-testid="compare-xlsx"><Download />Excel</Button>
      <Button variant="outline" size="sm" onClick={() => exp('md')} data-testid="compare-md"><Download />Markdown</Button>{back}</div>}>
    {c.error && !c.data ? <ErrorState error={c.error} retry={c.reload} /> : !c.data ? <Skeleton className="h-96" /> :
      <div className="overflow-auto rounded-xl border bg-card shadow-sm" data-testid="compare-table">
        <table className="w-full table-fixed border-collapse text-sm">
          <colgroup><col className="w-[148px]" />{c.data.products.map((p: any) => <col key={p.guid} />)}</colgroup>
          <thead className="sticky top-0 z-10 bg-card"><tr className="border-b">
            <th className="p-3 text-left align-bottom text-xs font-medium text-muted-foreground">{n} 个产品</th>
            {c.data.products.map((p: any) => <th key={p.guid} className="p-3 text-left align-top font-normal" data-testid="compare-col">
              <div className="flex items-start gap-2"><Logo p={p} size={32} /><div className="min-w-0 flex-1"><button className="block truncate text-left font-semibold hover:text-brand" onClick={() => a.openProduct(p.guid)}>{p.name}</button>
                {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 truncate text-xs text-brand hover:underline">{p.domain}<ExternalLink className="h-3 w-3" /></a>}
                <div className="mt-0.5">{p.enriched ? <Badge variant="success">已补齐官网信息</Badge> : <Badge variant="outline">未补齐</Badge>}</div></div>
                {n > 2 && <Tip label="从对比中移除"><button className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label={'移除 ' + p.name} onClick={() => setGuids(guids.filter(g => g !== p.guid))} data-testid="compare-remove"><X className="h-3.5 w-3.5" /></button></Tip>}</div></th>)}
          </tr></thead>
          <tbody>{groups.map(([g, rs]) => <React.Fragment key={g}>
            <tr><td colSpan={n + 1} className="border-b bg-muted/40 px-3 py-1 text-xs font-semibold text-muted-foreground">{g}</td></tr>
            {rs.map((r: any) => <tr key={r.key} data-testid="compare-row" data-differs={r.differs || undefined} className={cn('border-b align-top', r.differs && 'bg-warning/[0.06]')}>
              <td className="p-3 text-xs text-muted-foreground"><span className="flex items-center gap-1">{r.differs && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-label="存在差异" />}{r.label}</span></td>
              {r.values.map((v: string, i: number) => <td key={i} className={cn('whitespace-pre-line break-words p-3 text-xs leading-5', !v && 'text-muted-foreground/60', c.data.best[r.key] === i && 'font-semibold text-success')}>
                {c.data.best[r.key] === i && <Trophy className="mr-1 inline h-3 w-3" />}{r.key === 'url' && v ? <a className="text-brand hover:underline" href={v} target="_blank" rel="noreferrer">{v}</a> : v || '—'}</td>)}
            </tr>)}</React.Fragment>)}</tbody>
        </table>
      </div>}
  </Page>;
}
