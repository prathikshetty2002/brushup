import { parse } from '@babel/parser';
import type * as t from '@babel/types';
import MagicString from 'magic-string';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Hooks Ascend into a project's own files: the Next.js config wrapper, the layout tag and the Vite plugin.
 * Edits are small text splices guarded three ways: they only run on shapes we recognise, they are skipped when
 * Ascend is already wired in, and a result that no longer parses is thrown away. Anything else is left for the
 * user, with the exact lines to add.
 */
export type WireStatus = 'updated' | 'unchanged' | 'manual' | 'absent';

export interface WireResult {
  next?: { config: WireStatus; layout: WireStatus };
  vite?: WireStatus;
}

const NEXT_CONFIGS = ['next.config.ts', 'next.config.mts', 'next.config.mjs', 'next.config.js', 'next.config.cjs'];
const LAYOUTS = ['app/layout.tsx', 'app/layout.jsx', 'app/layout.js', 'src/app/layout.tsx', 'src/app/layout.jsx', 'src/app/layout.js'];
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

/** `export default nextConfig` -> `export default withAscend(nextConfig)`, or the `module.exports =` form. */
export function wireNextConfig(code: string): Wired {
  if (/ascend\/next['"]/.test(code)) return 'unchanged';
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
    line = `import { withAscend } from ${q}ascend/next${q};\n`;
  } else {
    for (const node of ast.program.body) {
      const e = node.type === 'ExpressionStatement' ? node.expression : null;
      if (e?.type === 'AssignmentExpression' && code.slice(e.left.start!, e.left.end!) === 'module.exports') wrapped = e.right;
    }
    line = `const { withAscend } = require(${q}ascend/next${q});\n`;
  }
  if (!wrapped) return null;
  s.appendLeft(wrapped.start!, 'withAscend(');
  s.appendRight(wrapped.end!, ')');
  const at = importAt(ast);
  s.appendLeft(at, at === 0 ? line : `\n${line.trimEnd()}`);
  const out = s.toString();
  return parses(out) ? out : null;
}

/** Add `<AscendScript />` just inside the closing `</body>` of the root layout. */
export function wireLayout(code: string): Wired {
  if (code.includes('AscendScript')) return 'unchanged';
  const closing = [...code.matchAll(/^([ \t]*)<\/body>/gm)].at(-1);
  let ast: t.File;
  try {
    ast = parseAny(code);
  } catch {
    return null;
  }
  const s = new MagicString(code);
  const q = quoteOf(code);
  if (closing) s.appendLeft(closing.index!, `${closing[1]}  <AscendScript />\n`);
  else {
    const inline = code.indexOf('</body>');
    if (inline < 0) return null;
    s.appendLeft(inline, '<AscendScript />');
  }
  const at = importAt(ast);
  const imp = `import { AscendScript } from ${q}ascend/next/script${q};`;
  s.appendLeft(at, at === 0 ? `${imp}\n` : `\n${imp}`);
  const out = s.toString();
  return parses(out) ? out : null;
}

/** The `plugins` array of the object the config file exports: `export default { … }`, `defineConfig({ … })`, a function returning one, or a const it names. Nested `plugins` (worker, test) are not it. */
function configPlugins(ast: t.File): t.ArrayExpression | null {
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
  const config = object(exported?.declaration);
  const prop = config?.properties.find(
    (p): p is t.ObjectProperty => p.type === 'ObjectProperty' && !p.computed && ((p.key.type === 'Identifier' && p.key.name === 'plugins') || (p.key.type === 'StringLiteral' && p.key.value === 'plugins')),
  );
  return prop?.value.type === 'ArrayExpression' ? prop.value : null;
}

/** Append `ascend()` to the `plugins: [...]` array of a Vite config. */
export function wireViteConfig(code: string): Wired {
  if (/ascend\/vite['"]/.test(code)) return 'unchanged';
  let ast: t.File;
  try {
    ast = parseAny(code);
  } catch {
    return null;
  }
  if (!ast.program.body.some((n) => n.type === 'ExportDefaultDeclaration')) return null; // CommonJS config: leave it
  const plugins = configPlugins(ast);
  if (!plugins) return null;
  const arr: t.ArrayExpression = plugins;
  const s = new MagicString(code);
  const q = quoteOf(code);
  const last = arr.elements.at(-1);
  if (last) s.appendLeft(last.end!, ', ascend()');
  else s.appendLeft(arr.start! + 1, 'ascend()');
  const at = importAt(ast);
  const imp = `import ascend from ${q}ascend/vite${q};`;
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

/** Wire Ascend into whichever of Next.js / Vite the project at `root` uses. */
export async function wireProject(root: string): Promise<WireResult> {
  const result: WireResult = {};
  const nextConfig = await firstExisting(root, NEXT_CONFIGS);
  if (nextConfig) {
    result.next = {
      config: await apply(nextConfig, wireNextConfig),
      layout: await apply(await firstExisting(root, LAYOUTS), wireLayout).then((s) => (s === 'absent' ? 'manual' : s)),
    };
  }
  const vite = await firstExisting(root, VITE_CONFIGS);
  if (vite && !nextConfig) result.vite = await apply(vite, wireViteConfig);
  return result;
}
