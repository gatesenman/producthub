import React, { useMemo, useState } from 'react';
import { Home, Star, ChevronsUpDown, Palette, LayoutGrid, Clock, Layers, Sparkles, PenLine, BarChart3, Radar, Workflow, ArrowDownUp, Settings, Search, Tag, Globe, Bot, Code2, Wand2, Megaphone, Headphones, Wallet, GraduationCap, HeartPulse, ShoppingBag, Users, Clapperboard, Database, ShieldCheck, Briefcase, Cpu, Gamepad2, Plane, Folder, Image, PenTool, Blocks, Hash } from 'lucide-react';
import { Sidebar, SidebarHeader, SidebarContent, SidebarGroup, SidebarMenuButton, SidebarTreeItem, SidebarFooter, useSidebar } from './ui/sidebar';
import { Input } from './ui/input';
import { api } from '../api';
import { useMeta, useActions, useAsync } from '../App';

export type NavSel = { kind: 'all' | 'favorite' | 'today' | 'launched' | 'recent' | 'multi' | 'summarized' | 'manual' | 'category' | 'tag' | 'source'; value?: string; label?: string };
export const DEV = import.meta.env.DEV || new URLSearchParams(location.search).has('dev') || (typeof localStorage !== 'undefined' && localStorage.getItem('ph.dev') === '1');
export const CAT_ICONS: Record<string, React.ComponentType<any>> = { ai: Bot, 'ai-writing': PenTool, 'ai-image': Image, 'ai-agent': Sparkles, dev: Code2, nocode: Blocks, productivity: Wand2, design: PenLine, marketing: Megaphone, sales: Headphones, finance: Wallet, education: GraduationCap, health: HeartPulse, ecommerce: ShoppingBag, social: Users, media: Clapperboard, data: Database, security: ShieldCheck, hr: Briefcase, hardware: Cpu, game: Gamepad2, travel: Plane, other: Folder };

