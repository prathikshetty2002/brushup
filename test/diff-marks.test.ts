import { describe, expect, it } from 'vitest';
import { changedPart, markDiff } from '../src/overlay/diff-marks';

describe('changedPart', () => {
  it('finds the few characters that differ in a long line', () => {
    const a = '<a className="px-4 py-2 text-sm font-medium">Sign in</a>';
    const b = '<a className="px-4 py-2 text-sm font-medium">Log in</a>';
    const c = changedPart(a, b)!;
    expect(a.slice(c.prefix, c.oldEnd)).toBe('Sign');
    expect(b.slice(c.prefix, c.newEnd)).toBe('Log');
  });
  it('returns null when the lines have little in common', () => {
    expect(changedPart('abcdefghij', 'zzzzzzzzzz')).toBeNull();
    expect(changedPart('same', 'same')).toBeNull();
  });
});

describe('markDiff', () => {
  it('marks paired -/+ lines and leaves context and unpaired lines alone', () => {
    const out = markDiff(['@@ -1,3 +1,3 @@', ' keep', '-<p class="mt-2 text-lg">Hi</p>', '+<p class="mt-4 text-lg">Hi</p>', ' tail']);
    expect(out.map((l) => l.kind)).toEqual(['hunk', 'ctx', 'del', 'add', 'ctx']);
    expect(out[2].text.slice(out[2].mark!.start, out[2].mark!.end)).toBe('2');
    expect(out[3].text.slice(out[3].mark!.start, out[3].mark!.end)).toBe('4');
    expect(out[1].mark).toBeUndefined();
  });
  it('does not pair runs of different length', () => {
    const out = markDiff(['-a line one', '-a line two', '+a line one!']);
    expect(out.every((l) => !l.mark)).toBe(true);
  });
});
