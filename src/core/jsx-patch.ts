import type * as t from '@babel/types';
import path from 'node:path';
import { checkAttr } from './attr';
import { EditError, StaleElement, type AttrEdit, type Edit, type Ident, type StructureEdit, type Target, type TextEdit } from './edit-types';
import { duplicateSpan, removeSpan, swapSpans, wrapSpan } from './structure';
import type { Files } from './patch';
import { readRules, splice } from './css-patch';
import { afterName, findElement, fingerprint, jsxName, parseSource, parseSrc, parseVer, walk } from './jsx';
import { matches, parseSelector, specificity } from './selector';
import type { SourceElement } from './html-map';
import { conflictingClasses, stripClasses, tailwindClasses, variantConflicts, isVariant, type ClassHints, type Scale } from './tailwind';

export interface JsxOptions {
  /** Express style edits as Tailwind utilities instead of inline styles. */
  tailwind: boolean;
  /** The project's Tailwind generation: on-scale spacing and sizes become plain utilities (`ml-10`) instead of `ml-[40px]`. */
  scale?: Scale;
}

const UNITLESS = new Set(['line-height', 'font-weight', 'opacity', 'z-index', 'flex', 'flex-grow', 'flex-shrink', 'order', 'zoom', 'tab-size', 'column-count']);
const camel = (prop: string) => prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
const classSet = (s: string) => [...new Set(s.split(/\s+/).filter(Boolean))].sort().join(' ');

/** The element's text when it is a single literal run (or empty), null when it comes from expressions or children. */
function literalText(el: t.JSXElement): string | null {
  if (!el.closingElement) return '';
  if (!el.children.length) return '';
  return el.children.length === 1 && el.children[0].type === 'JSXText' ? collapse(el.children[0].value) : null;
}

/**
 * How well `el` fits what the canvas saw: -1 if something it can read contradicts it, else the number of
 * things that agree (class string, text). A component usage doesn't hold the DOM's class, so only text counts there.
 */
function fit(code: string, el: t.JSXElement, hosted: boolean, ident: Ident): number {
  let agree = 0;
  if (ident.cls !== undefined && hosted) {
    const attr = attrNamed(el, 'className');
    const range = attr && classNameRange(attr);
    const lit = !attr ? '' : range ? code.slice(range.start, range.end) : null;
    if (lit !== null) {
      if (classSet(lit) !== classSet(ident.cls)) return -1;
      agree++;
    }
  }
  if (ident.text !== undefined) {
    const text = literalText(el);
    if (text !== null) {
      if (text.slice(0, 120) !== ident.text.slice(0, 120)) return -1;
      agree++;
    }
  }
  return agree;
}

/**
 * The element an edit means. The reference is a line:col, which goes stale the moment the file is edited
 * (by the agent, or by an earlier edit of ours before HMR re-renders). If nothing of that kind is at the
 * position any more, or the thing there is plainly a different element, look for the one element in the
 * file that still fits what the canvas saw; if that isn't unique, ask the user to retry rather than guess.
 */
function located(code: string, file: string, edit: Edit): { el: t.JSXElement; line: number; col: number } {
  const loc = parseSrc(edit.id);
  if (!loc) throw new EditError(`Bad element reference ${edit.id}`);
  let ast: t.File;
  try {
    ast = parseSource(code, file);
  } catch (err) {
    throw new EditError(`Could not parse ${file}: ${(err as Error).message}`);
  }
  // A component usage reference carries the component's name; a host element is checked against the DOM tag.
  const named = (el: t.JSXElement) => {
    const name = el.openingElement.name;
    return loc.name ? jsxName(code, name) === loc.name : name.type === 'JSXIdentifier' && name.name.toLowerCase() === edit.tag.toLowerCase();
  };
  // Comes off the wire: keep only well-formed strings.
  const raw = edit.ident;
  const ident: Ident | undefined = raw && typeof raw === 'object' ? { cls: typeof raw.cls === 'string' ? raw.cls : undefined, text: typeof raw.text === 'string' ? raw.text : undefined } : undefined;
  const hosted = !loc.name;
  const exact = findElement(ast, loc.line, loc.col);
  const exactOk = !!exact && named(exact);

  // The file changed under the page by someone other than us, so line:col can't be trusted at all. The tag carries
  // a fingerprint of the element's own source: find that, or refuse rather than guess.
  const ver = parseVer(edit.ver);
  if (ver && edit.stale === 'external') {
    const twins: t.JSXElement[] = [];
    walk(ast, (n) => {
      if (n.type === 'JSXElement' && named(n) && fingerprint(code, n) === ver.fp) twins.push(n);
    });
    // Identical twins keep their order unless one was added or removed; then only what the canvas saw can break the tie.
    const strong = ident ? twins.filter((el) => fit(code, el, hosted, ident) >= 1) : [];
    const found = twins.length === 1 ? twins[0] : twins.length === ver.total ? twins[ver.occ] : strong.length === 1 ? strong[0] : null;
    const at = found?.openingElement.loc?.start;
    if (!found || !at) {
      throw new StaleElement(`<${loc.name ?? edit.tag}> changed in the source since the page was rendered, so Brushup can't be sure which element you meant. It will refresh; try again.`);
    }
    return { el: found, line: at.line, col: at.column };
  }
  if (exactOk && (!ident || fit(code, exact, hosted, ident) >= 0)) return { el: exact, line: loc.line, col: loc.col };

  const same: t.JSXElement[] = [];
  walk(ast, (n) => {
    if (n.type === 'JSXElement' && named(n)) same.push(n);
  });
  const scored = ident ? same.map((el) => ({ el, score: fit(code, el, hosted, ident) })) : [];
  const strong = scored.filter((c) => c.score >= 1);
  const pick = strong.length === 1 ? strong[0].el : exactOk ? exact : null;
  const at = pick?.openingElement.loc?.start;
  if (!pick || !at) throw new EditError(`<${loc.name ?? edit.tag}> is no longer at ${edit.id}. The file changed; try again.`);
  return { el: pick, line: at.line, col: at.column };
}

