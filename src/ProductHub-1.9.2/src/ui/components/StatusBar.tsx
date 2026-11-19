import React from 'react';
import { AlertTriangle, RefreshCw, Sparkles, Database, Radio, CircleDot, Keyboard, DatabaseZap } from 'lucide-react';
import { api } from '../api';
import { useMeta, useActions } from '../App';
import { modKey } from './TitleBar';
import { cn } from '@/lib/utils';

const ago = (d: Date) => { const m = Math.round((Date.now() - d.getTime()) / 60000); return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); };
export const listCountBus = { set: (_n: number | null) => {} };
export function StatusBar({ status }: { status: any; aiOpen: boolean }) {
  const meta = useMeta(); const a = useActions(); const [shown, setShown] = React.useState<number | null>(null);
  React.useEffect(() => { listCountBus.set = setShown; }, []);
  // 官网补齐队列进度（v1.4）
  const [eq, setEq] = React.useState<any>(null);
  React.useEffect(() => { let t: any; let alive = true; const tick = async () => { try { const s = await api<any>('/api/enrich/status'); if (alive) setEq(s); t = setTimeout(tick, s.active ? 1500 : 6000); } catch { t = setTimeout(tick, 10000); } }; tick(); return () => { alive = false; clearTimeout(t); }; }, []);
  const s = status?.scheduler; const last = status?.last_sync ? new Date(status.last_sync) : null;
  const Item = ({ children, className, onClick, testId }: any) => <button data-testid={testId} onClick={onClick} className={cn('flex h-full items-center gap-1 px-2 hover:bg-accent hover:text-foreground [&>svg]:h-3 [&>svg]:w-3', className)}>{children}</button>;
  return (
    <footer data-testid="statusbar" className="flex h-6 shrink-0 select-none items-center border-t bg-sidebar text-2xs text-muted-foreground">
      <Item onClick={() => a.go('sources')} testId="status-sync">
        {s?.running ? <RefreshCw className="animate-spin text-brand" /> : <CircleDot className={s?.enabled ? 'text-success' : ''} />}
        {meta.readOnly ? '只读预览' : s?.running ? '正在同步…' : s?.enabled ? `自动同步已开启 · 待更新 ${s?.due ?? 0}` : '自动同步已暂停'}
        <span className="opacity-70">· {last ? '上次 ' + ago(last) : '尚未同步（预置数据）'}</span>
      </Item>
      {!!status?.errors && !meta.readOnly && <Item testId="status-errors" onClick={() => a.goSources({ status: 'error' })} className="bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"><AlertTriangle />{status.errors} 个来源抓取失败 · 点击处理</Item>}
      <Item onClick={() => a.go('settings')} testId="status-ai"><Sparkles className={meta.aiEnabled ? 'text-brand' : ''} />{meta.aiEnabled ? `AI 在线 · ${meta.aiModel}` : 'AI 离线模式'}</Item>
      {eq?.active ? <Item testId="status-enrich" className="text-brand"><DatabaseZap className="animate-pulse" />补齐官网信息 {eq.done}/{eq.total}{eq.failed ? ` · ${eq.failed} 失败` : ''}</Item>
        : eq?.enriched ? <Item testId="status-enrich"><DatabaseZap />{eq.enriched.toLocaleString()} 个产品已补齐官网信息</Item> : null}
      <div className="flex-1" />
      {shown !== null && <Item testId="status-count">当前列表 {shown.toLocaleString()} 个产品</Item>}
      <Item onClick={() => a.setNav({ kind: 'all' })}><Database />{status?.products?.toLocaleString() ?? '—'} 产品</Item>
      <Item onClick={() => a.go('sources')}><Radio />{status?.sources ?? '—'} 来源</Item>
      <Item><Keyboard />{modKey()}+K 命令</Item>
      <span className="px-2">v{meta.version}</span>
    </footer>
  );
}
