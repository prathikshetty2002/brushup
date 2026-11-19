import type { ReactNode } from 'react';

export default function Badge({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent-strong">{children}</span>;
}
