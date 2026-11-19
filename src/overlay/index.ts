import type { Edit, Scope, Target } from '../core/edit-types';
import type { Note } from '../server/notes';
import { moveBase, moveProps, type MoveBase } from './drag';
import { explainSize, handleLabel, handleProps, sizeProps, type BoxStart, type HandleKind, type SizeStyle } from './handles-math';
import { morphPage, refreshStylesheets } from './morph';
import { accessibleName, backdrop, contrastRatio, parseColor, RULES, scanPage, type A11yIssue } from './a11y';
import { DESIGN_RULES, scanDesign } from './design';
import { createPanel, type HandleInfo, type Mode, type NoteDraft, type NoteKind, type NoteView, type ChangesView, type SavingsView, type A11yView, type IgnoredView, type LayerView } from './panel';

interface Boot {
  /** 'static': Brushup serves one HTML page. 'dev': a framework dev server serves the app. */
  mode: 'static' | 'dev';
  hash: string;
  ws?: string;
}

declare global {
  interface Window {
    __brushup: Boot;
  }
}

interface Result {
  ok: boolean;
  error?: string;
  hash?: string;
  target?: Target;
  warning?: string;
  /** The file changed under the page and the server couldn't tell which element was meant. */
  stale?: boolean;
  /** The server couldn't find where this text is written in the source. */
  textSource?: boolean;
  /** The server understood the edit and declined to write it (a `.map()` item, a computed className, …), with the reason in `error`. */
  refused?: boolean;
  /** Answer to a `changes` request. */
  changes?: ChangesView;
  savings?: SavingsView;
  /** Where the edited element now is (`file:line:col`), when the edit moved it. */
  select?: string;
  /** An uploaded image: what to write as its `src`, and the file it was saved as. */
  src?: string;
  saved?: string;
}

// Config comes from `window.__brushup` (static server, Vite plugin) or, for frameworks that render a plain
// <script src> tag (Next.js), from that script tag's data attributes.
const self = document.currentScript as HTMLScriptElement | null;
const cfg: Boot = window.__brushup ?? { mode: self?.dataset.brushupMode === 'dev' ? 'dev' : 'static', hash: '', ws: self?.dataset.brushupWs };
const DEV = cfg.mode === 'dev';

/**
 * How a DOM element is tied to source:
 *  static mode: `data-brushup-id`, a synthetic id the server stamps on every element.
 *  dev mode:    `data-brushup-src` (file:line:col of the host element) and, for elements
 *               rendered by a component (shadcn `<Button>`), `data-brushup-use`
 *               (file:line:col#Name of the place the component was used).
 */
const SRC = 'data-brushup-src';
const USE = 'data-brushup-use';
const SV = 'data-brushup-sv';
const UV = 'data-brushup-uv';
const SID = 'data-brushup-id';
const TAGGED = DEV ? `[${SRC}],[${USE}]` : `[${SID}]`;
/** The reference edits are addressed to: the usage site when there is one, else the host element. */
const refOf = (el: Element) => (DEV ? (el.getAttribute(USE) ?? el.getAttribute(SRC)!) : el.getAttribute(SID)!);
const fallbackOf = (el: Element) => (DEV && el.hasAttribute(USE) ? (el.getAttribute(SRC) ?? undefined) : undefined);

const state = {
  hash: cfg.hash,
  mode: 'edit' as Mode,
  hovered: null as HTMLElement | null,
  editing: null as HTMLElement | null,
  reloadPending: false,
};

/* ---------- transport ---------- */

let ws: WebSocket;
let seq = 0;
const waiting = new Map<number, (r: Result) => void>();

function rpc(msg: Record<string, unknown>): Promise<Result> {
  return new Promise((resolve) => {
    if (ws?.readyState !== WebSocket.OPEN) return resolve({ ok: false, error: 'Not connected to the Brushup server' });
    const n = ++seq;
    waiting.set(n, resolve);
    ws.send(JSON.stringify({ ...msg, n }));
  });
}

// Edits are sent one at a time: each is based on the hash the previous one produced.
let queue: Promise<unknown> = Promise.resolve();
const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
};

function connect() {
  ws = new WebSocket(cfg.ws ?? `ws://${location.host}/__brushup/ws`);
  ws.onopen = () => panel.setStatus('');
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'result') {
      if (msg.hash) state.hash = msg.hash;
      waiting.get(msg.n)?.(msg);
      waiting.delete(msg.n);
    } else if (msg.type === 'reload') {
      freshListeners.forEach((f) => f());
      state.hash = msg.hash;
      void reload(!!msg.css);
      if (panel.changesOpen()) refreshChanges();
      if (panel.layersOpen()) setTimeout(refreshLayers, 300);
      if (panel.a11yOpen()) setTimeout(scanA11y, 400);
    } else if (msg.type === 'hmr') {
      freshListeners.forEach((f) => f());
      if (previews.size) settleSoon(250); // the dev server is hot-updating the page; our temporary previews can go once it lands
    } else if (msg.type === 'notes') {
      notes = msg.notes as Note[];
      refreshNotes(true);
    } else if (msg.type === 'ignored') {
      ignoredChecks = msg.items as typeof ignoredChecks;
      if (panel.a11yOpen()) scanA11y(); // otherwise the next time the tab opens, which scans anyway
    } else if (msg.type === 'info') {
      panel.setRoot(String(msg.root ?? ''));
      refreshPanel();
    } else if (msg.type === 'ask') {
      answerAsk(msg);
    }
  };
  ws.onclose = () => {
    panel.setStatus('Disconnected, retrying…', 'err');
    waiting.forEach((r) => r({ ok: false, error: 'Disconnected' }));
    waiting.clear();
    setTimeout(connect, 1000);
  };
}

/* ---------- live sync (file -> canvas) ---------- */

let reloading = false;
let reloadAgain = false;
async function reload(css: boolean) {
  if (DEV) {
    // The dev server's own HMR repaints the page; we only need to refresh the panel afterwards.
    setTimeout(refreshPanel, 300);
    return;
  }
  if (state.editing) return void (state.reloadPending = true);
  if (reloading) return void (reloadAgain = true);
  reloading = true;
  try {
    const html = await (await fetch('/__brushup/page', { cache: 'no-store' })).text();
    const next = new DOMParser().parseFromString(html, 'text/html');
    if (morphPage(next) === 'reload') return location.reload();
    if (css) refreshStylesheets();
    state.reloadPending = false;
    // Wait a frame so stylesheet swaps settle before we read computed styles.
    requestAnimationFrame(refreshPanel);
  } catch {
    /* server restarting; the websocket reconnect will trigger another reload */
  } finally {
    reloading = false;
    if (reloadAgain) {
      reloadAgain = false;
      void reload(css);
    }
  }
}

/* ---------- selection ---------- */

// Several DOM nodes can share one source location (list items, reused components),
// so selection is the node itself, re-found by (source ref, nth instance) if it is replaced.
const instances = (ref: string) => [...document.querySelectorAll<HTMLElement>(TAGGED)].filter((e) => refOf(e) === ref);
const tagOf = (el: HTMLElement) => el.tagName.toLowerCase();
/** The build's version token for the tag an edit is addressed to (the usage site if there is one, else the element). */
const verOf = (el: Element) => (DEV ? (el.hasAttribute(USE) ? el.getAttribute(UV) : el.getAttribute(SV)) ?? undefined : undefined);
/** Waits for the dev server's next hot update (which re-stamps the tags), or `ms`. */
const freshListeners = new Set<() => void>();
const nextFresh = (ms: number) =>
  new Promise<void>((resolve) => {
    const done = () => (freshListeners.delete(done), clearTimeout(timer), resolve());
    const timer = setTimeout(done, ms);
    freshListeners.add(done);
  });
/** What the element looks like right now, so the server can find it again if its source line moved. */
const identOf = (el: HTMLElement, withText = true) => ({
  cls: (el.getAttribute('class') ?? '').trim().slice(0, 600),
  ...(withText ? { text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) } : {}),
});
const isOurs = (e: Event) => e.composedPath().includes(panel.host);

/** One selected element: the node itself, plus how to find it again if React/HMR replaces it. */
interface Sel {
  el: HTMLElement;
  key: string;
  index: number;
}
let sels: Sel[] = [];
const makeSel = (el: HTMLElement): Sel => ({ el, key: refOf(el), index: Math.max(0, instances(refOf(el)).indexOf(el)) });

function resolveSel(s: Sel): HTMLElement | null {
  if (s.el.isConnected && refOf(s.el) === s.key) return s.el;
  const all = instances(s.key);
  const el = all[s.index] ?? all[0] ?? null;
  if (el) s.el = el;
  return el;
}

