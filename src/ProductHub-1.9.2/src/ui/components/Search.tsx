import React, { useEffect, useRef, useState } from 'react';
import { Globe, Loader2, Plus, Check, AlertTriangle, ExternalLink, Sparkles, CalendarClock, Gift, GitBranch, Languages, RefreshCw, Info } from 'lucide-react';
import { api } from '../api';
import { useMeta, useToast, useActions } from '../App';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Tip } from './ui/tooltip';
import { cn } from '@/lib/utils';

/** 快捷条件（硬筛选） */
export const CHIPS: { key: string; label: string; icon: React.ComponentType<{ className?: string }>; tip: string }[] = [
  { key: 'recent', label: '最近30天新上线', icon: CalendarClock, tip: '发布日期或首次收录在 30 天内' },
  { key: 'free', label: '有免费版', icon: Gift, tip: '定价含免费档 / 免费试用 / 标签为免费、开源' },
  { key: 'opensource', label: '开源', icon: GitBranch, tip: '标签含开源，或简介/官网提到 open source、GitHub 仓库' },
  { key: 'chinese', label: '中文支持', icon: Languages, tip: '名称/简介为中文、中文来源，或官网提供中文' },
];
export const EXAMPLES = ['帮团队做会议纪要的AI工具，支持中文', '类似 Notion 的开源笔记', '免费的 AI 绘画', 'mac 上的截图工具', '录屏', 'pdf editor'];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 高亮命中词（不区分大小写；长词优先） */
export function Hl({ text, terms, className }: { text?: string | null; terms?: string[]; className?: string }) {
  if (!text) return null; const ts = (terms || []).filter(t => t && t.length > (/[\u4e00-\u9fff]/.test(t) ? 0 : 1)).sort((a, b) => b.length - a.length);
  if (!ts.length) return <span className={className}>{text}</span>;
  const re = new RegExp(`(${ts.map(t => (/^[a-z0-9]/i.test(t) ? '(?<![A-Za-z0-9])' : '') + esc(t)).join('|')})`, 'gi'); const parts = text.split(re).filter(x => x !== undefined);
  return <span className={className}>{parts.map((p, i) => i % 2 ? <mark key={i} data-testid="hl" className="rounded-sm bg-warning/20 px-px text-foreground">{p}</mark> : p)}</span>;
}

