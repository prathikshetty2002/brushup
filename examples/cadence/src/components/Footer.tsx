import Logo from './Logo';

const columns = [
  { title: 'Product', links: ['Rituals', 'Blockers', 'Weekly wrap', 'Integrations'] },
  { title: 'Company', links: ['About', 'Customers', 'Careers', 'Contact'] },
  { title: 'Resources', links: ['Guides', 'Changelog', 'Security', 'Status'] },
];

export default function Footer() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-16 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm text-muted">One shared page for your team's week.</p>
        </div>
        {columns.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <h2 className="text-sm font-semibold">{c.title}</h2>
            <ul className="mt-4 space-y-3 text-sm text-muted">
              {c.links.map((l) => (
                <li key={l}>
                  <a href="#" className="transition-colors hover:text-ink">
                    {l}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-6 py-6 text-sm text-muted">© 2026 Cadence Labs. All rights reserved.</p>
      </div>
    </footer>
  );
}
