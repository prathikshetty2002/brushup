export default function Logo() {
  return (
    <a href="/" className="inline-flex items-center gap-2.5 font-display text-lg font-semibold tracking-tight">
      <span className="grid size-8 place-items-center rounded-lg bg-accent" aria-hidden="true">
        <svg viewBox="0 0 32 32" className="size-5">
          <path d="M6 20c3-9 6-9 10 0s7 9 10 0" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" />
        </svg>
      </span>
      Cadence
    </a>
  );
}