/** The element's text isn't a plain literal here (it comes from an expression, props or nested elements). */
export class TextNotHere extends EditError {}

const attrNamed = (el: t.JSXElement, name: string) =>
  el.openingElement.attributes.find((a): a is t.JSXAttribute => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === name);

const quote = (code: string) => (/from\s+'/.test(code) ? "'" : '"');

/** CSS value -> the source text of a React style value (numbers for px / unitless props). */
function styleLiteral(prop: string, value: string, q: string): string {
  const v = value.trim();
  if (UNITLESS.has(prop) && /^-?\d*\.?\d+$/.test(v)) return v;
  const px = /^(-?\d*\.?\d+)px$/.exec(v);
  if (px && !UNITLESS.has(prop)) return String(Number(px[1]));
  return v.includes(q) ? JSON.stringify(v) : `${q}${v}${q}`;
}

/* ---------- text ---------- */

export const escapeJsxText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');

type Lit = t.StringLiteral | t.TemplateLiteral;
const plainString = (n: t.Node | null | undefined): n is Lit => !!n && (n.type === 'StringLiteral' || (n.type === 'TemplateLiteral' && n.expressions.length === 0));
const litValue = (n: Lit) => (n.type === 'StringLiteral' ? n.value : (n.quasis[0].value.cooked ?? n.quasis[0].value.raw));
const collapse2 = (v: string) => v.replace(/\s+/g, ' ').trim();

/** Write `text` into a string literal, keeping its quote style and escaping what that quote needs. */
export function replaceLiteral(code: string, node: Lit, text: string): string {
  const q = code[node.start!];
  let body = text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
  body = q === '`' ? body.replace(/`/g, '\\`').replace(/\$\{/g, '\\${') : body.replace(new RegExp(q, 'g'), `\\${q}`);
  return code.slice(0, node.start!) + q + body + q + code.slice(node.end!);
}

/** The nodes above `target`, outermost first, or null if it isn't in `root`. */
function ancestors(root: t.Node, target: t.Node): t.Node[] | null {
  const stack: t.Node[] = [];
  const visit = (n: unknown): boolean => {
    if (!n || typeof n !== 'object') return false;
    if (Array.isArray(n)) return n.some(visit);
    const node = n as t.Node;
    if (typeof node.type !== 'string') return false;
    if (node === target) return true;
    stack.push(node);
    for (const key of Object.keys(node)) if (key !== 'loc' && key !== 'extra' && !key.endsWith('Comments') && visit((node as unknown as Record<string, unknown>)[key])) return true;
    stack.pop();
    return false;
  };
  return visit(root) ? stack : null;
}

const unwrap = (n: t.Node | null | undefined): t.Node | null | undefined => {
  while (n && (n.type === 'TSAsExpression' || n.type === 'TSSatisfiesExpression' || n.type === 'ParenthesizedExpression' || n.type === 'TSNonNullExpression')) n = n.expression;
  return n;
};
const keyName = (k: t.Node, computed: boolean) => (!computed && k.type === 'Identifier' ? k.name : k.type === 'StringLiteral' ? k.value : null);

/**
 * `{f.body}` or `{body}` inside `items.map((f) => …)` where `items` is a literal array in this file: the string
 * literal in the `instance`-th item that the text really comes from, or why it can't be found.
 */
function dataLiteral(ast: t.File, el: t.JSXElement, expr: t.Node, instance: number): { lit: Lit } | { why: string } {
  const above = ancestors(ast.program, el);
  if (!above) return { why: 'could not be located' };
  const access = expr.type === 'MemberExpression' && expr.object.type === 'Identifier' ? { name: expr.object.name, key: keyName(expr.property, expr.computed) } : expr.type === 'Identifier' ? { name: expr.name, key: null } : null;
  if (!access) return { why: 'is not a plain property of a list item' };
  for (let i = above.length - 1; i > 0; i--) {
    const fn = above[i];
    const call = above[i - 1];
    if ((fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression') || call.type !== 'CallExpression' || call.arguments[0] !== fn) continue;
    if (call.callee.type !== 'MemberExpression' || call.callee.property.type !== 'Identifier' || call.callee.property.name !== 'map') continue;
    const param = fn.params[0];
    let prop: string | null = null;
    if (access.key !== null && param?.type === 'Identifier' && param.name === access.name) prop = access.key;
    else if (access.key === null && param?.type === 'ObjectPattern') {
      const hit = param.properties.find((p): p is t.ObjectProperty => p.type === 'ObjectProperty' && p.value.type === 'Identifier' && p.value.name === access.name);
      prop = hit ? keyName(hit.key, hit.computed) : null;
    }
    if (!prop) continue;
    // where the list comes from
    let list = unwrap(call.callee.object);
    if (list?.type === 'Identifier') {
      const name = list.name;
      list = null;
      for (const stmt of ast.program.body) {
        const decl = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt;
        if (decl?.type !== 'VariableDeclaration') continue;
        const d = decl.declarations.find((x) => x.id.type === 'Identifier' && x.id.name === name);
        if (d) list = unwrap(d.init);
      }
    }
    if (list?.type !== 'ArrayExpression') return { why: 'is built by code (a filter, a fetch, a prop), not a literal list in this file' };
    if (list.elements.some((x) => !x || x.type === 'SpreadElement')) return { why: 'is in a list that spreads other lists, so its position is unclear' };
    const item = unwrap(list.elements[instance]);
    if (item?.type !== 'ObjectExpression') return { why: `has no matching item at position ${instance + 1} in its list` };
    const entry = item.properties.find((p): p is t.ObjectProperty => p.type === 'ObjectProperty' && keyName(p.key, p.computed) === prop);
    const value = unwrap(entry?.value);
    if (!plainString(value)) return { why: `is not a plain string in the list ("${prop}")` };
    return { lit: value };
  }
  return { why: 'is an expression (a variable, state or a prop), not text written here' };
}

function patchText(code: string, file: string, edit: TextEdit): string {
  const { el } = located(code, file, edit);
  const kids = el.children;
  const label = parseSrc(edit.id)?.name ?? edit.tag;
  if (!el.closingElement) throw new TextNotHere(`<${label}> has no text children to edit here.`);
  const only = kids.length === 1 ? kids[0] : null;
  if (only?.type === 'JSXExpressionContainer') {
    const e = only.expression;
    const source = code.slice(only.start!, only.end!);
    // {"Save"} or {`Save`}: the text is a literal, just written as an expression
    if (plainString(e)) return replaceLiteral(code, e, edit.text.trim());
    if (e.type === 'MemberExpression' || e.type === 'Identifier') {
      const found = dataLiteral(parseSource(code, file), el, e, edit.instance ?? 0);
      if ('why' in found) throw new TextNotHere(`The text in <${label}> comes from ${source}, which ${found.why}, so it can't be edited here.`);
      if (typeof edit.instance !== 'number') throw new TextNotHere(`The text in <${label}> comes from ${source}, a value in a list, and Brushup needs to know which item this is.`);
      // The page must still show what the data says, otherwise this isn't the item it appears to be (a filter, a sort)
      if (edit.was !== undefined && collapse2(edit.was) !== collapse2(litValue(found.lit))) {
        throw new TextNotHere(`The text in <${label}> comes from ${source}, but the page doesn't show item ${edit.instance + 1} of that list as written, so it can't be edited safely.`);
      }
      return replaceLiteral(code, found.lit, edit.text.trim());
    }
    throw new TextNotHere(`The text in <${label}> comes from ${source}, an expression, so it can't be edited here.`);
  }
  if (kids.length !== 1 || kids[0].type !== 'JSXText') {
    throw new TextNotHere(`The text in <${label}> comes from an expression or nested elements, so it can't be edited here.`);
  }
  const node = kids[0];
  const inner = code.slice(node.start!, node.end!);
  const lead = /^\s*/.exec(inner)![0];
  const trail = inner.trim() ? /\s*$/.exec(inner)![0] : '';
  return code.slice(0, node.start!) + lead + escapeJsxText(edit.text.trim()) + trail + code.slice(node.end!);
}

/* ---------- an image's src or alt ---------- */

/** A JSX attribute's string value: quoted the way the file quotes, switching quotes (or to an expression) when the value contains one. */
function attrValue(code: string, value: string, q: string): string {
  const safe = value.replace(/&/g, '&amp;'); // JSX reads entities in attribute strings
  if (!value.includes(q)) return `${q}${safe}${q}`;
  const other = q === '"' ? "'" : '"';
  return value.includes(other) ? `{${JSON.stringify(value)}}` : `${other}${safe}${other}`;
}

/** The quote this file puts around JSX attribute strings: what the same element uses, else what any element in the file uses, else a double quote. */
function attrQuote(ast: t.File, el: t.JSXElement, code: string): string {
  const quoteOf = (a: t.JSXAttribute | t.JSXSpreadAttribute) => (a.type === 'JSXAttribute' && a.value?.type === 'StringLiteral' ? code[a.value.start!] : null);
  const own = el.openingElement.attributes.map(quoteOf).filter((q): q is string => !!q);
  if (own.length) {
    // The style most of its attributes use; a tie goes to the first. (One odd attribute doesn't set the style.)
    const doubles = own.filter((q) => q === '"').length;
    const singles = own.length - doubles;
    return singles > doubles ? "'" : doubles > singles ? '"' : own[0];
  }
  let any: string | null = null;
  walk(ast, (n) => {
    if (!any && n.type === 'JSXAttribute') any = quoteOf(n);
  });
  return any ?? '"';
}

function patchAttr(code: string, file: string, edit: AttrEdit): string {
  checkAttr(edit);
  const { el } = located(code, file, edit);
  const label = parseSrc(edit.id)?.name ?? edit.tag;
  const q = attrQuote(parseSource(code, file), el, code);
  const attr = attrNamed(el, edit.name);
  if (!attr) {
    const at = afterName(el.openingElement);
    return `${code.slice(0, at)} ${edit.name}=${attrValue(code, edit.value, q)}${code.slice(at)}`;
  }
  const v = attr.value;
  if (!v || v.type === 'StringLiteral') return `${code.slice(0, attr.start!)}${edit.name}=${attrValue(code, edit.value, q)}${code.slice(attr.end!)}`;
  if (v.type === 'JSXExpressionContainer' && plainString(v.expression)) return replaceLiteral(code, v.expression, edit.value);
  throw new EditError(`The ${edit.name} of <${label}> comes from ${code.slice(v.start!, v.end!)}, an expression (an import or a variable), so Brushup can't change it here. Change it in the code, or pin a note for Claude.`);
}

/* ---------- delete and duplicate ---------- */

const LIST_METHODS = new Set(['map', 'flatMap', 'filter', 'reduce', 'forEach']);

/**
 * Why an element can't be safely removed or copied on its own, or null when it is an ordinary child of another
 * element. Only its direct parent matters: a `<p>` inside a `<div>` is plain markup even if that div is conditional
 * or drawn by a `.map` (changing it changes the shared template, which is what editing that JSX means).
 */
/** The nodes from the top of the file down to (not including) `el`. */
function pathTo(ast: t.File, el: t.JSXElement): t.Node[] {
  const path: t.Node[] = [];
  const find = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') return false;
    if (Array.isArray(node)) return node.some(find);
    const n = node as t.Node;
    if (typeof n.type !== 'string') return false;
    if (n === el) return true;
    path.push(n);
    for (const key of Object.keys(n)) {
      if (key === 'loc' || key === 'extra' || key.endsWith('Comments')) continue;
      if (find((n as unknown as Record<string, unknown>)[key])) return true;
    }
    path.pop();
    return false;
  };
  find(ast);
  return path;
}

function structureRefusal(ast: t.File, el: t.JSXElement): string | null {
  const path = pathTo(ast, el);
  const parent = path[path.length - 1];
  if (parent && (parent.type === 'JSXElement' || parent.type === 'JSXFragment')) return null;
  // Not a plain child: say what it is instead.
  for (let i = path.length - 1; i >= 0; i--) {
    const n = path[i];
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.property.type === 'Identifier' && LIST_METHODS.has(n.callee.property.name)) {
      return `is drawn from a list (.${n.callee.property.name}), so one line of code makes several elements and removing or copying it would change them all`;
    }
    if (n.type === 'ConditionalExpression' || n.type === 'LogicalExpression') return 'is shown conditionally (a && or ?: expression), so removing or copying it would change that logic';
    if (n.type === 'JSXAttribute') return 'is passed as a prop, not written as a child';
    if (n.type === 'JSXExpressionContainer') return 'is written inside an expression ({…}), so Brushup can\'t tell what it is for';
  }
  return 'is the top-level element a component returns, so removing or copying it would leave the component with nothing, or two roots';
}

/** The neighbouring element a move would swap with, or why there isn't one. */
function neighbour(ast: t.File, el: t.JSXElement, dir: -1 | 1): t.JSXElement | string {
  const parent = pathTo(ast, el).pop();
  if (!parent || (parent.type !== 'JSXElement' && parent.type !== 'JSXFragment')) return 'is not a plain child of another element';
  const kids = parent.children;
  let i = kids.indexOf(el) + dir;
  while (kids[i]?.type === 'JSXText' && !(kids[i] as t.JSXText).value.trim()) i += dir; // blank space between elements
  const next = kids[i];
  if (!next) return `is already the ${dir < 0 ? 'first' : 'last'} thing in its parent`;
  if (next.type === 'JSXElement') return next;
  return next.type === 'JSXText' ? 'has loose text next to it, and moving past text would change what the page says' : 'has an expression ({…}) next to it, which could be a list or a condition, so Brushup won\'t move past it';
}

/** The `file:line:col` reference (with the component name, when the edit was addressed to a usage) of an offset in the new source. */
function refAt(code: string, offset: number, like: string): string {
  const head = code.slice(0, offset).split('\n');
  const was = parseSrc(like);
  return `${was?.file ?? ''}:${head.length}:${head[head.length - 1].length}${was?.name ? `#${was.name}` : ''}`;
}

function patchStructure(code: string, file: string, edit: StructureEdit): { code: string; warning?: string; movedTo?: number } {
  const { el } = located(code, file, edit);
  const label = parseSrc(edit.id)?.name ?? edit.tag;
  const ast = parseSource(code, file);
  // Wrapping works anywhere an element can be written (a child, a list item, a condition, a prop) because the wrapper is one more element.
  if (edit.kind === 'wrap') return { code: wrapSpan(code, el.start!, el.end!) };
  if (edit.kind === 'moveUp' || edit.kind === 'moveDown') {
    const other = neighbour(ast, el, edit.kind === 'moveUp' ? -1 : 1);
    if (typeof other === 'string') throw new EditError(`<${label}> ${other}.`);
    const pair: [[number, number], [number, number]] = edit.kind === 'moveUp' ? [[other.start!, other.end!], [el.start!, el.end!]] : [[el.start!, el.end!], [other.start!, other.end!]];
    // Where the moved element starts afterwards, so the canvas can keep it selected (its old line now belongs to its neighbour).
    const otherLen = other.end! - other.start!;
    const movedTo = edit.kind === 'moveUp' ? other.start! : el.start! + otherLen + (other.start! - el.end!);
    return { code: swapSpans(code, pair[0], pair[1]), movedTo };
  }
  const why = structureRefusal(ast, el);
  if (why) throw new EditError(`<${label}> ${why}. Ask Claude to change it, or edit the code by hand.`);
  if (edit.kind === 'delete') return { code: removeSpan(code, el.start!, el.end!) };
  const copy = duplicateSpan(code, el.start!, el.end!);
  const ids = /\bid\s*=/.test(code.slice(el.start!, el.end!));
  return { code: copy, ...(ids ? { warning: 'The copy has the same id as the original; change one of them' } : {}) };
}

/* ---------- inline style={{ ... }} ---------- */

function patchInline(code: string, file: string, edit: Edit, prop: string, value: string): string {
  const { el } = located(code, file, edit);
  const q = quote(code);
  const key = camel(prop);
  const literal = styleLiteral(prop, value, q);
  const attr = attrNamed(el, 'style');
  if (!attr) {
    const at = afterName(el.openingElement);
    return code.slice(0, at) + ` style={{ ${key}: ${literal} }}` + code.slice(at);
  }
  const expr = attr.value?.type === 'JSXExpressionContainer' ? attr.value.expression : null;
  if (!expr || expr.type !== 'ObjectExpression') {
    throw new EditError('This element\'s style prop is not an object literal, so Brushup can\'t edit it.');
  }
  const existing = expr.properties.find(
    (p): p is t.ObjectProperty =>
      p.type === 'ObjectProperty' && !p.computed && ((p.key.type === 'Identifier' && p.key.name === key) || (p.key.type === 'StringLiteral' && (p.key.value === key || p.key.value === prop))),
  );
  if (existing) return code.slice(0, existing.value.start!) + literal + code.slice(existing.value.end!);
  const last = expr.properties[expr.properties.length - 1];
  if (last) return code.slice(0, last.end!) + `, ${key}: ${literal}` + code.slice(last.end!);
  return code.slice(0, expr.start! + 1) + ` ${key}: ${literal} ` + code.slice(expr.start! + 1);
}

/* ---------- Tailwind className ---------- */

/** Token names sent from the page, as plain lowercase words: anything else is dropped before it can reach a class name. */
const names = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((n): n is string => typeof n === 'string' && /^[a-z0-9-]{1,40}$/.test(n)).slice(0, 200) : undefined);

/** Returns patched code, or null if className isn't a plain string we can safely rewrite. */
function patchClass(code: string, file: string, edit: Edit, prop: string, value: string, scale?: Scale, variant = '', warnings?: string[]): string | null {
  const { el } = located(code, file, edit);
  const sent = edit.kind === 'style' ? edit.hints : undefined;
  // Only snap when the page says 1rem is 16px, otherwise `ml-10` wouldn't be the 40px the user saw.
  const hints: ClassHints = { lineHeight: sent?.lineHeight, scale: sent?.rootPx === 16 ? scale : undefined, colorTokens: names(sent?.colorTokens), textTokens: names(sent?.textTokens), spacingTokens: names(sent?.spacingTokens) };
  const attr = attrNamed(el, 'className');
  if (!attr) {
    const classes = tailwindClasses('', prop, value, hints, variant);
    if (classes === null) return null;
    const at = afterName(el.openingElement);
    return code.slice(0, at) + ` className="${classes}"` + code.slice(at);
  }
  const range = classNameRange(attr);
  if (!range) return patchClassCall(code, attr, prop, value, hints, variant, warnings);
  const current = code.slice(range.start, range.end);
  if (current.includes('\\')) return null;
  const next = tailwindClasses(current, prop, value, hints, variant);
  if (next === null) return null;
  return code.slice(0, range.start) + next + code.slice(range.end);
}

/** The helpers projects use to build a className from pieces; their string arguments are class lists. */
const CLASS_HELPERS = new Set(['cn', 'clsx', 'classNames', 'classnames', 'cx', 'twMerge', 'twJoin']);

/** Every string literal inside `node`, however deeply nested (the branches of `cond && '…'`, the keys of `{ '…': on }`). */
function stringsIn(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out;
  const n = node as { type?: string; value?: unknown; quasis?: { value: { cooked?: string | null } }[] };
  if (n.type === 'StringLiteral' && typeof n.value === 'string') out.push(n.value);
  else if (n.type === 'TemplateLiteral') for (const q of n.quasis ?? []) out.push(q.value.cooked ?? '');
  for (const [key, child] of Object.entries(node)) {
    if (key === 'loc' || key === 'extra' || key === 'leadingComments' || key === 'trailingComments') continue;
    if (Array.isArray(child)) child.forEach((c) => stringsIn(c, out));
    else if (child && typeof child === 'object') stringsIn(child, out);
  }
  return out;
}

/**
 * `className={cn('px-4 py-2', active && 'bg-blue-500', className)}` or `` className={`px-4 py-2 ${className}`} ``: write into the plain
 * string parts, the classes that always apply, and leave the conditional and passed-in parts alone. It needs a plain string with
 * classes in it; with none (`cn(buttonVariants(), className)`) the order of the pieces decides what wins, so it declines rather
 * than guess. Classes in the conditional parts that set the same property still win when their condition holds, and the edit says so.
 */
function patchClassCall(code: string, attr: t.JSXAttribute, prop: string, value: string, hints: ClassHints, variant: string, warnings?: string[]): string | null {
  const v = attr.value;
  const expr = v?.type === 'JSXExpressionContainer' ? v.expression : null;
  if (!expr) return null;
  const literals: { start: number; end: number }[] = [];
  const conditional: string[] = [];
  let helper = '';
  if (expr.type === 'CallExpression' && expr.callee.type === 'Identifier' && CLASS_HELPERS.has(expr.callee.name)) {
    helper = `${expr.callee.name}()`;
    for (const arg of expr.arguments) {
      if (arg.type === 'StringLiteral' || (arg.type === 'TemplateLiteral' && arg.expressions.length === 0)) literals.push({ start: arg.start! + 1, end: arg.end! - 1 });
      else stringsIn(arg, conditional);
    }
  } else if (expr.type === 'TemplateLiteral') {
    helper = 'the template';
    for (const q of expr.quasis) literals.push({ start: q.start!, end: q.end! });
    for (const e of expr.expressions) stringsIn(e, conditional);
  } else return null;
  // The string that gets the new class: the first with classes in it (a template may start with `${…}`). None means decline.
  const target = literals.findIndex((l) => code.slice(l.start, l.end).trim() !== '' || expr.type === 'CallExpression');
  if (target < 0) return null;
  if (literals.some((l) => code.slice(l.start, l.end).includes('\\'))) return null;
  // Keep the whitespace around the classes: in a template it is what separates them from a `${…}` next to them.
  const rewrite = (current: string, fn: (core: string) => string | null): string | null => {
    const lead = /^\s*/.exec(current)![0];
    const trail = /\s*$/.exec(current)![0];
    const next = fn(current.trim());
    if (next === null) return null;
    return next === '' ? (lead || trail ? ' ' : '') : lead + next + trail;
  };
  // Splice back to front so the earlier positions stay valid.
  let out = code;
  for (let i = literals.length - 1; i >= 0; i--) {
    const l = literals[i];
    const current = code.slice(l.start, l.end);
    const next = rewrite(current, (core) => (i === target ? tailwindClasses(core, prop, value, hints, variant) : stripClasses(core, prop, hints, variant)));
    if (next === null) return null;
    out = out.slice(0, l.start) + next + out.slice(l.end);
  }
  const still = conflictingClasses(conditional.join(' '), prop, hints, variant);
  if (still.length && warnings) warnings.push(`${[...new Set(still)].join(', ')} is set under a condition in ${helper}, so ${prop} may look unchanged while it applies`);
  return out;
}

/** Inner range of a className that is a plain string literal (or an expression-free template literal). */
function classNameRange(attr: t.JSXAttribute): { start: number; end: number } | null {
  const v = attr.value;
  const node = v?.type === 'JSXExpressionContainer' ? v.expression : v;
  if (node?.type === 'StringLiteral') return { start: node.start! + 1, end: node.end! - 1 };
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return { start: node.start! + 1, end: node.end! - 1 };
  return null;
}

/* ---------- shared CSS rule ---------- */

/** What can be known about an element from its JSX alone (no ancestors, no runtime). */
/** `import styles from './card.module.css'` -> { styles: '/abs/card.module.css' }. */
function moduleImports(code: string, file: string): Map<string, string> {
  const out = new Map<string, string>();
  try {
    for (const node of parseSource(code, file).program.body) {
      if (node.type !== 'ImportDeclaration' || !/\.module\.css$/.test(node.source.value)) continue;
      const def = node.specifiers.find((x) => x.type === 'ImportDefaultSpecifier' || x.type === 'ImportNamespaceSpecifier');
      if (def) out.set(def.local.name, path.resolve(path.dirname(file), node.source.value));
    }
  } catch {
    /* an unparsable file has no modules to find */
  }
  return out;
}

/** The class names a `className` expression takes from CSS modules (`styles.card`, `styles['card']`), and which files they live in. */
function moduleClasses(el: t.JSXElement, modules: Map<string, string>): { names: string[]; files: string[] } {
  const names: string[] = [];
  const files = new Set<string>();
  const attr = attrNamed(el, 'className');
  walk(attr?.value, (n) => {
    if (n.type !== 'MemberExpression' || n.object.type !== 'Identifier' || !modules.has(n.object.name)) return;
    const name = !n.computed && n.property.type === 'Identifier' ? n.property.name : n.computed && n.property.type === 'StringLiteral' ? n.property.value : null;
    if (name) (names.push(name), files.add(modules.get(n.object.name)!));
  });
  return { names, files: [...files] };
}

function staticIdentity(el: t.JSXElement, modules = new Map<string, string>()): { identity: SourceElement; moduleFiles: string[] } {
  const literal = (name: string) => {
    const a = attrNamed(el, name);
    const v = a?.value?.type === 'JSXExpressionContainer' ? a.value.expression : a?.value;
    return v?.type === 'StringLiteral' ? v.value : '';
  };
  const flat = (n: t.JSXOpeningElement['name']): string => (n.type === 'JSXIdentifier' ? n.name : n.type === 'JSXMemberExpression' ? `${flat(n.object)}.${n.property.name}` : '');
  const tag = flat(el.openingElement.name);
  const fromModules = moduleClasses(el, modules);
  const cls = [literal('className'), ...fromModules.names].filter(Boolean).join(' ');
  const identity = { tag, attrs: { id: literal('id'), class: cls }, classes: cls.split(/\s+/).filter(Boolean), parent: null } as unknown as SourceElement;
  return { identity, moduleFiles: fromModules.files };
}

function patchRule(files: Files, code: string, file: string, edit: Edit, prop: string, value: string): Files | null {
  const { identity, moduleFiles } = staticIdentity(located(code, file, edit).el, moduleImports(code, file));
  let best: { file: string; start: number; end: number; weight: number; value: string } | null = null;
  // An element styled from a CSS module can only be styled by that module's rules; otherwise any stylesheet may apply.
  const sheets = Object.keys(files).filter((f) => f.endsWith('.css') && (!moduleFiles.length || moduleFiles.includes(f)));
  for (const cssFile of sheets.sort()) {
    for (const rule of readRules(files[cssFile])) {
      const decl = rule.decls.filter((d) => d.prop === prop).pop();
      if (!decl) continue;
      let weight = -1;
      for (const sel of rule.selectors.map(parseSelector)) if (sel && matches(identity, sel)) weight = Math.max(weight, specificity(sel));
      if (weight >= 0 && (!best || weight >= best.weight)) best = { file: cssFile, start: decl.valueRange.start, end: decl.valueRange.end, weight, value: decl.value };
    }
  }
  if (!best) return null;
  if (best.value === value) return files;
  return { ...files, [best.file]: splice(files[best.file], { start: best.start, end: best.end }, value) };
}

/** Tag, static classes and plain text of the element at `edit.id`, for the agent-facing selection file. */
export function describeElement(code: string, file: string, id: string, tag: string): { tag: string; component?: string; classes: string[]; text: string } | null {
  try {
    const { el } = located(code, file, { kind: 'text', id, tag, text: '' });
    const text = el.children
      .filter((c): c is t.JSXText => c.type === 'JSXText')
      .map((c) => c.value)
      .join('')
      .trim()
      .slice(0, 120);
    return { tag, component: parseSrc(id)?.name, classes: staticIdentity(el).identity.classes, text };
  } catch {
    return null;
  }
}

/* ---------- entry point ---------- */

/** The className attribute's source text, for spotting variant utilities the edit has to live alongside. */
function classSource(code: string, file: string, edit: Edit): string {
  const attr = attrNamed(located(code, file, edit).el, 'className');
  return attr ? code.slice(attr.start!, attr.end!) : '';
}

/** Pure: apply an edit to the JSX file `file` (plus project css in `files` for rule edits). */
export function applyJsxEdit(files: Files, file: string, edit: Edit, opts: JsxOptions): { files: Files; target: Target; warning?: string; select?: string } {
  if (edit.kind === 'text') return { files: { ...files, [file]: patchText(files[file], file, edit) }, target: 'text' };
  if (edit.kind === 'attr') return { files: { ...files, [file]: patchAttr(files[file], file, edit) }, target: 'attribute' };
  if (edit.kind !== 'style') {
    const done = patchStructure(files[file], file, edit);
    return { files: { ...files, [file]: done.code }, target: 'structure', ...(done.warning ? { warning: done.warning } : {}), ...(done.movedTo === undefined ? {} : { select: refAt(done.code, done.movedTo, edit.id) }) };
  }

  let out = files;
  let target: Target = 'inline';
  const warnings: string[] = [];
  for (const [prop, rawValue] of Object.entries(edit.props)) {
    if (!/^[a-z-]+$/i.test(prop) || /[;{}]/.test(rawValue)) throw new EditError(`Rejected style ${prop}: ${rawValue}`);
    const p = prop.toLowerCase();
    if (edit.scope === 'rule') {
      const hit = patchRule(out, out[file], file, edit, p, rawValue);
      if (hit) {
        out = hit;
        target = 'rule';
        continue;
      }
    }
    const variant = edit.variant ?? '';
    if (variant) {
      // A breakpoint or state exists only as a Tailwind class: writing it inline would apply it at every size.
      if (!isVariant(variant)) throw new EditError(`Rejected variant ${variant}`);
      if (!opts.tailwind) throw new EditError(`Editing for ${variant}: needs Tailwind. This project's styles aren't Tailwind classes, so switch back to All sizes.`);
    }
    const variants = opts.tailwind ? variantConflicts(classSource(out[file], file, edit), p, variant) : [];
    if (opts.tailwind) {
      const next = patchClass(out[file], file, edit, p, rawValue, opts.scale, variant, warnings);
      if (next !== null) {
        out = { ...out, [file]: next };
        target = 'class';
        if (variants.length) warnings.push(`${variants.join(', ')} still win${variants.length > 1 ? '' : 's'} under ${variants.length > 1 ? 'their' : 'its'} condition, so ${p} may look unchanged there`);
        continue;
      }
    }
    if (variant) throw new EditError(`This element's className is computed, so ${variant}: can't be written into it. Edit it for All sizes, or write the ${variant}: class yourself.`);
    out = { ...out, [file]: patchInline(out[file], file, edit, p, rawValue) };
    target = 'inline';
    if (variants.length) warnings.push(`${p} was written inline (className is computed), which overrides ${variants.join(', ')} at every screen size`);
  }
  return { files: out, target, ...(warnings.length ? { warning: warnings.join('; ') } : {}) };
}
