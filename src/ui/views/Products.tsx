import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Star, Columns3, Search, RotateCcw, ChevronDown, ChevronUp, Plus, Download, List, LayoutGrid, Sparkles, ExternalLink, Copy, Trash2, Wand2, PanelRightOpen, PackageOpen, X, Tag, StarOff, GitCompare, DatabaseZap, Globe } from 'lucide-react';
import { ChipsRow, IntentBar, WebResults, Hl } from '../components/Search';
import { Checkbox } from '../components/ui/checkbox';
import { DropdownMenuLabel, DropdownMenuSeparator } from '../components/ui/dropdown-menu';
import { api, fmtDate } from '../api';
import { useMeta, useToast, catName, useAsync, useActions } from '../App';
import { Button } from '../components/ui/button';
import { Input, Label } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { MultiSelect } from '../components/ui/multi-select';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Tip } from '../components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, Shortcut } from '../components/ui/dropdown-menu';
import { Logo } from '../components/Logo';
import { Splitter } from '../components/Splitter';
import { EmptyState } from '../components/EmptyState';
import { ProductDetail } from './ProductDetail';
import { ProductFormDialog } from './ProductForm';
import { useResizable } from '../lib/hooks';
import { listCountBus } from '../components/StatusBar';
import { modKey } from '../components/TitleBar';
import { cn } from '@/lib/utils';

export type QForm = { q: string; category: string; tags: string[]; sources: string[]; region: string; pricing: string; dateFrom: string; dateTo: string; minVotes: string; minLaunches: string; origin: string; summarized: boolean; favorite: boolean; seenFrom: string; seenAfter?: string; sort: string; chips: string[] };
export const EMPTY_FORM: QForm = { q: '', category: '', tags: [], sources: [], region: '', pricing: '', dateFrom: '', dateTo: '', minVotes: '', minLaunches: '', origin: '', summarized: false, favorite: false, seenFrom: '', sort: 'updated', chips: [] };
const SORTS = [['relevance', '相关度'], ['updated', '最近更新'], ['newest', '最新发布'], ['first_seen', '最新收录'], ['launches', '发布次数'], ['votes', '票数'], ['name', '名称']].map(([value, label]) => ({ value, label }));
const PRICING = ['免费', '免费增值', '付费', '订阅制', '一次性买断', '开源'].map(v => ({ value: v, label: v }));

