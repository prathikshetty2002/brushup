import { Check } from 'lucide-react';
import Button from './Button';

type Props = { name: string; price: string; note: string; features: string[]; featured?: boolean; cta: string };

export default function PricingCard({ name, price, note, features, featured = false, cta }: Props) {
  return (
    <article className={`flex flex-col rounded-card border p-8 ${featured ? 'border-accent bg-white shadow-card ring-1 ring-accent' : 'border-line bg-white'}`}>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-2xl font-semibold">{name}</h3>
        {featured && <span className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-white">Most teams</span>}
      </div>
      <p className="mt-6 flex items-baseline gap-1">
        <span className="font-display text-5xl font-semibold tracking-tight">{price}</span>
        <span className="text-sm text-muted">{note}</span>
      </p>
      <ul className="mt-8 flex-1 space-y-3 text-sm">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-3">
            <Check className="mt-0.5 size-4 shrink-0 text-good" aria-hidden="true" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Button variant={featured ? 'primary' : 'secondary'} href="#" className="mt-8">
        {cta}
      </Button>
    </article>
  );
}
