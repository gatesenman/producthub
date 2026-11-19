import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const badgeVariants = cva('inline-flex items-center gap-1 rounded-md border px-1.5 py-0 text-xs leading-[18px] font-medium transition-colors whitespace-nowrap', {
  variants: { variant: { default: 'border-transparent bg-primary text-primary-foreground', secondary: 'border-transparent bg-secondary text-secondary-foreground', outline: 'text-muted-foreground', brand: 'border-transparent bg-brand-soft text-brand',
    success: 'border-transparent bg-success/12 text-success', warning: 'border-transparent bg-warning/15 text-warning', destructive: 'border-transparent bg-destructive/12 text-destructive' } },
  defaultVariants: { variant: 'secondary' } });
export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) { return <span className={cn(badgeVariants({ variant }), className)} {...props} />; }
