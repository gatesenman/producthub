import React from 'react';
import { Radar, Workflow } from 'lucide-react';
import { useMeta } from '../App';
import { SourcesView } from './Sources';
import { RulesView } from './Rules';
import { cn } from '@/lib/utils';
import { PageTabsCtx } from '../components/Page';

/** 「来源与规则」：维护监控来源与抓取规则的同一工作区 */
export function SourcesHub({ tab, setTab, status, ruleTarget, onEditRule }: { tab: string; setTab: (t: string) => void; status: string; ruleTarget: any; onEditRule: (s: any) => void }) {
  const meta = useMeta();
  const T = ({ id, icon, label }: any) => <button role="tab" aria-selected={tab === id} data-testid={'tab-' + id} onClick={() => setTab(id)} className={cn('flex h-6 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&>svg]:h-3.5 [&>svg]:w-3.5', tab === id ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{icon}{label}</button>;
  const tabs = <><T id="list" icon={<Radar />} label="来源列表" />{!meta.readOnly && <T id="rules" icon={<Workflow />} label="抓取规则" />}</>;
  return <PageTabsCtx.Provider value={{ title: '来源与规则', tabs }}><div className="flex min-h-0 flex-1 flex-col">
    {tab === 'rules' && !meta.readOnly ? <RulesView target={ruleTarget} /> : <SourcesView initialStatus={status} onEditRule={onEditRule} />}
  </div></PageTabsCtx.Provider>;
}