/** Every selected element still on the page. The last one is the primary (what the panel and handles show). */
const selectedAll = () => sels.map(resolveSel).filter((e): e is HTMLElement => !!e);
const selected = (): HTMLElement | null => {
  const all = selectedAll();
  return all[all.length - 1] ?? null;
};
const movable = () => selectedAll().filter((e) => e !== document.body && e !== document.documentElement);

/** `Button · page.tsx:30` for a component usage, `page.tsx:21` for a plain element. */
/** Where the selected element is written, from its build tag: shown as `<Button> · page.tsx:32`, openable in an editor. */
function sourceOf(el: HTMLElement): { prefix: string; shown: string; path: string; line: number; col: number } | null {
  const ref = el.getAttribute(USE) ?? el.getAttribute(SRC);
  if (!ref) return null;
  const [loc, name] = ref.split('#');
  const m = /^(.*):(\d+):(\d+)$/.exec(loc);
  if (!m) return null;
  return { prefix: name ? `<${name}> · ` : '', shown: `${m[1].replace(/^.*\//, '')}:${m[2]}`, path: m[1], line: Number(m[2]), col: Number(m[3]) };
}

const SECTION_TAGS = new Set(['section', 'main', 'header', 'footer', 'nav', 'aside', 'article', 'form']);
const suggestKind = (el: HTMLElement): NoteKind => (el.hasAttribute(USE) ? 'component' : SECTION_TAGS.has(tagOf(el)) ? 'section' : 'element');

function refreshPanel() {
  const el = selected();
  const detail = sels.length > 1 ? `${sels.length} elements selected` : '';
  if (el) panel.setThemeColors(themeColors());
  panel.show(el, detail || undefined, el ? `<${tagOf(el)}>` : '', el ? suggestKind(el) : 'element', el && DEV ? sourceOf(el) : null);
}

/** Select `el`; with `add` (Shift+click) toggle it in or out of the current selection instead. */
function select(el: HTMLElement | null, add = false) {
  if (!el) sels = [];
  else if (add) {
    const i = sels.findIndex((s) => s.el === el);
    if (i >= 0) sels.splice(i, 1);
    else sels.push(makeSel(el));
  } else sels = [makeSel(el)];
  announceSelection();
}

/** Show the selection in the panel and tell the server (and through it, the agent) which element is selected. */
function announceSelection() {
  refreshPanel();
  if (panel.layersOpen()) panel.setLayerSelection(selectedAll().map(layerKey));
  const primary = selected();
  ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'select', selection: primary ? { id: refOf(primary), tag: tagOf(primary) } : null }));
}

/* ---------- notes ---------- */

let notes: Note[] = [];
const resolved = new Map<string, HTMLElement | null>();
let notesSig = '';
let domDirty = false;
let lastRefresh = 0;
let lastPath = location.pathname;

const ownText = (el: Element) =>
  [...el.childNodes]
    .filter((c) => c.nodeType === Node.TEXT_NODE)
    .map((c) => c.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

function anchorFor(el: HTMLElement) {
  const ref = refOf(el);
  return {
    tag: tagOf(el),
    classes: [...el.classList].slice(0, 40),
    text: (ownText(el) || (el.textContent ?? '').replace(/\s+/g, ' ').trim()).slice(0, 80),
    src: DEV ? (el.getAttribute(SRC) ?? undefined) : undefined,
    use: DEV ? (el.getAttribute(USE) ?? undefined) : undefined,
    // Static mode: the server swaps this synthetic id for a file:line when it saves the note.
    sid: DEV ? undefined : ref,
    index: Math.max(0, instances(ref).indexOf(el)),
    page: location.pathname,
  };
}

/** Find a note's element: by exact source tags when the build stamped them, else by fingerprint. */
function resolveNote(n: Note): HTMLElement | null {
  const a = n.anchor;
  const ref = DEV ? (a.use ?? a.src) : undefined;
  if (ref) {
    const all = instances(ref);
    if (all.length) return all[a.index] ?? all[0];
  }
  const want = a.text.slice(0, 40);
  const candidates = [...document.querySelectorAll<HTMLElement>(a.tag)].filter(
    (el) =>
      !el.closest('#brushup-root') &&
      a.classes.every((c) => el.classList.contains(c)) &&
      (!want || ownText(el).startsWith(want) || (el.textContent ?? '').replace(/\s+/g, ' ').trim().startsWith(want)),
  );
  return candidates[a.index] ?? candidates[0] ?? null;
}

const refreshChanges = () => void rpc({ type: 'changes' }).then((r) => panel.setChanges(r.ok ? (r.changes ?? null) : null, r.ok ? r.savings : undefined));

/** Re-resolve every note on this page and refresh the list. `force` redraws even if nothing visible changed. */
function refreshNotes(force = false) {
  lastRefresh = Date.now();
  lastPath = location.pathname;
  const here = notes.filter((n) => n.anchor.page === location.pathname);
  resolved.clear();
  const views: NoteView[] = here.map((n) => {
    const el = resolveNote(n);
    resolved.set(n.id, el);
    return { id: n.id, n: notes.indexOf(n) + 1, kind: n.kind, label: n.label, text: n.text, done: n.status === 'done', reply: n.reply, found: !!el };
  });
  const sig = JSON.stringify([views, notes.length - here.length]);
  if (force || sig !== notesSig) {
    notesSig = sig;
    panel.setNotes(views, notes.length - here.length);
  }
}

function pinsNow() {
  return notes
    .filter((n) => resolved.has(n.id))
    .map((n) => {
      const el = resolved.get(n.id);
      return { id: n.id, n: notes.indexOf(n) + 1, rect: el?.isConnected ? el.getBoundingClientRect() : null, done: n.status === 'done' };
    });
}

function locateNote(id: string) {
  const el = resolved.get(id);
  if (!el) return;
  select(el);
  el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
}

async function saveNote(draft: NoteDraft, id: string | null, status?: 'open' | 'done', target?: HTMLElement) {
  const existing = id ? notes.find((n) => n.id === id) : undefined;
  const el = target ?? selected();
  if (!existing && !el) return panel.setStatus('Select an element first', 'err');
  const note = { id: existing?.id, kind: draft.kind, label: draft.label, text: draft.text, status: status ?? existing?.status ?? 'open', anchor: existing?.anchor ?? anchorFor(el!) };
  const r = await rpc({ type: 'note-save', note });
  if (r.ok) panel.setStatus(existing ? 'Note updated' : 'Note saved', 'ok');
  else panel.setStatus(r.error ?? 'Could not save the note', 'err');
}

/**
 * A text edit the source can't take (the words come from a database, a prop passed in from elsewhere, built by code):
 * don't lose the user's intent, pin it as a note on the element for Claude to carry out.
 */
async function noteForTextChange(el: HTMLElement, wanted: string, was: string, why: string) {
  const text = `Change this text to “${wanted}” (it says “${was.trim()}”).\nBrushup couldn't write it into the source: ${why}`.slice(0, 3900);
  if (notes.some((n) => n.status === 'open' && n.text === text)) return panel.setStatus('There is already a note for this change', 'warn');
  await saveNote({ kind: suggestKind(el), label: 'Text change', text }, null, 'open', el);
  panel.setStatus("Couldn't change the source, so a note for Claude was pinned instead", 'warn');
}

/* ---------- accessibility ---------- */

let a11yIssues = new Map<string, A11yIssue>();
const ruleSource = (rule: string) => {
  const r = [...RULES, ...DESIGN_RULES].find((x) => x.rule === rule) as { learn?: string; basis?: string; strength?: 'standard' | 'guideline' | 'convention' } | undefined;
  return { learn: r?.learn, basis: r?.basis, strength: r?.strength };
};
/** Checks the user dismissed, kept with the project by the server. */
let ignoredChecks: { key: string; scope: 'one' | 'kind'; rule: string; label: string; page: string }[] = [];
const ruleLabel = (rule: string) => [...RULES, ...DESIGN_RULES].find((r) => r.rule === rule)?.label ?? rule;
const ignoreKey = (i: A11yIssue) => `${i.rule}|${labelOf(i.el)}|${location.pathname}`;
const kindKey = (rule: string) => `kind|${rule}`;
const isIgnored = (i: A11yIssue) => {
  const keys = new Set(ignoredChecks.map((c) => c.key));
  return keys.has(kindKey(i.rule)) || keys.has(ignoreKey(i));
};

function scanA11y() {
  const ignore = (el: Element) => el === panel.host || panel.host.contains(el) || el.closest('#brushup-root') !== null;
  const found = [...scanPage(document, ignore), ...scanDesign(document, ignore)].filter((i) => !isIgnored(i));
  a11yIssues = new Map(found.map((i) => [i.id, i]));
  const views: A11yView[] = found.map((i) => ({ id: i.id, element: labelOf(i.el), category: DESIGN_RULES.some((r) => r.rule === i.rule) ? ('design' as const) : ('accessibility' as const), rule: i.rule, title: i.title, detail: i.detail, fix: i.fix?.label, ...ruleSource(i.rule) }));
  const ignoredViews: IgnoredView[] = ignoredChecks.map((c) => ({ key: c.key, label: c.scope === 'kind' ? `All “${ruleLabel(c.rule)}” suggestions` : `${ruleLabel(c.rule)}: ${c.label}` }));
  panel.setA11y(views, ignoredViews);
}

async function ignoreCheck(id: string, scope: 'one' | 'kind') {
  const issue = a11yIssues.get(id);
  if (!issue) return;
  const item = scope === 'kind' ? { key: kindKey(issue.rule), scope, rule: issue.rule, label: ruleLabel(issue.rule), page: '' } : { key: ignoreKey(issue), scope, rule: issue.rule, label: labelOf(issue.el), page: location.pathname };
  const r = await rpc({ type: 'ignore-add', item });
  if (!r.ok) panel.setStatus(r.error ?? 'Could not ignore that', 'err');
  else panel.setStatus(scope === 'kind' ? `Ignoring all “${ruleLabel(issue.rule)}” suggestions. Restore them from the Ignored list.` : 'Ignored. Restore it from the Ignored list.', 'ok');
}

async function restoreCheck(key: string) {
  const r = await rpc({ type: 'ignore-remove', key });
  if (!r.ok) panel.setStatus(r.error ?? 'Could not restore that', 'err');
}
/** An element in a few words for a list of issues: `<p> “Privacy · Terms”`, `<img> logo.png`, `<div> .card`. */
function labelOf(el: HTMLElement): string {
  const tag = tagOf(el);
  if (el instanceof HTMLImageElement) return `<img> ${(el.getAttribute('src') ?? '').split('/').pop()?.split('?')[0].slice(0, 32) ?? ''}`.trim();
  if (el === document.documentElement || el === document.body) return `<${tag}> (the whole page)`;
  // innerText puts a break between blocks (so "Drag to place" and "Move any element" don't run together); textContent is the fallback.
  const text = (ownText(el) || ((el.innerText ?? el.textContent) ?? '').replace(/\s+/g, ' ').trim()).slice(0, 28);
  if (text) return `<${tag}> “${text}”`;
  const hint = el.id ? `#${el.id}` : el.getAttribute('aria-label') ? `“${el.getAttribute('aria-label')!.slice(0, 28)}”` : el.classList[0] ? `.${el.classList[0]}` : '';
  return `<${tag}>${hint ? ` ${hint}` : ''}`;
}

/** The nearest element Brushup tagged, which is the one whose source it can edit. */
const editableFor = (el: HTMLElement) => el.closest<HTMLElement>(TAGGED);

function locateA11y(id: string) {
  const issue = a11yIssues.get(id);
  if (!issue) return;
  issue.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const target = editableFor(issue.el);
  if (target) select(target);
  else panel.setStatus("Brushup can't tell which source this element comes from", 'warn');
}

async function fixA11y(id: string) {
  const issue = a11yIssues.get(id);
  if (!issue?.fix) return;
  const target = editableFor(issue.el);
  if (!target) return panel.setStatus("Brushup can't tell where this is written, so use Send to Claude instead", 'warn');
  select(target);
  await commitStyle(target, issue.fix.props, 'auto', ''); // a fix is for the problem as it is, at every size
  setTimeout(scanA11y, 700); // let the page settle, then show what is left
}

async function noteA11y(id: string) {
  const issue = a11yIssues.get(id);
  if (!issue) return;
  const target = editableFor(issue.el) ?? issue.el;
  const design = DESIGN_RULES.some((r) => r.rule === issue.rule);
  const text = `${design ? 'Design' : 'Accessibility'}: ${issue.title}. ${issue.detail}`.slice(0, 3900);
  if (notes.some((n) => n.status === 'open' && n.text === text)) return panel.setStatus('There is already a note for this', 'warn');
  await saveNote({ kind: suggestKind(target), label: design ? 'Design' : 'Accessibility', text }, null, 'open', target);
}

/* ---------- questions from agents (MCP) ---------- */

const styleOf = (cs: CSSStyleDeclaration, props: string[]) => Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p).trim()]));
const round1 = (n: number) => Math.round(n * 10) / 10;

