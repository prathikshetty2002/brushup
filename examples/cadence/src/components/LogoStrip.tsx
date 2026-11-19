const names = ['Northwind', 'Fieldstone', 'Parallel', 'Alderbank', 'Quillworks'];

export default function LogoStrip() {
  return (
    <section aria-label="Customers" className="border-y border-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-10 md:flex-row md:justify-between">
        <p className="text-sm text-muted">Trusted by product teams at</p>
        <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 font-display text-xl font-semibold text-ink/55">
          {names.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
