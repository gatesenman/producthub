import React from 'react';
import { FileDown, FileText, Package, History, Radio, CheckCircle2, Layers, Sparkles } from 'lucide-react';
import { ErrorState } from '../components/EmptyState';
import { api } from '../api';
import { useAsync, useActions } from '../App';
import { Page, Card } from '../components/Page';
import { Skeleton } from '../components/ui/skeleton';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';

function Bars({ rows, label, value, onClick }: { rows: any[]; label: string; value: string; onClick?: (r: any) => void }) {
  const max = Math.max(1, ...rows.map(r => r[value]));
  return <div className="space-y-1">{rows.map((r, i) => <button key={i} onClick={() => onClick?.(r)} className="grid w-full grid-cols-[110px_1fr_44px] items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-accent"><span className="truncate">{r[label]}</span><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-brand/80" style={{ width: (r[value] / max) * 100 + '%' }} /></div><span className="text-right tabular-nums text-muted-foreground">{r[value]}</span></button>)}</div>;
}
/** 来源贡献：独有（品牌色）+ 重复（浅色）堆叠条，右侧「独有 / 收录」 */
function SourceBars({ rows, onClick }: { rows: any[]; onClick?: (r: any) => void }) {
  const max = Math.max(1, ...rows.map(r => r.n));
  return <div className="space-y-1" data-testid="source-bars">{rows.map((r, i) => <button key={i} onClick={() => onClick?.(r)} title={`${r.name}：独有 ${r.uniq} · 重复 ${r.n - r.uniq} · 收录 ${r.n}`} className="grid w-full grid-cols-[110px_1fr_72px] items-center gap-2 rounded px-1 py-0.5 text-left text-xs transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="truncate">{r.name}</span>
    <div className="flex h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-brand/30" style={{ width: (r.uniq / max) * 100 + '%' }} /><div className="h-full bg-brand" style={{ width: ((r.n - r.uniq) / max) * 100 + '%' }} /></div>
    <span className="text-right tabular-nums text-muted-foreground">重复 <b className="font-medium text-foreground">{r.n - r.uniq}</b>/{r.n}</span></button>)}</div>;
}
export function AnalyticsView() {
  const { data: a, loading, error, reload } = useAsync(() => api<any>('/api/analytics'), []); const act = useActions();
  if (error && !a) return <Page title="分析与报告" testId="analytics"><ErrorState error={error} retry={reload} /></Page>;
  if (loading || !a) return <Page title="分析与报告" testId="analytics"><div className="grid grid-cols-6 gap-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div><div className="mt-3 grid grid-cols-2 gap-3"><Skeleton className="h-72" /><Skeleton className="h-72" /></div></Page>;
  const t = a.totals; const maxM = Math.max(1, ...a.byMonth.map((m: any) => m.n));
  const kpis: [string, number, any][] = [['产品总数', t.products, Package], ['发布记录', t.versions, History], ['监控来源', t.sources, Radio], ['抓取成功来源', t.sources_ok, CheckCircle2], ['多次发布产品', t.multi_launch, Layers], ['已 AI 总结', t.summarized, Sparkles]];
  return (
    <Page title="分析与报告" desc="全库多维统计：分类分布、来源贡献、标签热度与发布趋势；可一键导出分享报告" testId="analytics" actions={<div className="flex gap-1.5"><Button variant="outline" size="sm" asChild><a href="/api/report?format=md" data-testid="report-md"><FileText />导出 Markdown</a></Button><Button size="sm" asChild><a href="/api/report?format=html" data-testid="report-html"><FileDown />导出报告（HTML）</a></Button></div>}>
      <div className="grid grid-cols-3 gap-3 xl:grid-cols-6">{kpis.map(([l, v, I]) => <div key={l} className="rounded-xl border bg-card p-3.5"><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><I className="h-3.5 w-3.5" />{l}</div><div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{v?.toLocaleString()}</div></div>)}</div>
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card title="按分类分布" desc="点击条目可跳转到该分类"><Bars rows={a.byCat} label="name" value="n" onClick={r => act.setNav({ kind: 'category', value: r.category, label: r.name })} /></Card>
        <Card title="来源重叠 Top 15" desc={<>按「与其他来源重复的产品数」排序：深色＝重复，浅色＝独有。{a.srcStats?.capped ? <>共 {a.srcStats.total} 个来源有数据，其中 {a.srcStats.capped} 个达到单次抓取上限 30 条。</> : null}</>}><SourceBars rows={a.bySource} onClick={(r: any) => act.setNav({ kind: 'source', value: r.guid, label: r.name })} /></Card>
        <Card title="热门标签"><div className="flex flex-wrap gap-1.5">{a.tags.map((x: any) => <button key={x.name} onClick={() => act.setNav({ kind: 'tag', value: x.name, label: '#' + x.name })} className="rounded-md border px-2 py-0.5 text-xs hover:bg-accent">{x.name} <span className="tabular-nums text-muted-foreground">{x.n}</span></button>)}</div></Card>
        <Card title="月度发布趋势" desc={a.byMonth.length < 3 ? '历史数据集中在近期，随着增量更新会逐步丰富' : undefined}>
          <div className="flex h-44 items-end gap-2">{a.byMonth.map((m: any) => <div key={m.month} className="flex flex-1 flex-col items-center gap-1 text-2xs text-muted-foreground"><span className="tabular-nums text-foreground">{m.n}</span><div className="w-full max-w-[36px] rounded-t bg-brand/80" style={{ height: Math.max(2, (m.n / maxM) * 130) }} /><span>{m.month?.slice(2)}</span></div>)}</div></Card>
        <Card title="多来源发布 / 高热度产品" className="lg:col-span-2"><div className="divide-y">{a.top.map((p: any, i: number) => <button key={p.guid} onClick={() => act.openProduct(p.guid)} className="flex w-full items-center gap-3 py-1.5 text-left hover:bg-accent/50"><span className="w-5 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span><span className="flex-1 truncate font-medium">{p.name}</span><Badge variant="outline">{p.launch_count} 次发布</Badge><span className="w-16 text-right text-xs tabular-nums text-muted-foreground">{p.votes} 票</span></button>)}</div></Card>
      </div>
    </Page>
  );
}