function overflowOf(el: HTMLElement, cs: CSSStyleDeclaration) {
  const pastX = Math.max(0, el.scrollWidth - el.clientWidth);
  const pastY = Math.max(0, el.scrollHeight - el.clientHeight);
  return {
    setting: `${cs.overflowX} / ${cs.overflowY}`,
    clipped: { x: cs.overflowX !== 'visible' && pastX > 1, y: cs.overflowY !== 'visible' && pastY > 1 },
    contentPastBoxPx: { x: pastX, y: pastY },
  };
}

/** What an agent can't see from source alone: how the element actually renders right now. */
function inspectElement(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const parent = el.parentElement;
  const pcs = parent ? getComputedStyle(parent) : null;
  return {
    page: location.pathname,
    tag: tagOf(el),
    // Component libraries (shadcn) carry dozens of classes; the first dozen identify the element.
    classes: [...el.classList].slice(0, 12),
    classesTotal: el.classList.length,
    text: (ownText(el) || (el.textContent ?? '').replace(/\s+/g, ' ').trim()).slice(0, 160),
    source: { src: el.getAttribute(SRC) ?? undefined, use: el.getAttribute(USE) ?? undefined, instances: DEV ? instances(refOf(el)).length : undefined },
    box: { x: round1(r.x), y: round1(r.y), width: round1(r.width), height: round1(r.height), viewport: { width: innerWidth, height: innerHeight }, inViewport: r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth },
    // `clipped` is the useful signal (content is hidden or needs scrolling). `contentPastBoxPx` is how far content
    // extends beyond the box: a few px is just font metrics (glyphs taller than the line-height) and harmless when overflow is visible.
    overflow: overflowOf(el, cs),
    layout: styleOf(cs, ['display', 'position', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap', 'grid-template-columns', 'overflow', 'z-index']),
    size: styleOf(cs, ['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'box-sizing']),
    spacing: styleOf(cs, ['margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left']),
    typography: styleOf(cs, ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'color']),
    appearance: styleOf(cs, ['background-color', 'border', 'border-radius', 'box-shadow', 'opacity']),
    parent: parent && pcs ? { tag: tagOf(parent), classes: [...parent.classList].slice(0, 8), display: pcs.display, width: pcs.width } : null,
    childElementCount: el.childElementCount,
    ...inspectMore(el, cs, r),
  };
}

/** A short, human-readable path to the element, for when source tags are missing: `main > section.hero > h1`. */
function selectorOf(el: Element): string {
  const parts: string[] = [];
  for (let n: Element | null = el; n && n !== document.documentElement && parts.length < 4; n = n.parentElement) {
    const cls = [...n.classList].slice(0, 2).map((c) => `.${c}`).join('');
    parts.unshift(`${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : cls}`);
  }
  return parts.join(' > ');
}

/** What an agent usually asks a screenshot for, as numbers: what it is called, how readable it is, and what is on top of it. */
function inspectMore(el: HTMLElement, cs: CSSStyleDeclaration, r: DOMRect) {
  const out: Record<string, unknown> = {};
  out.handle = { selector: selectorOf(el), mappedToSource: DEV ? el.hasAttribute(SRC) || el.hasAttribute(USE) : el.hasAttribute(SID) };
  const name = accessibleName(el);
  out.accessibility = { role: el.getAttribute('role') ?? el.tagName.toLowerCase(), name: name || null, focusable: el.matches('a[href], button, input, select, textarea, [tabindex]'), hidden: el.closest('[aria-hidden=true]') !== null };
  if (ownText(el)) {
    const fg = parseColor(cs.color);
    const bg = backdrop(el);
    if (fg && bg) {
      const text = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
      const size = parseFloat(cs.fontSize);
      const large = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight, 10) >= 700);
      const ratio = contrastRatio(text, bg);
      out.contrast = { ratio: Math.round(ratio * 100) / 100, required: large ? 3 : 4.5, passes: ratio >= (large ? 3 : 4.5), largeText: large };
    } else out.contrast = { note: 'The background is an image or gradient, so the ratio can’t be measured.' };
  }
  if (r.width && r.height) {
    // The element at its centre: if it isn't this one (or something inside it), something is on top of it.
    const top = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    if (top && top !== el && !el.contains(top) && !top.contains(el) && !panel.host.contains(top)) out.coveredAtCenterBy = describeEl(top as HTMLElement);
    // Other elements overlapping its box that are not its ancestors or descendants.
    const area = r.width * r.height;
    const overlaps: { el: ReturnType<typeof describeEl>; coversPercent: number }[] = [];
    for (const o of document.querySelectorAll<HTMLElement>(TAGGED)) {
      if (o === el || o.contains(el) || el.contains(o) || panel.host.contains(o) || overlaps.length > 40) continue;
      const b = o.getBoundingClientRect();
      const w = Math.min(r.right, b.right) - Math.max(r.left, b.left);
      const h = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
      if (w > 0 && h > 0 && (w * h) / area > 0.08) overlaps.push({ el: describeEl(o), coversPercent: Math.round(((w * h) / area) * 100) });
    }
    if (overlaps.length) out.overlappedBy = overlaps.sort((a, b) => b.coversPercent - a.coversPercent).slice(0, 3);
  }
  return out;
}

/** An element in a few words, with where it is written, for answers that name other elements. */
function describeEl(el: HTMLElement) {
  return { tag: tagOf(el), classes: [...el.classList].slice(0, 4), text: (ownText(el) || (el.textContent ?? '').replace(/\s+/g, ' ').trim()).slice(0, 60) || undefined, source: el.getAttribute(SRC) ?? el.getAttribute(USE) ?? undefined };
}

/* ---------- console (for agents) ---------- */

interface ConsoleEntry {
  level: 'error' | 'warn';
  at: string;
  message: string;
  stack?: string;
}
const consoleLog: ConsoleEntry[] = [];
const note = (level: ConsoleEntry['level'], message: string, stack?: string) => {
  consoleLog.push({ level, at: new Date().toISOString(), message: message.slice(0, 600), ...(stack ? { stack: stack.split('\n').slice(0, 4).join('\n').slice(0, 500) } : {}) });
  if (consoleLog.length > 100) consoleLog.shift();
};
const argsText = (args: unknown[]) => args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ');
for (const level of ['error', 'warn'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    note(level, argsText(args), args.find((a): a is Error => a instanceof Error)?.stack);
    original(...args);
  };
}
window.addEventListener('error', (e) => note('error', e.message || 'Script error', e.error?.stack));
window.addEventListener('unhandledrejection', (e) => note('error', `Unhandled promise rejection: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`, e.reason instanceof Error ? e.reason.stack : undefined));

/** The Checks tab's findings, for an agent: where each is written, what is wrong, and the edit that would fix it. */
function checkPage(ask: { category?: string; rule?: string; limit?: number }) {
  const ignore = (el: Element) => el === panel.host || panel.host.contains(el) || el.closest('#brushup-root') !== null;
  const everything = [...scanPage(document, ignore), ...scanDesign(document, ignore)];
  const all = everything.filter((i) => !isIgnored(i));
  const category = (i: A11yIssue) => (DESIGN_RULES.some((r) => r.rule === i.rule) ? 'design' : 'accessibility');
  const wanted = all.filter((i) => (!ask.category || ask.category === 'all' || category(i) === ask.category) && (!ask.rule || i.rule === ask.rule));
  const limit = Math.min(Math.max(Math.floor(ask.limit ?? 30), 1), 100);
  return {
    page: location.pathname,
    counts: { accessibility: all.filter((i) => category(i) === 'accessibility').length, design: all.filter((i) => category(i) === 'design').length },
    shown: Math.min(wanted.length, limit),
    ignoredByUser: everything.length - all.length,
    note: 'Fixed rules read from the rendered page, no screenshot. A clean result is not proof the page is accessible. Design checks are guidelines.',
    issues: wanted.slice(0, limit).map((i) => ({ category: category(i), rule: i.rule, problem: i.title, detail: i.detail, element: describeEl(i.el), ...(i.fix ? { suggestedFix: i.fix.props } : {}), ...ruleSource(i.rule) })),
  };
}

function answerAsk(msg: { id: string; ask?: { kind?: string; noteId?: string; category?: string; rule?: string; limit?: number; level?: string } }) {
  const reply = (ok: boolean, data?: unknown, error?: string) => ws.send(JSON.stringify({ type: 'answer', id: msg.id, ok, data, error }));
  try {
    if (msg.ask?.kind === 'check') return reply(true, checkPage(msg.ask));
    if (msg.ask?.kind === 'console') {
      const level = msg.ask.level === 'error' || msg.ask.level === 'warn' ? msg.ask.level : null;
      const entries = consoleLog.filter((e) => !level || e.level === level).slice(-Math.min(Math.max(Math.floor(msg.ask.limit ?? 20), 1), 100)).reverse();
      return reply(true, { page: location.pathname, count: entries.length, note: 'Errors and warnings logged since the canvas loaded on this page, newest first.', entries });
    }
    if (msg.ask?.kind !== 'inspect') return reply(false, undefined, 'Unknown question');
    const noteId = msg.ask.noteId;
    const el = noteId ? (resolved.get(noteId) ?? null) : selected();
    if (!el) return reply(false, undefined, noteId ? "That note's element is not on the page the canvas is showing." : 'Nothing is selected on the canvas.');
    reply(true, inspectElement(el));
  } catch (err) {
    reply(false, undefined, `Could not inspect: ${(err as Error).message}`);
  }
}

/* ---------- edits (canvas -> file) ---------- */

/**
 * Apply props to the element immediately so the canvas feels instant.
 * `revert` restores the old inline values (edit failed); `clear` removes ours
 * once the real source change has landed.
 */
function preview(el: HTMLElement, props: Record<string, string>) {
  const before = Object.keys(props).map((p) => [p, el.style.getPropertyValue(p)] as const);
  for (const [p, v] of Object.entries(props)) el.style.setProperty(p, v);
  return {
    revert: () => before.forEach(([p, v]) => (v ? el.style.setProperty(p, v) : el.style.removeProperty(p))),
    clear: () => Object.entries(props).forEach(([p, v]) => el.style.getPropertyValue(p) === v && el.style.removeProperty(p)),
  };
}

// Dev mode: a preview that was written to a class or CSS rule (not inline) must be dropped after HMR lands,
// or it would keep overriding later edits and undo.
const previews = new Set<() => void>();
let settleTimer: number | undefined;
function settleSoon(ms: number) {
  clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => {
    previews.forEach((clear) => clear());
    previews.clear();
    refreshPanel();
  }, ms);
}

