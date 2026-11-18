import { parse } from '@babel/parser';
import type * as t from '@babel/types';
import MagicString from 'magic-string';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Hooks Brushup into a project's own files: the Next.js config wrapper, the layout tag and the Vite plugin.
 * Edits are small text splices guarded three ways: they only run on shapes we recognise, they are skipped when
 * Brushup is already wired in, and a result that no longer parses is thrown away. Anything else is left for the
 * user, with the exact lines to add.
 */
export type WireStatus = 'updated' | 'created' | 'unchanged' | 'manual' | 'absent';

export interface WireResult {
  next?: { config: WireStatus; layout: WireStatus };
  vite?: WireStatus;
}

const NEXT_CONFIGS = ['next.config.ts', 'next.config.mts', 'next.config.mjs', 'next.config.js', 'next.config.cjs'];
const LAYOUTS = ['app/layout.tsx', 'app/layout.jsx', 'app/layout.js', 'src/app/layout.tsx', 'src/app/layout.jsx', 'src/app/layout.js'];
const DOCUMENTS = ['pages/_document.tsx', 'pages/_document.jsx', 'pages/_document.js', 'src/pages/_document.tsx', 'src/pages/_document.jsx', 'src/pages/_document.js'];
const VITE_CONFIGS = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs'];

const parseAny = (code: string): t.File =>
  parse(code, { sourceType: 'unambiguous', allowReturnOutsideFunction: true, plugins: ['typescript', 'jsx'] });

const parses = (code: string) => {
  try {
    parseAny(code);
    return true;
  } catch {
    return false;
  }
};

/** `;` unless the file's own imports go without. */
const semiOf = (code: string) => (/^import .*[^;]\s*$/m.test(code) && !/^import .*;\s*$/m.test(code) ? '' : ';');
const quoteOf = (code: string) => (/\bfrom\s+'|require\('/.test(code) ? "'" : '"');

/** Where a new import line goes: after the last import, else after leading directives ('use client'), else the top. */
function importAt(ast: t.File): number {
  const body = ast.program.body;
  const lastImport = [...body].reverse().find((n) => n.type === 'ImportDeclaration');
  if (lastImport) return lastImport.end!;
  const directive = ast.program.directives.at(-1);
  return directive ? directive.end! : 0;
}

type Wired = string | 'unchanged' | null;

