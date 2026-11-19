import { ArrowRight, Sparkles } from 'lucide-react';
import Badge from './Badge';
import Button from './Button';
import ProductCard from './ProductCard';

export default function Hero() {
  return (
    <section id="product" className="mx-auto grid max-w-6xl items-center gap-14 px-6 pb-24 pt-16 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
      <div className="rise">
        <Badge>
          <Sparkles className="size-3.5" aria-hidden="true" />
          New: weekly rituals, on one page
        </Badge>
        <h1 className="mt-6 font-display text-5xl font-semibold leading-[1.05] tracking-tight text-balance sm:text-6xl">Your team's weekly rhythm, without the meetings.</h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">Cadence replaces three recurring meetings with one shared page. Everyone updates in two minutes, blockers surface early, and Friday writes itself.</p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button href="#pricing">
            Start free
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
          <Button variant="secondary" href="#customers">
            See how teams use it
          </Button>
        </div>
        <p className="mt-[15px] text-sm text-[#8a909c]">Free for teams up to 5. No card needed.</p>
      </div>
      <div className="rise [animation-delay:120ms]">
        <ProductCard />
      </div>
    </section>
  );
}
