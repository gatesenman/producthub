import * as React from 'react';
import * as P from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';
export const TooltipProvider = P.Provider; export const Tooltip = P.Root; export const TooltipTrigger = P.Trigger;
export const TooltipContent = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof P.Content>>(({ className, sideOffset = 4, ...props }, ref) => (
  <P.Portal><P.Content ref={ref} sideOffset={sideOffset} className={cn('z-50 overflow-hidden rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0', className)} {...props} /></P.Portal>));
TooltipContent.displayName = 'TooltipContent';
export function Tip({ label, children, side }: { label: React.ReactNode; children: React.ReactElement<any>; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  const child = typeof label === 'string' && !children.props['aria-label'] ? React.cloneElement(children, { 'aria-label': label }) : children;
  return <Tooltip><TooltipTrigger asChild>{child}</TooltipTrigger><TooltipContent side={side}>{label}</TooltipContent></Tooltip>;
}
