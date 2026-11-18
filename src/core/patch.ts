import path from 'node:path';
import { EditError, type Edit, type Scope, type StyleEdit, type TextEdit } from './edit-types';
import { afterTagName, mapHtml, type Range, type SourceDoc, type SourceElement } from './html-map';
import { parseSelector, matches, specificity } from './selector';
import { readInlineDecls, readRules, splice } from './css-patch';

/** Absolute path -> file contents. Holds the entry HTML plus any local stylesheets it links. */
export type Files = Record<string, string>;

interface Sheet {
  file: string;
  /** Where the css text lives inside `file` (whole file for .css, the <style> body for inline). */
  range: Range;
}

const NON_LOCAL = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

/** Local stylesheet files linked from the document, resolved against `root`. */
export function linkedStylesheets(doc: SourceDoc, root: string): string[] {
  const out: string[] = [];
  for (const el of doc.elements) {
    if (el.tag !== 'link' || !/\bstylesheet\b/i.test(el.attrs.rel ?? '')) continue;
    const href = el.attrs.href;
    if (!href || NON_LOCAL.test(href)) continue;
    const abs = path.resolve(root, decodeURI(href.split(/[?#]/)[0]));
    if (abs === root || abs.startsWith(root + path.sep)) out.push(abs);
  }
  return out;
}

/** Stylesheets in cascade order: <style> blocks and linked files interleaved as in the document. */
function collectSheets(doc: SourceDoc, entry: string, files: Files): Sheet[] {
  const root = path.dirname(entry);
  const sheets: Sheet[] = [];
  for (const el of doc.elements) {
    if (el.tag === 'style' && el.endTag) {
      sheets.push({ file: entry, range: { start: el.startTag.end, end: el.endTag.start } });
    } else if (el.tag === 'link') {
      const abs = linkedStylesheets({ ...doc, elements: [el] }, root)[0];
      if (abs && abs in files) sheets.push({ file: abs, range: { start: 0, end: files[abs].length } });
    }
  }
  return sheets;
}

function lookup(doc: SourceDoc, edit: Edit): SourceElement {
  const el = doc.byId.get(edit.id);
  if (!el || el.tag.toLowerCase() !== edit.tag.toLowerCase()) {
    throw new EditError(`Element ${edit.id} <${edit.tag}> no longer matches the source`);
  }
  return el;
}

const encodeAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const encodeText = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function setInline(source: string, el: SourceElement, prop: string, value: string): string {
  const current = el.attrs.style;
  if (current === undefined || !el.styleAttr) {
    return splice(source, { start: afterTagName(source, el), end: afterTagName(source, el) }, ` style="${encodeAttr(`${prop}: ${value}`)}"`);
  }
  const existing = readInlineDecls(current).filter((d) => d.prop === prop.toLowerCase()).pop();
  const base = current.replace(/[\s;]*$/, '');
  const next = existing ? splice(current, existing.valueRange, value) : base ? `${base}; ${prop}: ${value}` : `${prop}: ${value}`;
  return splice(source, el.styleAttr, `style="${encodeAttr(next)}"`);
}

interface Candidate {
  sheet: Sheet;
  valueRange: Range;
  value: string;
  weight: number;
  order: number;
  /** Number of document elements the rule applies to. */
  reach: number;
}

function findRuleDecl(doc: SourceDoc, el: SourceElement, sheets: Sheet[], files: Files, prop: string): Candidate | null {
  let best: Candidate | null = null;
  let order = 0;
  for (const sheet of sheets) {
    const css = files[sheet.file].slice(sheet.range.start, sheet.range.end);
    for (const rule of readRules(css)) {
      order++;
      const decl = rule.decls.filter((d) => d.prop === prop).pop();
      const parsed = rule.selectors.map(parseSelector);
      if (!decl) continue;
      let weight = -1;
      for (const sel of parsed) if (sel && matches(el, sel)) weight = Math.max(weight, specificity(sel));
      if (weight < 0) continue;
      if (best && (weight < best.weight || (weight === best.weight && order < best.order))) continue;
      const reach = doc.elements.filter((e) => !e.inHead && parsed.some((s) => s && matches(e, s))).length;
      best = {
        sheet,
        valueRange: { start: decl.valueRange.start + sheet.range.start, end: decl.valueRange.end + sheet.range.start },
        value: decl.value,
        weight,
        order,
        reach,
      };
    }
  }
  return best;
}

function applyStyleProp(files: Files, entry: string, edit: StyleEdit, prop: string, value: string): Files {
  const source = files[entry];
  const doc = mapHtml(source);
  const el = lookup(doc, edit);
  const scope: Scope = edit.scope ?? 'auto';
  const lprop = prop.toLowerCase();

  if (scope !== 'element') {
    const hit = findRuleDecl(doc, el, collectSheets(doc, entry, files), files, lprop);
    if (hit && (scope === 'rule' || hit.reach === 1)) {
      if (hit.value === value) return files;
      const file = hit.sheet.file;
      return { ...files, [file]: splice(files[file], hit.valueRange, value) };
    }
  }
  const next = setInline(source, el, lprop, value);
  return next === source ? files : { ...files, [entry]: next };
}

function applyText(files: Files, entry: string, edit: TextEdit): Files {
  const source = files[entry];
  const doc = mapHtml(source);
  const el = lookup(doc, edit);
  if (!el.endTag) throw new EditError(`<${el.tag}> has no content to edit`);
  if (el.node.childNodes.some((n) => 'tagName' in n)) throw new EditError(`<${el.tag}> contains other elements; edit its children instead`);
  const range = { start: el.startTag.end, end: el.endTag.start };
  const inner = source.slice(range.start, range.end);
  // Keep the indentation/newlines the agent put around the text.
  const lead = /^\s*/.exec(inner)![0];
  const trail = inner.trim() ? /\s*$/.exec(inner)![0] : '';
  const next = splice(source, range, lead + encodeText(edit.text.trim()) + trail);
  return next === source ? files : { ...files, [entry]: next };
}

/** Pure: returns new file contents (unchanged files keep identity). Throws EditError if the edit can't be placed. */
export function applyEdit(files: Files, entry: string, edit: Edit): Files {
  if (edit.kind === 'text') return applyText(files, entry, edit);
  let out = files;
  for (const [prop, value] of Object.entries(edit.props)) {
    if (!/^[a-z-]+$/i.test(prop) || /[;{}]/.test(value)) throw new EditError(`Rejected style ${prop}: ${value}`);
    out = applyStyleProp(out, entry, edit, prop, value);
  }
  return out;
}
