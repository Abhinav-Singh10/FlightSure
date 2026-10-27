import type { ComponentProps } from 'react';
import { cn } from './utils.ts';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card" className={cn('rounded-2xl border border-border bg-white p-6 shadow-xs', className)} {...props} />;
}
