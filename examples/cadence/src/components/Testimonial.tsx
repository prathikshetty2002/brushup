export default function Testimonial() {
  return (
    <section id="customers" className="bg-sand">
      <figure className="mx-auto max-w-4xl px-6 py-24 text-center">
        <blockquote className="font-display text-3xl font-medium leading-snug tracking-tight text-balance sm:text-4xl">
          "We cancelled two standing meetings in the first month and nobody noticed, except that Mondays got calmer."
        </blockquote>
        <figcaption className="mt-8 flex items-center justify-center gap-4 text-left">
          <img src="/maya.svg" width={56} height={56} className="size-14 rounded-full" />
          <span>
            <span className="block font-medium">Maya Kowalski</span>
            <span className="block text-sm text-muted">Head of Product, Fieldstone</span>
          </span>
        </figcaption>
      </figure>
    </section>
  );
}