export function ChipsRow({ value, onChange, className }: { value: string[]; onChange: (v: string[]) => void; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-1.5', className)} role="group" aria-label="快捷条件" data-testid="chips">
    {CHIPS.map(c => { const on = value.includes(c.key); const I = c.icon; return <Tip key={c.key} label={c.tip}><button type="button" data-testid={'chip-' + c.key} aria-pressed={on}
      onClick={() => onChange(on ? value.filter(k => k !== c.key) : [...value, c.key])}
      className={cn('inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', on ? 'border-brand/50 bg-brand-soft font-medium text-brand' : 'text-muted-foreground hover:border-foreground/25 hover:text-foreground')}>
      <I className="h-3.5 w-3.5" />{c.label}{on && <Check className="h-3 w-3" />}</button></Tip>; })}
  </div>;
}

const KIND: Record<string, string> = { synonym: '同义', typo: '纠错', prefix: '补全', pinyin: '拼音', llm: 'AI 扩展' };
const CON: Record<string, string> = { free: '有免费版', opensource: '开源', chinese: '中文支持', recent: '最近30天', team: '面向团队', personal: '面向个人', developer: '面向开发者', ios: 'iOS', android: 'Android', mac: 'macOS', windows: 'Windows', extension: '浏览器插件', selfhost: '可自托管' };
/** “理解为”：把解析出的意图、扩展词、约束展示出来，让排序可解释 */
export function IntentBar({ s, onAddChip }: { s: any; onAddChip: (k: string) => void }) {
  if (!s || !s.concepts) return null;
  return <div className="flex min-h-8 flex-wrap items-center gap-1.5 border-b bg-muted/30 px-3 py-1.5 text-xs" data-testid="intent-bar">
    <span className="inline-flex items-center gap-1 text-muted-foreground"><Sparkles className="h-3.5 w-3.5 text-brand" />理解为</span>
    {s.concepts.map((c: any) => <Tip key={c.label} label={c.alts.length ? '同时匹配：' + c.alts.map((a: any) => `${a.text}（${KIND[a.kind] || a.kind}）`).join('、') : '精确匹配'}>
      <span className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5" data-testid="intent-concept"><b className="font-medium">{c.label}</b>{c.alts.length > 0 && <span className="text-muted-foreground">≈ {c.alts.slice(0, 2).map((a: any) => a.text).join(' / ')}{c.alts.length > 2 ? ' …' : ''}</span>}</span></Tip>)}
    {s.similarTo && <Badge variant="brand">与「{s.similarTo.name}」相似</Badge>}
    {(s.constraints || []).filter((k: string) => !(s.chips || []).includes(k)).map((k: string) => <Tip key={k} label={CHIPS.some(c => c.key === k) ? '点击改为必须满足' : '作为加分项'}><button type="button" onClick={() => CHIPS.some(c => c.key === k) && onAddChip(k)} className="rounded-md border border-dashed px-1.5 py-0.5 text-muted-foreground hover:text-foreground" data-testid={'intent-con-' + k}>偏好：{CON[k] || k}</button></Tip>)}
    {(s.ignored || []).length > 0 && <span className="text-muted-foreground">已忽略：{s.ignored.join('、')}</span>}
    <span className="ml-auto text-muted-foreground">{s.mode === 'llm' ? '大模型解析' : '本地规则解析'} · {s.tookMs ?? 0} ms{s.weak && <> · <span className="text-warning">本地匹配较少</span></>}</span>
  </div>;
}

/** 联网搜索结果：本地结果少/无时自动在后台查询公开来源 */
export function WebResults({ q, auto, onIngested, full }: { q: string; auto: boolean; onIngested: (guids: string[]) => void; full?: boolean }) {
  const meta = useMeta(); const toast = useToast(); const a = useActions();
  const [st, setSt] = useState<{ loading: boolean; data?: any; error?: string }>({ loading: false });
  const [done, setDone] = useState<Record<string, string>>({}); const [busy, setBusy] = useState<string | null>(null);
  const seq = useRef(0);
  const run = async () => { const s = ++seq.current; setSt({ loading: true }); try { const d = await api<any>('/api/websearch', { body: { q } }); if (s === seq.current) setSt({ loading: false, data: d }); } catch (e) { if (s === seq.current) setSt({ loading: false, error: (e as Error).message }); } };
  useEffect(() => { setDone({}); if (auto && q.trim()) run(); else setSt({ loading: false }); }, [q, auto]);
  const ingest = async (items: any[]) => { setBusy(items.length > 1 ? '*' : items[0].guid);
    try { const r = await api<any>('/api/websearch/ingest', { body: { items } }); const m = { ...done }; r.items.forEach((x: any, i: number) => { m[items[i].guid] = x.guid; }); setDone(m); onIngested(r.items.map((x: any) => x.guid)); a.refreshStatus();
      toast(items.length > 1 ? `已入库 ${r.items.length} 个产品，正在后台补齐官网信息` : `已入库「${items[0].name}」，正在后台补齐官网信息`); }
    catch (e) { toast('入库失败：' + (e as Error).message, 'err', { action: { label: '重试', run: () => ingest(items) } }); } finally { setBusy(null); } };
  if (!q.trim()) return null;
  const d = st.data; const fresh = (d?.items || []).filter((x: any) => !x.inLibrary && !done[x.guid]);
  return <section className={cn('flex min-h-0 flex-col border-t bg-background', full ? 'flex-1' : 'max-h-[46%] shrink-0')} data-testid="web-results" aria-label="联网搜索结果">
    <div className="flex h-9 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-b bg-muted/30 px-3 text-xs">
      <Globe className="h-3.5 w-3.5 shrink-0 text-brand" /><b className="shrink-0 text-sm font-semibold">联网搜索</b>
      <span className="min-w-0 truncate text-muted-foreground">{full ? '本地没有找到匹配的产品，' : '本地结果较少，'}已在公开来源搜索「{d?.query || q}」</span>
      <div className="flex-1" />
      {d && d.providers.map((p: any) => <Tip key={p.id} label={p.ok ? `${p.label}：${p.count} 条 · ${p.ms} ms` : `${p.label} 失败：${p.error}`}><span data-testid={'provider-' + p.id} data-ok={p.ok} className={cn('inline-flex items-center gap-0.5 rounded px-1 py-0.5', p.ok ? 'text-muted-foreground' : 'text-warning')}>{p.ok ? <Check className="h-3 w-3 text-success" /> : <AlertTriangle className="h-3 w-3" />}{p.label}</span></Tip>)}
      {d && <Tip label="重新搜索"><Button variant="ghost" size="icon" className="h-6 w-6" onClick={run} aria-label="重新联网搜索"><RefreshCw className="h-3.5 w-3.5" /></Button></Tip>}
      {!meta.readOnly && fresh.length > 1 && <Button size="sm" variant="outline" className="h-6" disabled={!!busy} onClick={() => ingest(fresh)} data-testid="web-ingest-all">{busy === '*' ? <Loader2 className="animate-spin" /> : <Plus />}全部入库（{fresh.length}）</Button>}
    </div>
    <div className="min-h-0 flex-1 overflow-auto">
      {st.loading && <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground" data-testid="web-loading"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在查询 Bing / DuckDuckGo / GitHub / Hacker News…（各来源独立超时，失败不影响其他来源）</div>}
      {!st.loading && st.error && <div className="flex items-center gap-2 px-3 py-4 text-xs text-destructive"><AlertTriangle className="h-3.5 w-3.5" />联网搜索失败：{st.error}<Button size="sm" variant="outline" className="h-6" onClick={run}>重试</Button></div>}
      {!st.loading && !st.error && !d && <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground"><Info className="h-3.5 w-3.5" />想看看市场上还有什么？<Button size="sm" variant="outline" className="h-6" onClick={run} data-testid="web-run"><Globe />联网搜索</Button></div>}
      {d && !d.items.length && !st.loading && <div className="px-3 py-4 text-xs text-muted-foreground" data-testid="web-empty">公开来源也没有找到像产品的结果{d.providers.some((p: any) => !p.ok) ? '（部分来源失败，可稍后重试）' : ''}。试试换个说法或用英文关键词。</div>}
      {d && !st.loading && <ul className="divide-y" data-testid="web-list">{d.items.map((it: any) => { const lib = it.inLibrary ? it.libraryGuid : done[it.guid];
        return <li key={it.guid} className="flex items-start gap-3 px-3 py-2" data-testid="web-item">
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-2xs font-semibold uppercase text-muted-foreground">{it.domain?.[0] || '?'}</div>
          <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><span className="truncate font-medium">{it.name}</span><a href={it.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-0.5 text-xs text-brand hover:underline">{it.domain}<ExternalLink className="h-3 w-3" /></a>
            <Badge variant="outline" className="shrink-0">{it.provider}</Badge>{it.stars ? <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">★ {it.stars.toLocaleString()}</span> : null}{it.date && <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{it.date}</span>}</div>
            <p className="line-clamp-2 text-xs text-muted-foreground">{it.snippet || '—'}</p></div>
          {lib ? <Button size="sm" variant="ghost" className="h-7 shrink-0 text-success" onClick={() => a.openProduct(lib)} data-testid="web-in-lib"><Check />{it.inLibrary ? '已在库' : '已入库'} · 查看</Button>
            : !meta.readOnly && <Button size="sm" variant="outline" className="h-7 shrink-0" disabled={!!busy} onClick={() => ingest([it])} data-testid="web-ingest">{busy === it.guid ? <Loader2 className="animate-spin" /> : <Plus />}入库</Button>}
        </li>; })}</ul>}
    </div>
  </section>;
}
