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
  id: string;
  tag: string;
  props: Record<string, string>;
  /**
   * element: always write an inline style on this element only.
   * rule:    edit the winning CSS rule that declares the property (affects every match).
   * auto:    edit the rule only if it targets this single element, else inline.
   */
  scope?: Scope;
  /** Facts the canvas knows from the live page that the source alone can't tell us. */
  hints?: {
    /** Current line-height as a unitless ratio, so changing font-size doesn't silently change spacing. */
    lineHeight?: string;
    /** The page's root font size in px. Tailwind's spacing units are rem, so on-scale values are only written as plain utilities when this is 16. */
    rootPx?: number;
  };
}

export interface TextEdit {
  kind: 'text';
  /** Where the text is edited: the component usage when there is one (`<Button>Save</Button>`), else the host element. */
  id: string;
  /** The host element's own reference, tried when the usage site doesn't hold the text itself. */
  fallback?: string;
  ident?: Ident;
  tag: string;
  text: string;
}

export type Edit = StyleEdit | TextEdit;

/** Where an edit ended up, so the canvas knows how long its temporary preview must live. */
export type Target = 'inline' | 'rule' | 'class' | 'text';

export class EditError extends Error {}
