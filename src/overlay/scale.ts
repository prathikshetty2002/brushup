/**
 * Tailwind's default type scale and spacing steps, for the pickers under Size and the margin/padding box. Both Tailwind 3 and 4
 * ship the same names and sizes; a project that changes them has the change picked up from the page where it can be (`--text-*`
 * and `--spacing-*` custom properties in Tailwind 4).
 */
export const TEXT_SIZES: { name: string; rem: number }[] = [
  { name: 'xs', rem: 0.75 },
  { name: 'sm', rem: 0.875 },
  { name: 'base', rem: 1 },
  { name: 'lg', rem: 1.125 },
  { name: 'xl', rem: 1.25 },
  { name: '2xl', rem: 1.5 },
  { name: '3xl', rem: 1.875 },
  { name: '4xl', rem: 2.25 },
  { name: '5xl', rem: 3 },
  { name: '6xl', rem: 3.75 },
  { name: '7xl', rem: 4.5 },
  { name: '8xl', rem: 6 },
  { name: '9xl', rem: 8 },
];

/** The steps people reach for, in pixels (a Tailwind step is 4px: 4 is `p-1`, 16 is `p-4`). */
export const SPACING_STEPS = [0, 4, 8, 12, 16, 24, 32, 48, 64, 96];
