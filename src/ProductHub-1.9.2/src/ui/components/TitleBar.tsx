import React, { useEffect, useState } from 'react';
import { Search, PanelLeft, Sparkles, Sun, Moon, Monitor, Minus, Square, X, Copy, Lock } from 'lucide-react';
import { Button } from './ui/button';
import { Tip } from './ui/tooltip';
import { useSidebar } from './ui/sidebar';
import { useMeta, useActions } from '../App';
import { cn } from '@/lib/utils';

declare global { interface Window { ph?: { isDesktop: boolean; platform: string; minimize(): void; maximize(): void; close(): void; onMaximized(cb: (v: boolean) => void): void } } }
export const isMac = () => (window.ph?.platform || navigator.platform).toLowerCase().includes('mac') || window.ph?.platform === 'darwin';
export const modKey = () => isMac() ? '⌘' : 'Ctrl';

export function TitleBar({ onPalette, aiOpen }: { onPalette: () => void; aiOpen: boolean }) {
  const meta = useMeta(); const { toggle } = useSidebar(); const a = useActions(); const desk = window.ph?.isDesktop; const mac = window.ph?.platform === 'darwin';
  const [max, setMax] = useState(false); useEffect(() => { window.ph?.onMaximized(setMax); }, []);
  const ThemeIcon = a.theme.theme === 'system' ? Monitor : a.theme.theme === 'dark' ? Moon : Sun;
  return (
    <header className="drag flex h-10 shrink-0 items-center gap-1 border-b bg-sidebar pl-2 pr-0" onDoubleClick={e => { if (e.target === e.currentTarget) window.ph?.maximize(); }} data-testid="titlebar">
      {mac && desk && <div className="w-[68px]" />}
      <div className="no-drag flex items-center gap-1">
        <Tip label={`切换侧边栏 (${modKey()}+B)`}><Button variant="ghost" size="icon" onClick={toggle} data-testid="sidebar-toggle"><PanelLeft /></Button></Tip>
      </div>
      <div className="flex items-center gap-2 pl-1 select-none">
        <div className="flex h-5 w-5 items-center justify-center rounded-sm bg-gradient-to-br from-brand to-violet-500 text-2xs font-bold text-white">P</div>
        <span className="text-sm font-semibold">统一产品库</span>
        {meta.readOnly && <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-1.5 text-2xs font-medium leading-[18px] text-warning"><Lock className="h-3 w-3" />内部预览 · 只读</span>}
      </div>
      <div className="flex flex-1 justify-center px-4">
        <button onClick={onPalette} data-testid="palette-trigger" className="no-drag flex h-7 w-full max-w-[420px] items-center gap-2 rounded-md border bg-background/60 px-2.5 text-xs text-muted-foreground shadow-sm transition-colors hover:bg-background hover:text-foreground">
          <Search className="h-3.5 w-3.5" /><span className="flex-1 text-left">搜索产品、跳转页面或执行命令…</span>
          <kbd className="rounded border bg-muted px-1.5 font-mono text-2xs">{modKey()} K</kbd></button>
      </div>
      <div className="no-drag flex items-center gap-0.5 pr-1">
        <Tip label={`主题：${{ system: '跟随系统', light: '浅色', dark: '深色' }[a.theme.theme]}（点击切换）`}><Button variant="ghost" size="icon" onClick={a.theme.cycle} data-testid="theme-toggle"><ThemeIcon /></Button></Tip>
        <Tip label={`AI 助手 (${modKey()}+J)`}><Button variant={aiOpen ? 'secondary' : 'ghost'} size="sm" onClick={a.toggleAI} data-testid="ai-toggle" className="gap-1"><Sparkles className="text-brand" />AI 助手</Button></Tip>
      </div>
      {desk && !mac && <div className="no-drag flex h-full items-stretch" data-testid="window-controls">
        <button aria-label="最小化" onClick={() => window.ph!.minimize()} className="flex w-11 items-center justify-center hover:bg-accent"><Minus className="h-3.5 w-3.5" /></button>
        <button aria-label="最大化" onClick={() => window.ph!.maximize()} className="flex w-11 items-center justify-center hover:bg-accent">{max ? <Copy className="h-3 w-3 -scale-x-100" /> : <Square className="h-3 w-3" />}</button>
        <button aria-label="关闭" onClick={() => window.ph!.close()} className={cn('flex w-11 items-center justify-center hover:bg-red-600 hover:text-white')}><X className="h-4 w-4" /></button>
      </div>}
    </header>
  );
}
