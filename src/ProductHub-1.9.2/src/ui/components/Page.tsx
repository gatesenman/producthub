import React from 'react';
import { cn } from '@/lib/utils';
/** 由外层工作区（如「来源与规则」）注入：统一标题 + 选项卡，子页面不再重复渲染自己的标题（v2 #31） */
export const PageTabsCtx = React.createContext<{ title: string; tabs: React.ReactNode } | null>(null);
export function Page({ title, desc, actions, children, testId, className }: { title: string; desc?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; testId?: string; className?: string }) {
  const hub = React.useContext(PageTabsCtx);
  return <div className="flex min-h-0 flex-1 flex-col" data-testid={testId}>
    <div className="flex items-center gap-3 border-b px-5 py-3"><div className="min-w-0 flex-1">{hub ? <div className="flex items-center gap-4"><h1 className="text-lg font-semibold leading-6" data-testid="page-title">{hub.title}</h1><div role="tablist" className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">{hub.tabs}</div></div> : <h1 className="text-lg font-semibold leading-6" data-testid="page-title">{title}</h1>}{desc && <p className="truncate text-xs text-muted-foreground">{desc}</p>}</div>{actions}</div>
    <div className={cn('min-h-0 flex-1 overflow-auto p-5', className)}>{children}</div></div>;
}
export function Card({ title, desc, children, className, actions }: { title?: React.ReactNode; desc?: React.ReactNode; children: React.ReactNode; className?: string; actions?: React.ReactNode }) {
  return <section className={cn('rounded-xl border bg-card p-4 shadow-sm', className)}>{(title || actions) && <div className="mb-3 flex items-start gap-2"><div className="flex-1"><h3 className="text-sm font-semibold">{title}</h3>{desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}</div>{actions}</div>}{children}</section>;
}
