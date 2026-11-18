import type { SourceElement } from './html-map';

/**
 * A deliberately small selector engine: compound selectors of tag/.class/#id/*
 * joined by descendant (' ') or child ('>') combinators. Anything fancier
 * (pseudo-classes, attributes, sibling combinators) parses to null and is never
 * treated as a match, so the patcher falls back to an inline style instead of
 * guessing.
 */
interface Compound {
  tag?: string;
  ids: string[];
  classes: string[];
  /** Relationship to the compound on its left. */
  combinator: ' ' | '>' | null;
}

export type Complex = Compound[];

const TOKEN = /\s*(>)\s*|(\s+)|(\*|[\w-]+)|\.([\w-]+)|#([\w-]+)/y;

export function parseSelector(selector: string): Complex | null {
  const text = selector.trim();
  if (!text) return null;
  const out: Complex = [];
  let cur: Compound | null = null;
  let pending: ' ' | '>' | null = null;
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    const m = TOKEN.exec(text);
    if (!m) return null;
    const [, child, space, tag, cls, id] = m;
    if (child || space) {
      if (!cur) return null;
      pending = child ? '>' : pending ?? ' ';
      cur = null;
      continue;
    }
    if (!cur) {
      cur = { ids: [], classes: [], combinator: out.length ? pending ?? ' ' : null };
      out.push(cur);
      pending = null;
    }
    if (tag) {
      if (cur.tag !== undefined || cur.ids.length || cur.classes.length) return null;
      cur.tag = tag === '*' ? undefined : tag.toLowerCase();
    } else if (cls) cur.classes.push(cls);
    else if (id) cur.ids.push(id);
  }
  if (!cur) return null; // trailing combinator
  return out;
}

function matchCompound(el: SourceElement, c: Compound): boolean {
  if (c.tag && el.tag.toLowerCase() !== c.tag) return false;
  if (c.ids.some((id) => el.attrs.id !== id)) return false;
  return c.classes.every((cls) => el.classes.includes(cls));
}

function matchFrom(el: SourceElement, c: Complex, idx: number): boolean {
  if (!matchCompound(el, c[idx])) return false;
  if (idx === 0) return true;
  if (c[idx].combinator === '>') return !!el.parent && matchFrom(el.parent, c, idx - 1);
  for (let p = el.parent; p; p = p.parent) if (matchFrom(p, c, idx - 1)) return true;
  return false;
}

export function matches(el: SourceElement, complex: Complex): boolean {
  return matchFrom(el, complex, complex.length - 1);
}

/** [ids, classes, tags] packed into one comparable number. */
export function specificity(complex: Complex): number {
  let a = 0;
  let b = 0;
  let c = 0;
  for (const comp of complex) {
    a += comp.ids.length;
    b += comp.classes.length;
    if (comp.tag) c += 1;
  }
  return a * 1_000_000 + b * 1_000 + c;
}