const LABEL: Partial<Record<Target, string>> = { class: 'Tailwind class', inline: 'inline style', rule: 'CSS rule' };

function reportSaved(el: HTMLElement | null, r: Result, count = 1) {
  const where = r.target && LABEL[r.target];
  const shared = DEV && el && count === 1 ? instances(refOf(el)).length : 1;
  const saved = `Saved${count > 1 ? ` · ${count} elements` : ''}${where ? ` · ${where}` : ''}${shared > 1 ? ` · ${shared} elements share this JSX` : ''}`;
  if (r.warning) panel.setStatus(`${saved} — ${r.warning}`, 'warn', { undo: true });
  else panel.setStatus(saved, 'ok', { undo: true });
}

async function send(edit: Edit): Promise<Result> {
  const r = await enqueue(() => rpc({ type: 'edit', edit, hash: state.hash }));
  if (!r.ok) failed(r, [edit]);
  return r;
}

/**
 * Say an edit failed. When the server declined it on purpose, the toast also offers to pin the change as a note, with the
 * wish already written and the reason attached, so the person never has to describe it or take a screenshot.
 */
function failed(r: Result, edits: Edit[]) {
  const el = selected();
  const wish = r.refused && el ? describeWish(edits, el) : null;
  panel.setStatus(r.error ?? 'Edit failed', 'err', wish ? { pinNote: () => void noteForRefusal(el!, wish, r.error ?? 'Brushup could not write it') } : {});
}

/** What the page showed for an edit's properties before the quick preview changed it, for the note a refusal can become. */
const wasValues = new WeakMap<Edit, Record<string, string>>();

/** What an edit asked for, in a sentence a person (or an agent) can act on. */
function describeWish(edits: Edit[], el: HTMLElement): string | null {
  const e = edits[0];
  const more = edits.length > 1 ? ` (and the same for the other ${edits.length - 1} selected elements)` : '';
  const what = (() => {
    if (e.kind === 'style') {
      const cs = getComputedStyle(el);
      const was = wasValues.get(e) ?? {};
      const parts = Object.entries(e.props).map(([prop, value]) => `${prop} to ${value}${(was[prop] ?? cs.getPropertyValue(prop)) ? ` (it is ${was[prop] ?? cs.getPropertyValue(prop)})` : ''}`);
      const size = e.variant ? ` for screens ${e.variant.replace(/^(dark:)?/, '')} and wider` : '';
      return `set ${parts.join(', ')}${size}`;
    }
    if (e.kind === 'delete') return 'delete this element';
    if (e.kind === 'duplicate') return 'duplicate this element';
    if (e.kind === 'moveUp') return 'move this element up (swap it with the one before it)';
    if (e.kind === 'moveDown') return 'move this element down (swap it with the one after it)';
    if (e.kind === 'wrap') return 'wrap this element in a <div>';
    if (e.kind === 'attr') return `set this image's ${e.name} to “${e.value}”`;
    return null; // text edits have their own note
  })();
  return what ? `${what}${more}` : null;
}

