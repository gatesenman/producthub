import * as React from 'react';
import { cn } from '@/lib/utils';
export const Table = ({ className, ...p }: React.HTMLAttributes<HTMLTableElement>) => <div className="relative w-full overflow-auto"><table className={cn('w-full caption-bottom text-sm', className)} {...p} /></div>;
export const TableHeader = ({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) => <thead className={cn('sticky top-0 z-10 bg-background/95 backdrop-blur [&_tr]:border-b', className)} {...p} />;
export const TableBody = ({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody className={cn('[&_tr:last-child]:border-0', className)} {...p} />;
export const TableRow = ({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) => <tr className={cn('border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-brand-soft', className)} {...p} />;
export const TableHead = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th className={cn('h-8 px-2.5 text-left align-middle text-xs font-medium text-muted-foreground whitespace-nowrap', className)} {...p} />;
export const TableCell = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn('px-2.5 py-1.5 align-middle', className)} {...p} />;
