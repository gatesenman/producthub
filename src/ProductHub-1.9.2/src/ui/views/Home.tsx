import React, { useState } from 'react';
import { Sparkles, RefreshCw, AlertTriangle, Star, CalendarPlus, TrendingUp, ArrowRight, CheckCircle2, Loader2, Search } from 'lucide-react';
import { ErrorState } from '../components/EmptyState';
import { api, fmtDate } from '../api';
import { useAsync, useActions, useMeta, useToast, catName } from '../App';
import { Page, Card } from '../components/Page';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Logo } from '../components/Logo';
import { EmptyState } from '../components/EmptyState';
import { ChipsRow, EXAMPLES } from '../components/Search';

/** 首页主角：一句话找产品 */
function HeroSearch({ total }: { total: number }) {
  const a = useActions(); const [q, setQ] = useState(''); const [chips, setChips] = useState<string[]>([]);
  const go = (text = q) => { if (text.trim() || chips.length) a.search(text.trim(), chips); };
  return <section className="mb-4 rounded-xl border bg-card p-5 shadow-sm" data-testid="home-hero">
    <h2 className="text-xl font-semibold tracking-tight">想找什么样的产品？</h2>
    <p className="mt-1 text-sm text-muted-foreground">用一句话描述需求，在 {total.toLocaleString()} 个产品中按相关度排序并解释为什么匹配；本地不够时自动联网搜索。</p>
    <form className="mt-3 flex gap-2" onSubmit={e => { e.preventDefault(); go(); }}>
      <div className="relative flex-1"><Search className="absolute left-3.5 top-3.5 h-4 w-4 text-brand" />
        <input value={q} onChange={e => setQ(e.target.value)} data-testid="home-search" aria-label="一句话描述你要找的产品" placeholder="例如：帮团队做会议纪要的AI工具，支持中文"
          className="h-11 w-full rounded-lg border bg-background pl-10 pr-3 text-md shadow-sm outline-none transition-[border-color,box-shadow] duration-fast placeholder:text-muted-foreground focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25" /></div>
      <Button type="submit" variant="brand" className="h-11 px-5" data-testid="home-search-go"><Search />找产品</Button>
    </form>
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <ChipsRow value={chips} onChange={setChips} />
      <div className="flex flex-wrap items-center gap-1.5 text-xs"><span className="text-muted-foreground">试试：</span>{EXAMPLES.slice(0, 4).map(x => <button key={x} type="button" onClick={() => { setQ(x); go(x); }} data-testid="home-example" className="rounded-md px-1.5 py-0.5 text-brand transition-colors duration-fast hover:bg-brand-soft">{x}</button>)}</div>
    </div>
  </section>;
}