async function noteForRefusal(el: HTMLElement, wish: string, why: string) {
  const text = `Please ${wish}.\nBrushup couldn't write it into the source: ${why}`.slice(0, 3900);
  if (notes.some((n) => n.status === 'open' && n.text === text)) return panel.setStatus('There is already a note for this change', 'warn');
  await saveNote({ kind: suggestKind(el), label: 'Change to make', text }, null, 'open', el);
  panel.setStatus('Pinned as a note for Claude', 'ok');
}

/** Line-height as a unitless ratio, read before a font-size change so the server can keep spacing intact. */
function lineHeightRatio(el: HTMLElement): string | undefined {
  const cs = getComputedStyle(el);
  const ratio = parseFloat(cs.lineHeight) / parseFloat(cs.fontSize);
  return Number.isFinite(ratio) ? String(Math.round(ratio * 1000) / 1000) : undefined;
}

async function sendMany(edits: Edit[]): Promise<Result> {
  if (edits.length === 1) return send(edits[0]);
  const r = await enqueue(() => rpc({ type: 'edits', edits, hash: state.hash }));
  if (!r.ok) failed(r, edits);
  return r;
}

/* ---------- the page's theme colours ---------- */

interface ThemeColor {
  name: string;
  value: string;
}
let themeCache: { at: number; colors: ThemeColor[] } | null = null;

/**
 * The colours the page's theme defines: `--color-*` custom properties declared on the root (Tailwind 4's `@theme`, or the same
 * convention written by hand). They are read from the page's own stylesheets, so a project with none simply has no list.
 */
function themeColors(): ThemeColor[] {
  if (themeCache && Date.now() - themeCache.at < 2000) return themeCache.colors;
  const names = new Set<string>();
  const visit = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule && /(^|,)\s*(:root|:host|html)\s*(,|$)/.test(rule.selectorText)) {
        for (const prop of rule.style) if (/^--color-[a-z0-9-]+$/.test(prop)) names.add(prop.slice(8));
      } else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules); // @layer theme { … }, @media, @supports
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      visit(sheet.cssRules);
    } catch {
      /* a stylesheet from another origin can't be read */
    }
  }
  const style = getComputedStyle(document.documentElement);
  const colors = [...names].map((name) => ({ name, value: style.getPropertyValue(`--color-${name}`).trim() })).filter((c) => c.value && !/^(inherit|initial|unset|revert)/.test(c.value));
  themeCache = { at: Date.now(), colors };
  return colors;
}

/* ---------- editing for a screen size ---------- */

/** Tailwind's default breakpoints (v3 and v4 agree): the smallest width each prefix applies from. */
const BREAKPOINTS: [string, number][] = [['2xl', 1536], ['xl', 1280], ['lg', 1024], ['md', 768], ['sm', 640]];
/** The breakpoint the window is at now, or '' below the smallest. */
const breakpointNow = () => BREAKPOINTS.find(([, min]) => window.innerWidth >= min)?.[0] ?? '';
let editHere = false;
/** The variant an edit is written under: the current breakpoint when "this size and wider" is chosen, else none (every size). */
const variantNow = () => (editHere ? breakpointNow() : '');
function refreshVariants() {
  const bp = breakpointNow();
  panel.setVariants(DEV, bp, BREAKPOINTS.find(([name]) => name === bp)?.[1] ?? 0);
}

/** Style changes for one or more elements, written as a single change (one undo step). */
async function commitStyles(items: { el: HTMLElement; props: Record<string, string> }[], scope: Scope = 'auto', retried = false, variant = variantNow()) {
  if (!items.length) return;
  const seen = new Set<string>();
  const edits: Edit[] = [];
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
  for (const { el, props } of items) {
    const ref = refOf(el);
    if (seen.has(ref)) continue; // list items share one source line: a single edit covers them all
    seen.add(ref);
    const hints = { ...(Number.isFinite(rootPx) ? { rootPx } : {}), ...('font-size' in props ? { lineHeight: lineHeightRatio(el) } : {}), ...('color' in props ? { colorTokens: themeColors().map((c) => c.name) } : {}) };
    edits.push({ kind: 'style', id: ref, tag: tagOf(el), props, scope: variant ? 'element' : scope, ...(variant ? { variant } : {}), hints, ...(DEV ? { ident: identOf(el), ver: verOf(el) } : {}) });
  }
  if (edits[0]?.kind === 'style') {
    try {
      const cs = getComputedStyle(items[0].el);
      wasValues.set(edits[0], Object.fromEntries(Object.keys(items[0].props).map((p) => [p, cs.getPropertyValue(p)])));
    } catch {
      /* the note then reads the value as it is when the edit fails */
    }
  }
  const previewed = items.map((i) => preview(i.el, i.props));
  const r = await sendMany(edits);
  if (!r.ok) {
    previewed.forEach((p) => p.revert());
    // The file changed under the page: wait for the hot update to re-tag the elements, then try once more on the same selection.
    if (r.stale && !retried) {
      await nextFresh(1500);
      await new Promise((resolve) => setTimeout(resolve, 120));
      const els = selectedAll();
      if (els.length === items.length) return commitStyles(items.map((it, i) => ({ el: els[i], props: it.props })), scope, true, variant);
    }
    return refreshPanel();
  }
  reportSaved(items[0].el, r, edits.length);
  if (DEV && r.target !== 'inline') {
    previewed.forEach((p) => previews.add(p.clear));
    settleSoon(1500); // fallback if no HMR notice arrives
  }
}

const commitStyle = (el: HTMLElement, props: Record<string, string>, scope: Scope = 'auto', variant?: string) => commitStyles([{ el, props }], scope, false, variant);

/* ---------- layers ---------- */

const layerEls = new Map<string, HTMLElement>();
const layerKey = (el: HTMLElement) => `${refOf(el)}#${Math.max(0, instances(refOf(el)).indexOf(el))}`;

/** The page's tagged elements as a tree, in document order. Capped, so a huge page can't stall the panel. */
const LAYER_CAP = 2000;
let layerTotal = 0;
/** The file an element's markup was written in, from its source reference (`file:line:col`). */
const fileOf = (el: HTMLElement) => el.getAttribute(SRC)?.replace(/:\d+:\d+$/, '') ?? null;

/**
 * The component an element's markup lives in, named after its file, when that differs from its parent's. A component does not
 * have to forward props for this to show: its root element is written in `FeatureCard.tsx`, its parent in `Features.tsx`.
 * Generic names (`page.tsx`, `index.tsx`) use their folder instead, and `app/page.tsx` itself gets no name.
 */
const GENERIC_FILES = new Set(['index', 'page', 'layout', 'route', 'default', 'template', 'main', 'app']);
const GENERIC_FOLDERS = new Set(['app', 'src', 'pages', 'routes', 'components', 'component', 'ui', 'lib', 'views', 'public', 'main', 'app', 'index']);

function componentFrom(el: HTMLElement, parent: HTMLElement | null): string | undefined {
  if (!DEV) return undefined;
  const file = fileOf(el);
  if (!file || (parent && fileOf(parent) === file)) return undefined;
  const parts = file.split('/');
  let base = parts.pop()!.replace(/\.[^.]+$/, '');
  // `index.tsx`, `page.tsx` and the like are named by their folder (`hero/index.tsx` is Hero); in a folder that says nothing too, there is no name.
  if (GENERIC_FILES.has(base)) {
    base = parts.pop() ?? '';
    if (GENERIC_FOLDERS.has(base.toLowerCase())) return undefined;
  }
  if (!base) return undefined;
  return base.replace(/(^|[-_. ])([a-z0-9])/g, (_, __, c: string) => c.toUpperCase()).replace(/[-_. ]/g, '');
}

