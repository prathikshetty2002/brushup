import Button from './Button';

export default function CtaBand() {
  return (
    <section className="mx-auto max-w-6xl px-6 pb-24">
      <div className="rounded-[1.75rem] bg-ink px-8 py-16 text-center text-white sm:px-16">
        <h2 className="mx-auto max-w-2xl font-display text-4xl font-semibold tracking-tight text-balance">Give your Mondays back.</h2>
        <p className="mx-auto mt-4 max-w-lg text-white/70">Set up your first ritual in five minutes. Your team will be updating by lunch.</p>
        <Button href="#pricing" className="mt-8 bg-white !text-ink hover:bg-white/90">
          Start free
        </Button>
      </div>
    </section>
  );
}
