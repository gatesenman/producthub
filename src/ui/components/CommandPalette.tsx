import React, { useEffect, useState } from 'react';
import { Home, Star, FileDown, LayoutGrid, BarChart3, Radar, Workflow, ArrowDownUp, Settings, Plus, Sparkles, Sun, PanelLeft, RefreshCw, Download, Package } from 'lucide-react';
import { CommandDialog, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from './ui/command';
import { Shortcut } from './ui/dropdown-menu';
import { useActions, useMeta, useToast } from '../App';
import { useSidebar } from './ui/sidebar';
import { api } from '../api';
import { Logo } from './Logo';
import { modKey } from './TitleBar';

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const a = useActions(); const meta = useMeta(); const sb = useSidebar(); const toast = useToast();
  const [q, setQ] = useState(''); const [hits, setHits] = useState<any[]>([]);
  useEffect(() => { if (!open) setQ(''); }, [open]);
  useEffect(() => { if (!q.trim()) { setHits([]); return; } const t = setTimeout(() => api<any>('/api/products/query', { body: { q, pageSize: 8 } }).then(r => setHits(r.items)), 150); return () => clearTimeout(t); }, [q]);
  const run = (fn: () => void) => { onOpenChange(false); setTimeout(fn, 0); };
  const m = modKey();
  const nav = [['home', '首页 · 今日新增', Home, '1'], ['products', '产品库', LayoutGrid, '2'], ['favorites', '我的关注', Star, '3'], ['sources', '来源与规则', Radar, '4'], ['analytics', '分析与报告', BarChart3, '5'], ['data', '导入导出', ArrowDownUp, '6'], ['rules', '抓取规则', Workflow, ''], ['settings', '设置', Settings, '7']].filter(n => !(meta.readOnly && ['rules', 'settings'].includes(n[0] as string))) as [string, string, any, string][];
  const acts: [string, any, () => void, string?][] = [
    ...(!meta.readOnly ? [['添加产品', Plus, () => a.addProduct(), `${m} N`] as [string, any, () => void, string]] : []),
    ['打开 AI 助手', Sparkles, () => a.toggleAI(), `${m} J`], ['切换主题（浅色 / 深色 / 跟随系统）', Sun, () => a.theme.cycle(), `${m} ⇧ L`], ['折叠 / 展开侧边栏', PanelLeft, () => sb.toggle(), `${m} B`],
    ...(!meta.readOnly ? [['立即增量更新 5 个来源', RefreshCw, async () => { toast('开始增量更新…'); const r = await api<any>('/api/scheduler/run', { body: { limit: 5 } }); toast(`完成 ${r.results?.length || 0} 个来源`); a.refreshStatus(); }] as [string, any, () => void]] : []),
    ['导出全部产品为 Excel', Download, () => { location.href = '/api/export?format=xlsx'; }],
    ['导出分析报告（HTML）', FileDown, () => { location.href = '/api/report?format=html'; }],
  ];
  const f = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="搜索产品，或输入命令…" value={q} onValueChange={setQ} data-testid="palette-input" />
      <CommandList data-testid="palette">
        <CommandEmpty>没有找到结果</CommandEmpty>
        {hits.length > 0 && <CommandGroup heading="产品">{hits.map(p => <CommandItem key={p.guid} value={'p-' + p.guid} onSelect={() => run(() => a.openProduct(p.guid))}><Logo p={p} size={18} /><span className="max-w-[45%] shrink-0 truncate">{p.name}</span><span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{p.tagline}</span></CommandItem>)}</CommandGroup>}
        {hits.length > 0 && <CommandGroup heading="找竞品 / 相似产品">{hits.slice(0, 3).map(p => <CommandItem key={'s' + p.guid} value={'sim-' + p.guid} data-testid="palette-similar" onSelect={() => run(() => { a.openProduct(p.guid); a.openAI(p); })}><Sparkles />找「{p.name}」的竞品</CommandItem>)}</CommandGroup>}
        {nav.some(n => f(n[1])) && <CommandGroup heading="跳转">{nav.filter(n => f(n[1])).map(([id, label, I, k]) => <CommandItem key={id} value={'nav-' + id} onSelect={() => run(() => a.go(id))}><I />{label}{k && <Shortcut>{m} {k}</Shortcut>}</CommandItem>)}</CommandGroup>}
        {acts.some(x => f(x[0])) && <CommandGroup heading="操作">{acts.filter(x => f(x[0])).map(([label, I, fn, k]) => <CommandItem key={label} value={'act-' + label} onSelect={() => run(fn)}><I />{label}{k && <Shortcut>{k}</Shortcut>}</CommandItem>)}</CommandGroup>}
        {!q && <CommandGroup heading="提示"><CommandItem value="tip" disabled><Package />输入关键词即可直接搜索产品库</CommandItem></CommandGroup>}
      </CommandList>
    </CommandDialog>
  );
}