const greet = () => { const h = new Date().getHours(); return h < 6 ? '夜深了' : h < 12 ? '早上好' : h < 18 ? '下午好' : '晚上好'; };
/** 首页：每天打开就能看到「今天新增了什么、关注的产品有没有动静、来源有没有出问题」 */
export function HomeView() {
  const meta = useMeta(); const a = useActions(); const toast = useToast();
  const h = useAsync(() => api<any>('/api/home'), []); const [syncing, setSyncing] = useState(false);
  const d = h.data;
  const sync = async () => { setSyncing(true); toast('开始同步：抓取到期的来源…'); try { const r = await api<any>('/api/scheduler/run', { body: { limit: 5 } }); const errs = (r.results || []).filter((x: any) => x.error).length; toast(`同步完成：${r.results?.length || 0} 个来源，新增 ${(r.results || []).reduce((s: number, x: any) => s + (x.inserted || 0), 0)} 个产品${errs ? `，${errs} 个失败` : ''}`, errs ? 'err' : 'ok'); h.reload(); a.refreshStatus(); } catch (e) { toast('同步失败：' + (e as Error).message, 'err'); } finally { setSyncing(false); } };
  if (!d && h.error) return <Page title="首页" testId="home"><ErrorState error={h.error} retry={h.reload} /></Page>;
  if (!d) return <Page title="首页" testId="home"><div className="grid grid-cols-4 gap-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div><Skeleton className="mt-3 h-80" /></Page>;
  const isNew = d.mode === 'new'; const maxT = Math.max(1, ...d.trend.map((t: any) => t.n));
  const seeNew = () => a.setNav(isNew ? { kind: 'today', value: d.cutoff, label: '同步新增' } : { kind: 'launched', label: '最近发布' });
  const kpi = (icon: React.ReactNode, label: string, value: React.ReactNode, sub: React.ReactNode, onClick?: () => void, testId?: string, tone?: string) =>
    <button onClick={onClick} data-testid={testId} className="group rounded-xl border bg-card p-4 text-left shadow-sm transition-[border-color,box-shadow,transform] duration-fast hover:-translate-y-px hover:border-foreground/20 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-0">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className={'flex h-6 w-6 items-center justify-center rounded-md [&>svg]:h-3.5 [&>svg]:w-3.5 ' + (tone ? 'bg-destructive/10 text-destructive' : 'bg-brand-soft text-brand')}>{icon}</span>{label}<ArrowRight className="ml-auto h-3.5 w-3.5 -translate-x-1 opacity-0 transition-[opacity,transform] duration-fast group-hover:translate-x-0 group-hover:opacity-100" /></div>
      <div className={'mt-2 text-2xl font-semibold tabular-nums tracking-tight ' + (tone || (value === 0 ? 'text-muted-foreground' : ''))}>{value}</div><div className="mt-0.5 text-xs text-muted-foreground">{sub}</div></button>;
  return (
    <Page title={`${greet()}，今天想找什么产品？`} testId="home"
      desc={<>产品库共 {d.total.toLocaleString()} 个产品 · 上次同步 {d.lastSync ? new Date(d.lastSync).toLocaleString('zh-CN', { hour12: false }) : '尚未同步（使用预置数据）'}</>}
      actions={<div className="flex gap-1.5"><Button variant="outline" size="sm" onClick={() => a.openPalette()}><Search />命令面板</Button>{!meta.readOnly && <Button size="sm" onClick={sync} disabled={syncing} data-testid="home-sync">{syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}{syncing ? '同步中…' : '立即同步'}</Button>}</div>}>
      <HeroSearch total={d.total} />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {kpi(<CalendarPlus />, '今日新增', <span data-testid="home-new-count">{d.newToday}</span>, isNew ? `累计同步新增 ${d.newAll}` : '尚无同步新增 · 点「立即同步」', seeNew, 'kpi-today')}
        {kpi(<TrendingUp />, '近 7 天新增', d.new7d, `正在监控 ${d.sources.enabled} 个来源`, seeNew)}
        {kpi(<Star />, '我的关注', d.favCount, d.favUpdates.length ? `${d.favUpdates.length} 个有新动态` : '暂无新动态', () => a.setNav({ kind: 'favorite', label: '我的关注' }), 'kpi-fav')}
        {kpi(<AlertTriangle />, '来源异常', d.sources.errors || 0, d.sources.errors ? '点击查看并修复' : `${d.sources.never || 0} 个尚未抓取`, () => a.goSources({ status: 'error' }), 'kpi-errors', d.sources.errors ? 'text-destructive' : '')}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card title={isNew ? '同步新增的产品' : '最近发布的产品'} desc={isNew ? '安装后从各来源新抓取到的产品，按收录时间倒序' : '还没有同步新增：先展示预置数据中最近发布的产品（按发布日期、发布次数）'} actions={<Button variant="ghost" size="sm" onClick={seeNew} data-testid="home-see-all">查看全部<ArrowRight /></Button>}>
          {d.items.length ? <div className="-mx-1 divide-y" data-testid="home-new-list">{d.items.map((p: any) => <button key={p.guid} onClick={() => a.openProduct(p.guid)} className="flex w-full items-center gap-3 rounded-md px-1.5 py-2 text-left transition-colors duration-fast hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <Logo p={p} size={28} /><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><span className="truncate font-medium">{p.name}</span>{p.favorite && <Star className="h-3 w-3 fill-warning text-warning" />}</div><div className="truncate text-xs text-muted-foreground">{p.tagline || p.domain}</div></div>
            <Badge variant="brand" className="shrink-0">{catName(meta, p.category)}</Badge>{p.launch_count > 1 && <Badge variant="outline" className="shrink-0">{p.launch_count} 次发布</Badge>}</button>)}</div>
            : <EmptyState icon={CheckCircle2} title="暂无产品" desc="点击右上角「立即同步」抓取最新内容" />}
        </Card>
        <div className="space-y-3">
          <Card title="近 14 天发布趋势" desc="按产品发布日期统计（平方根刻度）" actions={<span className="text-2xs tabular-nums text-muted-foreground">峰值 {maxT}</span>}>
            <div className="relative h-24" role="img" aria-label={'近 14 天发布数：' + d.trend.map((t: any) => `${t.d.slice(5)} ${t.n}`).join('，')}>
              {[0.5, 1].map(k => <div key={k} className="absolute inset-x-0 border-t border-dashed border-border" style={{ bottom: Math.sqrt(k) * 88 }} aria-hidden />)}
              <div className="absolute inset-0 flex items-end gap-1">{d.trend.map((t: any, i: number) => <div key={t.d} className="group/bar relative flex h-full flex-1 items-end">
                <div className={'w-full rounded-t-sm transition-colors duration-fast ' + (i === d.trend.length - 1 ? 'bg-brand' : 'bg-brand/45 group-hover/bar:bg-brand/80')} style={{ height: t.n ? Math.max(3, Math.sqrt(t.n / maxT) * 88) : 1 }} />
                <div className="pointer-events-none absolute -top-6 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-primary px-1.5 py-0.5 text-2xs tabular-nums text-primary-foreground opacity-0 transition-opacity duration-fast group-hover/bar:opacity-100">{t.d.slice(5)} · {t.n}</div></div>)}</div></div>
            <div className="mt-1.5 flex justify-between border-t pt-1 text-2xs tabular-nums text-muted-foreground"><span>{d.trend[0]?.d?.slice(5)}</span><span>{d.trend[7]?.d?.slice(5)}</span><span>今天</span></div></Card>
          <Card title="近 7 天热门分类" desc="按发布日期"><div className="flex flex-wrap gap-1.5">{d.cats.map((c: any) => <button key={c.category} onClick={() => a.setNav({ kind: 'category', value: c.category, label: c.name })} className="rounded-md border px-2 py-0.5 text-xs transition-colors duration-fast hover:border-brand/40 hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{c.name} <span className="tabular-nums text-muted-foreground">{c.n}</span></button>)}</div></Card>
          <Card title="关注的产品有新动态" desc="关注后，产品在任意来源再次发布会出现在这里">
            {d.favUpdates.length ? <div className="divide-y" data-testid="home-fav-updates">{d.favUpdates.map((p: any) => <button key={p.guid} onClick={() => a.openProduct(p.guid)} className="flex w-full items-center gap-2 py-1.5 text-left text-xs hover:bg-accent/60"><Logo p={p} size={20} /><span className="flex-1 truncate font-medium">{p.name}</span><span className="text-muted-foreground">{fmtDate(p.changed_at)}</span></button>)}</div>
              : <p className="text-xs text-muted-foreground">{d.favCount ? '关注的产品暂无新版本。' : '还没有关注任何产品：在产品详情点击 ☆ 关注。'}</p>}
          </Card>
          <Card title="来源健康" actions={d.sources.errors ? <Button size="sm" variant="outline" onClick={() => a.goSources({ status: 'error' })} data-testid="home-fix-sources">去处理</Button> : undefined}>
            {d.errors.length ? <ul className="space-y-1.5 text-xs">{d.errors.map((s: any) => <li key={s.guid} className="flex gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" /><div className="min-w-0"><div className="font-medium">{s.name}</div><div className="truncate text-muted-foreground">{s.last_error}</div></div></li>)}</ul>
              : <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-success" />所有启用的来源工作正常</p>}
          </Card>
          {!meta.aiEnabled && <Card><div className="flex items-start gap-2 text-xs"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand" /><div className="flex-1"><b className="font-medium">AI 当前为离线模式</b><p className="text-muted-foreground">相似产品、总结可离线使用；配置 API Key 可获得大模型分析。</p></div><Button size="sm" variant="ghost" onClick={() => a.go('settings')}>去配置</Button></div></Card>}
        </div>
      </div>
    </Page>
  );
}