function layerRows(): LayerView[] {
  const rows: LayerView[] = [];
  const depth = new Map<HTMLElement, number>();
  const rowOf = new Map<HTMLElement, LayerView>();
  const seen = new Map<string, number>();
  layerEls.clear();
  layerTotal = 0;
  for (const el of document.querySelectorAll<HTMLElement>(TAGGED)) {
    // The same counting `instances()` does, so a row's key matches `layerKey` (one pass instead of a scan per element).
    const ref = refOf(el);
    const n = seen.get(ref) ?? 0;
    seen.set(ref, n + 1);
    if (el === document.documentElement || el === document.body || panel.host.contains(el) || el.closest('head')) continue; // the page itself, not its <head>
    layerTotal++;
    if (rows.length >= LAYER_CAP) continue;
    const parent = el.parentElement?.closest<HTMLElement>(TAGGED) ?? null;
    const d = parent && depth.has(parent) ? depth.get(parent)! + 1 : 0;
    depth.set(el, d);
    const use = DEV ? el.getAttribute(USE) : null;
    const text = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent ?? '').join('').trim().replace(/\s+/g, ' ');
    const classes = [...el.classList];
    const key = `${ref}#${n}`;
    layerEls.set(key, el);
    const name = use ? (use.split('#')[1] ?? tagOf(el)) : tagOf(el);
    const from = use ? undefined : componentFrom(el, parent);
    const row: LayerView = {
      key,
      depth: d,
      name,
      component: !!use,
      from,
      hint: el.id ? `#${el.id}` : text ? `“${text.slice(0, 28)}”` : classes[0] ? `.${classes[0]}` : '',
      search: `${name} ${from ?? ''} ${el.id} ${classes.slice(0, 8).join(' ')} ${text.slice(0, 60)}`.toLowerCase(),
      hasChildren: false,
    };
    rows.push(row);
    rowOf.set(el, row);
    const above = parent ? rowOf.get(parent) : null;
    if (above) above.hasChildren = true;
  }
  return rows;
}

function refreshLayers() {
  panel.setLayers(layerRows(), layerTotal);
  panel.setLayerSelection(selectedAll().map(layerKey));
}

/** Tag and the start of the text: enough to tell the element that moved from the one it swapped with. */
const signature = (el: HTMLElement) => `${tagOf(el)}|${(el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)}`;

/* ---------- an image's source and alt text ---------- */

/** Set an image's `src` or `alt` in the source. The page shows the change straight away and puts it back if the server says no. */
async function commitAttr(el: HTMLElement, name: 'src' | 'alt', value: string, explicit = false): Promise<boolean> {
  const was = el.getAttribute(name);
  if (name === 'alt' && value === '' && was === null && !explicit) return false; // nothing to clear: a decorative image is chosen on purpose
  if (value === (was ?? '') && !(name === 'alt' && was === null)) return false;
  if (name === 'src' && !value) {
    panel.setStatus('An image needs a source', 'err');
    refreshPanel();
    return false;
  }
  el.setAttribute(name, value);
  const r = await send({ kind: 'attr', id: refOf(el), tag: tagOf(el), name, value, ...(DEV ? { ident: identOf(el), ver: verOf(el) } : {}) });
  if (!r.ok) {
    if (was === null) el.removeAttribute(name);
    else el.setAttribute(name, was);
    refreshPanel();
    return false;
  }
  const saved = name === 'src' ? 'Saved · image source' : value ? 'Saved · alt text' : 'Saved · marked decorative';
  panel.setStatus(r.warning ? `${saved} — ${r.warning}` : saved, r.warning ? 'warn' : 'ok', { undo: true });
  refreshPanel();
  return true;
}

/** Read a chosen image file, have the server save it into the project, and point the selected image at it. */
async function uploadImage(file: File) {
  const el = selected();
  if (!(el instanceof HTMLImageElement)) return panel.setStatus('Select an image first', 'err');
  if (file.size > 2.5 * 1024 * 1024) return panel.setStatus(`That image is ${(file.size / 1048576).toFixed(1)} MB; the limit here is 2.5 MB. Put it in your public folder yourself and type its path instead.`, 'err');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  panel.setStatus('Saving the image…');
  const r = await rpc({ type: 'upload', name: file.name, data: btoa(binary) });
  if (!r.ok || !r.src) return panel.setStatus(r.error ?? 'Could not save the image', 'err');
  const wired = await commitAttr(el, 'src', r.src);
  if (!wired) return;
  panel.setStatus(el.hasAttribute('alt') ? `Saved ${r.saved} and set it as the source` : `Saved ${r.saved} and set it as the source. Now describe it in Alt text.`, 'ok', { undo: true });
  if (!el.hasAttribute('alt')) panel.focusImageField('alt');
}

/* ---------- delete and duplicate ---------- */

/** Take the selected element(s) out of the source, or write a copy right after each. Both are one undo step. */
async function structure(kind: 'delete' | 'duplicate' | 'moveUp' | 'moveDown' | 'wrap', retried = false): Promise<void> {
  const els = selectedAll().filter((el) => el !== document.body && el !== document.documentElement);
  if (!els.length) return panel.setStatus('Select an element first', 'err');
  if (els.length > 1 && !/^(delete|duplicate)$/.test(kind)) return panel.setStatus('Select one element to move or wrap it', 'err');
  const seen = new Set<string>();
  const edits: Edit[] = [];
  for (const el of els) {
    const ref = refOf(el);
    if (seen.has(ref)) continue; // list items share one source line: one edit covers them all
    seen.add(ref);
    edits.push({ kind, id: ref, tag: tagOf(el), ...(DEV ? { ident: identOf(el), ver: verOf(el) } : {}) });
  }
  const r = await sendMany(edits);
  if (!r.ok) {
    if (r.stale && !retried) {
      await nextFresh(1500);
      await new Promise((resolve) => setTimeout(resolve, 120));
      return structure(kind, true);
    }
    return; // the server's message is already on screen: it says why (a list item, a condition, the page root…)
  }
  const shared = DEV && els.length === 1 ? instances(refOf(els[0])).length : 1;
  const what = els.length > 1 ? `${els.length} elements` : `<${tagOf(els[0])}>`;
  const did = { delete: 'Deleted', duplicate: 'Duplicated', moveUp: 'Moved', moveDown: 'Moved', wrap: 'Wrapped' }[kind];
  const done = { delete: 'are gone', duplicate: 'got a copy', moveUp: 'moved', moveDown: 'moved', wrap: 'were wrapped' }[kind];
  const note = shared > 1 ? ` · ${shared} elements share this JSX, so all of them ${done}` : '';
  if (kind === 'delete') select(null);
  const text = `${did} ${what}${kind === 'moveUp' ? ' up' : kind === 'moveDown' ? ' down' : kind === 'wrap' ? ' in a <div>' : ''}${note}`;
  // A moved element's old line now belongs to its neighbour: once the page has reloaded, select the element where it ended up.
  if (r.select && (kind === 'moveUp' || kind === 'moveDown')) {
    const ref = r.select;
    const sig = signature(els[0]);
    // The reload notice comes before the page has updated, and until it does that position still holds the neighbour:
    // keep looking until the element there is the one that moved (same tag and text), for a few seconds at most.
    void (async () => {
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const moved = instances(ref).find((e) => signature(e) === sig);
        if (moved) return select(moved);
      }
    })();
  }
  panel.setStatus(r.warning ? `${text} — ${r.warning}` : text, r.warning ? 'warn' : 'ok', { undo: true });
}

async function history(kind: 'undo' | 'redo') {
  const r = await enqueue(() => rpc({ type: kind }));
  if (!r.ok) panel.setStatus(r.error ?? `Cannot ${kind}`, 'err');
  else panel.setStatus(kind === 'undo' ? 'Undone' : 'Redone', 'ok');
}

/* ---------- inline text editing ---------- */

function startTextEdit(el: HTMLElement) {
  if (el.children.length) return panel.setStatus('That element contains other elements: select the one holding the text.', 'err');
  const original = el.textContent ?? '';
  state.editing = el;
  el.setAttribute('contenteditable', 'plaintext-only');
  el.focus();
  getSelection()?.selectAllChildren(el);

  // In a <button>, Space activates the button (on keyup) instead of typing a space, so label edits lost every space.
  const isButton = el.tagName === 'BUTTON';
  const insertSpace = () => {
    if (document.execCommand?.('insertText', false, ' ')) return;
    const sel = getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const space = document.createTextNode(' ');
    range.insertNode(space);
    range.setStartAfter(space);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const finish = (commit: boolean) => {
    el.removeEventListener('blur', onBlur);
    el.removeEventListener('keydown', onKey);
    el.removeEventListener('keyup', onKeyUp);
    el.removeAttribute('contenteditable');
    state.editing = null;
    const text = (el.textContent ?? '').trim();
    if (commit && text && text !== original.trim()) {
      void send({ kind: 'text', id: refOf(el), fallback: fallbackOf(el), tag: tagOf(el), text, ...(DEV ? { ident: identOf(el, false), instance: Math.max(0, instances(refOf(el)).indexOf(el)), was: original.replace(/\s+/g, ' ').trim(), ver: verOf(el), fallbackVer: el.hasAttribute(USE) ? (el.getAttribute(SV) ?? undefined) : undefined } : {}) }).then((r) => {
        if (r.ok) return reportSaved(el, r);
        el.textContent = original;
        if (r.textSource) void noteForTextChange(el, text, original, r.error ?? 'the text is not written in a place Brushup can edit');
      });
    } else {
      el.textContent = original;
      if (state.reloadPending) void reload(false);
    }
  };
  const onBlur = () => finish(true);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), finish(true));
    else if (e.key === 'Escape') (e.preventDefault(), finish(false));
    else if (e.key === ' ' && isButton) (e.preventDefault(), insertSpace());
    e.stopPropagation();
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ' && isButton) e.preventDefault(); // keyup is what "presses" a button
    e.stopPropagation();
  };
  el.addEventListener('blur', onBlur);
  el.addEventListener('keydown', onKey);
  el.addEventListener('keyup', onKeyUp);
}

