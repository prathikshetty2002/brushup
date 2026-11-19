import type { ComponentProps } from 'react';

const styles = {
  primary: 'bg-accent text-white shadow-sm hover:bg-accent-strong',
  secondary: 'border border-line bg-white text-ink hover:border-ink/30',
  ghost: 'text-ink hover:bg-ink/5',
} as const;

type Props = ComponentProps<'a'> & { variant?: keyof typeof styles };

export default function Button({ variant = 'primary', className = '', ...props }: Props) {
  return (
    <a
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-full px-6 text-sm font-medium transition-colors ${styles[variant]} ${className}`}
      {...props}
    />
  );
}
