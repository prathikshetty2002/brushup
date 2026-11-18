import type * as t from '@babel/types';
import { EditError, type Edit, type Ident, type Target, type TextEdit } from './edit-types';
import type { Files } from './patch';
import { readRules, splice } from './css-patch';
import { afterName, findElement, jsxName, parseSource, parseSrc, walk } from './jsx';
import { matches, parseSelector, specificity } from './selector';
import type { SourceElement } from './html-map';
import { tailwindClasses, variantConflicts, type ClassHints, type Scale } from './tailwind';

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

const escapeJsxText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');

function patchText(code: string, file: string, edit: TextEdit): string {
  const { el } = located(code, file, edit);
  const kids = el.children;
  const label = parseSrc(edit.id)?.name ?? edit.tag;
  if (!el.closingElement) throw new TextNotHere(`<${label}> has no text children to edit here.`);
  if (kids.length !== 1 || kids[0].type !== 'JSXText') {
    throw new TextNotHere(`The text in <${label}> comes from an expression or nested elements, so it can't be edited here.`);
  }
  const node = kids[0];
  const inner = code.slice(node.start!, node.end!);
  const lead = /^\s*/.exec(inner)![0];
  const trail = inner.trim() ? /\s*$/.exec(inner)![0] : '';
  return code.slice(0, node.start!) + lead + escapeJsxText(edit.text.trim()) + trail + code.slice(node.end!);
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

/** Returns patched code, or null if className isn't a plain string we can safely rewrite. */
function patchClass(code: string, file: string, edit: Edit, prop: string, value: string, scale?: Scale): string | null {
  const { el } = located(code, file, edit);
  const sent = edit.kind === 'style' ? edit.hints : undefined;
  // Only snap when the page says 1rem is 16px, otherwise `ml-10` wouldn't be the 40px the user saw.
  const hints: ClassHints = { lineHeight: sent?.lineHeight, scale: sent?.rootPx === 16 ? scale : undefined };
  const attr = attrNamed(el, 'className');
  if (!attr) {
    const classes = tailwindClasses('', prop, value, hints);
    if (classes === null) return null;
    const at = afterName(el.openingElement);
    return code.slice(0, at) + ` className="${classes}"` + code.slice(at);
  }
  const range = classNameRange(attr);
  if (!range) return null;
  const current = code.slice(range.start, range.end);
  if (current.includes('\\')) return null;
  const next = tailwindClasses(current, prop, value, hints);
  if (next === null) return null;
  return code.slice(0, range.start) + next + code.slice(range.end);
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
function staticIdentity(el: t.JSXElement): SourceElement {
  const literal = (name: string) => {
    const a = attrNamed(el, name);
    const v = a?.value?.type === 'JSXExpressionContainer' ? a.value.expression : a?.value;
    return v?.type === 'StringLiteral' ? v.value : '';
  };
  const flat = (n: t.JSXOpeningElement['name']): string => (n.type === 'JSXIdentifier' ? n.name : n.type === 'JSXMemberExpression' ? `${flat(n.object)}.${n.property.name}` : '');
  const tag = flat(el.openingElement.name);
  const cls = literal('className');
  return { tag, attrs: { id: literal('id'), class: cls }, classes: cls.split(/\s+/).filter(Boolean), parent: null } as unknown as SourceElement;
}

function patchRule(files: Files, code: string, file: string, edit: Edit, prop: string, value: string): Files | null {
  const identity = staticIdentity(located(code, file, edit).el);
  let best: { file: string; start: number; end: number; weight: number; value: string } | null = null;
  for (const cssFile of Object.keys(files).filter((f) => f.endsWith('.css')).sort()) {
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
    return { tag, component: parseSrc(id)?.name, classes: staticIdentity(el).classes, text };
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
export function applyJsxEdit(files: Files, file: string, edit: Edit, opts: JsxOptions): { files: Files; target: Target; warning?: string } {
  if (edit.kind === 'text') return { files: { ...files, [file]: patchText(files[file], file, edit) }, target: 'text' };

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
    const variants = opts.tailwind ? variantConflicts(classSource(out[file], file, edit), p) : [];
    if (opts.tailwind) {
      const next = patchClass(out[file], file, edit, p, rawValue, opts.scale);
      if (next !== null) {
        out = { ...out, [file]: next };
        target = 'class';
        if (variants.length) warnings.push(`${variants.join(', ')} still win${variants.length > 1 ? '' : 's'} under ${variants.length > 1 ? 'their' : 'its'} condition, so ${p} may look unchanged there`);
        continue;
      }
    }
    out = { ...out, [file]: patchInline(out[file], file, edit, p, rawValue) };
    target = 'inline';
    if (variants.length) warnings.push(`${p} was written inline (className is computed), which overrides ${variants.join(', ')} at every screen size`);
  }
  return { files: out, target, ...(warnings.length ? { warning: warnings.join('; ') } : {}) };
}
