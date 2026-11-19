import * as React from 'react';
import * as P from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
export const Dialog = P.Root; export const DialogTrigger = P.Trigger; export const DialogClose = P.Close;
export const DialogOverlay = ({ className, ...props }: React.ComponentProps<typeof P.Overlay>) => <P.Overlay className={cn('fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0', className)} {...props} />;
export const DialogContent = React.forwardRef<HTMLDivElement, React.ComponentProps<typeof P.Content>>(({ className, children, ...props }, ref) => (
  <P.Portal><DialogOverlay />
    <P.Content ref={ref} className={cn('fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-0 border bg-background shadow-xl duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 rounded-xl max-h-[88vh] overflow-hidden flex flex-col', className)} {...props}>
      {children}
      <P.Close className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground opacity-70 transition-opacity hover:bg-accent hover:opacity-100"><X className="h-4 w-4" /><span className="sr-only">关闭</span></P.Close>
    </P.Content></P.Portal>));
DialogContent.displayName = 'DialogContent';
export const DialogHeader = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex flex-col gap-1 border-b px-5 py-3.5', className)} {...p} />;
export const DialogFooter = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('flex justify-end gap-2 border-t bg-muted/40 px-5 py-3', className)} {...p} />;
export const DialogTitle = ({ className, ...p }: React.ComponentProps<typeof P.Title>) => <P.Title className={cn('text-sm font-semibold', className)} {...p} />;
export const DialogDescription = ({ className, ...p }: React.ComponentProps<typeof P.Description>) => <P.Description className={cn('text-xs text-muted-foreground', className)} {...p} />;
