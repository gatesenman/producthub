import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
/** 统一空状态：圆形底图标 + 标题 + 说明 + 可选操作（设计系统 §6） */
export function EmptyState({ icon: I, title, desc, action, className, testId, tone = 'muted' }: { icon: React.ComponentType<any>; title: string; desc?: React.ReactNode; action?: React.ReactNode; className?: string; testId?: string; tone?: 'muted' | 'error' }) {
  return <div data-testid={testId} role={tone === 'error' ? 'alert' : undefined} className={cn('flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground animate-in fade-in-0', className)}>
    <div className={cn('mb-1 flex h-12 w-12 items-center justify-center rounded-full', tone === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground')}><I className="h-6 w-6 stroke-[1.5]" /></div>
    <div className="text-sm font-medium text-foreground">{title}</div>{desc && <div className="max-w-xs text-xs leading-5">{desc}</div>}{action && <div className="mt-1">{action}</div>}</div>;
}
/** 统一错误状态：说明原因 + 重试 */
export function ErrorState({ error, retry, title = '加载失败', className }: { error: string; retry?: () => void; title?: string; className?: string }) {
  return <EmptyState tone="error" testId="error-state" icon={AlertTriangle} title={title} className={className} desc={<>{error}<br />请检查本地服务是否在运行，然后重试。</>} action={retry && <Button size="sm" variant="outline" onClick={retry} data-testid="retry"><RotateCcw />重试</Button>} />;
}
