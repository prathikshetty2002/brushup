import type { ComponentProps } from 'react';

export default function Badge({ className = '', ...props }: ComponentProps<'span'>) {
  return <span className={`inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent-strong ${className}`} {...props} />;
}
