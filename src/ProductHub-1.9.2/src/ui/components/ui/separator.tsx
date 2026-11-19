import * as React from 'react';
import * as P from '@radix-ui/react-separator';
import { cn } from '@/lib/utils';
export const Separator = ({ className, orientation = 'horizontal', ...props }: React.ComponentProps<typeof P.Root>) => <P.Root decorative orientation={orientation} className={cn('shrink-0 bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)} {...props} />;
