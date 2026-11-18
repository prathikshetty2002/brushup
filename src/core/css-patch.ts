import postcss from 'postcss';
import type { Range } from './html-map';

export interface CssDecl {
  prop: string;
  value: string;
  /** Span of the value text only, relative to the parsed css string. */
  valueRange: Range;
}

export interface CssRule {
  selectors: string[];
  decls: CssDecl[];
}

function declsOf(container: postcss.Container): CssDecl[] {
  const out: CssDecl[] = [];
  container.each((node) => {
    if (node.type !== 'decl' || node.source?.start?.offset === undefined) return;
    const valueText = node.raws.value?.raw ?? node.value;
    const start = node.source.start.offset + node.prop.length + (node.raws.between?.length ?? 0);
    out.push({ prop: node.prop.toLowerCase(), value: node.value, valueRange: { start, end: start + valueText.length } });
  });
  return out;
}

/**
 * Top-level rules only. Rules nested in @media/@supports/@keyframes apply
 * conditionally, so editing them for an unconditional canvas tweak would be wrong.
 */
export function readRules(css: string): CssRule[] {
  let root: postcss.Root;
  try {
    root = postcss.parse(css);
  } catch {
    return [];
  }
  const rules: CssRule[] = [];
  root.each((node) => {
    if (node.type === 'rule') rules.push({ selectors: node.selectors, decls: declsOf(node) });
  });
  return rules;
}

/** Declarations inside a `style="..."` attribute value. */
export function readInlineDecls(style: string): CssDecl[] {
  try {
    return declsOf(postcss.parse(style));
  } catch {
    return [];
  }
}

export function splice(text: string, range: Range, replacement: string): string {
  return text.slice(0, range.start) + replacement + text.slice(range.end);
}