export function AppSidebar({ view, status }: { view: string; status?: any }) {
  const meta = useMeta(); const a = useActions(); const { collapsed } = useSidebar();
  const [q, setQ] = useState(''); const [open, setOpen] = useState<Record<string, boolean>>({ ai: true, dev: false });
  // 侧栏用轻量统计；仅在库变更（产品数/上次同步）时刷新，切页面不重打重查询
  const stats = useAsync(() => api<any>('/api/nav-stats'), [status?.products, status?.last_sync]);
  const facets = useAsync(() => api<any>('/api/facets'), [status?.last_sync]); const home = useAsync(() => api<any>('/api/home'), [status?.last_sync, status?.products]);
  const counts = useMemo(() => Object.fromEntries((stats.data?.byCat || []).map((c: any) => [c.category, c.n])), [stats.data]);
  const total = stats.data?.totals?.products;
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  const isNav = (k: NavSel['kind'], v?: string) => view === 'products' && a.nav.kind === k && (v === undefined || a.nav.value === v);
  const tops = meta.categories.filter(c => !c.parent);
  const sumCount = (id: string) => (counts[id] || 0) + meta.categories.filter(s => s.parent === id).reduce((x, s) => x + (counts[s.id] || 0), 0);
  const Icon = (id: string) => { const I = CAT_ICONS[id] || Folder; return <I />; };
  const tools: { id: string; label: string; icon: React.ReactNode; count?: number; alert?: boolean }[] = [
    { id: 'sources', label: '来源与规则', icon: <Radar />, count: status?.errors || undefined, alert: !!status?.errors },
    { id: 'analytics', label: '分析与报告', icon: <BarChart3 /> },
    { id: 'data', label: '导入导出', icon: <ArrowDownUp /> },
    ...(DEV ? [{ id: 'design', label: '组件库（开发）', icon: <Palette /> }] : []),
  ];
  return (
    <Sidebar>
      {!collapsed && <SidebarHeader><div className="relative"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input value={q} onChange={e => setQ(e.target.value)} placeholder="筛选导航…" className="h-7 bg-background pl-7 text-xs" data-testid="sidebar-search" /></div></SidebarHeader>}
      <SidebarContent>
        <SidebarGroup label="工作台">
          {match('首页 今日新增') && <SidebarMenuButton testId="nav-home" icon={<Home />} label="首页 · 今日新增" count={home.data?.newToday || undefined} active={view === 'home'} onClick={() => a.go('home')} />}
          {match('产品库 全部产品') && <SidebarMenuButton testId="nav-products" icon={<LayoutGrid />} label="产品库" count={total} active={isNav('all')} onClick={() => a.setNav({ kind: 'all' })} />}
          {match('我的关注') && <SidebarMenuButton testId="nav-favorites" icon={<Star />} label="我的关注" count={status?.favorites} active={isNav('favorite')} onClick={() => a.setNav({ kind: 'favorite', label: '我的关注' })} />}
        </SidebarGroup>
        <SidebarGroup label="快捷视图" defaultOpen={false}>
          {match('最近收录') && <SidebarMenuButton icon={<Clock />} label="最近收录" active={isNav('recent')} onClick={() => a.setNav({ kind: 'recent', label: '最近收录' })} />}
          {match('多次发布') && <SidebarMenuButton icon={<Layers />} label="多次发布" count={stats.data?.totals?.multi_launch} active={isNav('multi')} onClick={() => a.setNav({ kind: 'multi', label: '多次发布' })} />}
          {match('已 AI 总结') && <SidebarMenuButton icon={<Sparkles />} label="已 AI 总结" count={stats.data?.totals?.summarized} active={isNav('summarized')} onClick={() => a.setNav({ kind: 'summarized', label: '已 AI 总结' })} />}
          {match('手动添加') && <SidebarMenuButton icon={<PenLine />} label="手动添加" active={isNav('manual')} onClick={() => a.setNav({ kind: 'manual', label: '手动添加' })} />}
        </SidebarGroup>
        <SidebarGroup label="分类">
          {tops.filter(c => match(c.name) || meta.categories.some(s => s.parent === c.id && match(s.name))).map(c => {
            const subs = meta.categories.filter(s => s.parent === c.id && (match(s.name) || match(c.name)));
            return <SidebarTreeItem key={c.id} open={!!q || !!open[c.id]} onOpenChange={o => setOpen(x => ({ ...x, [c.id]: o }))} testId={'cat-' + c.id} icon={Icon(c.id)} label={c.name} count={sumCount(c.id)} active={isNav('category', c.id)} onClick={() => a.setNav({ kind: 'category', value: c.id, label: c.name })}>
              {subs.length ? subs.map(s => <SidebarMenuButton key={s.id} testId={'cat-' + s.id} icon={Icon(s.id)} label={s.name} count={counts[s.id] || 0} active={isNav('category', s.id)} onClick={() => a.setNav({ kind: 'category', value: s.id, label: s.name })} />) : null}
            </SidebarTreeItem>;
          })}
        </SidebarGroup>
        {!collapsed && <SidebarGroup label="标签" defaultOpen={false}>
          {(stats.data?.tags || []).filter((t: any) => match(t.name)).slice(0, 14).map((t: any) => <SidebarMenuButton key={t.name} icon={<Hash />} label={t.name} count={t.n} active={isNav('tag', t.name)} onClick={() => a.setNav({ kind: 'tag', value: t.name, label: '#' + t.name })} />)}
        </SidebarGroup>}
        {!collapsed && <SidebarGroup label="来源" defaultOpen={false}>
          {(facets.data?.sources || []).filter((s: any) => match(s.name)).slice(0, 15).map((s: any) => <SidebarMenuButton key={s.guid} icon={<Globe />} label={s.name} count={s.product_count} active={isNav('source', s.guid)} onClick={() => a.setNav({ kind: 'source', value: s.guid, label: s.name })} />)}
        </SidebarGroup>}
        <SidebarGroup label="管理">
          {tools.filter(t => match(t.label)).map(t => <SidebarMenuButton key={t.id} testId={'nav-' + t.id} icon={t.icon} label={t.label} count={t.count} countClassName={t.alert ? 'bg-destructive/10 text-destructive font-medium' : undefined} active={view === t.id} onClick={() => a.go(t.id)} />)}
        </SidebarGroup>
      </SidebarContent>
      {!meta.readOnly && <SidebarFooter><SidebarMenuButton testId="nav-settings" icon={<Settings />} label="设置" active={view === 'settings'} onClick={() => a.go('settings')} /></SidebarFooter>}
      {meta.readOnly && <SidebarFooter><SidebarMenuButton icon={<Tag />} label="只读预览" /></SidebarFooter>}
    </Sidebar>
  );
}
