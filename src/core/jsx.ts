import { parse } from '@babel/parser';
import type * as t from '@babel/types';
import MagicString from 'magic-string';

/** Stamped on host elements (`<div>`): `file:line:col` of the element. */
export const SRC_ATTR = 'data-ascend-src';
/** Stamped on component usages (`<Button>`): `file:line:col#Name`. Reaches the DOM when the component spreads its props. */
export const USE_ATTR = 'data-ascend-use';

let lastParse: { code: string; file: string; ast: t.File } | null = null;

/** Parse once per (code, file): an edit looks the same file up several times before it changes it. Callers don't mutate the AST. */
export function parseSource(code: string, file: string): t.File {
  if (lastParse?.code === code && lastParse.file === file) return lastParse.ast;
  const ast = parse(code, {
    sourceType: 'module',
    sourceFilename: file,
    plugins: /\.tsx$/.test(file) ? ['jsx', 'typescript'] : ['jsx'],
  });
  lastParse = { code, file, ast };
  return ast;
}

/** Depth-first walk over any Babel node, skipping location/comment bookkeeping. */
export function walk(node: unknown, visit: (n: t.Node) => void) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  const n = node as t.Node;
  if (typeof n.type !== 'string') return;
  visit(n);
  for (const key of Object.keys(n)) {
    if (key === 'loc' || key === 'extra' || key.endsWith('Comments')) continue;
    walk((n as unknown as Record<string, unknown>)[key], visit);
  }
}

/** Where new attributes go in an opening tag: after the name, and after generic arguments (`<Foo<T> …>`). */
export function afterName(open: t.JSXOpeningElement): number {
  const generics = (open as unknown as { typeArguments?: t.Node; typeParameters?: t.Node }).typeArguments ?? (open as unknown as { typeParameters?: t.Node }).typeParameters;
  return (generics?.end ?? open.name.end)!;
}

// Components that take no arbitrary props: passing one would warn or throw.
const NO_PROPS = new Set(['Fragment', 'Suspense', 'StrictMode', 'Profiler', 'Activity', 'ViewTransition', 'Offscreen', 'Provider', 'Consumer', 'Slottable']);

/** Source text of a JSX element name (`Button`, `Dialog.Trigger`), or null for namespaced names. */
export function jsxName(code: string, name: t.JSXOpeningElement['name']): string | null {
  return name.type === 'JSXNamespacedName' ? null : code.slice(name.start!, name.end!);
}

export interface InstrumentOptions {
  /** Also tag component usages so per-instance edits reach the usage site (default true). */
  usage?: boolean;
}

/**
 * Tag the JSX in a file so the canvas can map DOM back to source:
 *  - host elements (`<div>`, `<h1>`…) get `data-ascend-src="file:line:col"`;
 *  - component usages (`<Button>`, `<Dialog.Trigger>`) get `data-ascend-use="file:line:col#Name"`,
 *    which lands on the DOM element when the component forwards its props (shadcn/ui does).
 * Returns null when there is nothing to tag or the file doesn't parse.
 */
export function instrument(code: string, file: string, rel: string, options: InstrumentOptions = {}): { code: string; map: ReturnType<MagicString['generateMap']> } | null {
  if (!code.includes('<')) return null;
  let ast: t.File;
  try {
    ast = parseSource(code, file);
  } catch {
    return null;
  }
  const s = new MagicString(code);
  let count = 0;
  walk(ast, (node) => {
    if (node.type !== 'JSXOpeningElement' || node.loc == null || node.name.end == null) return;
    const attrs = node.attributes;
    const has = (name: string) => attrs.some((a) => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === name);
    const at = `${rel}:${node.loc.start.line}:${node.loc.start.column}`;
    const name = node.name;

    if (name.type === 'JSXIdentifier' && /^[a-z]/.test(name.name)) {
      if (has(SRC_ATTR)) return;
      s.appendLeft(afterName(node), ` ${SRC_ATTR}="${at}"`);
      count++;
      return;
    }
    if (options.usage === false || has(USE_ATTR)) return;
    const text = jsxName(code, name);
    if (!text) return;
    const last = text.split('.').pop()!;
    if (NO_PROPS.has(last)) return;
    s.appendLeft(afterName(node), ` ${USE_ATTR}="${at}#${text}"`);
    count++;
  });
  return count ? { code: s.toString(), map: s.generateMap({ hires: true, source: file, includeContent: true }) } : null;
}

const LOC = /^(.*):(\d+):(\d+)(?:#(.+))?$/;

/** `file:line:col` for a host element, `file:line:col#Name` for a component usage. */
export function parseSrc(src: string): { file: string; line: number; col: number; name?: string } | null {
  const m = LOC.exec(src);
  return m ? { file: m[1], line: Number(m[2]), col: Number(m[3]), name: m[4] } : null;
}

export function findElement(ast: t.File, line: number, col: number): t.JSXElement | null {
  let found: t.JSXElement | null = null;
  walk(ast, (n) => {
    if (found || n.type !== 'JSXElement') return;
    const start = n.openingElement.loc?.start;
    if (start && start.line === line && start.column === col) found = n;
  });
  return found;
}
