import type { LucideIcon } from 'lucide-react';

type Props = { icon: LucideIcon; title: string; body: string };

export default function FeatureCard({ icon: Icon, title, body }: Props) {
  return (
    <article className="rounded-card border border-line bg-white p-8 transition-shadow hover:shadow-card">
      <span className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <h3 className="mt-6 font-display text-2xl font-semibold tracking-tight">{title}</h3>
      <p className="mt-3 leading-relaxed text-muted">{body}</p>
    </article>
  );
}
