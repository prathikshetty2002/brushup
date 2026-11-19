/**
 * Removing and copying an element's source text, keeping the file tidy: an element that sits on its own lines is
 * removed with those lines (no blank gap left behind), and its copy is written on a new line at the same indentation.
 */

/** Whether the span [start, end) is alone on its line(s): only whitespace before it on its first line and after it on its last. */
function aloneOnLine(code: string, start: number, end: number) {
  const lineStart = code.lastIndexOf('\n', start - 1) + 1;
  const nl = code.indexOf('\n', end);
  const lineEnd = nl === -1 ? code.length : nl;
  const alone = code.slice(lineStart, start).trim() === '' && code.slice(end, lineEnd).trim() === '';
  return { alone, lineStart, lineEnd, indent: code.slice(lineStart, start) };
}

export function removeSpan(code: string, start: number, end: number): string {
  const l = aloneOnLine(code, start, end);
  if (l.alone) return code.slice(0, l.lineStart) + code.slice(l.lineEnd < code.length ? l.lineEnd + 1 : l.lineEnd);
  return code.slice(0, start) + code.slice(end);
}

export function duplicateSpan(code: string, start: number, end: number): string {
  const l = aloneOnLine(code, start, end);
  const text = code.slice(start, end);
  return code.slice(0, end) + (l.alone ? `\n${l.indent}` : '') + text + code.slice(end);
}

/** Wrap the span in an element: on its own lines it becomes a block with the span indented inside, otherwise it stays on one line. */
export function wrapSpan(code: string, start: number, end: number, tag = 'div'): string {
  const l = aloneOnLine(code, start, end);
  const text = code.slice(start, end);
  if (!l.alone) return `${code.slice(0, start)}<${tag}>${text}</${tag}>${code.slice(end)}`;
  const inner = text.split('\n').map((line, i) => (i === 0 || !line.trim() ? line : `  ${line}`)).join('\n');
  return `${code.slice(0, start)}<${tag}>\n${l.indent}  ${inner}\n${l.indent}</${tag}>${code.slice(end)}`;
}

/** Swap two spans, the first of which comes earlier in the file; whatever sits between them stays where it is. */
export function swapSpans(code: string, first: [number, number], second: [number, number]): string {
  return code.slice(0, first[0]) + code.slice(second[0], second[1]) + code.slice(first[1], second[0]) + code.slice(first[0], first[1]) + code.slice(second[1]);
}