/** 把普通表单转换为后端筛选引擎的条件树（AND） */
export function formToQuery(f: QForm) {
  const c: any[] = []; const cond = (field: string, op: string, value?: any) => c.push({ type: 'cond', field, op, value });
  if (f.tags.length) cond('tags', 'has_any', f.tags);
  if (f.pricing) cond('tags', 'has_any', [f.pricing]);
  if (f.sources.length) cond('source', 'in', f.sources);
  if (f.region) cond('source_region', 'in', [f.region]);
  if (f.dateFrom) cond('launch_date', 'gte', f.dateFrom);
  if (f.dateTo) cond('launch_date', 'lte', f.dateTo);
  if (f.minVotes) cond('votes', 'gte', Number(f.minVotes));
  if (f.minLaunches) cond('launch_count', 'gte', Number(f.minLaunches));
  if (f.origin) cond('origin', 'in', [f.origin]);
  if (f.summarized) cond('has_summary', 'is_true');
  if (f.favorite) cond('favorite', 'is_true');
  if (f.seenFrom) cond('first_seen', 'gte', f.seenFrom);
  if (f.seenAfter) cond('first_seen', 'gt', f.seenAfter);
  return { q: f.q.trim() || undefined, chips: f.chips?.length ? f.chips : undefined, category: f.category || undefined, sort: f.sort === 'relevance' && !f.q.trim() ? 'updated' : f.sort, filter: c.length ? { type: 'group', op: 'AND', children: c } : null };
}
const ROW_H = 36; const ROW_H_BASE = ROW_H; const ROW_H_SEARCH = 58; const PAGE = 40;
/** 滚动位置记忆：按查询条件记录，返回同一列表时恢复 */
const scrollMem = new Map<string, number>();
const INVERSE: Record<string, string> = { favorite: 'unfavorite', unfavorite: 'favorite', tag: 'untag', untag: 'tag' };
/** 列表列定义：默认显示 分类/标签/发布次数/首次收录；票数、发布日期可在「列」菜单中打开 */
type Col = { key: string; label: string; w: string; minW: number; right?: boolean; def: boolean; cell: (p: any, meta: any) => React.ReactNode };
export const COLS: Col[] = [
  { key: 'category', label: '分类', w: '118px', minW: 0, def: true, cell: (p, m) => <div><Badge variant="brand" className="max-w-[110px] truncate">{catName(m, p.category)}</Badge></div> },
  { key: 'tags', label: '标签', w: '170px', minW: 760, def: true, cell: p => <div className="flex min-w-0 gap-1 overflow-hidden">{p.tags.slice(0, 2).map((t: string) => <Badge key={t} variant="outline">{t}</Badge>)}{p.tags.length > 2 && <span className="text-2xs text-muted-foreground">+{p.tags.length - 2}</span>}</div> },
  { key: 'launches', label: '发布次数', w: '64px', minW: 0, right: true, def: true, cell: p => <div className="text-right tabular-nums">{p.launch_count > 1 ? <b className="font-semibold">{p.launch_count}</b> : p.launch_count}</div> },
  { key: 'votes', label: '票数', w: '56px', minW: 600, right: true, def: false, cell: p => <div className="text-right tabular-nums text-muted-foreground">{p.votes || '—'}</div> },
  { key: 'launch_date', label: '发布日期', w: '92px', minW: 900, right: true, def: false, cell: p => <div className="text-right tabular-nums text-muted-foreground">{fmtDate(p.launch_date)}</div> },
  { key: 'first_seen', label: '首次收录', w: '92px', minW: 640, right: true, def: true, cell: p => <div className="text-right tabular-nums text-muted-foreground">{fmtDate(p.first_seen)}</div> },
];
const colBus = new Set<(c: string[]) => void>();
function useCols(): [string[], (c: string[]) => void] {
  const [c, setC] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('ph.cols') || '') } catch { return COLS.filter(x => x.def).map(x => x.key); } });
  useEffect(() => { colBus.add(setC); return () => { colBus.delete(setC); }; }, []);
  return [c, (n: string[]) => { localStorage.setItem('ph.cols', JSON.stringify(n)); colBus.forEach(f => f(n)); }];
}
function ColumnMenu() {
  const [c, setC] = useCols();
  return <DropdownMenu><Tip label="显示列"><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" data-testid="col-menu"><Columns3 /></Button></DropdownMenuTrigger></Tip>
    <DropdownMenuContent align="end">{COLS.map(x => <DropdownMenuItem key={x.key} data-testid={'col-' + x.key} onSelect={e => { e.preventDefault(); setC(c.includes(x.key) ? c.filter(k => k !== x.key) : [...c, x.key]); }}><span className="w-4">{c.includes(x.key) ? '✓' : ''}</span>{x.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>;
}

export function ProductsView({ selected, setSelected, addSignal, searchSignal, onCompare }: { selected: string | null; setSelected: (g: string | null) => void; addSignal: number; searchSignal?: { q: string; chips?: string[]; n: number } | null; onCompare?: (guids: string[]) => void }) {
  const meta = useMeta(); const toast = useToast(); const a = useActions();
  const facets = useAsync(() => api<any>('/api/facets'), []);
  const [form, setForm] = useState<QForm>(EMPTY_FORM); const [applied, setApplied] = useState<QForm>(EMPTY_FORM);
  const [more, setMore] = useState(false); const [layout, setLayout] = useState<'table' | 'grid'>('table');
  const [items, setItems] = useState<any[]>([]); const [total, setTotal] = useState(0); const [loading, setLoading] = useState(true); const pageRef = useRef(1); const loadingMore = useRef(false); const reqSeq = useRef(0);
  const [adding, setAdding] = useState(false); const [editing, setEditing] = useState<any>(null);
  const searchRef = useRef<HTMLInputElement>(null); const [sinfo, setSinfo] = useState<any>(null); const [webOpen, setWebOpen] = useState(false);
  // 键盘导航读取最新值，避免事件早于 effect 重新注册时拿到旧的选中项
  const selRef = useRef(selected); selRef.current = selected; const itemsRef = useRef<any[]>([]); itemsRef.current = items;
  const detail = useResizable('detail', 440, 340, 760, 'left');
  // —— 多选 / 批量 / 乐观更新 / 可撤销删除 ——
  const [checked, setChecked] = useState<Set<string>>(new Set()); const anchor = useRef<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set()); const pendingDel = useRef(new Map<string, { t: any; guids: string[]; commit: () => void }>());
  const visItems = useMemo(() => hidden.size ? items.filter(p => !hidden.has(p.guid)) : items, [items, hidden]);
  const shownTotal = Math.max(0, total - (items.length - visItems.length));
  const visRef = useRef<any[]>([]); visRef.current = visItems; const checkedRef = useRef(checked); checkedRef.current = checked;
  const hide = (gs: string[], on: boolean) => setHidden(h => { const n = new Set(h); gs.forEach(g => on ? n.add(g) : n.delete(g)); return n; });
  const patchItems = (gs: string[], patch: any) => setItems(xs => xs.map(p => gs.includes(p.guid) ? { ...p, ...patch } : p));
  const toggleCheck = (guid: string, range = false) => setChecked(prev => { const n = new Set(prev); const its = visRef.current;
    if (range && anchor.current) { const i = its.findIndex(p => p.guid === anchor.current), j = its.findIndex(p => p.guid === guid); if (i >= 0 && j >= 0) { const on = !prev.has(guid); for (let k = Math.min(i, j); k <= Math.max(i, j); k++) on ? n.add(its[k].guid) : n.delete(its[k].guid); return n; } }
    n.has(guid) ? n.delete(guid) : n.add(guid); anchor.current = guid; return n; });
  const checkAll = (on: boolean) => setChecked(on ? new Set(visRef.current.map(p => p.guid)) : new Set());
  const softDelete = (ps: any[]) => { const guids = ps.map(p => p.guid); if (!guids.length) return; hide(guids, true); setChecked(new Set()); if (selRef.current && guids.includes(selRef.current)) setSelected(null);
    const key = String(Date.now() + Math.random());
    const commit = async () => { pendingDel.current.delete(key); try { await api('/api/products/batch', { body: { guids, action: 'delete' } }); setItems(xs => xs.filter(p => !guids.includes(p.guid))); setTotal(t => Math.max(0, t - guids.length)); a.refreshStatus(); } catch (e) { toast('删除失败：' + (e as Error).message, 'err'); } finally { hide(guids, false); } };
    const t = setTimeout(commit, 6000); pendingDel.current.set(key, { t, guids, commit });
    toast(ps.length === 1 ? `已删除「${ps[0].name}」` : `已删除 ${ps.length} 个产品`, 'ok', { duration: 6000, action: { label: '撤销', run: () => { clearTimeout(t); pendingDel.current.delete(key); hide(guids, false); toast('已恢复'); } } }); };
  // 离开页面/关闭窗口前提交待删除项
  useEffect(() => { const flush = () => pendingDel.current.forEach(x => { clearTimeout(x.t); navigator.sendBeacon?.('/api/products/batch', new Blob([JSON.stringify({ guids: x.guids, action: 'delete' })], { type: 'application/json' })); });
    window.addEventListener('beforeunload', flush); return () => { window.removeEventListener('beforeunload', flush); pendingDel.current.forEach(x => { clearTimeout(x.t); x.commit(); }); }; }, []);
  const fav = async (p: any) => { const next = !p.favorite; const inFav = applied.favorite; patchItems([p.guid], { favorite: next }); if (!next && inFav) hide([p.guid], true);
    const undo = async () => { patchItems([p.guid], { favorite: true }); hide([p.guid], false); await api('/api/favorites/' + p.guid, { method: 'PUT' }); a.refreshStatus(); if (!itemsRef.current.some(x => x.guid === p.guid)) load(true); };
    try { await api('/api/favorites/' + p.guid, { method: next ? 'PUT' : 'DELETE' }); a.refreshStatus(); toast(next ? '已加入我的关注' : '已取消关注', 'ok', next ? {} : { action: { label: '撤销', run: undo } }); }
    catch (e) { patchItems([p.guid], { favorite: !next }); hide([p.guid], false); toast('操作失败：' + (e as Error).message, 'err', { action: { label: '重试', run: () => fav({ ...p }) } }); } };
  const batch = async (action: string, tag?: string, silent = false): Promise<void> => {
    const sel = visRef.current.filter(p => checkedRef.current.has(p.guid)); if (!sel.length) return;
    if (action === 'delete') return softDelete(sel);
    const changed = sel.filter(p => action === 'favorite' ? !p.favorite : action === 'unfavorite' ? p.favorite : action === 'tag' ? !p.tags.includes(tag) : p.tags.includes(tag)).map(p => p.guid);
    return runBatch(action, changed, sel.length, tag, silent); };
  const runBatch = async (action: string, guids: string[], n: number, tag?: string, silent = false) => {
    const before = items.filter(p => guids.includes(p.guid)).map(p => ({ guid: p.guid, favorite: p.favorite, tags: p.tags }));
    if (action === 'favorite' || action === 'unfavorite') patchItems(guids, { favorite: action === 'favorite' });
    if (action === 'tag' || action === 'untag') setItems(xs => xs.map(p => guids.includes(p.guid) ? { ...p, tags: action === 'tag' ? [...new Set([...p.tags, tag])] : p.tags.filter((t: string) => t !== tag) } : p));
    if (action === 'unfavorite' && applied.favorite) hide(guids, true);
    try { if (guids.length) await api('/api/products/batch', { body: { guids, action, tag } }); a.refreshStatus();
      if (!silent) { const label: Record<string, string> = { favorite: `已关注 ${n} 个产品`, unfavorite: `已取消关注 ${n} 个产品`, tag: `已为 ${n} 个产品添加标签「${tag}」`, untag: `已从 ${n} 个产品移除标签「${tag}」` };
        toast(label[action], 'ok', guids.length ? { action: { label: '撤销', run: () => { hide(guids, false); runBatch(INVERSE[action], guids, n, tag, true).then(() => { toast('已撤销'); if (guids.some(g => !itemsRef.current.some(x => x.guid === g))) load(true); }); } } } : {}); } }
    catch (e) { setItems(xs => xs.map(p => { const b = before.find(x => x.guid === p.guid); return b ? { ...p, ...b } : p; })); hide(guids, false); toast('批量操作失败：' + (e as Error).message, 'err', { action: { label: '重试', run: () => runBatch(action, guids, n, tag) } }); } };
  const enrichSel = async () => { const gs = [...checked]; try { const r = await api<any>('/api/enrich', { body: { guids: gs } }); toast(`已加入补齐队列 ${r.queued} 个产品：后台抓取官网的定价、功能、目标用户等，进度见底部状态栏`); a.refreshStatus(); } catch (e) { toast('补齐失败：' + (e as Error).message, 'err'); } };
  const exportSel = (f: string) => { const gs = [...checked]; if (gs.length > 1500) return toast('一次最多导出 1500 个选中项，请缩小选择或用「导出当前结果」', 'err'); const p = new URLSearchParams({ format: f, filter: JSON.stringify({ type: 'cond', field: 'guid', op: 'in', value: gs }) }); location.href = '/api/export?' + p; toast(`正在导出 ${gs.length} 个产品`); };
  // 查询表单容器宽度自适应：窄时把标签/来源收进「更多条件」、按钮仅显示图标（v2 #30）
  const formRef = useRef<HTMLFormElement>(null); const [compact, setCompact] = useState(false);
  useEffect(() => { const el = formRef.current; if (!el) return; const ro = new ResizeObserver(() => setCompact(el.clientWidth < 900)); ro.observe(el); return () => ro.disconnect(); }, []);
  const set = <K extends keyof QForm>(k: K, v: QForm[K]) => setForm(f => ({ ...f, [k]: v }));

  // 侧边栏导航 → 表单预设
  useEffect(() => {
    const n = a.nav; const f: QForm = { ...EMPTY_FORM };
    if (n.kind === 'category') f.category = n.value!; if (n.kind === 'tag') f.tags = [n.value!]; if (n.kind === 'source') f.sources = [n.value!];
    if (n.kind === 'recent') f.sort = 'first_seen'; if (n.kind === 'multi') { f.minLaunches = '2'; f.sort = 'launches'; } if (n.kind === 'summarized') f.summarized = true; if (n.kind === 'manual') f.origin = 'manual';
    if (n.kind === 'favorite') f.favorite = true; if (n.kind === 'today') { f.seenAfter = n.value!; f.sort = 'first_seen'; } if (n.kind === 'launched') f.sort = 'newest';
    setForm(f); setApplied(f);
  }, [a.nav]);
  useEffect(() => { if (addSignal) setAdding(true); }, [addSignal]);
  // 首页 / 命令面板发起的搜索
  useEffect(() => { if (!searchSignal?.n) return; const f: QForm = { ...EMPTY_FORM, q: searchSignal.q, chips: searchSignal.chips || [], sort: searchSignal.q.trim() ? 'relevance' : 'updated' }; setForm(f); setApplied(f); }, [searchSignal?.n]);
  // 关键词即时搜索
  useEffect(() => { const t = setTimeout(() => setApplied(x => { if (x.q === form.q) return x; const sort = form.q.trim() && x.sort === 'updated' ? 'relevance' : !form.q.trim() && x.sort === 'relevance' ? 'updated' : x.sort; if (sort !== form.sort) setForm(f => ({ ...f, sort })); return { ...x, q: form.q, sort }; }), 300); return () => clearTimeout(t); }, [form.q]);
  const setChips = (chips: string[]) => { setForm(f => ({ ...f, chips })); setApplied(x => ({ ...x, chips })); };
  useEffect(() => { setWebOpen(false); }, [applied.q]);

  const query = useMemo(() => formToQuery(applied), [applied]);
  const load = useCallback(async (reset: boolean) => {
    if (!reset && (loadingMore.current || items.length >= total)) return;
    // 请求序号守卫：只接受最新一次查询的响应，避免旧响应覆盖（v1.3 修复 e2e 偶发失败的根因）
    const seq = ++reqSeq.current;
    loadingMore.current = true; if (reset) { setLoading(true); pageRef.current = 1; }
    try { const r = await api<any>('/api/products/query', { body: { ...query, page: pageRef.current, pageSize: PAGE } }); if (seq !== reqSeq.current) return; if (reset) setSinfo(r.search || null); setTotal(r.total); setItems(prev => reset ? r.items : [...prev, ...r.items]); pageRef.current++; }
    finally { if (seq === reqSeq.current) { loadingMore.current = false; setLoading(false); } }
  }, [query, items.length, total]);
  useEffect(() => { load(true); }, [query]);
  // 查询条件变化时清空勾选
  useEffect(() => { setChecked(new Set()); anchor.current = null; }, [query]);

  useEffect(() => { listCountBus.set(shownTotal); return () => listCountBus.set(null); }, [shownTotal]);

  const submit = (e?: React.FormEvent) => { e?.preventDefault(); setApplied({ ...form }); };
  const reset = () => { setForm(EMPTY_FORM); setApplied(EMPTY_FORM); };
  const activeCount = Object.entries(applied).filter(([k, v]) => k !== 'sort' && k !== 'q' && (Array.isArray(v) ? v.length : !!v)).length;
  const exp = (f: string) => { const p = new URLSearchParams({ format: f }); if (query.q) p.set('q', query.q); if (query.category) p.set('category', query.category); if (query.filter) p.set('filter', JSON.stringify(query.filter)); location.href = '/api/export?' + p; };
  const reloadAll = () => load(true);

  // 键盘：↑↓ 选择、Esc 关闭详情、Ctrl+F 聚焦搜索
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName; const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); searchRef.current?.focus(); return; }
      if (typing || document.querySelector('[role=dialog][data-state=open]:not([data-testid=ai-panel]), [role=menu][data-state=open]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); checkAll(true); return; }
      if (e.key === 'Escape') { if (checkedRef.current.size) { setChecked(new Set()); return; } if (selRef.current) setSelected(null); }
      if (e.key === ' ' && selRef.current && (e.target as HTMLElement)?.tagName !== 'BUTTON') { e.preventDefault(); toggleCheck(selRef.current, e.shiftKey); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !meta.readOnly && checkedRef.current.size) { e.preventDefault(); batch('delete'); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const its = visRef.current; const i = its.findIndex(p => p.guid === selRef.current); const n = Math.max(0, Math.min(its.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))); if (its[n]) { selRef.current = its[n].guid; setSelected(its[n].guid); } }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [items, selected]);

  const regions = (facets.data?.regions || []).map((r: string) => ({ value: r, label: r }));
  const sourceOpts = (facets.data?.sources || []).map((s: any) => ({ value: s.guid, label: s.name, hint: s.product_count }));
  const tagOpts = Object.values(meta.tagGroups).flat().map(t => ({ value: t, label: t }));
  const catOpts = meta.categories.map(c => ({ value: c.id, label: (c.parent ? '　' : '') + c.name }));

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex min-w-[420px] flex-1 flex-col">
        {/* 普通表单查询 */}
        <form ref={formRef} onSubmit={submit} className="border-b bg-background px-3 py-2" data-testid="query-form" data-compact={compact || undefined}>
          <div className="flex flex-wrap items-end gap-2">
            <div className="relative min-w-[220px] basis-full"><Search className="absolute left-3 top-3 h-4 w-4 text-brand" />
              <Input ref={searchRef} data-testid="search" value={form.q} onChange={e => set('q', e.target.value)} placeholder={`一句话描述你要找的产品，如「帮团队做会议纪要的AI工具，支持中文」· 支持中英文、拼音、错别字（${modKey()}+F）`} className="h-10 rounded-lg pl-9 pr-9 text-md shadow-sm" aria-label="搜索产品" />
              {form.q && <button type="button" aria-label="清空搜索" onClick={() => { set('q', ''); setApplied(x => ({ ...x, q: '', sort: x.sort === 'relevance' ? 'updated' : x.sort })); }} className="absolute right-2.5 top-2.5 rounded p-0.5 text-muted-foreground hover:text-foreground" data-testid="search-clear"><X className="h-4 w-4" /></button>}</div>
            <ChipsRow value={form.chips} onChange={setChips} className="mr-auto" />
            <Select testId="q-category" value={form.category} onValueChange={v => set('category', v)} options={catOpts} placeholder="全部分类" className="w-[124px]" />
            {!compact && <MultiSelect testId="q-tags" value={form.tags} onChange={v => set('tags', v)} options={tagOpts} placeholder="标签" className="w-[124px]" />}
            {!compact && <MultiSelect testId="q-sources" value={form.sources} onChange={v => set('sources', v)} options={sourceOpts} placeholder="来源" className="w-[124px]" />}
            {compact ? <Tip label="查询 (Enter)"><Button type="submit" size="icon" className="h-8 w-8" data-testid="q-submit"><Search /></Button></Tip> : <Button type="submit" size="default" data-testid="q-submit"><Search />查询</Button>}
            {compact ? <Tip label="重置条件"><Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={reset} data-testid="q-reset"><RotateCcw /></Button></Tip> : <Button type="button" variant="outline" onClick={reset} data-testid="q-reset"><RotateCcw />重置</Button>}
            <Button type="button" variant="ghost" aria-expanded={more} aria-controls="q-more-panel" onClick={() => setMore(m => !m)} data-testid="q-more" className="text-muted-foreground">{more ? <ChevronUp /> : <ChevronDown />}{compact ? '更多' : '更多条件'}{activeCount > 0 && <Badge variant="brand">{activeCount}</Badge>}</Button>
          </div>
          {more && <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-2 gap-y-2 animate-in fade-in-0 slide-in-from-top-1" data-testid="q-more-panel" id="q-more-panel">
            {compact && <Field label="标签"><MultiSelect testId="q-tags" value={form.tags} onChange={v => set('tags', v)} options={tagOpts} placeholder="不限" /></Field>}
            {compact && <Field label="来源"><MultiSelect testId="q-sources" value={form.sources} onChange={v => set('sources', v)} options={sourceOpts} placeholder="不限" /></Field>}
            <Field label="来源地区"><Select testId="q-region" value={form.region} onValueChange={v => set('region', v)} options={regions} placeholder="不限" /></Field>
            <Field label="商业模式"><Select testId="q-pricing" value={form.pricing} onValueChange={v => set('pricing', v)} options={PRICING} placeholder="不限" /></Field>
            <Field label="发布日期 起"><Input type="date" value={form.dateFrom} onChange={e => set('dateFrom', e.target.value)} data-testid="q-date-from" /></Field>
            <Field label="发布日期 止"><Input type="date" value={form.dateTo} onChange={e => set('dateTo', e.target.value)} data-testid="q-date-to" /></Field>
            <Field label="最少票数"><Input type="number" min={0} value={form.minVotes} onChange={e => set('minVotes', e.target.value)} placeholder="不限" data-testid="q-votes" /></Field>
            <Field label="最少发布次数"><Input type="number" min={0} value={form.minLaunches} onChange={e => set('minLaunches', e.target.value)} placeholder="不限" data-testid="q-launches" /></Field>
            <Field label="收录方式"><Select testId="q-origin" value={form.origin} onValueChange={v => set('origin', v)} options={[{ value: 'crawl', label: '自动抓取' }, { value: 'manual', label: '手动添加' }, { value: 'import', label: '导入' }]} placeholder="不限" /></Field>
            <Field label="AI 总结"><Select value={form.summarized ? '1' : ''} onValueChange={v => set('summarized', v === '1')} options={[{ value: '1', label: '仅已总结' }]} placeholder="不限" /></Field>
            <Field label="首次收录 起"><Input type="date" value={form.seenFrom} onChange={e => set('seenFrom', e.target.value)} data-testid="q-seen-from" /></Field>
            <Field label="关注"><Select testId="q-fav" value={form.favorite ? '1' : ''} onValueChange={v => set('favorite', v === '1')} options={[{ value: '1', label: '仅我关注的' }]} placeholder="不限" /></Field>
          </div>}
        </form>
        {/* 列表工具栏 */}
        {checked.size > 0 ? <BatchBar n={checked.size} all={checked.size === visItems.length} readOnly={meta.readOnly} tags={tagOpts.map((t: any) => t.value)} onAll={() => checkAll(true)} onClear={() => setChecked(new Set())} onAction={batch} onExport={exportSel} onCompare={() => onCompare?.([...checked])} onEnrich={enrichSel} /> :
        <div className="flex h-9 items-center gap-2 overflow-hidden whitespace-nowrap border-b px-3 text-xs text-muted-foreground">
          <span className="min-w-0 truncate text-sm font-semibold text-foreground" data-testid="list-title">{a.nav.kind === 'all' ? '全部产品' : a.nav.label}</span><span className="text-border">|</span><span data-testid="total" className="shrink-0">共 <b className="font-semibold text-foreground tabular-nums">{shownTotal.toLocaleString()}</b> 个产品</span>
          {a.nav.kind !== 'all' && <button className="inline-flex items-center gap-0.5 hover:text-foreground" onClick={() => a.setNav({ kind: 'all' })}><X className="h-3 w-3" />清除</button>}
          <div className="flex-1" />
          {applied.q && !(sinfo?.weak) && <Tip label="在公开来源搜索更多产品"><Button variant="ghost" size="sm" className="h-7" onClick={() => setWebOpen(o => !o)} data-testid="web-toggle" aria-pressed={webOpen}><Globe />{!compact && '联网搜索'}</Button></Tip>}
          {!compact && <span>排序</span>}<Select testId="q-sort" value={applied.sort} onValueChange={v => { set('sort', v); setApplied(x => ({ ...x, sort: v })); }} options={SORTS} className="h-7 w-[110px] text-xs" />
          <ColumnMenu />
          <div className="flex rounded-md border p-0.5">
            <Tip label="表格"><button onClick={() => setLayout('table')} className={cn('rounded p-1', layout === 'table' && 'bg-accent text-foreground')} data-testid="layout-table"><List className="h-3.5 w-3.5" /></button></Tip>
            <Tip label="卡片"><button onClick={() => setLayout('grid')} className={cn('rounded p-1', layout === 'grid' && 'bg-accent text-foreground')} data-testid="layout-grid"><LayoutGrid className="h-3.5 w-3.5" /></button></Tip>
          </div>
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm" aria-label="导出当前结果"><Download />{!compact && '导出'}</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">{['csv', 'xlsx', 'json'].map(f => <DropdownMenuItem key={f} onSelect={() => exp(f)}>导出当前结果为 {f.toUpperCase()}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
          {!meta.readOnly && <Tip label={`${modKey()}+N`}><Button size="sm" variant="brand" onClick={() => setAdding(true)} data-testid="add-product" aria-label="添加产品"><Plus />{compact ? '添加' : '添加产品'}</Button></Tip>}
        </div>}
        {applied.q && sinfo && !loading && <IntentBar s={sinfo} onAddChip={k => setChips([...new Set([...applied.chips, k])])} />}
        {loading ? <ListSkeleton /> : !visItems.length ? (applied.favorite ? <EmptyFav onBrowse={() => a.setNav({ kind: 'all' })} /> : applied.q.trim() && !items.length ? <WebResults q={applied.q} auto full onIngested={() => reloadAll()} /> : <Empty onReset={reset} />) :
          layout === 'table' ? <VirtualTable items={visItems} selected={selected} onSelect={setSelected} onEnd={() => load(false)} hasMore={items.length < total} onEdit={setEditing} reload={reloadAll}
              checked={checked} onCheck={toggleCheck} onCheckAll={checkAll} onFav={fav} onDelete={p => softDelete([p])} memKey={JSON.stringify(query)} searching={!!applied.q.trim()} />
            : <CardGrid items={visItems} onSelect={setSelected} onEnd={() => load(false)} memKey={JSON.stringify(query)} />}
        {!loading && visItems.length > 0 && applied.q.trim() && (sinfo?.weak || webOpen) && <WebResults q={applied.q} auto onIngested={() => reloadAll()} />}
      </section>
      {selected && <><Splitter rs={detail} testId="detail-splitter" />
        <div style={{ width: detail.width }} className="flex shrink-0 flex-col bg-background"><ProductDetail guid={selected} onClose={() => setSelected(null)} onChanged={() => { if (applied.favorite) reloadAll(); }} onDeleted={() => { setSelected(null); reloadAll(); }} onEdit={setEditing}
          requestDelete={meta.readOnly ? undefined : (p: any) => softDelete([p])} onFav={(g, f) => patchItems([g], { favorite: f })} nav={(() => { const i = visItems.findIndex(p => p.guid === selected); if (i < 0) return undefined;
            return { pos: i + 1, total: shownTotal, prev: i > 0 ? () => setSelected(visItems[i - 1].guid) : undefined, next: i < visItems.length - 1 ? () => { setSelected(visItems[i + 1].guid); if (i + 1 > visItems.length - 10) load(false); } : undefined }; })()} /></div></>}
      <ProductFormDialog open={adding} onOpenChange={setAdding} onDone={(p: any) => { setAdding(false); reloadAll(); setSelected(p.guid); toast(p.status === 'inserted' ? '已添加新产品' : '产品已存在，已合并为新版本'); a.refreshStatus(); }} />
      <ProductFormDialog open={!!editing} onOpenChange={o => !o && setEditing(null)} initial={editing} guid={editing?.guid} onDone={() => { setEditing(null); reloadAll(); toast('已保存'); }} />
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="flex flex-col gap-1"><Label>{label}</Label>{children}</div>; }
function ListSkeleton() { return <div className="flex-1 space-y-0 overflow-hidden" data-testid="list-skeleton">{Array.from({ length: 18 }, (_, i) => <div key={i} className="flex h-9 items-center gap-3 border-b px-3"><Skeleton className="h-6 w-6" /><Skeleton className="h-3.5 w-48" /><Skeleton className="ml-auto h-3.5 w-20" /><Skeleton className="h-3.5 w-16" /></div>)}</div>; }
function EmptyFav({ onBrowse }: { onBrowse: () => void }) { return <EmptyState className="flex-1" testId="empty-fav" icon={Star} title="还没有关注的产品" desc="在列表行或产品详情点击 ☆ 即可关注；关注的产品有新版本发布时会出现在首页。" action={<Button variant="outline" size="sm" onClick={onBrowse}>去产品库看看</Button>} />; }
function Empty({ onReset }: { onReset: () => void }) { return <EmptyState className="flex-1" testId="empty" icon={PackageOpen} title="没有匹配的产品" desc="试试放宽查询条件或换个关键词" action={<Button variant="outline" size="sm" onClick={onReset}><RotateCcw />重置条件</Button>} />; }
/** 批量操作条：替换列表工具栏（同高 36px，避免布局跳动） */
function BatchBar({ n, all, readOnly, tags, onAll, onClear, onAction, onExport, onCompare, onEnrich }: { n: number; all: boolean; readOnly: boolean; tags: string[]; onAll: () => void; onClear: () => void; onAction: (a: string, tag?: string) => void; onExport: (f: string) => void; onCompare: () => void; onEnrich: () => void }) {
  const [tq, setTq] = useState(''); const ref = useRef<HTMLDivElement>(null); const [narrow, setNarrow] = useState(false);
  useEffect(() => { const el = ref.current; if (!el) return; const ro = new ResizeObserver(() => setNarrow(el.clientWidth < 720)); ro.observe(el); return () => ro.disconnect(); }, []);
  const L = (t: string) => narrow ? <span className="sr-only">{t}</span> : t;
  return <div ref={ref} className="flex h-9 items-center gap-1 overflow-hidden whitespace-nowrap border-b bg-brand-soft px-3 text-xs animate-in fade-in-0" data-testid="batch-bar" role="toolbar" aria-label="批量操作">
    <span className="shrink-0 font-medium text-foreground" data-testid="batch-count" aria-live="polite">已选 {n.toLocaleString()} 项</span>
    {!all && !narrow && <Button variant="link" size="sm" className="h-6 px-1" onClick={onAll}>全选已加载</Button>}
    <span className="mx-1 h-4 w-px bg-border" />
    <Tip label={n < 2 ? '至少选择 2 个产品' : n > 5 ? '最多对比 5 个产品' : '并排对比所选产品'}><span><Button variant="ghost" size="sm" className="h-7" disabled={n < 2 || n > 5} onClick={onCompare} data-testid="batch-compare"><GitCompare />{L('对比')}</Button></span></Tip>
    {!readOnly && <Tip label="抓取官网，补齐定价、功能、目标用户、公司、社交账号"><Button variant="ghost" size="sm" className="h-7" onClick={onEnrich} data-testid="batch-enrich"><DatabaseZap />{L('补齐信息')}</Button></Tip>}
    {!readOnly && <><Button variant="ghost" size="sm" className="h-7" onClick={() => onAction('favorite')} data-testid="batch-fav"><Star />{L('关注')}</Button>
      <Button variant="ghost" size="sm" className="h-7" onClick={() => onAction('unfavorite')} data-testid="batch-unfav"><StarOff />{L('取消关注')}</Button>
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-7" data-testid="batch-tag"><Tag />{L('标签')}<ChevronDown /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-auto"><div className="p-1"><Input autoFocus value={tq} onChange={e => setTq(e.target.value)} onKeyDown={e => e.stopPropagation()} placeholder="筛选标签…" className="h-7 text-xs" data-testid="batch-tag-q" /></div>
          <DropdownMenuLabel>添加标签</DropdownMenuLabel>{tags.filter(t => !tq || t.includes(tq)).slice(0, 40).map(t => <DropdownMenuItem key={t} data-testid={'batch-tag-' + t} onSelect={() => onAction('tag', t)}>{t}</DropdownMenuItem>)}
          <DropdownMenuSeparator /><DropdownMenuLabel>移除标签</DropdownMenuLabel>{tags.filter(t => !tq || t.includes(tq)).slice(0, 12).map(t => <DropdownMenuItem key={t} onSelect={() => onAction('untag', t)}>移除「{t}」</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></>}
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-7" data-testid="batch-export"><Download />{L('导出选中')}<ChevronDown /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start">{['csv', 'xlsx', 'json'].map(f => <DropdownMenuItem key={f} data-testid={'batch-export-' + f} onSelect={() => onExport(f)}>导出为 {f.toUpperCase()}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
    {!readOnly && <Button variant="ghost" size="sm" className="h-7 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => onAction('delete')} data-testid="batch-delete"><Trash2 />{L('删除')}</Button>}
    <div className="flex-1" /><span className="hidden truncate text-muted-foreground 2xl:inline">Shift+点击 连选 · {modKey()}+A 全选 · Esc 取消</span>
    <Tip label="取消选择 (Esc)"><Button variant="ghost" size="icon" onClick={onClear} data-testid="batch-clear"><X /></Button></Tip>
  </div>;
}

/** 虚拟滚动表格：表头吸顶、仅渲染可见行、滚动到底自动加载 */
function VirtualTable({ items, selected, onSelect, onEnd, hasMore, onEdit, reload, checked, onCheck, onCheckAll, onFav, onDelete, memKey, searching }: { items: any[]; selected: string | null; onSelect: (g: string) => void; onEnd: () => void; hasMore: boolean; onEdit: (p: any) => void; reload: () => void; checked: Set<string>; onCheck: (g: string, range?: boolean) => void; onCheckAll: (on: boolean) => void; onFav: (p: any) => void; onDelete: (p: any) => void; memKey: string; searching?: boolean }) {
  const meta = useMeta(); const a = useActions(); const toast = useToast(); const ROW_H = searching ? ROW_H_SEARCH : ROW_H_BASE;
  const ref = useRef<HTMLDivElement>(null); const [top, setTop] = useState(0); const [h, setH] = useState(600); const [w, setW] = useState(900);
  useEffect(() => { const el = ref.current!; const ro = new ResizeObserver(() => { setH(el.clientHeight); setW(el.clientWidth); }); ro.observe(el); return () => ro.disconnect(); }, []);
  useEffect(() => { const i = items.findIndex(p => p.guid === selected); const el = ref.current; if (i < 0 || !el) return; const y = i * ROW_H; if (y < el.scrollTop) el.scrollTop = y; else if (y + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW_H - el.clientHeight; }, [selected]);
  // 恢复该查询上次的滚动位置
  useEffect(() => { const el = ref.current; const y = scrollMem.get(memKey) || 0; if (el && y) { el.scrollTop = y; setTop(el.scrollTop); } }, [memKey]);
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => { const el = e.currentTarget; setTop(el.scrollTop); scrollMem.set(memKey, el.scrollTop); if (hasMore && el.scrollTop + el.clientHeight > el.scrollHeight - ROW_H * 10) onEnd(); };
  const [colPref] = useCols(); const fits = (k: string) => colPref.includes(k) && w > (COLS.find(c => c.key === k)!.minW);
  const vis = COLS.filter(c => fits(c.key));
  const start = Math.max(0, Math.floor(top / ROW_H) - 8); const end = Math.min(items.length, Math.ceil((top + h) / ROW_H) + 8);
  const cols = `${meta.readOnly ? '' : '28px '}minmax(240px,1fr) ${vis.map(c => c.w).join(' ')} 32px`; const nChecked = checked.size;
  const fav = onFav;
  const analyze = async (p: any) => { try { await api('/api/products/' + p.guid + '/analyze', { method: 'POST' }); toast('AI 分析完成'); onSelect(p.guid); reload(); } catch (e) { toast('AI 分析失败：' + (e as Error).message, 'err', { action: { label: '重试', run: () => analyze(p) } }); } };
  const del = onDelete;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="product-table">
      <div className="grid h-8 shrink-0 items-center border-b bg-muted/40 px-3 text-xs font-medium text-muted-foreground" style={{ gridTemplateColumns: cols }}>
        {!meta.readOnly && <Checkbox aria-label="全选已加载" data-testid="check-all" checked={nChecked && nChecked === items.length ? true : nChecked ? 'indeterminate' : false} onCheckedChange={v => onCheckAll(v === true)} />}<span>产品</span>{vis.map(c => <span key={c.key} className={c.right ? 'text-right' : ''}>{c.label}</span>)}<span />
      </div>
      <div ref={ref} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" tabIndex={0} role="grid" aria-label="产品列表" aria-rowcount={items.length} aria-multiselectable={!meta.readOnly}
        onKeyDown={e => { if (e.key === 'Enter' && !selected && items[0]) onSelect(items[0].guid); }}>
        <div style={{ height: items.length * ROW_H + (hasMore ? ROW_H : 0) }} className="relative">
          {items.slice(start, end).map((p, k) => { const i = start + k; return (
            <ContextMenu key={p.guid}><ContextMenuTrigger asChild>
              <div data-testid="product-row" role="row" aria-rowindex={i + 1} aria-selected={selected === p.guid} data-checked={checked.has(p.guid) || undefined} data-state={selected === p.guid ? 'selected' : undefined}
                onClick={e => { if (!meta.readOnly && (e.shiftKey || e.ctrlKey || e.metaKey)) { e.preventDefault(); onCheck(p.guid, e.shiftKey); return; } onSelect(p.guid); }} onDoubleClick={() => p.url && window.open(p.url, '_blank')}
                className="absolute inset-x-0 grid cursor-default items-center border-b border-border/60 px-3 transition-colors duration-fast hover:bg-muted/60 data-[checked]:bg-brand-soft/60 data-[state=selected]:bg-brand-soft data-[state=selected]:shadow-[inset_2px_0_0_hsl(var(--brand))]" style={{ top: i * ROW_H, height: ROW_H, gridTemplateColumns: cols }}>
                {!meta.readOnly && <Checkbox aria-label={'选择 ' + p.name} data-testid="row-check" checked={checked.has(p.guid)} onClick={e => { e.stopPropagation(); e.preventDefault(); onCheck(p.guid, e.shiftKey); }} />}
                <div className="flex min-w-0 items-center gap-2.5"><Logo p={p} size={searching ? 28 : 22} /><div className="min-w-0 leading-tight"><div className="truncate font-medium"><Hl text={p.name} terms={p.match?.hl} /></div><div className="truncate text-xs text-muted-foreground"><Hl text={p.tagline || p.domain || '—'} terms={p.match?.hl} /></div>
                  {searching && p.match && <div className="mt-0.5 flex min-w-0 items-center gap-1 overflow-hidden text-2xs" data-testid="match-reasons" title={'为什么匹配：' + p.match.reasons.join('；')}><span className="shrink-0 text-brand">为什么匹配</span>{p.match.reasons.slice(0, 4).map((r: string, i: number) => <span key={i} className={cn('shrink-0 truncate rounded px-1', r.startsWith('✓') ? 'bg-success/12 text-success' : r.startsWith('?') ? 'text-muted-foreground' : 'bg-muted text-foreground/80')}>{r}</span>)}</div>}</div></div>
                {vis.map(c => <React.Fragment key={c.key}>{c.cell(p, meta)}</React.Fragment>)}
                <div className="flex justify-end">{!meta.readOnly && <button data-testid="fav-toggle" aria-label={p.favorite ? '取消关注 ' + p.name : '关注 ' + p.name} aria-pressed={!!p.favorite} onClick={e => { e.stopPropagation(); fav(p); }} className={cn('rounded p-1 text-muted-foreground/60 transition-[color,transform] duration-fast hover:text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-90', p.favorite && 'text-warning')}><Star className={cn('h-3.5 w-3.5', p.favorite && 'fill-warning')} /></button>}</div>
              </div></ContextMenuTrigger>
              <ContextMenuContent data-testid="row-menu">
                <ContextMenuItem onSelect={() => onSelect(p.guid)}><PanelRightOpen />查看详情<Shortcut>Enter</Shortcut></ContextMenuItem>
                {!meta.readOnly && <ContextMenuItem onSelect={() => onCheck(p.guid)}>{checked.has(p.guid) ? '取消选择' : '选择'}<Shortcut>Space</Shortcut></ContextMenuItem>}
                <ContextMenuItem onSelect={() => a.openAI(p)}><Sparkles />查找相似产品</ContextMenuItem>
                {!meta.readOnly && <ContextMenuItem onSelect={() => fav(p)}><Star />{p.favorite ? '取消关注' : '关注'}</ContextMenuItem>}
                {!meta.readOnly && <ContextMenuItem onSelect={() => analyze(p)}><Wand2 />AI 分析</ContextMenuItem>}
                <ContextMenuItem disabled={!p.url} onSelect={() => window.open(p.url, '_blank')}><ExternalLink />打开官网</ContextMenuItem>
                <ContextMenuItem onSelect={() => { navigator.clipboard?.writeText(p.guid); toast('已复制 GUID'); }}><Copy />复制 GUID</ContextMenuItem>
                {!meta.readOnly && <><ContextMenuSeparator /><ContextMenuItem onSelect={() => onEdit(p)}>编辑…</ContextMenuItem><ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => del(p)}><Trash2 className="!text-destructive" />删除<Shortcut>可撤销</Shortcut></ContextMenuItem></>}
              </ContextMenuContent></ContextMenu>); })}
          {hasMore && <div className="absolute inset-x-0 flex items-center gap-2 px-3 text-xs text-muted-foreground" style={{ top: items.length * ROW_H, height: ROW_H }}><Skeleton className="h-5 w-5" /><Skeleton className="h-3 w-40" />正在加载更多…</div>}
        </div>
      </div>
    </div>
  );
}
function CardGrid({ items, onSelect, onEnd, memKey }: { items: any[]; onSelect: (g: string) => void; onEnd: () => void; memKey: string }) {
  const meta = useMeta(); const ref = useRef<HTMLDivElement>(null); const k = 'grid:' + memKey;
  useEffect(() => { const y = scrollMem.get(k); if (ref.current && y) ref.current.scrollTop = y; }, [k]);
  return <div ref={ref} className="min-h-0 flex-1 overflow-auto p-3" onScroll={e => { const el = e.currentTarget; scrollMem.set(k, el.scrollTop); if (el.scrollTop + el.clientHeight > el.scrollHeight - 300) onEnd(); }}>
    <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2.5">{items.map(p =>
      <button key={p.guid} data-testid="product-row" onClick={() => onSelect(p.guid)} className="flex h-[132px] flex-col gap-2 rounded-lg border bg-card p-3 text-left transition-[border-color,box-shadow,transform] duration-fast hover:-translate-y-px hover:border-brand/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-0">
        <div className="flex items-center gap-2.5"><Logo p={p} size={32} /><div className="min-w-0"><div className="truncate font-medium">{p.name}</div><div className="truncate text-xs text-muted-foreground">{p.domain || '—'}</div></div></div>
        <p className="line-clamp-2 text-xs text-muted-foreground">{p.tagline}</p>
        <div className="mt-auto flex gap-1"><Badge variant="brand">{catName(meta, p.category)}</Badge>{p.launch_count > 1 && <Badge variant="outline">×{p.launch_count} 发布</Badge>}</div>
      </button>)}</div></div>;
}
