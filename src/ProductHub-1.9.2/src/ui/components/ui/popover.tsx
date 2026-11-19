import * as React from 'react';
import * as P from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';
export const Popover = P.Root; export const PopoverTrigger = P.Trigger;
export const PopoverContent = ({ className, align = 'start', sideOffset = 4, ...props }: React.ComponentProps<typeof P.Content>) => <P.Portal><P.Content align={align} sideOffset={sideOffset} className={cn('z-50 w-64 rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95', className)} {...props} /></P.Portal>;
