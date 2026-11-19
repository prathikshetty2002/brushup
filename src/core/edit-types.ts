/**
 * Edits the canvas can ask the server to make. Elements are addressed by the
 * `data-brushup-id` the server injects when serving the page; `tag` is a sanity
 * check that the id still points at the element the user clicked.
 */
export type Scope = 'auto' | 'element' | 'rule';

/** What the canvas saw on the element, so the server can find it again if the source shifted under its line:col. */
export interface Ident {
  /** The element's rendered `class` attribute. */
  cls?: string;
  /** Its rendered text, whitespace-collapsed. */
  text?: string;
}

export interface StyleEdit {
  kind: 'style';
  ident?: Ident;
  /** Build-time version token of the element's tag (`file hash . fingerprint . n . of`), so the server can tell if it moved. */
  ver?: string;
  stale?: Staleness;
  id: string;
  tag: string;
  props: Record<string, string>;
  /**
   * element: always write an inline style on this element only.
   * rule:    edit the winning CSS rule that declares the property (affects every match).
   * auto:    edit the rule only if it targets this single element, else inline.
   */
  scope?: Scope;
  /**
   * A Tailwind variant to write the change under (`md` writes `md:ml-4`), so it applies from that screen size up. Only Tailwind
   * classes can carry it: with no className to write into, or a computed one, the edit is refused rather than written for every size.
   */
  variant?: string;
  /** Facts the canvas knows from the live page that the source alone can't tell us. */
  hints?: {
    /** Current line-height as a unitless ratio, so changing font-size doesn't silently change spacing. */
    lineHeight?: string;
    /** The page's root font size in px. Tailwind's spacing units are rem, so on-scale values are only written as plain utilities when this is 16. */
    rootPx?: number;
    /** Names of the page's theme colours (`--color-ink` is `ink`), sent with a colour edit. */
    colorTokens?: string[];
  };
}

export interface TextEdit {
  kind: 'text';
  ver?: string;
  /** Which of the elements rendered from the same JSX this was (list items from one `.map`), in document order. */
  instance?: number;
  /** The text as it was on the page before the edit, to check it still matches the data it is written from. */
  was?: string;
  /** The version token of `fallback`. */
  fallbackVer?: string;
  stale?: Staleness;
  /** Where the text is edited: the component usage when there is one (`<Button>Save</Button>`), else the host element. */
  id: string;
  /** The host element's own reference, tried when the usage site doesn't hold the text itself. */
  fallback?: string;
  ident?: Ident;
  tag: string;
  text: string;
}

/** Take an element out of the source, write a copy right after it, swap it with a neighbour, or wrap it in a `<div>`. */
export interface StructureEdit {
  kind: 'delete' | 'duplicate' | 'moveUp' | 'moveDown' | 'wrap';
  ver?: string;
  stale?: Staleness;
  id: string;
  tag: string;
  ident?: Ident;
}

/** Set the `src` or `alt` of an image. Only these two, and only to a plain string. */
export interface AttrEdit {
  kind: 'attr';
  ver?: string;
  stale?: Staleness;
  id: string;
  tag: string;
  ident?: Ident;
  name: 'src' | 'alt';
  value: string;
}

export type Edit = StyleEdit | TextEdit | StructureEdit | AttrEdit;

/** Where an edit ended up, so the canvas knows how long its temporary preview must live. */
export type Target = 'inline' | 'rule' | 'class' | 'text' | 'structure' | 'attribute';

export class EditError extends Error {}

/** The element the canvas meant is no longer where the page says, and the source can't say which one it was now. */
export class StaleElement extends EditError {}

/** How the file compares with the one the page was rendered from (set by the server, never trusted from a client). */
export type Staleness = 'none' | 'own' | 'external';
