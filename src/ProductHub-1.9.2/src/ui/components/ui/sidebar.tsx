import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tip } from './tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible';
import { ScrollArea } from './scroll-area';

/** shadcn Sidebar 模式（精简实现）：分组、可折叠为图标栏、子菜单缩进参考线、右对齐计数徽标 */
type Ctx = { collapsed: boolean; setCollapsed: (v: boolean) => void; toggle: () => void };
const SidebarCtx = React.createContext<Ctx>({ collapsed: false, setCollapsed: () => {}, toggle: () => {} });
export const useSidebar = () => React.useContext(SidebarCtx);
export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setC] = React.useState(() => localStorage.getItem('ph.sidebar') === '1');
  const setCollapsed = (v: boolean) => { setC(v); localStorage.setItem('ph.sidebar', v ? '1' : '0'); };
  return <SidebarCtx.Provider value={{ collapsed, setCollapsed, toggle: () => setCollapsed(!collapsed) }}>{children}</SidebarCtx.Provider>;
}
export function Sidebar({ className, children }: { className?: string; children: React.ReactNode }) {
  const { collapsed } = useSidebar();
  return <aside data-collapsed={collapsed} data-testid="sidebar" className={cn('group/sidebar flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out', collapsed ? 'w-[52px]' : 'w-[248px]', className)}>{children}</aside>;
}
export const SidebarHeader = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex flex-col gap-2 p-2', className)} {...p} />;
export const SidebarFooter = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('mt-auto flex flex-col gap-1 border-t border-sidebar-border p-2', className)} {...p} />;
export const SidebarContent = ({ children }: { children: React.ReactNode }) => <ScrollArea className="min-h-0 flex-1"><div className="flex flex-col gap-1 pb-3">{children}</div></ScrollArea>;

export function SidebarGroup({ label, children, defaultOpen = true, action }: { label: string; children: React.ReactNode; defaultOpen?: boolean; action?: React.ReactNode }) {
  const { collapsed } = useSidebar();
  if (collapsed) return <div className="flex flex-col gap-0.5 px-2 py-1">{children}</div>;
  return <Collapsible defaultOpen={defaultOpen} className="group/collapsible px-2 py-1">
    <div className="flex h-7 items-center">
      <CollapsibleTrigger className="flex flex-1 items-center gap-1 rounded-md px-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground/80 hover:text-foreground">
        {label}<ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]/collapsible:rotate-90" /></CollapsibleTrigger>{action}
    </div>
    <CollapsibleContent><div className="flex flex-col gap-px">{children}</div></CollapsibleContent>
  </Collapsible>;
}

export interface MenuButtonProps { icon?: React.ReactNode; label: React.ReactNode; count?: number | string; active?: boolean; onClick?: () => void; testId?: string; tooltip?: string; onContextMenu?: React.MouseEventHandler; className?: string }
export function SidebarMenuButton({ icon, label, count, active, onClick, testId, tooltip, className, countClassName }: MenuButtonProps & { countClassName?: string }) {
  const { collapsed } = useSidebar();
  const btn = <button data-testid={testId} data-active={active} onClick={onClick}
    className={cn('group/item flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-1 focus-visible:ring-ring data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground data-[active=true]:[&>svg]:text-foreground',
      collapsed && 'justify-center px-0', className)}>
    {icon}{!collapsed && <span className="flex-1 truncate">{label}</span>}
    {!collapsed && count !== undefined && <span className={cn('ml-auto min-w-[22px] rounded px-1 text-right text-2xs tabular-nums text-muted-foreground group-data-[active=true]/item:text-foreground', countClassName)}>{count}</span>}
  </button>;
  return collapsed ? <Tip side="right" label={<span>{tooltip || label}{count !== undefined ? ` · ${count}` : ''}</span>}>{btn}</Tip> : btn;
}
/** 可折叠树节点：箭头 + 缩进参考线 */
export function SidebarTreeItem({ children, open, onOpenChange, ...btn }: MenuButtonProps & { children?: React.ReactNode; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { collapsed } = useSidebar();
  if (!children || collapsed) return <SidebarMenuButton {...btn} />;
  return <Collapsible open={open} onOpenChange={onOpenChange}>
    <div className="relative flex items-center">
      <SidebarMenuButton {...btn} className="pr-7" />
      <CollapsibleTrigger aria-label="展开" className="absolute right-0 flex h-7 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground">
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform duration-150', open && 'rotate-90')} /></CollapsibleTrigger>
    </div>
    <CollapsibleContent><div className="ml-[17px] flex flex-col gap-px border-l border-sidebar-border py-0.5 pl-2">{children}</div></CollapsibleContent>
  </Collapsible>;
}
