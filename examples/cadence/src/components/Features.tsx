import { CalendarCheck, MessagesSquare, TrendingUp } from 'lucide-react';
import FeatureCard from './FeatureCard';

const features = [
  {
    icon: CalendarCheck,
    title: 'Rituals that run themselves',
    body: 'Set the plan, check-in and wrap once. Cadence asks the right question on the right day and collects the answers.',
  },
  {
    icon: MessagesSquare,
    title: 'Blockers, not status theatre',
    body: 'Updates take two minutes. Anything stuck is pulled to the top, with the people who can unblock it already tagged.',
  },
  {
    icon: TrendingUp,
    title: 'A Friday that writes itself',
    body: 'The week is summarised from what people actually said, so the wrap-up is a read, not a meeting.',
  },
];

export default function Features() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <div className="max-w-2xl">
        <p className="text-sm font-medium text-accent">What it does</p>
        <h2 className="mt-3 font-display text-4xl font-semibold tracking-tight text-balance">Less talking about work. More of it.</h2>
      </div>
      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {features.map((f) => (
          <FeatureCard key={f.title} {...f} />
        ))}
      </div>
    </section>
  );
}
