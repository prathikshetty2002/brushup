import { parse } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';

type Element = DefaultTreeAdapterMap['element'];
type ChildNode = DefaultTreeAdapterMap['childNode'];

export interface Range {
  start: number;
  end: number;
}

export interface SourceElement {
  id: string;
  tag: string;
  node: Element;
  parent: SourceElement | null;
  startTag: Range;
  endTag: Range | null;
  attrs: Record<string, string>;
  classes: string[];
  /** Span of the whole `style="..."` attribute in the source, if present. */
  styleAttr: Range | null;
  inHead: boolean;
  /** 1-based line of the start tag. */
  line: number;
}

export interface SourceDoc {
  source: string;
  elements: SourceElement[];
  byId: Map<string, SourceElement>;
}

/** Parse HTML and give every element that exists in the source a stable id (document order). */
export function mapHtml(source: string): SourceDoc {
  const document = parse(source, { sourceCodeLocationInfo: true });
  const elements: SourceElement[] = [];
  const byId = new Map<string, SourceElement>();
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) lineStarts.push(i + 1);

  const lineOf = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const walk = (nodes: ChildNode[], parent: SourceElement | null, inHead: boolean) => {
    for (const node of nodes) {
      if (!('tagName' in node)) continue;
      const loc = node.sourceCodeLocation;
      let current = parent;
      let head = inHead || node.tagName === 'head';
      // Elements the parser invented (implied tbody, missing html/head/body) have no location.
      if (loc && loc.startTag) {
        const attrs: Record<string, string> = {};
        for (const a of node.attrs) attrs[a.name] = a.value;
        const styleLoc = loc.attrs?.style;
        const el: SourceElement = {
          id: `a${elements.length}`,
          tag: node.tagName,
          node,
          parent,
          startTag: { start: loc.startTag.startOffset, end: loc.startTag.endOffset },
          endTag: loc.endTag ? { start: loc.endTag.startOffset, end: loc.endTag.endOffset } : null,
          attrs,
          classes: (attrs.class ?? '').split(/\s+/).filter(Boolean),
          styleAttr: styleLoc ? { start: styleLoc.startOffset, end: styleLoc.endOffset } : null,
          inHead: head,
          line: lineOf(loc.startTag.startOffset),
        };
        elements.push(el);
        byId.set(el.id, el);
        current = el;
      }
      const kids = node.tagName === 'template' ? [] : node.childNodes;
      walk(kids, current, head);
    }
  };
  walk(document.childNodes, null, false);
  return { source, elements, byId };
}

/** Offset just after the tag name in the start tag, where new attributes can be inserted. */
export function afterTagName(source: string, el: SourceElement): number {
  const m = /^<[^\s/>]+/.exec(source.slice(el.startTag.start, el.startTag.end));
  return el.startTag.start + (m ? m[0].length : 1 + el.tag.length);
}

/** Serve-time copy of the page: every body element gets `data-brushup-id`. */
export function annotate(doc: SourceDoc): string {
  const inserts = doc.elements
    .filter((el) => !el.inHead)
    .map((el) => ({ at: afterTagName(doc.source, el), text: ` data-brushup-id="${el.id}"` }))
    .sort((a, b) => b.at - a.at);
  let out = doc.source;
  for (const { at, text } of inserts) out = out.slice(0, at) + text + out.slice(at);
  return out;
}
