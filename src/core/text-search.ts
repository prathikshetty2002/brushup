import { parse } from '@babel/parser';
import type * as t from '@babel/types';
import { escapeJsxText } from './jsx-patch';
import { replaceLiteral } from './jsx-patch';
import { walk } from './jsx';

/**
 * Finding where a piece of text is written when the structured routes (literal children, `.map` over a literal
 * list) don't apply: props, constants, state defaults, filtered lists, translation files. The text on the page is
 * the key: if exactly one string in the project's source says exactly that, that is where it comes from.
 */
export type Place = { file: string; start: number; end: number; line: number; kind: 'string' | 'attribute' | 'jsx-text' | 'json' };

const collapse = (v: string) => v.replace(/\s+/g, ' ').trim();
// Attributes whose strings are identifiers, not words a person reads.
const NOT_TEXT_ATTRS = new Set(['className', 'class', 'id', 'key', 'ref', 'style', 'htmlFor', 'type', 'href', 'src', 'rel', 'target', 'role', 'name', 'slot', 'variant', 'size', 'as', 'to', 'method', 'action', 'lang', 'dir']);

export const TEXT_FILES = /\.(tsx|jsx|ts|js|mjs|cjs|json)$/;
export const SKIPPED = /(^|[\\/])(node_modules|\.git|\.brushup|\.next|\.turbo|\.vite|dist|build|coverage|out|__tests__|__mocks__|__snapshots__|tests?|e2e|cypress|stories|fixtures?)([\\/]|$)|\.(test|spec|stories|d)\.[a-z]+$|(^|[\\/])(package|package-lock|tsconfig[^\\/]*|components)\.json$/i;

/** A short, distinctive piece of `text` that must appear in any file that writes it (cheap pre-filter before parsing). */
export const needleOf = (text: string): string | null => {
  const words = collapse(text).split(' ').filter((w) => /^[\p{L}\p{N}]{3,}$/u.test(w));
  return words.sort((a, b) => b.length - a.length)[0] ?? null;
};

function parseCode(code: string, file: string): t.File | null {
  for (const plugins of [['typescript', 'jsx'], ['jsx']] as const) {
    try {
      return parse(code, { sourceType: 'module', sourceFilename: file, plugins: [...plugins], errorRecovery: false });
    } catch {
      /* try the next dialect */
    }
  }
  return null;
}

/** Every place in `code` (one file) whose whole text is `text`, ignoring whitespace differences. */
export function placesIn(code: string, file: string, text: string): Place[] {
  const want = collapse(text);
  const out: Place[] = [];
  if (/\.json$/.test(file)) {
    for (const m of code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) {
      const after = code.slice(m.index! + m[0].length).match(/^\s*(:?)/)![1];
      if (after === ':') continue; // an object key
      let value: string;
      try {
        value = JSON.parse(m[0]);
      } catch {
        continue;
      }
      if (collapse(value) === want) out.push({ file, start: m.index!, end: m.index! + m[0].length, line: code.slice(0, m.index!).split('\n').length, kind: 'json' });
    }
    return out;
  }
  const ast = parseCode(code, file);
  if (!ast) return out;
  const skip = new Set<t.Node>(); // strings that are identifiers, import paths or keys, not words a person reads
  const attrValue = new Set<t.Node>(); // JSX attribute values that are readable text (label="Save")
  walk(ast.program, (n) => {
    if (n.type === 'JSXAttribute' && n.value?.type === 'StringLiteral') (n.name.type === 'JSXIdentifier' && NOT_TEXT_ATTRS.has(n.name.name) ? skip : attrValue).add(n.value);
    if (n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration') skip.add(n.source);
    if (n.type === 'ExportNamedDeclaration' && n.source) skip.add(n.source);
    if (n.type === 'ObjectProperty' && !n.computed) skip.add(n.key);
    if (n.type === 'Directive') skip.add(n.value);
  });
  walk(ast.program, (n) => {
    if (skip.has(n) || n.start == null || n.end == null || !n.loc) return;
    const at = (kind: Place['kind']): Place => ({ file, start: n.start!, end: n.end!, line: n.loc!.start.line, kind });
    if (n.type === 'JSXText') {
      if (collapse(n.value) === want) out.push(at('jsx-text'));
    } else if (n.type === 'StringLiteral') {
      if (collapse(n.value) === want) out.push(at(attrValue.has(n) ? 'attribute' : 'string'));
    } else if (n.type === 'TemplateLiteral' && n.expressions.length === 0) {
      if (collapse(n.quasis[0].value.cooked ?? n.quasis[0].value.raw) === want) out.push(at('string'));
    }
  });
  return out;
}

/** `text` written into the place `p` in `code`, in a form that suits it (quote style, JSX escapes, JSON). */
export function writePlace(code: string, p: Place, text: string): string {
  const body = text.trim();
  if (p.kind === 'json') return code.slice(0, p.start) + JSON.stringify(body) + code.slice(p.end);
  if (p.kind === 'jsx-text') {
    const inner = code.slice(p.start, p.end);
    return code.slice(0, p.start) + /^\s*/.exec(inner)![0] + escapeJsxText(body) + (inner.trim() ? /\s*$/.exec(inner)![0] : '') + code.slice(p.end);
  }
  if (p.kind === 'attribute') {
    // a JSX attribute string has no escapes: pick a quote the text doesn't contain, else use an expression
    if (!body.includes('"') && !body.includes('\n')) return code.slice(0, p.start) + `"${body}"` + code.slice(p.end);
    if (!body.includes("'") && !body.includes('\n')) return code.slice(0, p.start) + `'${body}'` + code.slice(p.end);
    return code.slice(0, p.start) + `{${JSON.stringify(body)}}` + code.slice(p.end);
  }
  return replaceLiteral(code, { start: p.start, end: p.end } as t.StringLiteral, body);
}
