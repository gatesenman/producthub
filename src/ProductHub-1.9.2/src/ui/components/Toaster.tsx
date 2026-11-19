import React from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
export type ToastItem = { id: number; s: string; kind: string; action?: { label: string; run: () => void } };
/** 底部居中 Toast：成功/错误图标 + 可选操作按钮（撤销/重试），可手动关闭；屏幕阅读器以 polite 播报 */
export function Toaster({ toasts, dismiss }: { toasts: ToastItem[]; dismiss: (id: number) => void }) {
  return <div aria-live="polite" className="pointer-events-none fixed bottom-9 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">{toasts.map(t =>
    <div key={t.id} role={t.kind === 'err' ? 'alert' : 'status'} data-testid="toast" className="pointer-events-auto flex max-w-md items-center gap-2 rounded-lg border bg-popover py-1.5 pl-3 pr-1.5 text-sm text-popover-foreground shadow-lg animate-in slide-in-from-bottom-2 fade-in-0">
      {t.kind === 'err' ? <AlertCircle className="h-4 w-4 shrink-0 text-destructive" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />}<span className="py-0.5">{t.s}</span>
      {t.action && <button data-testid="toast-action" className="ml-1 rounded-md px-2 py-0.5 text-sm font-medium text-brand transition-colors duration-fast hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[.97]" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
      <button aria-label="关闭通知" className="rounded-md p-1 text-muted-foreground transition-colors duration-fast hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => dismiss(t.id)}><X className="h-3.5 w-3.5" /></button></div>)}</div>;
}
