import * as P from '@radix-ui/react-collapsible';
export const Collapsible = P.Root; export const CollapsibleTrigger = P.Trigger;
export const CollapsibleContent = ({ className = '', ...p }: React.ComponentProps<typeof P.Content>) => <P.Content className={'overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down ' + className} {...p} />;
