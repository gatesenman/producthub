import * as React from 'react';
import * as P from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
export const Checkbox = ({ className, ...props }: React.ComponentProps<typeof P.Root>) => <P.Root className={cn('peer h-4 w-4 shrink-0 rounded-sm border border-input shadow-sm focus-visible:outline-none transition-colors duration-fast hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:text-primary-foreground', className)} {...props}><P.Indicator className="flex items-center justify-center text-current">{props.checked === "indeterminate" ? <Minus className="h-3 w-3" /> : <Check className="h-3 w-3" />}</P.Indicator></P.Root>;
