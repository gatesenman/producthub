import * as React from 'react';
import { Command as C } from 'cmdk';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogTitle } from './dialog';
export const Command = ({ className, ...props }: React.ComponentProps<typeof C>) => <C className={cn('flex h-full w-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground', className)} {...props} />;
export function CommandDialog({ open, onOpenChange, children }: { open: boolean; onOpenChange: (o: boolean) => void; children: React.ReactNode }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-xl p-0 top-[30%]" aria-describedby={undefined}><DialogTitle className="sr-only">命令面板</DialogTitle>
    <Command shouldFilter={false} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-1.5">{children}</Command></DialogContent></Dialog>;
}
export const CommandInput = ({ className, ...props }: React.ComponentProps<typeof C.Input>) => <div className="flex items-center border-b px-3" cmdk-input-wrapper=""><Search className="mr-2 h-4 w-4 shrink-0 opacity-50" /><C.Input className={cn('flex h-11 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground', className)} {...props} /></div>;
export const CommandList = ({ className, ...props }: React.ComponentProps<typeof C.List>) => <C.List className={cn('max-h-[360px] overflow-y-auto overflow-x-hidden py-1', className)} {...props} />;
export const CommandEmpty = (props: React.ComponentProps<typeof C.Empty>) => <C.Empty className="py-6 text-center text-sm text-muted-foreground" {...props} />;
export const CommandGroup = ({ className, ...props }: React.ComponentProps<typeof C.Group>) => <C.Group className={cn('overflow-hidden py-1 text-foreground', className)} {...props} />;
export const CommandItem = ({ className, ...props }: React.ComponentProps<typeof C.Item>) => <C.Item className={cn('relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg]:size-4 [&_svg]:text-muted-foreground', className)} {...props} />;
export const CommandSeparator = ({ className, ...props }: React.ComponentProps<typeof C.Separator>) => <C.Separator className={cn('-mx-1 h-px bg-border', className)} {...props} />;
