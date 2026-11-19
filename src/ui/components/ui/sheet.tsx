import * as React from 'react';
import * as P from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';
/** shadcn Sheet（右侧滑出，非模态，可调宽） */
export const Sheet = P.Root;
export const SheetTitle = P.Title;
export const SheetContent = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof P.Content> & { width?: number }>(({ className, children, width = 380, style, ...props }, ref) => (
  <P.Portal><P.Content ref={ref} onInteractOutside={e => e.preventDefault()} aria-describedby={undefined}
    className={cn('fixed bottom-6 right-0 top-10 z-40 flex flex-col border-l bg-background shadow-2xl transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-200 data-[state=open]:duration-200 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right', className)}
    style={{ width, ...style }} {...props}>{children}</P.Content></P.Portal>));
SheetContent.displayName = 'SheetContent';
