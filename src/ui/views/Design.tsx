import React, { useState } from 'react';
import { Plus, Search, Star, Inbox, Trash2, Sparkles } from 'lucide-react';
import { Page, Card } from '../components/Page';
import { Button } from '../components/ui/button';
import { Input, Label } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Select } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Tip } from '../components/ui/tooltip';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/table';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../App';
import { COLOR_TOKENS, TYPE_SCALE, RADIUS, SHADOW, SPACING, MOTION } from '../lib/tokens';

/** 组件库（仅开发模式 / ?dev=1）：设计令牌与组件状态一览，配合 docs/设计系统.md */
export function DesignView() {
  const toast = useToast(); const [sel, setSel] = useState('');
  const H = ({ children }: any) => <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</h3>;
  return (
    <Page title="组件库" desc="设计令牌与组件状态（开发模式）· 规则见 docs/设计系统.md" testId="design-gallery">
      <div className="space-y-4">
        <Card title="颜色令牌" desc="全部通过 CSS 变量定义，浅色 / 深色各一套；业务代码禁止写死十六进制颜色">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">{COLOR_TOKENS.map(c => <div key={c} className="flex items-center gap-2 text-xs"><span className="h-6 w-6 shrink-0 rounded-md border" style={{ background: `hsl(var(--${c}))` }} /><code className="truncate">--{c}</code></div>)}</div></Card>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="字号阶梯"><div className="space-y-1.5">{TYPE_SCALE.map(([k, px, use]) => <div key={k} className="flex items-baseline gap-3"><code className="w-14 text-2xs text-muted-foreground">text-{k}</code><span className={'text-' + k}>统一产品库 Aa 123</span><span className="ml-auto text-2xs text-muted-foreground">{px}px · {use}</span></div>)}</div></Card>
          <Card title="间距 / 圆角 / 阴影 / 动效"><div className="space-y-3 text-xs">
            <div className="flex items-end gap-2">{SPACING.map(([k, px]) => <div key={k} className="flex flex-col items-center gap-1"><div className="bg-brand/60" style={{ width: px, height: px }} /><span className="text-2xs text-muted-foreground">{k}·{px}</span></div>)}</div>
            <div className="flex gap-2">{RADIUS.map(([k, px, use]) => <Tip key={k} label={use}><div className={`flex h-10 w-16 items-center justify-center border bg-muted rounded-${k}`}>{k}</div></Tip>)}</div>
            <div className="flex gap-3">{SHADOW.map(([k, use]) => <Tip key={k} label={use}><div className={`flex h-10 w-24 items-center justify-center rounded-lg border bg-card ${k}`}>{k}</div></Tip>)}</div>
            <div className="flex gap-3">{MOTION.map(([k, use]) => <div key={k} className={`rounded-md border px-2 py-1 transition-colors hover:bg-brand hover:text-brand-foreground ${k}`}>{k} · {use}</div>)}</div></div></Card>
        </div>
        <Card title="Button" desc="每个区域最多 1 个主按钮（brand / default）；危险操作用 destructive 并二次确认">
          <div className="space-y-2"><div className="flex flex-wrap items-center gap-2"><Button variant="brand"><Plus />主操作 brand</Button><Button>default</Button><Button variant="outline">outline</Button><Button variant="secondary">secondary</Button><Button variant="ghost">ghost</Button><Button variant="link">link</Button><Button variant="destructive"><Trash2 />destructive</Button></div>
            <div className="flex flex-wrap items-center gap-2"><Button size="sm">size sm</Button><Button size="lg">size lg</Button><Tip label="图标按钮必须有 Tooltip"><Button size="icon" variant="ghost"><Star /></Button></Tip><Button disabled>disabled</Button><Button variant="outline" disabled>加载中…</Button></div></div></Card>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="表单控件"><div className="grid grid-cols-2 gap-3"><div className="space-y-1"><Label>输入框</Label><div className="relative"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" /><Input className="pl-8" placeholder="关键词" /></div></div>
            <div className="space-y-1"><Label>禁用</Label><Input disabled value="只读内容" readOnly /></div><div className="space-y-1"><Label>下拉选择</Label><Select value={sel} onValueChange={setSel} placeholder="全部分类" options={[{ value: 'a', label: 'AI 人工智能' }, { value: 'b', label: '开发者工具' }]} /></div>
            <div className="space-y-1"><Label>错误态</Label><Input aria-invalid className="border-destructive focus-visible:ring-destructive" defaultValue="http://" /><p className="text-2xs text-destructive">请输入有效网址</p></div></div></Card>
          <Card title="Badge / 状态"><div className="flex flex-wrap gap-1.5"><Badge>secondary</Badge><Badge variant="brand">分类 brand</Badge><Badge variant="outline">标签 outline</Badge><Badge variant="success">正常</Badge><Badge variant="warning">无数据</Badge><Badge variant="destructive">失败</Badge></div>
            <div className="mt-3 flex gap-2 text-xs"><span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-success" />运行中</span><span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />已暂停</span><span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-destructive" />异常</span></div></Card>
          <Card title="Tabs"><Tabs defaultValue="a"><TabsList><TabsTrigger value="a">概览</TabsTrigger><TabsTrigger value="b">版本记录</TabsTrigger><TabsTrigger value="c">AI 分析</TabsTrigger></TabsList><TabsContent value="a" className="pt-2 text-xs text-muted-foreground">Tabs 用于同一对象的不同侧面；页面级导航用侧栏。</TabsContent></Tabs></Card>
          <Card title="反馈" desc="成功 / 失败统一走 Toast；长任务按钮内显示加载状态"><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => toast('已保存')}>成功 Toast</Button><Button size="sm" variant="outline" onClick={() => toast('抓取失败：网络超时', 'err')}>错误 Toast</Button></div></Card>
          <Card title="加载骨架"><div className="space-y-2"><div className="flex items-center gap-2"><Skeleton className="h-6 w-6" /><Skeleton className="h-3.5 w-40" /><Skeleton className="ml-auto h-3.5 w-16" /></div><Skeleton className="h-3.5 w-3/4" /><Skeleton className="h-3.5 w-1/2" /></div></Card>
          <Card title="空状态"><EmptyState icon={Inbox} title="没有匹配的产品" desc="试试放宽查询条件或换个关键词" action={<Button size="sm" variant="outline">重置条件</Button>} className="py-4" /></Card>
        </div>
        <Card title="Table（紧凑 36px 行高）"><Table><TableHeader><TableRow><TableHead>产品</TableHead><TableHead>分类</TableHead><TableHead className="text-right">发布次数</TableHead></TableRow></TableHeader>
          <TableBody>{[['ChatGPT', 'AI 人工智能', 4], ['Linear', '效率工具', 2]].map(([n, c, k]) => <TableRow key={n as string}><TableCell className="font-medium">{n}</TableCell><TableCell><Badge variant="brand">{c}</Badge></TableCell><TableCell className="text-right tabular-nums">{k}</TableCell></TableRow>)}</TableBody></Table></Card>
        <p className="flex items-center gap-1 text-2xs text-muted-foreground"><Sparkles className="h-3 w-3" />此页面只在开发模式或地址带 ?dev=1 时出现在侧栏。</p>
      </div>
    </Page>
  );
}
