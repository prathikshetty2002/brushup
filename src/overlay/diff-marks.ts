/**
 * Inside one changed line, which part is the change? Lines of JSX are long and the edit is often a few characters
 * (`ml-2.5` added to a class list, one word of text), so the part that differs is marked rather than leaving the eye to find it.
 */
export interface Change {
  /** Characters at the start that both versions share. */
  prefix: number;
  /** The end of the differing part in the old and in the new line. */
  oldEnd: number;
  newEnd: number;
}

/** The differing middle of two versions of a line, or null when they have too little in common for marking to help. */
export function changedPart(oldLine: string, newLine: string): Change | null {
  let prefix = 0;
  while (prefix < oldLine.length && prefix < newLine.length && oldLine[prefix] === newLine[prefix]) prefix++;
  let oldEnd = oldLine.length;
  let newEnd = newLine.length;
  while (oldEnd > prefix && newEnd > prefix && oldLine[oldEnd - 1] === newLine[newEnd - 1]) (oldEnd--, newEnd--);
  const shared = prefix + (oldLine.length - oldEnd);
  const shortest = Math.min(oldLine.length, newLine.length);
  // A line that is mostly different is simply a different line: marking all of it says nothing.
  if (shortest === 0 || shared < shortest * 0.3) return null;
  if (oldEnd === prefix && newEnd === prefix) return null; // identical
  return { prefix, oldEnd, newEnd };
}

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk';
  /** The line without its leading + / - / space. */
  text: string;
  /** The part to mark, for a removed or added line that has a partner. */
  mark?: { start: number; end: number };
}

/** Turn a file's diff lines (as git prints them, header lines already removed) into lines with their changed parts marked. */
export function markDiff(raw: string[]): DiffLine[] {
  const lines: DiffLine[] = raw.map((r) => ({ kind: r.startsWith('@@') ? 'hunk' : r[0] === '+' ? 'add' : r[0] === '-' ? 'del' : 'ctx', text: r.startsWith('@@') ? r : r.slice(1) }));
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== 'del') {
      i++;
      continue;
    }
    // A run of removed lines followed straight away by a run of added ones: pair them off, one to one, when the runs match.
    let d = i;
    while (d < lines.length && lines[d].kind === 'del') d++;
    let a = d;
    while (a < lines.length && lines[a].kind === 'add') a++;
    if (d - i === a - d) {
      for (let k = 0; k < d - i; k++) {
        const change = changedPart(lines[i + k].text, lines[d + k].text);
        if (!change) continue;
        lines[i + k].mark = { start: change.prefix, end: change.oldEnd };
        lines[d + k].mark = { start: change.prefix, end: change.newEnd };
      }
    }
    i = Math.max(a, i + 1);
  }
  return lines;
}
