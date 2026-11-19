import * as React from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Command } from 'cmdk';

/** 多选下拉（Popover + Command 搜索） */
export function MultiSelect({ value, onChange, options, placeholder, testId, className }: { value: string[]; onChange: (v: string[]) => void; options: { value: string; label: string; hint?: string | number }[]; placeholder: string; testId?: string; className?: string }) {
  const [open, setOpen] = React.useState(false); const [q, setQ] = React.useState('');
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  const labels = value.map(v => options.find(o => o.value === v)?.label || v);
  const shown = options.filter(o => !q || o.label.toLowerCase().includes(q.toLowerCase())).slice(0, 200);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button data-testid={testId} className={cn('flex h-8 w-full items-center gap-1 rounded-md border border-input bg-transparent px-2.5 text-left text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring', className)}>
      <span className={cn('flex-1 truncate', !value.length && 'text-muted-foreground')}>{value.length ? (value.length > 2 ? `${labels.slice(0, 2).join('、')} 等 ${value.length} 项` : labels.join('、')) : placeholder}</span>
      {value.length ? <X className="h-3.5 w-3.5 opacity-50 hover:opacity-100" onClick={e => { e.stopPropagation(); onChange([]); }} /> : <ChevronDown className="h-3.5 w-3.5 opacity-50" />}
    </button></PopoverTrigger>
    <PopoverContent className="w-[260px] p-0">
      <Command shouldFilter={false}>
        <Command.Input value={q} onValueChange={setQ} placeholder="搜索…" className="h-9 w-full border-b bg-transparent px-3 text-sm outline-none" />
        <Command.List className="max-h-64 overflow-y-auto p-1">
          {!shown.length && <div className="py-4 text-center text-xs text-muted-foreground">无匹配项</div>}
          {shown.map(o => <Command.Item key={o.value} value={o.value} onSelect={() => toggle(o.value)} data-testid="ms-option"
            className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm data-[selected=true]:bg-accent">
            <span className={cn('flex h-4 w-4 items-center justify-center rounded-sm border', value.includes(o.value) ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>{value.includes(o.value) && <Check className="h-3 w-3" />}</span>
            <span className="flex-1 truncate">{o.label}</span>{o.hint !== undefined && <span className="text-2xs text-muted-foreground">{o.hint}</span>}
          </Command.Item>)}
        </Command.List>
      </Command>
    </PopoverContent>
  </Popover>;
}
