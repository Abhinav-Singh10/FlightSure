import type { ComponentProps } from 'react';
import { cn } from './utils.ts';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input data-slot="input" className={cn(
    'h-12 w-full rounded-lg border border-border bg-white px-3 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-50',
    className,
  )} {...props} />;
}