/** `export default nextConfig` -> `export default withBrushup(nextConfig)`, or the `module.exports =` form. */
export function wireNextConfig(code: string): Wired {
  if (/brushup\/next['"]/.test(code)) return 'unchanged';
  let ast: t.File;
  try {
    ast = parseAny(code);
  } catch {
    return null;
  }
  const s = new MagicString(code);
  const q = quoteOf(code);
  const esm = ast.program.body.find((n): n is t.ExportDefaultDeclaration => n.type === 'ExportDefaultDeclaration');
  let wrapped: t.Node | null = null;
  let line = '';
  if (esm) {
    if (esm.declaration.type === 'FunctionDeclaration' || esm.declaration.type === 'ClassDeclaration' || esm.declaration.type === 'TSDeclareFunction') return null;
    wrapped = esm.declaration;
    line = `import { withBrushup } from ${q}brushup/next${q}${semiOf(code)}\n`;
  } else {
    for (const node of ast.program.body) {
      const e = node.type === 'ExpressionStatement' ? node.expression : null;
      if (e?.type === 'AssignmentExpression' && code.slice(e.left.start!, e.left.end!) === 'module.exports') wrapped = e.right;
    }
    line = `const { withBrushup } = require(${q}brushup/next${q})${semiOf(code)}\n`;
  }
  if (!wrapped) return null;
  s.appendLeft(wrapped.start!, 'withBrushup(');
  s.appendRight(wrapped.end!, ')');
  const at = importAt(ast);
  s.appendLeft(at, at === 0 ? line : `\n${line.trimEnd()}`);
  const out = s.toString();
  return parses(out) ? out : null;
}

/** Add `<BrushupScript />` just inside the closing `</body>` of the root layout. */
export function wireLayout(code: string): Wired {
  if (code.includes('BrushupScript')) return 'unchanged';
  const closing = [...code.matchAll(/^([ \t]*)<\/body>/gm)].at(-1);
  let ast: t.File;
  try {
    ast = parseAny(code);
  } catch {
    return null;
  }
  const s = new MagicString(code);
  const q = quoteOf(code);
  if (closing) s.appendLeft(closing.index!, `${closing[1]}  <BrushupScript />\n`);
  else {
    const inline = code.indexOf('</body>');
    if (inline < 0) return null;
    s.appendLeft(inline, '<BrushupScript />');
  }
  const at = importAt(ast);
  const imp = `import { BrushupScript } from ${q}brushup/next/script${q}${semiOf(code)}`;
  s.appendLeft(at, at === 0 ? `${imp}\n` : `\n${imp}`);
  const out = s.toString();
  return parses(out) ? out : null;
}

/** The object a Vite config file exports: `export default { … }`, `defineConfig({ … })`, a function returning one, or a const it names. */
function configObject(ast: t.File): t.ObjectExpression | null {
  const top = new Map<string, t.Expression>();
  for (const node of ast.program.body) {
    if (node.type !== 'VariableDeclaration') continue;
    for (const d of node.declarations) if (d.id.type === 'Identifier' && d.init) top.set(d.id.name, d.init);
  }
  const object = (node: t.Node | null | undefined, depth = 0): t.ObjectExpression | null => {
    if (!node || depth > 6) return null;
    switch (node.type) {
      case 'ObjectExpression':
        return node;
      case 'CallExpression':
        return object(node.arguments[0], depth + 1);
      case 'TSAsExpression':
      case 'TSSatisfiesExpression':
      case 'ParenthesizedExpression':
        return object(node.expression, depth + 1);
      case 'Identifier':
        return object(top.get(node.name), depth + 1);
      case 'ArrowFunctionExpression':
      case 'FunctionExpression': {
        if (node.body.type !== 'BlockStatement') return object(node.body, depth + 1);
        const ret = node.body.body.find((n): n is t.ReturnStatement => n.type === 'ReturnStatement');
        return object(ret?.argument, depth + 1);
      }
      default:
        return null;
    }
  };
  const exported = ast.program.body.find((n): n is t.ExportDefaultDeclaration => n.type === 'ExportDefaultDeclaration');
  return object(exported?.declaration);
}

const pluginsProp = (config: t.ObjectExpression | null) =>
  config?.properties.find((p): p is t.ObjectProperty => p.type === 'ObjectProperty' && !p.computed && ((p.key.type === 'Identifier' && p.key.name === 'plugins') || (p.key.type === 'StringLiteral' && p.key.value === 'plugins')));

/** Append `brushup()` to the `plugins: [...]` array of a Vite config. */
export function wireViteConfig(code: string): Wired {
  if (/brushup\/vite['"]/.test(code)) return 'unchanged';
  let ast: t.File;
  try {
    ast = parseAny(code);
  } catch {
    return null;
  }
  if (!ast.program.body.some((n) => n.type === 'ExportDefaultDeclaration')) return null; // CommonJS config: leave it
  const config = configObject(ast);
  const prop = pluginsProp(config);
  const s = new MagicString(code);
  const q = quoteOf(code);
  if (prop) {
    if (prop.value.type !== 'ArrayExpression') return null; // plugins built some other way: leave it
    const last = prop.value.elements.at(-1);
    if (last) s.appendLeft(last.end!, ', brushup()');
    else s.appendLeft(prop.value.start! + 1, 'brushup()');
  } else if (config) {
    // A config with no plugins at all: add the key as its first property, indented like the next one.
    const first = config.properties[0];
    const indent = first ? (/\n([ \t]*)$/.exec(code.slice(0, first.start!))?.[1] ?? '') : '';
    if (first) s.appendLeft(first.start!, indent ? `plugins: [brushup()],\n${indent}` : 'plugins: [brushup()], ');
    else s.appendLeft(config.start! + 1, ' plugins: [brushup()] ');
  } else return null;
  const at = importAt(ast);
  const imp = `import brushup from ${q}brushup/vite${q}${semiOf(code)}`;
  s.appendLeft(at, at === 0 ? `${imp}\n` : `\n${imp}`);
  const out = s.toString();
  return parses(out) ? out : null;
}

async function firstExisting(root: string, names: string[]): Promise<string | null> {
  for (const name of names) {
    const file = path.join(root, name);
    try {
      await readFile(file);
      return file;
    } catch {
      /* try the next name */
    }
  }
  return null;
}

async function apply(file: string | null, wire: (code: string) => Wired): Promise<WireStatus> {
  if (!file) return 'absent';
  const code = await readFile(file, 'utf8');
  const out = wire(code);
  if (out === null) return 'manual';
  if (out === 'unchanged') return 'unchanged';
  await writeFile(file, out);
  return 'updated';
}

/** Wire Brushup into whichever of Next.js / Vite the project at `root` uses. */
export async function wireProject(root: string): Promise<WireResult> {
  const result: WireResult = {};
  const nextConfig = await firstExisting(root, NEXT_CONFIGS);
  if (nextConfig) {
    // The App Router's root layout and/or the Pages Router's _document: wire whichever exist, create _document if
    // the project only has a pages/ folder.
    const layout = await firstExisting(root, LAYOUTS);
    const doc = await firstExisting(root, DOCUMENTS);
    const statuses: WireStatus[] = [];
    if (layout) statuses.push(await apply(layout, wireLayout));
    if (doc) statuses.push(await apply(doc, wireLayout));
    if (!layout && !doc) statuses.push(await createDocument(root));
    const order: WireStatus[] = ['manual', 'created', 'updated', 'unchanged'];
    result.next = { config: await apply(nextConfig, wireNextConfig), layout: order.find((x) => statuses.includes(x)) ?? 'manual' };
  }
  const vite = await firstExisting(root, VITE_CONFIGS);
  if (vite && !nextConfig) result.vite = await apply(vite, wireViteConfig);
  return result;
}

/** A Pages Router project with no custom _document gets the standard one, plus the Brushup script. */
async function createDocument(root: string): Promise<WireStatus> {
  const dir = ['pages', 'src/pages'].find((d) => existsSync(path.join(root, d)));
  if (!dir) return 'manual';
  const ts = existsSync(path.join(root, 'tsconfig.json'));
  const file = path.join(root, dir, `_document.${ts ? 'tsx' : 'js'}`);
  await writeFile(
    file,
    `import { Html, Head, Main, NextScript } from "next/document";
import { BrushupScript } from "brushup/next/script";

export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body>
        <Main />
        <NextScript />
        <BrushupScript />
      </body>
    </Html>
  );
}
`,
  );
  return 'created';
}
