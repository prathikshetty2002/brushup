import PricingCard from './PricingCard';

const plans = [
  { name: 'Free', price: '$0', note: 'for up to 5 people', features: ['Weekly plan and Friday wrap', '1 team', '30 days of history'], cta: 'Start free' },
  { name: 'Team', price: '$6', note: 'per person, per month', features: ['Unlimited rituals', 'Blocker routing', 'Slack and Teams updates', 'Unlimited history'], cta: 'Start a 14-day trial', featured: true },
  { name: 'Scale', price: '$12', note: 'per person, per month', features: ['Everything in Team', 'SSO and audit log', 'Cross-team rollups', 'Priority support'], cta: 'Talk to us' },
];

export default function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-6xl px-6 py-24">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-medium text-accent">Pricing</p>
        <h2 className="mt-3 font-display text-4xl font-semibold tracking-tight text-balance">Start free. Pay when the whole team is in.</h2>
      </div>
      <div className="mt-14 grid items-stretch gap-6 md:grid-cols-3">
        {plans.map((p) => (
          <PricingCard key={p.name} {...p} />
        ))}
      </div>
    </section>
  );
}
