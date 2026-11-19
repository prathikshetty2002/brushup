import { Check } from 'lucide-react';

const rituals = [
  { name: 'Monday plan', note: 'Priorities set by 9 of 9', done: true },
  { name: 'Wednesday check-in', note: '2 blockers flagged', done: true },
  { name: 'Friday wrap', note: 'Opens in 2 days', done: false },
];

const people = [
  { initials: 'MK', tone: 'bg-[#dfe3fb] text-accent-strong' },
  { initials: 'JO', tone: 'bg-[#fde7d6] text-[#9a4a14]' },
  { initials: 'SA', tone: 'bg-[#d9f0e6] text-good' },
  { initials: 'LT', tone: 'bg-[#f3e1f5] text-[#7a2a8a]' },
];

export default function ProductCard() {
  return (
    <div className="rounded-card border border-line bg-white p-6 shadow-card" aria-label="A Cadence week, as a team sees it">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">This week</p>
          <p className="mt-1 font-display text-2xl font-semibold">Product team</p>
        </div>
        <div className="flex -space-x-2" aria-label="9 people">
          {people.map((p) => (
            <span key={p.initials} className={`grid size-8 place-items-center rounded-full border-2 border-white text-xs font-semibold ${p.tone}`}>
              {p.initials}
            </span>
          ))}
          <span className="grid size-8 place-items-center rounded-full border-2 border-white bg-sand text-xs font-semibold text-muted">+5</span>
        </div>
      </div>

      <ul className="mt-6 space-y-3">
        {rituals.map((r) => (
          <li key={r.name} className="flex items-center gap-3 rounded-xl border border-line px-4 py-3">
            <span className={`grid size-6 place-items-center rounded-full ${r.done ? 'bg-good text-white' : 'border border-line text-transparent'}`}>
              <Check className="size-3.5" aria-hidden="true" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-medium">{r.name}</span>
              <span className="block text-xs text-muted">{r.note}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-6 rounded-xl bg-sand p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-medium">Team pulse</p>
          <p className="text-sm font-semibold text-good">+12% vs last week</p>
        </div>
        <div className="mt-4 flex h-16 items-end gap-2" aria-hidden="true">
          {[38, 52, 44, 61, 58, 72, 80].map((h, i) => (
            <span key={i} className="flex-1 rounded-t bg-accent/80" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
