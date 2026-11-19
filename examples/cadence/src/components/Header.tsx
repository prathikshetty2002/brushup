import Button from './Button';
import Logo from './Logo';

const links = [
  { label: 'Product', href: '#product' },
  { label: 'Customers', href: '#customers' },
  { label: 'Pricing', href: '#pricing' },
];

export default function Header() {
  return (
    <header className="sticky top-0 z-10 border-b border-line/70 bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-8 text-sm text-muted md:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="transition-colors hover:text-ink">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="ghost" href="#" className="hidden sm:inline-flex">
            Sign in
          </Button>
          <Button href="#pricing">Start free</Button>
        </div>
      </div>
    </header>
  );
}