/* ---------- pointer: select, drag to move ---------- */

/** Moving the selection: every selected element moves by the same amount. */
let drag: { items: { el: HTMLElement; base: MoveBase; last: Record<string, string> }[]; x: number; y: number; moved: boolean; collapseTo: HTMLElement | null; box: Box; targets: Box[] } | null = null;
/** Dragging a resize / padding / margin handle on the primary element. */
let hdrag: { kind: HandleKind; x: number; y: number; start: BoxStart; last: Record<string, string>; moved: boolean; size: SizeStyle; blocked: string | null } | null = null;

const active = () => state.mode === 'edit';
/** Which handle is being dragged (read through a function: it is assigned inside event callbacks). */
const draggingHandle = (): HandleKind | null => hdrag?.kind ?? null;

/** What decides this element's size, read from the page as it is now. */
function sizeStyleOf(el: HTMLElement): SizeStyle {
  const cs = getComputedStyle(el);
  const ps = el.parentElement ? getComputedStyle(el.parentElement) : null;
  return {
    display: cs.display,
    flexBasis: cs.flexBasis,
    flexGrow: cs.flexGrow,
    maxWidth: cs.maxWidth,
    minWidth: cs.minWidth,
    maxHeight: cs.maxHeight,
    minHeight: cs.minHeight,
    parentDisplay: ps?.display ?? '',
    parentFlexDirection: ps?.flexDirection ?? '',
  };
}
/** Rubber-band selection: dragging out a box from empty space (or Alt+drag anywhere) selects what it fully contains. */
let marquee: { x: number; y: number; rect: { left: number; top: number; width: number; height: number } | null; add: boolean; click: () => void } | null = null;

/** Every tagged element fully inside `box`, keeping only the outermost where one contains another. */
function insideBox(box: { left: number; top: number; width: number; height: number }): HTMLElement[] {
  const inside = [...document.querySelectorAll<HTMLElement>(TAGGED)].filter((e) => {
    if (e === document.body || e === document.documentElement) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.left >= box.left - 1 && r.top >= box.top - 1 && r.right <= box.left + box.width + 1 && r.bottom <= box.top + box.height + 1;
  });
  return inside.filter((e) => !inside.some((o) => o !== e && o.contains(e)));
}

type Box = { left: number; top: number; right: number; bottom: number };

/** Edges and centres of other elements the dragged selection can line up with, read once when the drag starts. */
function snapTargets(moving: HTMLElement[]): Box[] {
  const out: Box[] = [];
  for (const e of document.querySelectorAll<HTMLElement>(TAGGED)) {
    if (e === document.body || e === document.documentElement || moving.some((m) => m === e || m.contains(e) || e.contains(m))) continue;
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
    out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    if (out.length >= 400) break;
  }
  return out;
}

const SNAP = 5;

/**
 * How far to nudge a drag so the moving box lines up with a neighbour's edge or centre (within SNAP px), and the
 * guide lines to draw. Each axis snaps to the closest alignment found; an axis that isn't moving is left alone.
 */
function snapDrag(moving: Box, dx: number, dy: number, targets: Box[]) {
  const box = { left: moving.left + dx, right: moving.right + dx, top: moving.top + dy, bottom: moving.bottom + dy };
  const xs = [box.left, (box.left + box.right) / 2, box.right];
  const ys = [box.top, (box.top + box.bottom) / 2, box.bottom];
  let bestX: { d: number; at: number; t: Box } | null = null;
  let bestY: { d: number; at: number; t: Box } | null = null;
  for (const t of targets) {
    for (const x of xs) for (const tx of [t.left, (t.left + t.right) / 2, t.right]) if (Math.abs(tx - x) <= SNAP && (!bestX || Math.abs(tx - x) < Math.abs(bestX.d))) bestX = { d: tx - x, at: tx, t };
    for (const y of ys) for (const ty of [t.top, (t.top + t.bottom) / 2, t.bottom]) if (Math.abs(ty - y) <= SNAP && (!bestY || Math.abs(ty - y) < Math.abs(bestY.d))) bestY = { d: ty - y, at: ty, t };
  }
  const sx = dx !== 0 && bestX ? bestX.d : 0;
  const sy = dy !== 0 && bestY ? bestY.d : 0;
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  if (dx !== 0 && bestX) lines.push({ x1: bestX.at, x2: bestX.at, y1: Math.min(box.top + sy, bestX.t.top), y2: Math.max(box.bottom + sy, bestX.t.bottom) });
  if (dy !== 0 && bestY) lines.push({ y1: bestY.at, y2: bestY.at, x1: Math.min(box.left + sx, bestY.t.left), x2: Math.max(box.right + sx, bestY.t.right) });
  return { dx: dx + sx, dy: dy + sy, lines };
}

const pageTarget = (e: Event) => ((e.target as Element | null)?.closest?.(TAGGED) as HTMLElement | null) ?? null;
const px = (v: string) => parseFloat(v) || 0;

window.addEventListener(
  'pointerdown',
  (e) => {
    if (!active() || e.button !== 0 || isOurs(e)) return;
    if (state.editing?.contains(e.target as Node)) return;
    state.editing?.blur();
    panel.blur();
    const el = pageTarget(e);
    e.preventDefault();
    e.stopPropagation();
    // Empty space (or Alt anywhere) starts a rubber band; if it turns out to be a plain click, do what a click did before.
    if (!el || el === document.body || el === document.documentElement || e.altKey) {
      const shift = e.shiftKey;
      marquee = { x: e.clientX, y: e.clientY, rect: null, add: shift, click: () => (el ? select(el, shift) : select(null)) };
      return;
    }
    if (e.shiftKey) return select(el, true); // Shift+click adds to / removes from the selection
    // Pressing on something already in a multi-selection keeps it, so the whole group can be dragged;
    // a click without a drag then narrows the selection to that element.
    const inGroup = sels.length > 1 && sels.some((s) => s.el === el);
    if (!inGroup) select(el);
    const items = movable().map((m) => ({ el: m, base: moveBase(m), last: {} }));
    const rects = items.map((i) => i.el.getBoundingClientRect());
    const box = { left: Math.min(...rects.map((r) => r.left)), top: Math.min(...rects.map((r) => r.top)), right: Math.max(...rects.map((r) => r.right)), bottom: Math.max(...rects.map((r) => r.bottom)) };
    if (items.length) drag = { items, x: e.clientX, y: e.clientY, moved: false, collapseTo: inGroup ? el : null, box, targets: snapTargets(items.map((i) => i.el)) };
    else if (inGroup) select(el);
  },
  true,
);

window.addEventListener(
  'pointermove',
  (e) => {
    if (hdrag) {
      const dx = e.clientX - hdrag.x;
      const dy = e.clientY - hdrag.y;
      if (!hdrag.moved && Math.hypot(dx, dy) < 2) return;
      if (!hdrag.moved) panel.setGhost(true);
      hdrag.moved = true;
      const asked = handleProps(hdrag.kind, hdrag.start, dx, dy, e.shiftKey);
      hdrag.last = sizeProps(asked, hdrag.size); // a flex item sized by flex-basis gets flex-basis, not a width it would ignore
      for (const el of selectedAll()) for (const [p, v] of Object.entries(hdrag.last)) el.style.setProperty(p, v);
      // Did the page honour it? If not, say why instead of leaving a handle that silently does nothing.
      const primary = selected();
      hdrag.blocked = null;
      if (primary && hdrag.kind.startsWith('resize')) {
        for (const axis of ['width', 'height'] as const) {
          if (!(axis in asked)) continue;
          const wanted = parseFloat(asked[axis]);
          if (Math.abs(parseFloat(getComputedStyle(primary)[axis]) - wanted) > 1.5) hdrag.blocked = explainSize(axis, wanted, sizeStyleOf(primary)) ?? 'the layout keeps it from changing';
        }
      }
      panel.setTip(handleLabel(hdrag.last) + (hdrag.blocked ? ` · not applied: ${hdrag.blocked}` : ''), e.clientX, e.clientY);
      return;
    }
    if (marquee) {
      if (!marquee.rect && Math.hypot(e.clientX - marquee.x, e.clientY - marquee.y) < 4) return;
      if (!marquee.rect) panel.setGhost(true);
      marquee.rect = { left: Math.min(marquee.x, e.clientX), top: Math.min(marquee.y, e.clientY), width: Math.abs(e.clientX - marquee.x), height: Math.abs(e.clientY - marquee.y) };
      panel.setMarquee(marquee.rect);
      return;
    }
    if (!active() || isOurs(e)) return;
    if (!drag) return void (state.hovered = pageTarget(e));
    let dx = e.clientX - drag.x;
    let dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) panel.setGhost(true);
    drag.moved = true;
    if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
    // Line up with neighbouring edges and centres (hold Ctrl or Cmd to move freely).
    if (e.ctrlKey || e.metaKey) panel.setGuides([]);
    else {
      const snapped = snapDrag(drag.box, dx, dy, drag.targets);
      dx = snapped.dx;
      dy = snapped.dy;
      panel.setGuides(snapped.lines);
    }
    for (const item of drag.items) {
      item.last = moveProps(item.base, dx, dy);
      for (const [p, v] of Object.entries(item.last)) item.el.style.setProperty(p, v);
    }
    refreshPanel();
  },
  true,
);

