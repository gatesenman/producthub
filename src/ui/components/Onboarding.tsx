import React, { useEffect, useState } from 'react';
import { vUrl } from '@/lib/validate';
import { Sparkles, Database, KeyRound, CheckCircle2, ArrowRight, Command, Star, CalendarPlus } from 'lucide-react';
import { api } from '../api';
import { useAsync } from '../App';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input, Label } from './ui/input';
import { modKey } from './TitleBar';
import { cn } from '@/lib/utils';

/** 首次启动引导：欢迎 → 数据已就绪 → （可选）AI Key → 开始使用。
 *  「跳过引导」= 不再显示；关闭窗口（Esc / 点遮罩）= 稍后继续，下次启动从当前步骤恢复 */
export function Onboarding({ open, onDone, onClose }: { open: boolean; onDone: (aiSaved: boolean) => void; onClose?: () => void }) {
  const [step, setStep] = useState(0); const [key, setKey] = useState(''); const [base, setBase] = useState('https://api.openai.com/v1'); const [model, setModel] = useState('gpt-4o-mini');
  const st = useAsync(() => api<any>('/api/status'), [open]); const s = st.data;
  const [resumed, setResumed] = useState(false);
  useEffect(() => { if (open) api<any>('/api/settings').then(x => { const n = Number(x['app.onboardStep']); if (n > 0 && n < 4) { setStep(n); setResumed(true); } }).catch(() => {}); }, [open]);
  const go = (n: number) => { setStep(n); setResumed(false); };
  const later = () => { api('/api/settings', { body: { 'app.onboardStep': String(step) } }).catch(() => {}); onClose ? onClose() : onDone(false); };
  const baseErr = key ? vUrl(base, true) : '';
  const finish = async (withAi: boolean) => { await api('/api/settings', { body: { 'app.onboarded': '1', 'app.onboardStep': '', ...(withAi && key ? { 'ai.apiKey': key, 'ai.baseUrl': base, 'ai.model': model } : {}) } }); setStep(0); onDone(withAi && !!key); };
  const steps = ['欢迎', '数据', 'AI', '完成'];
  return <Dialog open={open} onOpenChange={o => { if (!o) later(); }}>
    <DialogContent className="max-w-[520px] gap-0 p-0" data-testid="onboarding">
      <div className="flex gap-1 px-6 pt-5">{steps.map((x, i) => <div key={x} className={cn('h-1 flex-1 rounded-full', i <= step ? 'bg-brand' : 'bg-muted', 'transition-colors duration-base')} aria-hidden />)}</div>
      {resumed && <div className="mx-6 mt-3 rounded-md bg-brand-soft px-3 py-1.5 text-xs text-foreground" data-testid="ob-resumed">已从上次离开的第 {step + 1} 步继续 · <button className="font-medium text-brand underline-offset-2 hover:underline" onClick={() => go(0)}>从头开始</button></div>}
      <div className="min-h-[260px] px-6 py-5">
        {step === 0 && <div className="space-y-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-violet-500 text-lg font-bold text-white">P</div>
          <DialogTitle className="text-xl">欢迎使用统一产品库</DialogTitle>
          <DialogDescription>把 Product Hunt、Hacker News、少数派等 {s?.sources ?? 240}+ 个产品发布来源汇总到一处：自动去重、记录每次发布、AI 帮你找竞品。</DialogDescription>
          <ul className="space-y-2 pt-1 text-sm">{[[CalendarPlus, '首页看今日新增，每天 1 分钟掌握新产品'], [Sparkles, '选中任意产品「找竞品 / 相似」'], [Star, '关注感兴趣的产品，它再次发布时提醒你'], [Command, `${modKey()}+K 随时搜索产品或执行命令`]].map(([I, t]: any) => <li key={t} className="flex items-center gap-2"><I className="h-4 w-4 text-brand" />{t}</li>)}</ul></div>}
        {step === 1 && <div className="space-y-3"><Database className="h-8 w-8 text-brand" /><DialogTitle className="text-xl">数据已就绪，无需任何配置</DialogTitle>
          <DialogDescription>安装包内置了预先抓取的历史数据，离线也能直接使用。</DialogDescription>
          <div className="grid grid-cols-3 gap-2 pt-1" data-testid="ob-stats">{[['产品', s?.products], ['监控来源', s?.sources], ['已启用', s?.enabled]].map(([l, v]) => <div key={l} className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{l}</div><div className="text-2xl font-semibold tabular-nums">{v?.toLocaleString() ?? '…'}</div></div>)}</div>
          <p className="text-xs text-muted-foreground">后台每分钟检查到期来源并增量抓取，进度见窗口底部状态栏；失败的来源会在首页「来源健康」提示。</p></div>}
        {step === 2 && <div className="space-y-3"><KeyRound className="h-8 w-8 text-brand" /><DialogTitle className="text-xl">（可选）连接大模型</DialogTitle>
          <DialogDescription>不配置也能用：相似产品、分类、总结会使用本地离线算法。配置 OpenAI 兼容接口后可获得更准确的 AI 分析和规则生成。</DialogDescription>
          <div className="space-y-2"><Label>API Key</Label><Input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="sk-…（留空则跳过）" data-testid="ob-key" />
            <div className="grid grid-cols-2 gap-2"><div className="space-y-1"><Label>接口地址</Label><Input value={base} onChange={e => setBase(e.target.value)} aria-invalid={!!baseErr || undefined} data-testid="ob-base" />{baseErr && <p className="text-xs text-destructive" role="alert">{baseErr}</p>}</div><div className="space-y-1"><Label>模型</Label><Input value={model} onChange={e => setModel(e.target.value)} /></div></div>
            <p className="text-xs text-muted-foreground">Key 仅保存在本机数据库，随时可在「设置 → AI」修改。</p></div></div>}
        {step === 3 && <div className="space-y-3 text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-success" /><DialogTitle className="text-xl">一切就绪</DialogTitle>
          <DialogDescription>{key ? '已连接大模型。' : 'AI 将以离线模式运行，可稍后在设置中配置。'}接下来带你去首页看看今天的新产品。</DialogDescription></div>}
      </div>
      <div className="flex items-center gap-2 border-t bg-muted/30 px-6 py-3">
        {step < 3 && <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => finish(false)} data-testid="ob-skip">跳过引导</Button>}
        {step < 3 && <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={later} data-testid="ob-later">稍后继续</Button>}
        <div className="flex-1" />
        {step > 0 && step < 3 && <Button variant="outline" size="sm" onClick={() => go(step - 1)}>上一步</Button>}
        {step === 2 && !key && <Button size="sm" onClick={() => go(3)} data-testid="ob-skip-ai">暂不配置</Button>}
        {step < 2 && <Button size="sm" onClick={() => go(step + 1)} data-testid="ob-next">下一步<ArrowRight /></Button>}
        {step === 2 && key && <Button size="sm" disabled={!!baseErr} onClick={() => go(3)} data-testid="ob-next">保存并继续<ArrowRight /></Button>}
        {step === 3 && <Button size="sm" variant="brand" onClick={() => finish(true)} data-testid="ob-finish">开始使用</Button>}
      </div>
    </DialogContent></Dialog>;
}
