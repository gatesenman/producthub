import * as React from 'react';
import * as P from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';
export const Tabs = P.Root;
export const TabsList = ({ className, ...props }: React.ComponentProps<typeof P.List>) => <P.List className={cn('inline-flex h-8 items-center justify-center rounded-lg bg-muted p-0.5 text-muted-foreground', className)} {...props} />;
export const TabsTrigger = ({ className, ...props }: React.ComponentProps<typeof P.Trigger>) => <P.Trigger className={cn('inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-all focus-visible:outline-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm', className)} {...props} />;
export const TabsContent = ({ className, ...props }: React.ComponentProps<typeof P.Content>) => <P.Content className={cn('focus-visible:outline-none', className)} {...props} />;
