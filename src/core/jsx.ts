import { parse } from '@babel/parser';
import type * as t from '@babel/types';
import MagicString from 'magic-string';

/** Stamped on host elements (`<div>`): `file:line:col` of the element. */
export const SRC_ATTR = 'data-brushup-src';
/** Stamped on component usages (`<Button>`): `file:line:col#Name`. Reaches the DOM when the component spreads its props. */
export const USE_ATTR = 'data-brushup-use';
/** Version tokens that ride along with the two refs above (`fileHash.fingerprint.n.of`). */
export const SV_ATTR = 'data-brushup-sv';
export const UV_ATTR = 'data-brushup-uv';

const fnv = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
};

/** A short hash of a source file, insensitive to a BOM and line endings. */
export const fileHash = (code: string) => fnv(code.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'));

const flat = (code: string, n: t.Node) => code.slice(n.start!, n.end!).replace(/\s+/g, ' ');

/**
 * What an element *is* in the source, apart from what Brushup itself edits: its tag, every attribute except
 * className/class/style, and its direct children (text and expressions as written, nested elements by tag only).
 * It does not move when the line does, and it does not change when Brushup rewrites the element's classes.
 */
export function fingerprint(code: string, el: t.JSXElement): string {
  const open = el.openingElement;
  const attrs = open.attributes
    .filter((a) => !(a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && ['className', 'class', 'style'].includes(a.name.name)))
    .map((a) => flat(code, a));
  const kids = el.children
    .map((c) => (c.type === 'JSXText' ? c.value.replace(/\s+/g, ' ').trim() : c.type === 'JSXElement' ? `<${flat(code, c.openingElement.name)}/>` : flat(code, c)))
    .filter(Boolean)
    .join('|')
    .slice(0, 300);
  return fnv([flat(code, open.name), ...attrs, kids].join('\u0001'));
}

export interface Ver {
  file: string;
  fp: string;
  /** Which of the identical elements (same fingerprint) this was, in document order, and how many there were. */
  occ: number;
  total: number;
}

export function parseVer(token: unknown): Ver | null {
  const m = typeof token === 'string' ? /^([0-9a-z]+)\.([0-9a-z]+)\.(\d+)\.(\d+)$/.exec(token) : null;
  return m ? { file: m[1], fp: m[2], occ: Number(m[3]), total: Number(m[4]) } : null;
}

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
 *  - host elements (`<div>`, `<h1>`…) get `data-brushup-src="file:line:col"`;
 *  - component usages (`<Button>`, `<Dialog.Trigger>`) get `data-brushup-use="file:line:col#Name"`,
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
  const hash = fileHash(code);
  // Fingerprint every element first, so each tag can say which of its identical twins it is.
  const prints = new Map<number, { fp: string; occ: number; total: number }>();
  const seen = new Map<string, number>();
  walk(ast, (node) => {
    if (node.type !== 'JSXElement') return;
    const fp = fingerprint(code, node);
    const occ = seen.get(fp) ?? 0;
    seen.set(fp, occ + 1);
    prints.set(node.openingElement.start!, { fp, occ, total: 0 });
  });
  for (const p of prints.values()) p.total = seen.get(p.fp)!;
  const token = (open: t.JSXOpeningElement) => {
    const p = prints.get(open.start!);
    return p ? `${hash}.${p.fp}.${p.occ}.${p.total}` : '';
  };
  walk(ast, (node) => {
    if (node.type !== 'JSXOpeningElement' || node.loc == null || node.name.end == null) return;
    const attrs = node.attributes;
    const has = (name: string) => attrs.some((a) => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === name);
    const at = `${rel}:${node.loc.start.line}:${node.loc.start.column}`;
    const name = node.name;
    const ver = (attr: string) => (token(node) ? ` ${attr}="${token(node)}"` : '');

    if (name.type === 'JSXIdentifier' && /^[a-z]/.test(name.name)) {
      if (has(SRC_ATTR)) return;
      s.appendLeft(afterName(node), ` ${SRC_ATTR}="${at}"${ver(SV_ATTR)}`);
      count++;
      return;
    }
    if (options.usage === false || has(USE_ATTR)) return;
    const text = jsxName(code, name);
    if (!text) return;
    const last = text.split('.').pop()!;
    if (NO_PROPS.has(last)) return;
    s.appendLeft(afterName(node), ` ${USE_ATTR}="${at}#${text}"${ver(UV_ATTR)}`);
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
