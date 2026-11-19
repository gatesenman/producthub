import React, { useState } from 'react';
import { Star, X, ChevronUp, ChevronDown, Sparkles, Wand2, Pencil, Trash2, ExternalLink, Copy, Loader2, DatabaseZap, Globe2 } from 'lucide-react';
import { ErrorState } from '../components/EmptyState';
import { api, fmtDate } from '../api';
import { useMeta, useToast, catName, useAsync, useActions } from '../App';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Skeleton } from '../components/ui/skeleton';
import { Tip } from '../components/ui/tooltip';
import { Logo } from '../components/Logo';

export function Radar({ dims, size = 210 }: { dims: { label: string; score: number }[]; size?: number }) {
  const n = dims.length, c = size / 2, R = c - 32; const pt = (i: number, r: number) => [c + r * Math.sin((2 * Math.PI * i) / n), c - r * Math.cos((2 * Math.PI * i) / n)];
  return <svg width={size} height={size} className="radar">{[0.25, 0.5, 0.75, 1].map(k => <polygon key={k} points={dims.map((_, i) => pt(i, R * k).join(',')).join(' ')} className="ring" />)}
    <polygon points={dims.map((d, i) => pt(i, (R * d.score) / 10).join(',')).join(' ')} className="area" />
    {dims.map((d, i) => { const [x, y] = pt(i, R + 16); return <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle">{d.label}</text>; })}</svg>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section><h4 className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</h4>{children}</section>; }
const ORIGIN: Record<string, string> = { crawl: '自动抓取', manual: '手动添加', import: '导入', web: '联网搜索入库' };
const SOCIAL: Record<string, string> = { x: 'X / Twitter', linkedin: 'LinkedIn', github: 'GitHub', discord: 'Discord', youtube: 'YouTube', weibo: '微博', producthunt: 'Product Hunt' };
/** 信息新鲜度：7 天内为新、90 天内为较新，否则建议重新补齐 */
export function freshness(at?: string | null): { label: string; tone: 'success' | 'secondary' | 'warning' } | null {
  if (!at) return null; const d = Math.floor((Date.now() - new Date(at).getTime()) / 86400000);
  const label = d <= 0 ? '今天更新' : d < 30 ? `${d} 天前更新` : d < 365 ? `${Math.floor(d / 30)} 个月前更新` : '一年前更新';
  return { label, tone: d <= 7 ? 'success' : d <= 90 ? 'secondary' : 'warning' };
}
/** 官网信息（v1.4 自动补齐） */
function EnrichSection({ p, onEnrich, busy, readOnly }: { p: any; onEnrich: () => void; busy: boolean; readOnly: boolean }) {
  const e = p.enrich; const f = freshness(p.enriched_at); const err = String(p.enrich_status || '').startsWith('error:') ? p.enrich_status.slice(6) : null;
  const btn = !readOnly && <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={onEnrich} disabled={busy || !p.url} data-testid="enrich">{busy ? <Loader2 className="animate-spin" /> : <DatabaseZap />}{busy ? '补齐中…' : e ? '重新补齐' : '补齐信息'}</Button>;
  return <section data-testid="enrich-section" className="rounded-lg border p-3">
    <div className="mb-2 flex items-center gap-1.5"><Globe2 className="h-3.5 w-3.5 text-brand" /><h4 className="text-xs font-medium">官网信息</h4>
      {f && <Badge variant={f.tone} data-testid="enrich-fresh">{f.label}</Badge>}{e && <span className="text-2xs text-muted-foreground">{e.method === 'llm' ? '大模型提取' : '规则提取'}</span>}<div className="flex-1" />{btn}</div>
    {!e ? <p className="text-xs text-muted-foreground">{err ? <>上次补齐失败：{err}。</> : !p.url ? '该产品没有官网地址，无法补齐。' : '尚未补齐：从官网自动提取定价档位、核心功能、目标用户、公司与社交账号。'}</p> :
    <dl className="grid grid-cols-[64px_1fr] gap-x-3 gap-y-2 text-xs">
      {e.summary && <><dt className="text-muted-foreground">官网定位</dt><dd className="leading-5">{e.summary}</dd></>}
      <dt className="text-muted-foreground">定价</dt><dd data-testid="enrich-pricing">{e.pricing?.hasFree === true ? <Badge variant="success" className="mr-1">有免费版</Badge> : e.pricing?.hasFree === false ? <Badge variant="outline" className="mr-1">无免费版</Badge> : null}{e.pricing?.model && <span className="mr-1">{e.pricing.model}</span>}
        {(e.pricing?.tiers || []).length > 0 && <div className="mt-1 flex flex-wrap gap-1">{e.pricing.tiers.map((t: any) => <span key={t.name} className="rounded border px-1.5 py-0.5"><b className="font-medium">{t.name}</b>{t.price && <span className="ml-1 tabular-nums text-muted-foreground">{t.price}{t.period ? ' ' + t.period : ''}</span>}</span>)}</div>}
        {!e.pricing?.model && !(e.pricing?.tiers || []).length && e.pricing?.hasFree == null && '—'}
        {e.pricing?.url && <a href={e.pricing.url} target="_blank" rel="noreferrer" className="ml-1 text-brand hover:underline">定价页</a>}</dd>
      {!!e.features?.length && <><dt className="text-muted-foreground">核心功能</dt><dd><ul className="list-disc space-y-0.5 pl-4">{e.features.slice(0, 6).map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></dd></>}
      {!!e.audience?.length && <><dt className="text-muted-foreground">目标用户</dt><dd className="flex flex-wrap gap-1">{e.audience.map((x: string) => <Badge key={x} variant="outline">{x}</Badge>)}</dd></>}
      {e.company?.name && <><dt className="text-muted-foreground">公司/团队</dt><dd>{e.company.name}{e.company.founded ? ` · 成立于 ${e.company.founded}` : ''}{e.company.location ? ` · ${e.company.location}` : ''}</dd></>}
      {Object.keys(e.socials || {}).length > 0 && <><dt className="text-muted-foreground">社交账号</dt><dd className="flex flex-wrap gap-x-2 gap-y-0.5">{Object.entries(e.socials).map(([k, u]) => <a key={k} href={u as string} target="_blank" rel="noreferrer" className="text-brand hover:underline">{SOCIAL[k] || k}</a>)}</dd></>}
      {!!e.languages?.length && <><dt className="text-muted-foreground">界面语言</dt><dd>{e.languages.join(' · ')}</dd></>}
    </dl>}
  </section>;
}

export type DetailNav = { pos: number; total: number; prev?: () => void; next?: () => void };
export function ProductDetail({ guid, onClose, onChanged, onDeleted, onEdit, nav, requestDelete, onFav }: { guid: string; onClose: () => void; onChanged: () => void; onDeleted: () => void; onEdit: (p: any) => void; nav?: DetailNav; requestDelete?: (p: any) => void; onFav?: (guid: string, fav: boolean) => void }) {
  const meta = useMeta(); const toast = useToast(); const a = useActions();
  const { data: p, setData, loading, error, reload } = useAsync(() => api<any>('/api/products/' + guid), [guid]);
  const [tab, setTab] = useState('info'); const [busy, setBusy] = useState(false); const [enriching, setEnriching] = useState(false);
  const enrich = async () => { setEnriching(true); try { await api('/api/enrich', { body: { guids: [guid] } }); const t0 = Date.now();
    const poll = async (): Promise<void> => { const x = await api<any>('/api/products/' + guid); if ((x.enrich_status === 'queued' || x.enrich_status === p?.enrich_status && x.enriched_at === p?.enriched_at) && Date.now() - t0 < 30000) { await new Promise(r => setTimeout(r, 800)); return poll(); } setData(x); toast(x.enrich_status === 'ok' ? '官网信息已更新' : '补齐失败：' + String(x.enrich_status || '').replace(/^error:/, ''), x.enrich_status === 'ok' ? 'ok' : 'err'); };
    await poll(); a.refreshStatus(); } catch (e) { toast('补齐失败：' + (e as Error).message, 'err'); } finally { setEnriching(false); } };
  if (error && !p) return <ErrorState error={error} retry={reload} title="无法加载产品详情" />;
  if (!p) return <div className="space-y-3 p-4" data-testid="detail-skeleton"><div className="flex gap-3"><Skeleton className="h-11 w-11" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-3/4" /></div></div><Skeleton className="h-7 w-full" />{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-4" />)}</div>;
  const analyze = async () => { setBusy(true); try { setData(await api('/api/products/' + guid + '/analyze', { method: 'POST' })); setTab('ai'); toast('AI 分析完成'); onChanged(); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); } };
  const del = async () => { if (requestDelete) return requestDelete(p); if (!confirm(`确定删除「${p.name}」？`)) return; await api('/api/products/' + guid, { method: 'DELETE' }); toast('已删除'); onDeleted(); };
  // 乐观更新：立即切换星标，请求失败回滚并提示重试
  const toggleFav = async () => { const next = !p.favorite; setData({ ...p, favorite: next }); onFav?.(guid, next);
    try { await api<any>('/api/favorites/' + guid, { method: next ? 'PUT' : 'DELETE' }); toast(next ? '已加入我的关注' : '已取消关注', 'ok', next ? {} : { action: { label: '撤销', run: async () => { await api('/api/favorites/' + guid, { method: 'PUT' }); setData((x: any) => ({ ...x, favorite: true })); onFav?.(guid, true); onChanged(); a.refreshStatus(); } } }); onChanged(); a.refreshStatus(); }
    catch (e) { setData({ ...p, favorite: !next }); onFav?.(guid, !next); toast('关注失败：' + (e as Error).message, 'err', { action: { label: '重试', run: toggleFav } }); } };
  const an = p.ai_analysis;
  const KV = ({ k, children, mono }: { k: string; children: React.ReactNode; mono?: boolean }) => <><dt className="text-muted-foreground">{k}</dt><dd className={mono ? 'break-all font-mono text-xs' : 'min-w-0 break-words'}>{children || '—'}</dd></>;
  return (
    <div className={'flex h-full min-h-0 flex-col transition-opacity duration-fast ' + (loading ? 'pointer-events-none opacity-60' : 'animate-in fade-in-0')} aria-busy={loading} data-testid="product-detail">
      <div className="flex items-start gap-3 px-4 pb-3 pt-4">
        <Logo p={p} size={44} />
        <div className="min-w-0 flex-1"><h2 className="truncate text-lg font-semibold leading-6">{p.name}</h2>
          {p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-xs text-brand hover:underline">{p.domain || p.url}<ExternalLink className="h-3 w-3" /></a> : <span className="text-xs text-muted-foreground">无官网</span>}</div>
        {!meta.readOnly && <Tip label={p.favorite ? '取消关注' : '关注：在「我的关注」中跟踪后续发布'}><Button variant="ghost" size="icon" data-testid="fav" data-active={!!p.favorite} aria-pressed={!!p.favorite} onClick={toggleFav}><Star className={p.favorite ? 'fill-warning text-warning' : ''} /></Button></Tip>}
        {nav && nav.total > 1 && <div className="flex items-center" data-testid="detail-nav"><Tip label="上一个 (↑)"><Button variant="ghost" size="icon" disabled={!nav.prev} onClick={nav.prev} data-testid="detail-prev"><ChevronUp /></Button></Tip><span className="min-w-[44px] text-center text-2xs tabular-nums text-muted-foreground" data-testid="detail-pos" aria-live="polite">{nav.pos} / {nav.total.toLocaleString()}</span><Tip label="下一个 (↓)"><Button variant="ghost" size="icon" disabled={!nav.next} onClick={nav.next} data-testid="detail-next"><ChevronDown /></Button></Tip></div>}
        <Tip label="关闭 (Esc)"><Button variant="ghost" size="icon" onClick={onClose} data-testid="detail-close"><X /></Button></Tip>
      </div>
      <div className="flex flex-wrap gap-1.5 px-4 pb-3">
        <Button size="sm" variant="brand" onClick={() => a.openAI(p)} data-testid="find-similar"><Sparkles />找竞品 / 相似</Button>
        {!meta.readOnly && <><Button size="sm" variant="outline" onClick={analyze} disabled={busy} data-testid="analyze">{busy ? <Loader2 className="animate-spin" /> : <Wand2 />}{busy ? '分析中…' : 'AI 分析'}</Button>
          <Button size="sm" variant="outline" onClick={() => onEdit(p)} data-testid="edit"><Pencil />编辑</Button>
          <Tip label="删除"><Button size="icon" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" onClick={del}><Trash2 /></Button></Tip></>}
      </div>
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="border-b px-4 pb-2"><TabsList className="w-full"><TabsTrigger className="flex-1" value="info" data-testid="tab-info">概览</TabsTrigger><TabsTrigger className="flex-1" value="versions" data-testid="tab-versions">版本记录 <Badge variant="secondary" className="h-4 px-1">{p.versions.length}</Badge></TabsTrigger><TabsTrigger className="flex-1" value="ai" data-testid="tab-ai">AI 分析</TabsTrigger></TabsList></div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <TabsContent value="info" className="space-y-4">
            {p.tagline && <p className="text-md leading-6">{p.tagline}</p>}
            {p.ai_summary && <div className="rounded-lg border border-brand/20 bg-brand-soft/60 p-3"><div className="mb-1 flex items-center gap-1 text-xs font-medium text-brand"><Sparkles className="h-3.5 w-3.5" />AI 总结</div><p className="leading-6">{p.ai_summary}</p></div>}
            <EnrichSection p={p} onEnrich={enrich} busy={enriching} readOnly={meta.readOnly} />
            <Section title="基本信息"><dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-2">
              <KV k="分类"><Badge variant="brand">{catName(meta, p.category)}</Badge></KV>
              {p.tags.length > 0 && <KV k="标签"><div className="flex flex-wrap gap-1">{p.tags.map((t: string) => <Badge key={t} variant="outline">{t}</Badge>)}</div></KV>}
              {p.pricing && <KV k="定价">{p.pricing}</KV>}{p.platforms.length > 0 && <KV k="平台">{p.platforms.join('、')}</KV>}{p.maker && <KV k="开发者">{p.maker}</KV>}{p.country && <KV k="国家/地区">{p.country}</KV>}
            </dl></Section>
            <Section title="收录情况"><div className="grid grid-cols-3 gap-2" data-testid="detail-stats">
              {([['发布次数', p.launch_count], ['来源数', new Set(p.versions.map((v: any) => v.source_guid).filter(Boolean)).size], ['票数', p.votes || 0], ['首次发布', fmtDate(p.launch_date)], ['首次收录', fmtDate(p.first_seen)], ['最近出现', fmtDate(p.last_seen)]] as [string, any][]).map(([k, v]) => <div key={k} className="rounded-md border bg-muted/30 px-2.5 py-1.5"><div className="text-2xs text-muted-foreground">{k}</div><div className="font-medium tabular-nums">{v}</div></div>)}
            </div></Section>
            {p.description && <Section title="详细描述"><p className="line-clamp-[12] whitespace-pre-wrap leading-6 text-foreground/85">{p.description}</p></Section>}
            {p.notes && <Section title="备注"><p className="whitespace-pre-wrap">{p.notes}</p></Section>}
            <details className="group rounded-md border px-3 py-2 text-xs"><summary className="cursor-pointer select-none text-muted-foreground">技术信息（GUID / 去重键 / 收录方式）</summary>
              <dl className="mt-2 grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5"><KV k="收录方式">{ORIGIN[p.origin] || p.origin}</KV>
                <KV k="GUID" mono><span className="inline-flex items-center gap-1">{p.guid}<Copy className="h-3 w-3 cursor-pointer text-muted-foreground hover:text-foreground" onClick={() => { navigator.clipboard?.writeText(p.guid); toast('已复制 GUID'); }} /></span></KV>
                <KV k="去重键" mono>{p.dedup_key}</KV></dl></details>
          </TabsContent>
          <TabsContent value="versions">
            <ol className="relative ml-1.5 border-l pl-4" data-testid="versions">{p.versions.map((v: any) => <li key={v.id} className="relative pb-3.5" title={'记录于 ' + new Date(v.created_at).toLocaleString('zh-CN')}>
              <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-brand" />
              <div className="flex items-center gap-2"><b className="font-medium">{v.source_name || v.version_label || '手动/导入'}</b><span className="text-xs tabular-nums text-muted-foreground">{fmtDate(v.launched_at)}</span>{v.votes ? <Badge variant="outline">{v.votes} 票</Badge> : null}
                {v.url && <a className="ml-auto text-muted-foreground hover:text-brand" href={v.url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>}</div>
              <div className="truncate text-xs text-muted-foreground">{v.snapshot?.tagline || v.snapshot?.description?.slice(0, 120) || '—'}</div></li>)}</ol>
          </TabsContent>
          <TabsContent value="ai">{an ? <div className="space-y-4" data-testid="ai-analysis">
            <div className="flex items-center gap-2"><Badge variant={an.mode === 'ai' ? 'brand' : 'secondary'}>{an.mode === 'ai' ? '大模型生成' : '本地离线分析'}</Badge>{an.mode !== 'ai' && <span className="text-xs text-muted-foreground">配置 AI Key 可获得大模型分析</span>}</div>
            <p className="leading-6">{an.summary}</p>
            <div className="flex justify-center rounded-lg border bg-muted/30 py-2"><Radar dims={an.dimensions} /></div>
            <div className="space-y-2">{an.dimensions.map((d: any) => <div key={d.key}><div className="flex items-center gap-2"><span className="w-20 shrink-0 text-xs">{d.label}</span><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-brand transition-all" style={{ width: d.score * 10 + '%' }} /></div><span className="w-6 text-right text-xs font-semibold tabular-nums">{d.score}</span></div><div className="pl-[88px] text-xs text-muted-foreground">{d.comment}</div></div>)}</div>
            <dl className="grid grid-cols-[76px_1fr] gap-x-3 gap-y-2">
              <dt className="text-muted-foreground">目标用户</dt><dd className="flex flex-wrap gap-1">{an.audience.map((x: string) => <Badge key={x} variant="outline">{x}</Badge>)}</dd>
              <dt className="text-muted-foreground">商业模式</dt><dd>{an.business_model}</dd>
              {!!an.competitors?.length && <><dt className="text-muted-foreground">相似/竞品</dt><dd className="flex flex-wrap gap-1">{an.competitors.map((x: string) => <Badge key={x} variant="secondary">{x}</Badge>)}</dd></>}
            </dl>
            {!!an.features?.length && <section><h4 className="mb-1 text-xs font-medium text-muted-foreground">核心功能</h4><ul className="list-disc space-y-1 pl-4 text-xs">{an.features.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></section>}
          </div> : <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground"><Wand2 className="h-8 w-8 stroke-1" /><span>尚未进行 AI 分析</span>{!meta.readOnly && <Button size="sm" variant="brand" onClick={analyze}>立即分析</Button>}</div>}</TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
