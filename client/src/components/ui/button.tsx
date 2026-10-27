import type { ComponentProps } from 'react';
import { cn } from './utils.ts';

// A small shadcn/ui button, keeping only the variants used by this project.
type ButtonProps = ComponentProps<'button'> & { variant?: 'default' | 'outline' | 'ghost' };

export function Button({ className, variant = 'default', type = 'button', ...props }: ButtonProps) {
  const styles = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90',
    outline: 'border border-border bg-white hover:bg-muted',
    ghost: 'hover:bg-muted',
  };
  return <button type={type} data-slot="button" className={cn(
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
    styles[variant], className,
  )} {...props} />;
}
