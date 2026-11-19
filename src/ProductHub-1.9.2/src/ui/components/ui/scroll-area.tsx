import * as React from 'react';
import * as P from '@radix-ui/react-scroll-area';
import { cn } from '@/lib/utils';
export const ScrollArea = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof P.Root> & { viewportRef?: React.Ref<HTMLDivElement>; onViewportScroll?: React.UIEventHandler<HTMLDivElement> }>(({ className, children, viewportRef, onViewportScroll, ...props }, ref) => (
  <P.Root ref={ref} className={cn('relative overflow-hidden', className)} {...props}>
    <P.Viewport ref={viewportRef} onScroll={onViewportScroll} className="h-full w-full rounded-[inherit] [&>div]:!block">{children}</P.Viewport>
    <ScrollBar /><P.Corner />
  </P.Root>));
ScrollArea.displayName = 'ScrollArea';
export const ScrollBar = ({ className, orientation = 'vertical', ...props }: React.ComponentProps<typeof P.ScrollAreaScrollbar>) => (
  <P.ScrollAreaScrollbar orientation={orientation} className={cn('flex touch-none select-none transition-colors', orientation === 'vertical' && 'h-full w-2 border-l border-l-transparent p-[1px]', orientation === 'horizontal' && 'h-2 flex-col border-t border-t-transparent p-[1px]', className)} {...props}>
    <P.ScrollAreaThumb className="relative flex-1 rounded-full bg-border hover:bg-muted-foreground/40" /></P.ScrollAreaScrollbar>);