const endDrag = () => {
  panel.setGhost(false);
  panel.setGuides([]);
  if (marquee) {
    const m = marquee;
    marquee = null;
    panel.setMarquee(null);
    if (!m.rect) return m.click();
    const found = insideBox(m.rect);
    if (!found.length) return m.add ? undefined : select(null);
    sels = m.add ? [...sels.filter((x) => !found.includes(x.el)), ...found.map(makeSel)] : found.map(makeSel);
    return announceSelection();
  }
  if (hdrag) {
    const h = hdrag;
    hdrag = null;
    panel.setTip(null);
    if (h.moved) {
      void commitStyles(selectedAll().map((el) => ({ el, props: h.last }))).then(() => {
        if (h.blocked) panel.setStatus(`Saved, but it won't show: ${h.blocked}`, 'warn', { undo: true });
      });
    }
    return;
  }
  const d = drag;
  drag = null;
  if (d?.moved) void commitStyles(d.items.map((i) => ({ el: i.el, props: i.last })));
  else if (d?.collapseTo) select(d.collapseTo);
};
window.addEventListener('pointerup', endDrag, true);
window.addEventListener('pointercancel', endDrag, true);

// Stop the page's own links/buttons from firing while editing.
for (const type of ['click', 'submit', 'auxclick'] as const) {
  window.addEventListener(
    type,
    (e) => {
      if (!active() || isOurs(e) || state.editing?.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
}

window.addEventListener(
  'dblclick',
  (e) => {
    if (!active() || isOurs(e)) return;
    const el = pageTarget(e);
    if (el && !state.editing) startTextEdit(el);
  },
  true,
);

/* ---------- keyboard ---------- */

window.addEventListener(
  'keydown',
  (e) => {
    if (!active() || isOurs(e) || state.editing) return;
    const target = e.target as HTMLElement;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      void history(e.shiftKey ? 'redo' : 'undo');
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      void history('redo');
    } else if (e.key === 'Escape') {
      select(null);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!selectedAll().length) return;
      e.preventDefault();
      void structure('delete');
    } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd') {
      e.preventDefault(); // the browser would bookmark the page
      if (selectedAll().length) void structure('duplicate');
    } else if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!selected()) return;
      e.preventDefault();
      panel.openComposer();
    } else if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      if (!selectedAll().length) return;
      e.preventDefault();
      void structure(e.key === 'ArrowUp' ? 'moveUp' : 'moveDown'); // Alt+Up / Alt+Down: swap with the neighbour above or below
    } else if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'g') {
      if (!selectedAll().length) return;
      e.preventDefault();
      void structure('wrap');
    } else if (e.key.startsWith('Arrow')) {
      const els = movable();
      if (!els.length) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      void commitStyles(els.map((el) => ({ el, props: moveProps(moveBase(el), dx, dy) })));
    }
  },
  true,
);

/* ---------- boot ---------- */

let scrubbing: { revert: () => void }[] = [];

const panel = createPanel({
  onInvalid: (message) => panel.setStatus(message, 'err'),
  onScrub(props) {
    scrubbing.forEach((p) => p.revert());
    scrubbing = props ? selectedAll().map((el) => preview(el, props)) : [];
  },
  onVariant(here) {
    editHere = here;
    refreshVariants();
  },
  onStyle(props, scope) {
    void commitStyles(
      selectedAll().map((el) => ({ el, props })),
      scope,
    );
  },
  onMode(mode) {
    state.mode = mode;
    panel.setMode(mode);
    if (mode === 'preview') state.hovered = null;
  },
  onUndo: () => void history('undo'),
  onRedo: () => void history('redo'),
  onLayersRefresh: refreshLayers,
  onLayerSelect(key, add) {
    const el = layerEls.get(key);
    if (!el) return;
    select(el, add);
    el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  },
  onLayerHover(key) {
    state.hovered = key ? (layerEls.get(key) ?? null) : null;
  },
  onMove: (dir) => void structure(dir === 'up' ? 'moveUp' : 'moveDown'),
  onWrap: () => void structure('wrap'),
  onImageAttr(name, value, explicit) {
    const el = selected();
    if (el) void commitAttr(el, name, value, explicit);
  },
  onImageUpload: (file) => void uploadImage(file),
  onA11yAlt(id) {
    const issue = a11yIssues.get(id);
    const target = issue && editableFor(issue.el);
    if (!target) return panel.setStatus('Brushup can\'t tell which source this image comes from', 'warn');
    select(target);
    issue!.el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    setTimeout(() => panel.focusImageField('alt'), 60);
  },
  onDelete: () => void structure('delete'),
  onDuplicate: () => void structure('duplicate'),
  onParent() {
    const parent = selected()?.parentElement?.closest<HTMLElement>(TAGGED);
    if (parent) select(parent);
  },
  onNoteSave: (draft, id) => void saveNote(draft, id),
  onNoteDelete: (id) => void rpc({ type: 'note-delete', id }),
  onNoteDone(id, done) {
    const n = notes.find((x) => x.id === id);
    if (n) void saveNote({ kind: n.kind, label: n.label, text: n.text }, id, done ? 'done' : 'open');
  },
  onNoteLocate: locateNote,
  onChangesRefresh: refreshChanges,
  onA11yScan: scanA11y,
  onA11yLocate: locateA11y,
  onA11yFix: (id) => void fixA11y(id),
  onA11yNote: (id) => void noteA11y(id),
  onA11yIgnore: (id, scope) => void ignoreCheck(id, scope),
  onA11yRestore: (key) => void restoreCheck(key),
  onHandleDown(kind, e) {
    const el = selected();
    if (!el) return;
    const cs = getComputedStyle(el);
    const start: BoxStart = {
      width: px(cs.width),
      height: px(cs.height),
      pad: { t: px(cs.paddingTop), r: px(cs.paddingRight), b: px(cs.paddingBottom), l: px(cs.paddingLeft) },
      mar: { t: px(cs.marginTop), r: px(cs.marginRight), b: px(cs.marginBottom), l: px(cs.marginLeft) },
      move: moveBase(el),
    };
    hdrag = { kind, x: e.clientX, y: e.clientY, start, last: {}, moved: false, size: sizeStyleOf(el), blocked: null };
  },
});
panel.setMode('edit');
refreshVariants();
window.addEventListener('resize', refreshVariants);

// Notes are re-resolved when the page changes under them (route change, HMR, list updates).
new MutationObserver(() => (domDirty = true)).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

/** Box metrics of the primary selection for the handle layer, or null when handles shouldn't show. */
function handleInfo(): HandleInfo | null {
  const el = selected();
  if (!el || state.editing || el === document.body || el === document.documentElement) return null;
  const cs = getComputedStyle(el);
  return {
    rect: el.getBoundingClientRect(),
    pad: { t: px(cs.paddingTop), r: px(cs.paddingRight), b: px(cs.paddingBottom), l: px(cs.paddingLeft) },
    mar: { t: px(cs.marginTop), r: px(cs.marginRight), b: px(cs.marginBottom), l: px(cs.marginLeft) },
    border: { t: px(cs.borderTopWidth), r: px(cs.borderRightWidth), b: px(cs.borderBottomWidth), l: px(cs.borderLeftWidth) },
  };
}

(function frame() {
  if (location.pathname !== lastPath || (domDirty && Date.now() - lastRefresh > 500)) {
    domDirty = false;
    refreshNotes();
  }
  panel.layout(state.hovered, selected(), active());
  panel.layoutSelection(active() ? selectedAll().slice(0, -1) : []);
  panel.layoutHandles(active() ? handleInfo() : null, draggingHandle());
  panel.layoutPins(active() ? pinsNow() : [], (id) => {
    locateNote(id);
    panel.showNotesTab();
  });
  requestAnimationFrame(frame);
})();

connect();
