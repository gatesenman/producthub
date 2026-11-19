import * as React from 'react';
import * as P from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
/** shadcn Select；value 为空字符串时显示 placeholder（Radix 不允许空值，内部用 __all__ 代替） */
const EMPTY = '__all__';
export function Select({ value, onValueChange, options, placeholder, className, testId, disabled }: { value: string; onValueChange: (v: string) => void; options: { value: string; label: React.ReactNode }[]; placeholder?: string; className?: string; testId?: string; disabled?: boolean }) {
  return (
    <P.Root value={value === '' ? EMPTY : value} onValueChange={v => onValueChange(v === EMPTY ? '' : v)} disabled={disabled}>
      <P.Trigger data-testid={testId} className={cn('flex h-8 w-full items-center justify-between gap-1 whitespace-nowrap rounded-md border border-input bg-transparent px-2.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 [&>span]:truncate data-[placeholder]:text-muted-foreground', className)}>
        <P.Value placeholder={placeholder} /><P.Icon asChild><ChevronDown className="h-3.5 w-3.5 opacity-50" /></P.Icon>
      </P.Trigger>
      <P.Portal><P.Content position="popper" sideOffset={4} className="relative z-50 max-h-80 min-w-[8rem] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 w-[var(--radix-select-trigger-width)]">
        <P.Viewport className="p-1 max-h-80">
          {placeholder !== undefined && <Item value={EMPTY}>{placeholder}</Item>}
          {options.map(o => <Item key={o.value} value={o.value}>{o.label}</Item>)}
        </P.Viewport></P.Content></P.Portal>
    </P.Root>);
}
function Item({ value, children }: { value: string; children: React.ReactNode }) {
  return <P.Item value={value} className="relative flex w-full cursor-default select-none items-center rounded-md py-1.5 pl-2 pr-7 text-sm outline-none focus:bg-accent data-[disabled]:opacity-50">
    <P.ItemText>{children}</P.ItemText><span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center"><P.ItemIndicator><Check className="h-3.5 w-3.5" /></P.ItemIndicator></span></P.Item>;
}
