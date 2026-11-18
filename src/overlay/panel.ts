import { RULES } from './a11y';
import { DESIGN_RULES } from './design';
import { HANDLE_KINDS, SIDES, type HandleKind, type Sides } from './handles-math';

export type Mode = 'edit' | 'preview';
export type PanelScope = 'auto' | 'rule';
export type NoteKind = 'element' | 'section' | 'component';

/** A note as the panel shows it. */
export interface NoteView {
  id: string;
  n: number;
  kind: NoteKind;
  label: string;
  text: string;
  done: boolean;
  /** What the agent said it did when it marked the note done. */
  reply?: string;
  /** Whether the element could be found on the page right now. */
  found: boolean;
}

/** What the Changes tab shows: the git diff of the project's working tree. */
export type ChangesView =
  | { repo: false; reason: string }
  | { repo: true; branch: string; truncated: boolean; files: { file: string; status: string; additions: number; deletions: number; diff: string; byBrushup: boolean }[] };

/** One accessibility problem as the A11y tab lists it. */
export interface A11yView {
  id: string;
  category: 'accessibility' | 'design';
  rule: string;
  title: string;
  detail: string;
  /** Label of the one-click fix, when there is one. */
  fix?: string;
  /** Where the standard explains why it matters. */
  learn?: string;
}

export interface NoteDraft {
  kind: NoteKind;
  label: string;
  text: string;
}

export interface PanelHooks {
  onStyle(props: Record<string, string>, scope: PanelScope): void;
  /** Live, unsaved preview while a field is being scrubbed; null drops it. */
  onScrub(props: Record<string, string> | null): void;
  /** The user typed something a field can't take. */
  onInvalid?(message: string): void;
  onMode(mode: Mode): void;
  onUndo(): void;
  onRedo(): void;
  onParent(): void;
  onNoteSave(draft: NoteDraft, id: string | null): void;
  onNoteDelete(id: string): void;
  onNoteDone(id: string, done: boolean): void;
  onNoteLocate(id: string): void;
  /** The Changes tab was opened or refreshed: fetch the diff and call `setChanges`. */
  onChangesRefresh(): void;
  /** The A11y tab was opened or rescanned: scan the page and call `setA11y`. */
  onA11yScan(): void;
  onA11yLocate(id: string): void;
  onA11yFix(id: string): void;
  onA11yNote(id: string): void;
  onHandleDown(kind: HandleKind, e: PointerEvent): void;
}

/** The selected element's box, for placing handles and the margin/padding bands. */
export interface HandleInfo {
  rect: DOMRect;
  pad: Sides;
  mar: Sides;
  border: Sides;
}

type Kind = 'px' | 'ratio' | 'color' | 'weight';
interface Field {
  group?: string;
  label: string;
  prop: string;
  kind: Kind;
  /** Only meaningful when the element is a flex/grid container. */
  needsContainer?: boolean;
}

const FIELDS: Field[] = [
  { group: 'Typography', label: 'Size', prop: 'font-size', kind: 'px' },
  { label: 'Weight', prop: 'font-weight', kind: 'weight' },
  { label: 'Color', prop: 'color', kind: 'color' },
  { label: 'Line height', prop: 'line-height', kind: 'ratio' },
  { group: 'Spacing', label: 'Top', prop: 'padding-top', kind: 'px' },
  { label: 'Right', prop: 'padding-right', kind: 'px' },
  { label: 'Bottom', prop: 'padding-bottom', kind: 'px' },
  { label: 'Left', prop: 'padding-left', kind: 'px' },
  { label: 'Top', prop: 'margin-top', kind: 'px' },
  { label: 'Right', prop: 'margin-right', kind: 'px' },
  { label: 'Bottom', prop: 'margin-bottom', kind: 'px' },
  { label: 'Left', prop: 'margin-left', kind: 'px' },
  { group: 'Layout', label: 'Gap', prop: 'gap', kind: 'px', needsContainer: true },
  { label: 'Width', prop: 'width', kind: 'px' },
  { label: 'Height', prop: 'height', kind: 'px' },
];

const CSS = `
:host { all: initial;
  --accent: #c73a19; --accent-rgb: 199,58,25; --on-accent: #fff;
  --pad: #1f8a74; --mar: #b07410; --ok: #1b7a65; --warn: #8f5d12; --err: #b42318;
  --bg: #faf8f3; --raise: #f0ede3; --raise-2: #e8e4d7; --line: #e2ddd0; --text: #1d1b17; --muted: #5f5a4e; --faint: #746e5f; --field: transparent; --fieldline: #938d7d;
  --shadow: 0 10px 30px -10px rgba(29,27,23,.28), 0 1px 2px rgba(29,27,23,.10);
  --mono: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace; --serif: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
}
@media (prefers-color-scheme: dark) {
  :host { --accent: #f06a48; --accent-rgb: 240,106,72; --pad: #4cc2a8; --mar: #e0a73c; --ok: #4cc2a8; --warn: #e0a73c; --err: #f0735c;
    --on-accent: #1b1a17; --bg: #1b1a17; --raise: #24221e; --raise-2: #2e2b26; --line: #35322b; --text: #efeadf; --muted: #a8a191; --faint: #8b8474; --fieldline: #6b6558;
    --shadow: 0 10px 30px -10px rgba(0,0,0,.6), 0 1px 2px rgba(0,0,0,.3); }
}
* { box-sizing: border-box; font: 12px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; font-feature-settings: 'tnum' 1; }
.box { position: fixed; pointer-events: none; }
.hover { outline: 1px solid rgba(var(--accent-rgb),.5); }
.sel { outline: 1.5px solid var(--accent); }
.sel .tag { position: absolute; left: -1.5px; top: -21px; background: var(--accent); color: var(--on-accent); padding: 2px 7px; border-radius: 2px 2px 0 0; font: 600 11px/1.3 var(--mono); white-space: nowrap; }
.pin { position: fixed; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; background: var(--accent); color: var(--on-accent); display: grid; place-items: center; pointer-events: auto; cursor: pointer; box-shadow: 0 0 0 2px #fff, 0 2px 6px rgba(0,0,0,.3); font: 700 11px/1 var(--mono); }
.pin.done { background: var(--ok); opacity: .85; } .pin[hidden] { display: none; }
.h { position: fixed; pointer-events: auto; z-index: 2; touch-action: none; }
.h[hidden] { display: none; }
.h.resize { width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; background: #fff; border: 1.5px solid var(--accent); border-radius: 1px; }
.h.pad, .h.mar { border-radius: 1px; box-shadow: 0 0 0 1.5px #fff; }
.h.pad { background: var(--pad); } .h.mar { background: var(--mar); }
.h.pad.vert, .h.mar.vert { width: 20px; height: 5px; margin: -2.5px 0 0 -10px; }
.h.pad.horz, .h.mar.horz { width: 5px; height: 20px; margin: -10px 0 0 -2.5px; }
.h.vert { cursor: ns-resize; } .h.horz { cursor: ew-resize; } .h.se { cursor: nwse-resize; } .h.ne { cursor: nesw-resize; }
.band { position: fixed; pointer-events: none; box-sizing: border-box; border-style: solid; border-color: transparent; }
.band[hidden] { display: none; }
.band.mar { border-color: color-mix(in srgb, var(--mar) 28%, transparent); } .band.pad { border-color: color-mix(in srgb, var(--pad) 28%, transparent); }
.tip { position: fixed; pointer-events: none; background: #1d1b17; color: #f6f4ee; padding: 2px 8px; border-radius: 2px; font: 500 11px/1.4 var(--mono); white-space: nowrap; z-index: 5; }
.tip[hidden] { display: none; }
.marquee { position: fixed; pointer-events: none; border: 1px solid var(--accent); background: rgba(var(--accent-rgb),.08); z-index: 3; } .marquee[hidden] { display: none; }
.guide { position: fixed; pointer-events: none; background: var(--accent); z-index: 3; opacity: .85; }
.sel2 { position: fixed; pointer-events: none; outline: 1.5px solid rgba(var(--accent-rgb),.7); }

.panel { position: fixed; z-index: 4; top: 14px; right: 14px; width: 272px; max-height: calc(100vh - 28px); overflow: auto; pointer-events: auto; color: var(--text); background: var(--bg);
  border: 1px solid var(--line); border-radius: 4px; box-shadow: var(--shadow); scrollbar-width: thin; scrollbar-color: var(--raise-2) transparent; }
.panel.left { right: auto; left: 14px; }
header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; position: sticky; top: 0; z-index: 1; background: var(--bg); border-bottom: 1px solid var(--line); }
.logo { width: 24px; height: 24px; flex: none; display: block; }
header { cursor: grab; } header:active { cursor: grabbing; } header button { cursor: pointer; }
header strong { font: italic 400 17px/1 var(--serif); letter-spacing: -.01em; }
.status { flex: 1; min-width: 0; font-size: 11px; color: var(--muted); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.status.ok { color: var(--ok); } .status.warn { color: var(--warn); white-space: normal; text-align: left; } .status.err { color: var(--err); white-space: normal; text-align: left; }
.seg { display: flex; gap: 1px; }
.seg button { border-radius: 2px; padding: 4px 10px; min-height: 24px; color: var(--muted); }
.seg button[aria-pressed=true] { background: var(--raise-2); color: var(--text); }
button { background: none; border: 0; color: inherit; cursor: pointer; padding: 4px 9px; border-radius: 2px; transition: background .1s, color .1s; }
button:hover { background: var(--raise); } button:active { background: var(--raise-2); }
button:focus-visible, input:focus-visible { outline: 1.5px solid var(--accent); outline-offset: 1px; }
button:disabled { opacity: .4; cursor: default; background: none; }
.iconbtn { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; color: var(--muted); } .iconbtn:hover { color: var(--text); }
.iconbtn svg { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.body { padding: 0 12px 12px; } .panel.preview .body { display: none; }
.actions { display: flex; align-items: center; gap: 0; margin: 6px -6px 2px; }
.actions .sp { flex: 1; }
.tabs { display: flex; gap: 16px; margin: 0 0 8px; border-bottom: 1px solid var(--line); }
.tabs button { border-radius: 0; color: var(--muted); padding: 6px 0 7px; position: relative; background: none; }
.tabs button:hover { color: var(--text); background: none; }
.tabs button[aria-selected=true] { color: var(--accent); } .tabs button[aria-selected=true]::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 1.5px; background: var(--accent); }
.tabs .count { background: var(--accent); color: var(--on-accent); border-radius: 2px; padding: 0 5px; margin-left: 5px; font-size: 11px; font-weight: 600; }
[data-pane][hidden] { display: none !important; }
.info { color: var(--faint); margin-bottom: 4px; word-break: break-all; font: 11px/1.5 var(--mono); padding: 2px 0 8px; }
.info b { color: var(--text); font: 500 11.5px/1.5 var(--mono); }
h4 { margin: 12px 0 4px; font: italic 400 13px/1 var(--serif); color: var(--muted); display: flex; align-items: center; gap: 8px; }
h4::after { content: ''; flex: 1; height: 1px; background: var(--line); }
.grid { display: grid; grid-template-columns: 1fr; gap: 0; }
label.f { position: relative; display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 0; color: var(--muted); font-size: 12px; }
label.f[data-unit]::after { content: attr(data-unit); position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font-size: 10px; color: var(--faint); pointer-events: none; }
input, select, textarea { background: var(--field); color: var(--text); border: 1px solid var(--fieldline); border-radius: 2px; padding: 3px 8px; font-family: var(--mono); font-size: 11.5px; transition: border-color .1s, background .1s; }
label.f input, label.f select { width: 96px; flex: none; text-align: right; }
.composer input, .composer select, .composer textarea { width: 100%; text-align: left; }
input, select { height: 26px; } textarea { min-height: 72px; resize: vertical; font-family: inherit; font-size: 12px; line-height: 1.5; padding: 8px 10px; }
input[type=number] { -moz-appearance: textfield; appearance: textfield; padding-right: 22px; } input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
select { appearance: none; -webkit-appearance: none; padding-right: 20px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' stroke='%23918a7a' stroke-width='1.5' stroke-linecap='round'%3E%3Cpath d='M1 1l4 4 4-4'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 7px center; }
input[type=color] { padding: 2px; cursor: pointer; } input[type=color]::-webkit-color-swatch-wrapper { padding: 0; } input[type=color]::-webkit-color-swatch { border: 0; border-radius: 1px; } input[type=color]::-moz-color-swatch { border: 0; border-radius: 1px; }
input:hover, select:hover, textarea:hover { border-color: var(--faint); } input:disabled { opacity: .35; }
input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); }
.shared { display: flex; gap: 9px; align-items: flex-start; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line); color: var(--muted); cursor: pointer; font-size: 11px; line-height: 1.45; }
.shared b { display: block; color: var(--text); font-weight: 600; } .shared .why { display: block; margin-top: 2px; color: var(--faint); font-size: 10.5px; }
.shared input { appearance: none; -webkit-appearance: none; flex: none; width: 30px; height: 18px; margin-top: 1px; padding: 0; border-radius: 2px; background: var(--raise-2); border: 0; position: relative; cursor: pointer; }
.shared input::after { content: ''; position: absolute; top: 3px; left: 3px; width: 12px; height: 12px; border-radius: 1px; background: var(--bg); transition: transform .12s; }
.shared input:checked { background: var(--accent); } .shared input:checked::after { transform: translateX(12px); background: #fff; }
.keys { margin: 14px 0 0; padding-top: 10px; border-top: 1px solid var(--line); display: grid; gap: 6px; color: var(--faint); font-size: 11.5px; }
.keys div { display: grid; grid-template-columns: 96px 1fr; align-items: center; gap: 8px; } .keys dt, .keys dd { margin: 0; } .keys kbd { margin: 0; }
.iconbtn { position: relative; } .iconbtn .dot { position: absolute; top: 3px; right: 3px; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
.tour-ring { position: fixed; z-index: 5; pointer-events: none; border: 2px solid var(--accent); border-radius: 4px; box-shadow: 0 0 0 4px rgba(var(--accent-rgb), .18); transition: all .2s cubic-bezier(.2,.8,.2,1); }
.tour { position: fixed; z-index: 6; width: 264px; padding: 14px 14px 12px; pointer-events: auto; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 4px; box-shadow: 0 14px 36px rgba(0,0,0,.28); animation: enter .2s cubic-bezier(.2,.8,.2,1); }
.tour h3 { margin: 0 0 4px; font: italic 600 16px/1.25 var(--serif); } .tour p { margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.5; }
.tour .foot { display: flex; align-items: center; gap: 8px; margin-top: 12px; } .tour .foot .n { flex: 1; color: var(--faint); font: 500 11px var(--mono); }
.tour button { padding: 5px 11px; border-radius: 3px; } .tour .next { background: var(--accent); color: var(--on-accent); } .tour .skip { color: var(--muted); }
.tour[hidden], .tour-ring[hidden] { display: none; }
.panel.mini .body { display: none; } .panel.mini header { border-bottom: 0; } .panel.mini [data-act=mini] svg { transform: rotate(180deg); }
.chbar { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; color: var(--muted); font-size: 11.5px; } .chbar .sp { flex: 1; } .chbar .chsum { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; } .chbar .ghost { white-space: nowrap; } .chbar .ghost { padding: 3px 8px; border: 1px solid var(--line); border-radius: 3px; color: var(--muted); } .chbar .ghost:hover:not(:disabled) { color: var(--text); } .chbar .ghost:disabled { opacity: .45; cursor: default; }
.chlist { min-width: 0; } .chfile { border: 1px solid var(--line); border-radius: 3px; margin-bottom: 6px; overflow: hidden; background: var(--bg); } .chfile summary { display: flex; gap: 8px; align-items: baseline; padding: 6px 8px; cursor: pointer; list-style: none; } .chfile summary::-webkit-details-marker { display: none; }
.chfile .chnm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 500 11px var(--mono); color: var(--text); direction: rtl; text-align: left; } .chfile .chst { font: 600 10px var(--mono); color: var(--faint); }
.chfile .chby { font-size: 10px; color: var(--accent); } .chfile .chadd { color: var(--ok); font: 11px var(--mono); } .chfile .chdel { color: var(--err); font: 11px var(--mono); }
.chfile pre { margin: 0; padding: 6px 0; background: var(--bg); max-width: 100%; max-height: 240px; overflow: auto; border-top: 1px solid var(--line); font: 10.5px/1.5 var(--mono); } .chfile pre span { display: block; padding: 0 8px; white-space: pre; }
.chfile pre .cha { background: rgba(76, 194, 168, .14); } .chfile pre .chd { background: rgba(240, 115, 92, .14); } .chfile pre .chh { color: var(--faint); }
.chnote { margin: 8px 0; padding: 7px 9px; border-left: 2px solid var(--warn); background: var(--raise); color: var(--muted); font-size: 11px; line-height: 1.5; }
.note .reply { margin: 6px 0 0; padding: 5px 8px; border-left: 2px solid var(--ok); background: var(--raise); color: var(--muted); font-size: 11px; line-height: 1.5; }
.a11yitem { border: 1px solid var(--line); border-radius: 3px; padding: 8px 9px; margin-bottom: 6px; background: var(--bg); }
.a11yitem .rule { display: inline-block; margin-bottom: 4px; padding: 1px 6px; border-radius: 2px; background: var(--raise); color: var(--muted); font: 600 10px var(--mono); text-transform: uppercase; letter-spacing: .04em; }
.a11yitem b { display: block; color: var(--text); font-weight: 600; font-size: 12px; line-height: 1.4; } .a11yitem p { margin: 3px 0 0; color: var(--muted); font-size: 11px; line-height: 1.5; }
.a11yfilter { display: flex; gap: 4px; margin: 0 0 8px; } .a11yfilter button { padding: 3px 9px; border: 1px solid var(--line); border-radius: 3px; color: var(--muted); font-size: 11px; } .a11yfilter button[aria-pressed=true] { background: var(--raise-2); color: var(--text); border-color: var(--fieldline); }
.a11yitem .rule.design { color: var(--pad); }
.a11ywhat h4 { margin: 8px 0 2px; font: 600 10px var(--mono); text-transform: uppercase; letter-spacing: .05em; color: var(--faint); }
.a11yitem .learn { display: inline-block; margin-top: 6px; color: var(--accent); font-size: 11px; text-decoration: underline; text-underline-offset: 2px; }
.a11ywhat { margin: 8px 0; font-size: 11px; color: var(--muted); } .a11ywhat summary { cursor: pointer; } .a11ywhat ul { margin: 6px 0 0; padding-left: 16px; line-height: 1.5; } .a11ywhat li { margin-bottom: 3px; } .a11ywhat b { color: var(--text); font-weight: 600; }
.a11yitem .acts { display: flex; gap: 6px; margin-top: 7px; flex-wrap: wrap; } .a11yitem .acts button { padding: 3px 8px; border: 1px solid var(--line); border-radius: 3px; color: var(--muted); font-size: 11px; } .a11yitem .acts button:hover { color: var(--text); }
.a11yitem .acts .apply { background: var(--accent); color: var(--on-accent); border-color: transparent; font-weight: 600; } .a11yitem .acts .apply:hover { color: var(--on-accent); filter: brightness(1.08); }
.hint { margin: 12px 0 0; color: var(--faint); font-size: 10.5px; line-height: 2; }
kbd { white-space: nowrap; font: 500 11px/1 var(--mono); padding: 2px 5px; border-radius: 2px; border: 1px solid var(--line); color: var(--muted); margin: 0 1px; }
.add { width: 100%; border: 1px dashed var(--accent); border-radius: 2px; color: var(--accent); padding: 8px; font-weight: 500; }
.add:hover { background: rgba(var(--accent-rgb),.07); } .add:disabled { color: var(--faint); border-color: var(--line); background: none; }
form.composer { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; padding: 10px; border: 1px solid var(--line); border-radius: 2px; }
form.composer .row { display: flex; gap: 6px; } form.composer .row > * { flex: 1; }
form.composer .primary { background: var(--accent); color: var(--on-accent); font-weight: 600; } form.composer .primary:hover { filter: brightness(1.06); background: var(--accent); }
form.composer .ghost { color: var(--muted); border: 1px solid var(--line); }
.note { margin-top: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 2px; }
.note.done { opacity: .5; } .note.missing { border-color: var(--warn); }
.note .head { display: flex; gap: 7px; align-items: center; margin-bottom: 5px; }
.note .num { background: var(--accent); color: var(--on-accent); border-radius: 50%; width: 18px; height: 18px; display: grid; place-items: center; font: 700 10px/1 var(--mono); flex: none; }
.note.done .num { background: var(--ok); }
.note .kind { color: var(--faint); font-size: 11px; font-style: italic; font-family: var(--serif); } .note .name { font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.note p { margin: 0 0 8px; white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
.note .acts { display: flex; gap: 2px; flex-wrap: wrap; margin: 0 -5px -3px; } .note .acts button { padding: 2px 7px; color: var(--muted); font-size: 11px; } .note .acts button:hover { color: var(--accent); }
.note .warn { color: var(--warn); font-size: 11px; margin: 0 0 5px; }
.empty { color: var(--faint); padding: 12px 0; text-align: center; }
@keyframes enter { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
@keyframes rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes pop { 0% { transform: scale(.4); opacity: 0; } 70% { transform: scale(1.12); } 100% { transform: scale(1); opacity: 1; } }
.panel { animation: enter .24s cubic-bezier(.2,.8,.2,1); }
.hover { transition: left .07s ease-out, top .07s ease-out, width .07s ease-out, height .07s ease-out; }
.sel.glide { transition: left .15s cubic-bezier(.2,.8,.2,1), top .15s cubic-bezier(.2,.8,.2,1), width .15s cubic-bezier(.2,.8,.2,1), height .15s cubic-bezier(.2,.8,.2,1); }
.pin { animation: pop .26s cubic-bezier(.3,1.5,.5,1); transition: transform .12s; } .pin:hover { transform: scale(1.12); }
.h.resize, .h.pad, .h.mar { transition: transform .1s; } .h.resize:hover, .h.pad:hover, .h.mar:hover { transform: scale(1.3); }
.tip { animation: fade .1s; }
.tabs, .seg { position: relative; }
.tabs .ink { position: absolute; bottom: -1px; height: 1.5px; background: var(--accent); transition: left .22s cubic-bezier(.2,.8,.2,1), width .22s cubic-bezier(.2,.8,.2,1); pointer-events: none; }
.tabs button[aria-selected=true]::after { display: none; }
.seg .thumb { position: absolute; top: 0; bottom: 0; background: var(--raise-2); border-radius: 2px; transition: left .2s cubic-bezier(.2,.8,.2,1), width .2s cubic-bezier(.2,.8,.2,1); pointer-events: none; }
.seg button { position: relative; z-index: 1; } .seg button[aria-pressed=true] { background: none; }
.status { animation: fade .15s; }
label.f.scrub > span { cursor: ew-resize; user-select: none; touch-action: none; }
label.f.scrub > span:hover { color: var(--text); }
label.f.flash input { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(var(--accent-rgb),.16); }
label.f input { transition: border-color .5s, box-shadow .5s, background .1s; }
input:focus, select:focus, textarea:focus { box-shadow: 0 0 0 3px rgba(var(--accent-rgb),.14); }
.info.idle { text-align: center; font: italic 13px/1.5 var(--serif); color: var(--muted); padding: 22px 12px; margin: 8px 0; border: 1px dashed var(--line); border-radius: 2px; }
form.composer, .note { animation: rise .2s cubic-bezier(.2,.8,.2,1); }
.note .num, .pin { transition: background .2s; }
.boxm { position: relative; display: grid; grid-template-columns: 36px minmax(0, 1fr) 36px; grid-template-areas: ". t ." "l p r" ". b ."; gap: 8px; padding: 24px 8px 10px; border: 1px dashed var(--mar); border-radius: 2px; }
.boxp { grid-area: p; position: relative; display: grid; grid-template-columns: 36px minmax(0, 1fr) 36px; grid-template-areas: ". t ." "l k r" ". b ."; gap: 6px; padding: 24px 8px 8px; border: 1px solid var(--pad); border-radius: 2px; background: color-mix(in srgb, var(--pad) 7%, transparent); }
.boxm .cap { position: absolute; left: 8px; top: 5px; font: italic 11.5px/1 var(--serif); color: var(--muted); }
.boxm .c { display: grid; place-items: center; } .boxm .c.t { grid-area: t; } .boxm .c.l { grid-area: l; } .boxm .c.r { grid-area: r; } .boxm .c.b { grid-area: b; }
.boxp .core { grid-area: k; min-height: 28px; border: 1px dashed var(--line); border-radius: 1px; }
label.f.mini { display: block; padding: 0; } label.f.mini input { width: 36px; height: 26px; padding: 0 2px; text-align: center; }
label.f.mini input:not(:focus), label.f.scrub > span { cursor: ew-resize; }
.scrubbing, .scrubbing input { user-select: none; cursor: ew-resize; }
.panel.ghost { opacity: .22; pointer-events: none; transition: opacity .12s; }
header .sp { flex: 1; }
.toast { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 6; max-width: min(520px, calc(100vw - 32px)); display: flex; align-items: center; gap: 10px; padding: 9px 8px 9px 14px; background: #1d1b17; color: #f6f4ee; border-radius: 3px; pointer-events: auto; box-shadow: 0 10px 28px rgba(0,0,0,.35); animation: toastin .22s cubic-bezier(.2,.8,.2,1); }
@keyframes toastin { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }
.toast .bar { width: 3px; align-self: stretch; border-radius: 2px; background: #4cc2a8; } .toast.warn .bar { background: #e0a73c; } .toast.err .bar { background: #f0735c; }
.toast .status, .toast .status.ok, .toast .status.warn, .toast .status.err { flex: 1; min-width: 0; color: #f6f4ee; font-size: 12.5px; line-height: 1.4; text-align: left; white-space: normal; overflow: visible; animation: none; }
.toast button { color: #ff9a7d; font-weight: 600; padding: 3px 9px; min-height: 26px; } .toast button:hover { background: rgba(255,255,255,.1); }
.toast .x { color: #bdb7a6; font-weight: 400; font-size: 17px; line-height: 1; padding: 3px 7px; }
a.src { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; } a.src:not([href]) { color: inherit; text-decoration: none; cursor: default; }
.info .copy { display: inline-grid; place-items: center; width: 20px; height: 20px; padding: 0; margin-left: 4px; vertical-align: -5px; color: var(--faint); } .info .copy:hover { color: var(--text); }
.info .copy svg { width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.colorrow { display: flex; gap: 4px; width: 96px; flex: none; }
label.f .colorrow input[type=color] { width: 28px; flex: none; padding: 2px; }
label.f .colorrow input.hex { flex: 1; min-width: 0; width: auto; text-align: left; padding: 0 6px; text-transform: lowercase; }
input[aria-invalid=true] { border-color: var(--err); }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; animation: none !important; } }
[hidden] { display: none !important; }
`;

const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
function toHex(color: string): string {
  const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?/.exec(color);
  if (!m) return '#000000';
  const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return `#${hex(+m[1])}${hex(+m[2])}${hex(+m[3])}${alpha < 1 ? hex(alpha * 255) : ''}`;
}
/** `#abc`, `abc`, `#aabbcc`, `#aabbcc80` -> lowercase `#rrggbb[aa]`, or null if it isn't a hex colour. */
export function normalizeHex(text: string): string | null {
  const m = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text.trim());
  if (!m) return null;
  const h = m[1].length <= 4 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
}
const round = (n: number, d = 1) => String(Math.round(n * 10 ** d) / 10 ** d);

/** Where the selected element is written, as the build tagged it. */
export interface SourceRef {
  prefix: string;
  shown: string;
  path: string;
  line: number;
  col: number;
}

const EDITORS: Record<string, string> = { vscode: 'vscode://file', 'vscode-insiders': 'vscode-insiders://file', cursor: 'cursor://file', windsurf: 'windsurf://file', zed: 'zed://file' };

export function createPanel(hooks: PanelHooks) {
  let projectRoot = '';
  /** `vscode://file/abs/path:line:col`; the editor is `localStorage['brushup:editor']` (vscode, cursor, windsurf, zed). */
  const editorUrl = (src: SourceRef) => {
    if (!projectRoot) return null;
    let editor = 'vscode';
    try {
      editor = localStorage.getItem('brushup:editor') || 'vscode';
    } catch {
      /* storage can be blocked */
    }
    const abs = `${projectRoot.replace(/\\/g, '/')}/${src.path}`;
    // Encode each segment ('#', '?' and '%' in a folder name would otherwise end the path); a Windows drive keeps its colon.
    const path = abs.split('/').map((seg) => (/^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg))).join('/');
    return `${EDITORS[editor] ?? EDITORS.vscode}${path.startsWith('/') ? '' : '/'}${path}:${src.line}:${src.col}`;
  };
  const host = document.createElement('div');
  host.id = 'brushup-root';
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style>
    <div class="box hover" hidden></div>
    <div class="box sel" hidden><span class="tag"></span></div>
    <div class="pins"></div>
    <div class="band mar" hidden></div>
    <div class="band pad" hidden></div>
    <div class="handles"></div>
    <div class="tip" hidden></div>
    <div class="marquee" hidden></div>
    <div class="guides"></div>
    <aside class="panel" role="region" aria-label="Brushup design panel">
      <header>
        <svg class="logo" viewBox="0 0 256 256" aria-hidden="true"><path d="M12 132L226 116L244 126L226 140L244 154L224 188L12 204Z" fill="var(--accent)"/><path d="M122.01 222.46Q111.19 222.46 105.53 219.88Q99.87 217.29 96.18 214.1L70.6 220.74H54.36L88.56 59.36Q89.54 54.44 90.28 50.75Q91.02 47.06 91.02 44.36Q91.02 39.44 88.31 37.47Q85.61 35.5 79.7 35.5H72.57L73.06 33.04H137.76L128.41 76.34Q126.93 83.47 124.1 94.54Q121.28 105.61 117.83 118.16H118.82Q122.26 109.79 127.92 102.29Q133.58 94.79 142.06 90.23Q150.55 85.68 162.36 85.68Q172.44 85.68 180.93 90.23Q189.42 94.79 194.58 104.75Q199.75 114.71 199.75 130.95Q199.75 140.05 197.54 151.98Q195.32 163.91 190.16 176.21Q184.99 188.51 176.13 198.97Q167.28 209.42 153.99 215.94Q140.71 222.46 122.01 222.46ZM112.42 219.02Q121.03 219.02 128.04 212.74Q135.05 206.47 140.46 196.01Q145.88 185.56 149.57 173.01Q153.26 160.47 155.22 147.68Q157.19 134.88 157.19 124.06Q157.19 107.58 153.62 101.31Q150.06 95.03 143.91 95.03Q137.51 95.03 132.1 100.81Q126.69 106.59 122.51 115.57Q118.32 124.55 116.11 134.39L99.14 213.11Q101.1 215.33 104.55 217.17Q107.99 219.02 112.42 219.02Z" fill="var(--text)"/></svg>
        <strong>Brushup</strong><span class="sp"></span>
        <button class="iconbtn" data-act="mini" title="Collapse or expand the panel" aria-label="Collapse or expand the panel" aria-expanded="true"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button>
        <div class="seg"><span class="thumb"></span><button data-mode="edit">Edit</button><button data-mode="preview">Preview</button></div>
      </header>
      <div class="body">
        <div class="actions">
          <button class="iconbtn" data-act="undo" title="Undo (Ctrl/Cmd+Z)" aria-label="Undo"><svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/></svg></button>
          <button class="iconbtn" data-act="redo" title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo"><svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/></svg></button>
          <button class="iconbtn" data-act="parent" title="Select parent" aria-label="Select parent"><svg viewBox="0 0 24 24"><path d="M12 19V6"/><path d="M6 11l6-6 6 6"/></svg></button>
          <span class="sp"></span>
          <button class="iconbtn" data-act="tour" title="How to use Brushup" aria-label="How to use Brushup"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 114 2c-.9.6-1.6 1-1.6 2.1"/><path d="M12 16.9v.1"/></svg><i class="dot" hidden></i></button>
          <button class="iconbtn" data-act="dock" title="Move panel to the other side" aria-label="Move panel"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/></svg></button>
        </div>
        <div class="tabs" role="tablist"><span class="ink"></span>
          <button role="tab" id="brushup-tab-style" aria-controls="brushup-pane-style" data-tab="style" aria-selected="true" tabindex="0">Style</button>
          <button role="tab" id="brushup-tab-notes" aria-controls="brushup-pane-notes" data-tab="notes" aria-selected="false" tabindex="-1">Notes<span class="count" hidden></span></button>
          <button role="tab" id="brushup-tab-changes" aria-controls="brushup-pane-changes" data-tab="changes" aria-selected="false" tabindex="-1">Changes</button>
          <button role="tab" id="brushup-tab-a11y" aria-controls="brushup-pane-a11y" data-tab="a11y" aria-selected="false" tabindex="-1" >Checks<span class="count" data-a11y-count hidden></span></button>
        </div>
        <div data-pane="style" role="tabpanel" id="brushup-pane-style" aria-labelledby="brushup-tab-style">
          <div class="info">Click an element to select it.</div>
          <div class="fields" hidden></div>
          <label class="shared" hidden title="Off: only the selected element changes. On: the CSS rule is edited, so every element it matches changes."><input type="checkbox" /><span><b>Edit the shared CSS rule</b><small class="why">Off: only this element changes.</small></span></label>
          <dl class="keys" aria-label="Shortcuts"><div><dt><kbd>drag</kbd></dt><dd>Move</dd></div><div><dt><kbd>↑ ↓ ← →</kbd></dt><dd>Nudge 1px, <kbd>⇧</kbd> for 10</dd></div><div><dt><kbd>double-click</kbd></dt><dd>Edit text</dd></div><div><dt><kbd>N</kbd></dt><dd>Add a note</dd></div><div><dt><kbd>Esc</kbd></dt><dd>Deselect</dd></div></dl>
        </div>
        <div data-pane="changes" role="tabpanel" id="brushup-pane-changes" aria-labelledby="brushup-tab-changes" hidden>
          <div class="chbar"><span class="chsum">Not loaded yet</span><span class="sp"></span><button class="ghost" data-act="changes-refresh">Refresh</button><button class="ghost" data-act="changes-copy" disabled>Copy diff</button></div>
          <div class="chlist"></div>
        </div>
        <div data-pane="a11y" role="tabpanel" id="brushup-pane-a11y" aria-labelledby="brushup-tab-a11y" hidden>
          <div class="chbar"><span class="a11ysum">Open this tab to check the page</span><span class="sp"></span><button class="ghost" data-act="a11y-scan">Check again</button></div>
          <div class="a11yfilter" role="group" aria-label="Show checks"><button data-filter="all" aria-pressed="true">All</button><button data-filter="accessibility" aria-pressed="false">Accessibility</button><button data-filter="design" aria-pressed="false">Design</button></div>
          <div class="a11ylist"></div>
          <details class="a11ywhat"><summary>What's checked</summary><div></div></details>
          <p class="chnote a11ynote" hidden>These checks catch some problems, not all of them. A clean accessibility result doesn't mean the page is accessible: also try it with only a keyboard, and with a screen reader. Design checks are guidelines, so a deliberate choice can be right: ignore any that don't fit.</p>
        </div>
        <div data-pane="notes" role="tabpanel" id="brushup-pane-notes" aria-labelledby="brushup-tab-notes" hidden>
          <button class="add" data-act="add-note" disabled>Select an element to add a note</button>
          <form class="composer" hidden>
            <div class="target info"></div>
            <div class="row"><select name="kind" aria-label="Note type"><option value="element">Element</option><option value="section">Section</option><option value="component">Component</option></select><input name="label" placeholder="Name (e.g. Hero)" aria-label="Note name" maxlength="120" /></div>
            <textarea name="text" placeholder="What should change, or what should Claude know?" aria-label="Note" maxlength="4000" required></textarea>
            <div class="row"><button type="submit" class="primary">Save note</button><button type="button" class="ghost" data-act="cancel-note">Cancel</button></div>
          </form>
          <div class="notes-list"></div>
        </div>
      </div>
    </aside>
    <div class="tour-ring" hidden></div>
    <div class="tour" role="dialog" aria-label="Brushup tour" hidden><h3></h3><p></p><div class="foot"><span class="n"></span><button class="skip" type="button">Skip</button><button class="back skip" type="button">Back</button><button class="next" type="button"></button></div></div>
    <div class="toast" role="status" aria-live="polite" hidden><span class="bar"></span><span class="status"></span><button class="undo" data-act="toast-undo" hidden>Undo</button><button class="x" data-act="toast-x" aria-label="Dismiss">&times;</button></div>`;
  document.documentElement.appendChild(host);

  const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T;
  const hoverBox = $<HTMLDivElement>('.hover');
  const selBox = $<HTMLDivElement>('.sel');
  const selTag = $<HTMLSpanElement>('.sel .tag');
  const pinsEl = $<HTMLDivElement>('.pins');
  const bandMar = $<HTMLDivElement>('.band.mar');
  const bandPad = $<HTMLDivElement>('.band.pad');
  const handlesEl = $<HTMLDivElement>('.handles');
  const tipEl = $<HTMLDivElement>('.tip');
  const marqueeEl = $<HTMLDivElement>('.marquee');
  const guidesEl = $<HTMLDivElement>('.guides');
  const panel = $<HTMLElement>('.panel');
  const statusEl = $<HTMLSpanElement>('.status');
  const toastEl = $<HTMLDivElement>('.toast');
  const undoBtn = $<HTMLButtonElement>('.toast .undo');
  const info = $<HTMLDivElement>('[data-pane=style] .info');
  const fieldsEl = $<HTMLDivElement>('.fields');
  const sharedLabel = $<HTMLLabelElement>('.shared');
  const shared = $<HTMLInputElement>('.shared input');
  const sharedWhy = $<HTMLElement>('.shared .why');
  shared.addEventListener('change', () => (sharedWhy.textContent = shared.checked ? 'On: every element this rule matches changes.' : 'Off: only this element changes.'));
  const addBtn = $<HTMLButtonElement>('[data-act=add-note]');
  const composer = $<HTMLFormElement>('form.composer');
  const composerTarget = $<HTMLDivElement>('form.composer .target');
  const listEl = $<HTMLDivElement>('.notes-list');
  const countEl = $<HTMLSpanElement>('.tabs .count');

  // Build the property fields once.
  const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
  const hexInputs = new Map<string, HTMLInputElement>();
  const fmt = (n: number) => String(Math.round(n * 100) / 100);
  const SIDE_WORD: Record<string, string> = { top: 'top', right: 'right', bottom: 'bottom', left: 'left' };

  /**
   * Drag `handle` sideways to scrub `input` (Shift = x10): the page previews it live and the drop saves it.
   * `grab` means the handle is the field itself, so a plain click must still focus it for typing.
   */
  const wireScrub = (handle: HTMLElement, input: HTMLInputElement | HTMLSelectElement, f: Field, grab: boolean) => {
    const step = f.kind === 'px' ? 1 : 0.05;
    const valueOf = (v: string) => (f.kind === 'px' ? `${v}px` : v);
    handle.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== 0 || input.disabled) return;
      if (grab && root.activeElement === input) return; // typing in it: leave the pointer alone
      if (!grab) e.preventDefault();
      const x0 = e.clientX;
      const v0 = parseFloat(input.value) || 0;
      let moved = false;
      const move = (m: PointerEvent) => {
        const dx = m.clientX - x0;
        if (!moved && Math.abs(dx) < 3) return;
        if (!moved) {
          moved = true;
          handle.classList.add('scrubbing');
          if (grab) input.blur();
          try {
            handle.setPointerCapture(m.pointerId);
          } catch {
            /* no active pointer (synthetic events) */
          }
        }
        const next = v0 + Math.round(dx / 2) * step * (m.shiftKey ? 10 : 1);
        input.value = fmt(f.kind === 'px' ? Math.max(0, next) : Math.max(0.5, next));
        hooks.onScrub({ [f.prop]: valueOf(input.value) });
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        handle.classList.remove('scrubbing');
        if (!moved) return grab ? undefined : input.focus();
        hooks.onScrub(null);
        input.dispatchEvent(new Event('change'));
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    // Arrow keys step the value (Shift = x10, Alt = fine) and save once typing pauses.
    let pause: number | undefined;
    (input as HTMLInputElement).addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const by = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * step * (e.key === 'ArrowUp' ? 1 : -1);
      const next = (parseFloat(input.value) || 0) + by;
      input.value = fmt(f.kind === 'px' ? Math.max(0, next) : Math.max(0.5, next));
      clearTimeout(pause);
      pause = window.setTimeout(() => input.dispatchEvent(new Event('change')), 350);
    });
  };

  /** One property field. `mini` is the compact box-model cell: no visible label (it sits on its side of the box). */
  const makeField = (f: Field, mini: boolean) => {
    const label = document.createElement('label');
    label.className = mini ? 'f mini' : 'f';
    if (f.kind === 'px' && !mini) label.dataset.unit = 'px';
    let name: HTMLSpanElement | null = null;
    if (!mini) {
      name = document.createElement('span');
      name.textContent = f.label;
      label.append(name);
    }
    let input: HTMLInputElement | HTMLSelectElement;
    if (f.kind === 'weight') {
      input = document.createElement('select');
      for (const w of ['100', '200', '300', '400', '500', '600', '700', '800', '900']) input.add(new Option(w, w));
    } else {
      input = document.createElement('input');
      input.type = f.kind === 'color' ? 'color' : 'number';
      if (f.kind === 'ratio') (input as HTMLInputElement).step = '0.05';
    }
    input.dataset.prop = f.prop;
    if (mini) {
      const [type, side] = f.prop.split('-');
      input.setAttribute('aria-label', `${type === 'padding' ? 'Padding' : 'Margin'} ${SIDE_WORD[side]}, pixels`);
      input.title = `${f.prop} (drag sideways to scrub)`;
    }
    input.addEventListener('change', () => {
      const v = input.value;
      if (v === '') return;
      hooks.onStyle({ [f.prop]: f.kind === 'px' ? `${v}px` : v }, shared.checked ? 'rule' : 'auto');
      label.classList.add('flash');
      window.setTimeout(() => label.classList.remove('flash'), 700);
    });
    if (f.kind === 'px' || f.kind === 'ratio') {
      if (name) {
        label.classList.add('scrub');
        wireScrub(name, input, f, false);
      } else wireScrub(input, input, f, true);
    }
    inputs.set(f.prop, input);
    if (f.kind === 'color') {
      // The swatch opens the native picker; the text box takes a typed or pasted hex.
      const hexIn = document.createElement('input');
      hexIn.type = 'text';
      hexIn.className = 'hex';
      hexIn.maxLength = 9;
      hexIn.spellcheck = false;
      hexIn.dataset.hex = f.prop;
      hexIn.setAttribute('aria-label', 'Colour, hex');
      hexInputs.set(f.prop, hexIn);
      input.addEventListener('input', () => (hexIn.value = input.value));
      hexIn.addEventListener('change', () => {
        const hexValue = normalizeHex(hexIn.value);
        hexIn.setAttribute('aria-invalid', String(!hexValue));
        if (!hexValue) return void hooks.onInvalid?.('Use a hex colour such as #1d1b17');
        hexIn.value = hexValue;
        (input as HTMLInputElement).value = hexValue.slice(0, 7);
        hooks.onStyle({ [f.prop]: hexValue }, shared.checked ? 'rule' : 'auto');
        label.classList.add('flash');
        window.setTimeout(() => label.classList.remove('flash'), 700);
      });
      const row = document.createElement('div');
      row.className = 'colorrow';
      row.append(input, hexIn);
      label.append(row);
    } else label.append(input);
    return label;
  };

  let grid: HTMLDivElement | null = null;
  for (const f of FIELDS) {
    if (f.group) {
      const h = document.createElement('h4');
      h.textContent = f.group;
      fieldsEl.append(h);
      if (f.group === 'Spacing') {
        // Margin and padding as one nested box: the eight values sit on their sides instead of eight rows.
        const box = document.createElement('div');
        box.className = 'boxm';
        const cell = (kind: string, side: string) => `<div class="c ${side[0]}" data-cell="${kind}-${side}"></div>`;
        const sides = (kind: string) => ['top', 'left', 'right', 'bottom'].map((x) => cell(kind, x));
        box.innerHTML = `<span class="cap">Margin</span>${sides('margin').slice(0, 2).join('')}<div class="boxp"><span class="cap">Padding</span>${sides('padding').slice(0, 2).join('')}<div class="core"></div>${sides('padding').slice(2).join('')}</div>${sides('margin').slice(2).join('')}`;
        fieldsEl.append(box);
        grid = null;
      } else {
        grid = document.createElement('div');
        grid.className = 'grid';
        fieldsEl.append(grid);
      }
    }
    const boxed = /^(padding|margin)-/.test(f.prop);
    const field = makeField(f, boxed);
    if (boxed) fieldsEl.querySelector(`[data-cell="${f.prop}"]`)!.append(field);
    else (grid ?? fieldsEl.querySelector<HTMLElement>('.grid:last-of-type')!).append(field);
  }

  root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.addEventListener('click', () => hooks.onMode(b.dataset.mode as Mode)));
  root.querySelector('[data-act=undo]')!.addEventListener('click', () => hooks.onUndo());
  undoBtn.addEventListener('click', () => ((toastEl.hidden = true), hooks.onUndo()));
  root.querySelector('[data-act=toast-x]')!.addEventListener('click', () => ((statusEl.textContent = ''), (toastEl.hidden = true)));
  root.querySelector('[data-act=redo]')!.addEventListener('click', () => hooks.onRedo());
  root.querySelector('[data-act=parent]')!.addEventListener('click', () => hooks.onParent());
  // Which side the panel sits on; remembered per browser, never required.
  try {
    if (localStorage.getItem('brushup:dock') === 'left') panel.classList.add('left');
  } catch {
    /* storage can be blocked */
  }
  const header = $<HTMLElement>('header');
  const moveTo = (left: number, top: number) => {
    const x = Math.min(Math.max(left, 8), Math.max(8, innerWidth - panel.offsetWidth - 8));
    const y = Math.min(Math.max(top, 8), Math.max(8, innerHeight - 56));
    Object.assign(panel.style, { left: `${x}px`, top: `${y}px`, right: 'auto', maxHeight: `${Math.max(120, innerHeight - y - 8)}px` });
  };
  const saved = () => {
    try {
      return JSON.parse(localStorage.getItem('brushup:pos') ?? 'null') as { x: number; y: number } | null;
    } catch {
      return null;
    }
  };
  const park = saved();
  if (park && Number.isFinite(park.x) && Number.isFinite(park.y)) moveTo(park.x, park.y);
  addEventListener('resize', () => panel.style.right === 'auto' && moveTo(panel.getBoundingClientRect().left, panel.getBoundingClientRect().top));
  // Drag the header to put the panel anywhere; the spot is remembered per browser.
  header.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as Element).closest('button')) return;
    e.preventDefault();
    try {
      header.setPointerCapture(e.pointerId); // keeps the drag alive if the pointer outruns the header
    } catch {
      /* no active pointer (synthetic events) */
    }
    const box = panel.getBoundingClientRect();
    const dx = e.clientX - box.left;
    const dy = e.clientY - box.top;
    const move = (m: PointerEvent) => moveTo(m.clientX - dx, m.clientY - dy);
    const up = () => {
      header.removeEventListener('pointermove', move);
      header.removeEventListener('pointerup', up);
      header.removeEventListener('pointercancel', up);
      if (panel.style.right !== 'auto') return;
      try {
        localStorage.setItem('brushup:pos', JSON.stringify({ x: parseFloat(panel.style.left), y: parseFloat(panel.style.top) }));
      } catch {
        /* storage can be blocked */
      }
    };
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', up);
    header.addEventListener('pointercancel', up);
  });
  // The dock button snaps the panel back to a side (and flips it if it was already docked).
  root.querySelector('[data-act=dock]')!.addEventListener('click', () => {
    const dragged = panel.style.right === 'auto';
    for (const k of ['left', 'top', 'right', 'maxHeight'] as const) panel.style[k] = '';
    const left = dragged ? panel.classList.contains('left') : panel.classList.toggle('left');
    try {
      localStorage.removeItem('brushup:pos');
      localStorage.setItem('brushup:dock', left ? 'left' : 'right');
    } catch {
      /* storage can be blocked */
    }
  });

  /* ----- guided tour ----- */
  const tourEl = $<HTMLElement>('.tour');
  const ring = $<HTMLElement>('.tour-ring');
  const tourDot = root.querySelector<HTMLElement>('[data-act=tour] .dot')!;
  const STEPS: { sel: string | null; title: string; body: string }[] = [
    { sel: null, title: 'Click to select', body: 'Click any element on your page to select it. Shift-click adds more; drag on empty space to box-select. Esc deselects.' },
    { sel: null, title: 'Move and resize', body: 'Drag an element to move it, or pull its handles to resize. Arrow keys nudge by 1px (hold Shift for 10). Guides snap to neighbours; hold Ctrl/Cmd to turn that off.' },
    { sel: '.info', title: 'Change the style', body: 'The fields for the selected element appear here: size, colour, spacing, width. Every change is written straight into your source file.' },
    { sel: null, title: 'Edit text in place', body: 'Double-click text to retype it. If the text comes from data Brushup can’t edit, it pins a note for Claude instead.' },
    { sel: '[data-tab=notes]', title: 'Leave notes for Claude', body: 'Press N on a selected section or component to pin a note. Claude reads your notes and picks them up from your project.' },
    { sel: '[data-tab=changes]', title: 'Review what changed', body: 'The Changes tab shows the git diff of your project, with the files Brushup edited marked. Check it, copy it, then commit when you like it.' },
    { sel: '.actions', title: 'Undo anything', body: 'Undo and redo every edit, or select the parent element. Every change is a small edit to your files, so git shows it too.' },
    { sel: '.seg', title: 'Preview', body: 'Switch to Preview to use the page normally, with no selection getting in the way. Switch back to Edit to keep tweaking.' },
  ];
  let step = -1;
  const showStep = (i: number) => {
    step = i;
    const st = STEPS[i];
    tourEl.hidden = false;
    tourEl.querySelector('h3')!.textContent = st.title;
    tourEl.querySelector('p')!.textContent = st.body;
    tourEl.querySelector('.n')!.textContent = `${i + 1} / ${STEPS.length}`;
    tourEl.querySelector<HTMLElement>('.back')!.hidden = i === 0;
    tourEl.querySelector<HTMLElement>('.skip:not(.back)')!.hidden = i === STEPS.length - 1;
    tourEl.querySelector('.next')!.textContent = i === STEPS.length - 1 ? 'Done' : 'Next';
    const pr = panel.getBoundingClientRect();
    const target = st.sel ? root.querySelector<HTMLElement>(st.sel) : null;
    const tr = target?.getBoundingClientRect();
    ring.hidden = !tr;
    if (tr) Object.assign(ring.style, { left: `${tr.left - 4}px`, top: `${tr.top - 4}px`, width: `${tr.width + 8}px`, height: `${tr.height + 8}px` });
    const w = 264, h = tourEl.offsetHeight || 150, gap = 14;
    const onRight = pr.left + pr.width / 2 > innerWidth / 2;
    const left = Math.max(8, Math.min(innerWidth - w - 8, onRight ? pr.left - w - gap : pr.right + gap));
    const top = Math.max(8, Math.min(innerHeight - h - 8, tr ? tr.top : pr.top));
    Object.assign(tourEl.style, { left: `${left}px`, top: `${top}px` });
    tourEl.querySelector<HTMLElement>('.next')!.focus();
  };
  const endTour = () => {
    step = -1;
    tourEl.hidden = true;
    ring.hidden = true;
    tourDot.hidden = true;
    try {
      localStorage.setItem('brushup:tour', 'seen');
    } catch {
      /* storage can be blocked */
    }
  };
  try {
    tourDot.hidden = localStorage.getItem('brushup:tour') === 'seen';
  } catch {
    tourDot.hidden = false;
  }
  root.querySelector('[data-act=tour]')!.addEventListener('click', () => (step < 0 ? showStep(0) : endTour()));
  tourEl.querySelector('.next')!.addEventListener('click', () => (step >= STEPS.length - 1 ? endTour() : showStep(step + 1)));
  tourEl.querySelector('.back')!.addEventListener('click', () => step > 0 && showStep(step - 1));
  tourEl.querySelector('.skip:not(.back)')!.addEventListener('click', endTour);
  tourEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') endTour();
    else if (e.key === 'ArrowRight') (e.preventDefault(), tourEl.querySelector<HTMLElement>('.next')!.click());
    else if (e.key === 'ArrowLeft') (e.preventDefault(), tourEl.querySelector<HTMLElement>('.back')!.click());
    e.stopPropagation();
  });

  /* ----- tabs ----- */
  /** Slide a marker under the active tab / mode button. */
  const slide = (marker: HTMLElement, active: HTMLElement | null) => {
    if (!active || !active.offsetWidth) return;
    marker.style.left = `${active.offsetLeft}px`;
    marker.style.width = `${active.offsetWidth}px`;
  };
  const moveInk = () => {
    slide($<HTMLElement>('.tabs .ink'), root.querySelector<HTMLElement>('[data-tab][aria-selected=true]'));
    slide($<HTMLElement>('.seg .thumb'), root.querySelector<HTMLElement>('[data-mode][aria-pressed=true]'));
  };
  const showTab = (tab: 'style' | 'notes' | 'changes' | 'a11y') => {
    root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => (b.setAttribute('aria-selected', String(b.dataset.tab === tab)), (b.tabIndex = b.dataset.tab === tab ? 0 : -1)));
    root.querySelectorAll<HTMLElement>('[data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== tab));
    moveInk();
    if (tab === 'changes') hooks.onChangesRefresh();
    if (tab === 'a11y') hooks.onA11yScan();
  };
  requestAnimationFrame(moveInk);
  document.fonts?.ready.then(moveInk);
  root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab as 'style' | 'notes' | 'changes' | 'a11y')));
  // Arrow keys move between tabs (the tablist pattern); only the active tab is in the Tab order.
  $<HTMLElement>('.tabs').addEventListener('keydown', (e: KeyboardEvent) => {
    const order = ['style', 'notes', 'changes', 'a11y'] as const;
    const at = order.findIndex((t) => root.querySelector<HTMLElement>(`[data-tab=${t}]`)!.getAttribute('aria-selected') === 'true');
    const n = order.length;
    const to = e.key === 'ArrowRight' ? (at + 1) % n : e.key === 'ArrowLeft' ? (at + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    showTab(order[to]);
    root.querySelector<HTMLElement>(`[data-tab=${order[to]}]`)!.focus();
  });

  /* ----- composer ----- */
  let editingId: string | null = null;
  const field = (name: string) => composer.elements.namedItem(name) as HTMLInputElement;
  const closeComposer = () => {
    composer.hidden = true;
    editingId = null;
    composer.reset();
  };
  addBtn.addEventListener('click', () => api.openComposer());
  root.querySelector('[data-act=cancel-note]')!.addEventListener('click', closeComposer);
  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = field('text').value.trim();
    if (!text) return;
    hooks.onNoteSave({ kind: field('kind').value as NoteKind, label: field('label').value.trim(), text }, editingId);
    closeComposer();
  });

  const place = (box: HTMLElement, el: Element | null) => {
    if (!el || !el.isConnected) return void (box.hidden = true);
    const r = el.getBoundingClientRect();
    box.hidden = false;
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  };

  let status: number | undefined;
  let lastSelected: Element | null = null;
  let target = '';
  let suggestedKind: NoteKind = 'element';
  const pinEls = new Map<string, HTMLDivElement>();
  const handleEls = new Map<HandleKind, HTMLDivElement>();
  const extraEls: HTMLDivElement[] = [];
  let hoverHandle: HandleKind | null = null;

  /** Create the grip for `kind` on first use. Spacing grips are pills, resize grips are squares. */
  const handleEl = (kind: HandleKind) => {
    let el = handleEls.get(kind);
    if (el) return el;
    el = document.createElement('div');
    const type = kind.startsWith('resize') ? 'resize' : kind.slice(0, 3);
    const side = kind.slice(-1);
    const orient =
      kind === 'resize-e' || kind === 'resize-w' ? 'horz' : kind === 'resize-s' || kind === 'resize-n' ? 'vert' : kind === 'resize-se' || kind === 'resize-nw' ? 'se' : kind === 'resize-ne' || kind === 'resize-sw' ? 'ne' : side === 't' || side === 'b' ? 'vert' : 'horz';
    el.className = `h ${type} ${orient}`;
    el.dataset.kind = kind;
    el.title = kind.startsWith('resize') ? 'Drag to resize (Shift = free); the left and top edges also move the element' : kind.startsWith('pad') ? 'Padding: drag inward to grow' : 'Margin: drag outward to grow';
    el.addEventListener('pointerenter', () => (hoverHandle = kind));
    el.addEventListener('pointerleave', () => (hoverHandle = hoverHandle === kind ? null : hoverHandle));
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        el!.setPointerCapture(e.pointerId); // keeps the drag alive if the pointer leaves the grip
      } catch {
        /* no active pointer (synthetic events) */
      }
      hooks.onHandleDown(kind, e);
    });
    handlesEl.append(el);
    handleEls.set(kind, el);
    return el;
  };

  /** Overlap in px² between two boxes. */
  const overlap = (a: { left: number; right: number; top: number; bottom: number }, b: { left: number; right: number; top: number; bottom: number }) =>
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

  const setMini = (on: boolean) => {
    panel.classList.toggle('mini', on);
    root.querySelector('[data-act=mini]')?.setAttribute('aria-expanded', String(!on));
  };
  root.querySelector('[data-act=mini]')!.addEventListener('click', () => {
    panel.style.top = panel.style.maxHeight = '';
    setMini(!panel.classList.contains('mini'));
  });

  /**
   * Keep a newly selected element clear of the panel: hop to the other side if that covers less of it and,
   * when neither side is clear (a full-width element), shrink into the free band above or below it.
   * Measured just after, once the panel has filled in with the element's fields.
   */
  const dodge = (el: Element | null) => {
    if (!el || panel.style.right === 'auto' || panel.classList.contains('preview')) return;
    const place = () => {
      panel.style.top = panel.style.maxHeight = '';
      setMini(false);
      const r = el.getBoundingClientRect();
      const pad = 14; // room for the handles and the tag around the element
      const box = { left: r.left - pad, right: r.right + pad, top: r.top - pad, bottom: r.bottom + pad };
      const area = (box.right - box.left) * (box.bottom - box.top);
      const p = panel.getBoundingClientRect();
      if (!r.width || !r.height || !p.width || !area) return;
      const share = (side: 'left' | 'right') => {
        const left = side === 'left' ? 14 : innerWidth - 14 - p.width;
        return overlap(box, { left, right: left + p.width, top: p.top, bottom: p.bottom }) / area;
      };
      const onLeft = panel.classList.contains('left');
      const now = share(onLeft ? 'left' : 'right');
      if (now < 0.02) return;
      const there = share(onLeft ? 'right' : 'left');
      let best = now;
      if (there < now) {
        panel.classList.toggle('left');
        panel.style.animation = 'none';
        void panel.offsetWidth;
        panel.style.animation = '';
        best = there;
      }
      if (best < 0.02) return;
      // Neither side is clear: use whichever vertical band is taller, and let the panel scroll inside it.
      const above = box.top - 28;
      const below = innerHeight - box.bottom - 28;
      const room = Math.max(above, below);
      if (room < 220) {
        // No band tall enough: shrink to just the header, in whichever top or bottom corner covers less.
        setMini(true);
        const h = panel.getBoundingClientRect().height;
        const side = panel.classList.contains('left') ? 14 : innerWidth - 14 - p.width;
        const at = (top: number) => overlap(box, { left: side, right: side + p.width, top, bottom: top + h });
        const bottom = innerHeight - 14 - h;
        panel.style.top = `${at(bottom) < at(14) ? bottom : 14}px`;
        return;
      }
      panel.style.maxHeight = `${room}px`;
      panel.style.top = `${above >= below ? 14 : innerHeight - 14 - Math.min(room, p.height)}px`;
    };
    window.setTimeout(place, 0);
  };

  /* ----- accessibility ----- */
  const a11ySum = $<HTMLElement>('.a11ysum');
  const a11yList = $<HTMLElement>('.a11ylist');
  const a11yCount = $<HTMLElement>('[data-a11y-count]');
  const a11yNote = $<HTMLElement>('.a11ynote');
  const whatEl = $<HTMLElement>('.a11ywhat div');
  for (const [heading, rules] of [['Accessibility', RULES], ['Design', DESIGN_RULES]] as const) {
    const h = document.createElement('h4');
    h.textContent = heading;
    const ul = document.createElement('ul');
    for (const r of rules) {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = `${r.label}: `;
      li.append(b, r.what);
      ul.append(li);
    }
    whatEl.append(h, ul);
  }
  let a11yAll: A11yView[] = [];
  let a11yFilter: 'all' | 'accessibility' | 'design' = 'all';
  const filterBtns = [...root.querySelectorAll<HTMLButtonElement>('.a11yfilter button')];
  root.querySelector('[data-act=a11y-scan]')!.addEventListener('click', () => {
    a11ySum.textContent = 'Checking…';
    hooks.onA11yScan();
  });
  const renderA11y = () => {
    const issues = a11yAll.filter((i) => a11yFilter === 'all' || i.category === a11yFilter);
    const n = (c: string) => a11yAll.filter((i) => i.category === c).length;
    filterBtns.forEach((b) => {
      const f = b.dataset.filter!;
      b.setAttribute('aria-pressed', String(f === a11yFilter));
      b.textContent = `${{ all: 'All', accessibility: 'Accessibility', design: 'Design' }[f]} ${f === 'all' ? a11yAll.length : n(f)}`;
    });
    a11yList.textContent = '';
    a11yCount.hidden = a11yAll.length === 0;
    a11yCount.textContent = String(a11yAll.length);
    const what = a11yFilter === 'all' ? '' : `${a11yFilter} `;
    a11ySum.textContent = issues.length ? `${issues.length} ${what}issue${issues.length === 1 ? '' : 's'}` : `No ${what}issues found`;
    a11yNote.hidden = false;
    for (const issue of issues) {
      const item = document.createElement('div');
      item.className = 'a11yitem';
      const rule = document.createElement('span');
      rule.className = `rule${issue.category === 'design' ? ' design' : ''}`;
      rule.textContent = `${issue.category === 'design' ? 'Design · ' : ''}${[...RULES, ...DESIGN_RULES].find((r) => r.rule === issue.rule)?.label ?? issue.rule}`;
      const title = document.createElement('b');
      title.textContent = issue.title; // text only: this comes from the page being inspected
      const detail = document.createElement('p');
      detail.textContent = issue.detail;
      const acts = document.createElement('div');
      acts.className = 'acts';
      const act = (label: string, fn: () => void, cls = '') => {
        const b = document.createElement('button');
        b.textContent = label;
        if (cls) b.className = cls;
        b.addEventListener('click', fn);
        acts.append(b);
      };
      if (issue.fix) act(issue.fix, () => hooks.onA11yFix(issue.id), 'apply');
      act('Locate', () => hooks.onA11yLocate(issue.id));
      act('Send to Claude', () => hooks.onA11yNote(issue.id));
      item.append(rule, title, detail, acts);
      if (issue.learn?.startsWith('https://www.w3.org/')) {
        const learn = document.createElement('a');
        learn.className = 'learn';
        learn.href = issue.learn; // always one of our own W3C links, never anything from the page
        learn.target = '_blank';
        learn.rel = 'noopener noreferrer';
        learn.textContent = 'Learn more ↗';
        item.append(learn);
      }
      a11yList.append(item);
    }
  };
  const setA11y = (issues: A11yView[]) => {
    a11yAll = issues;
    renderA11y();
  };
  filterBtns.forEach((b) =>
    b.addEventListener('click', () => {
      a11yFilter = b.dataset.filter as typeof a11yFilter;
      renderA11y();
    }),
  );

  /* ----- changes (git diff) ----- */
  const chSum = $<HTMLElement>('.chsum');
  const chList = $<HTMLElement>('.chlist');
  const chCopy = $<HTMLButtonElement>('[data-act=changes-copy]');
  let chText = '';
  root.querySelector('[data-act=changes-refresh]')!.addEventListener('click', () => {
    chSum.textContent = 'Loading…';
    hooks.onChangesRefresh();
  });
  chCopy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(chText).then(
      () => ((chCopy.textContent = 'Copied'), setTimeout(() => (chCopy.textContent = 'Copy diff'), 1400)),
      () => ((chCopy.textContent = 'Copy failed'), setTimeout(() => (chCopy.textContent = 'Copy diff'), 1400)),
    );
  });
  const setChanges = (view: ChangesView | null) => {
    chList.textContent = '';
    chText = '';
    chCopy.disabled = true;
    const note = (text: string) => {
      const p = document.createElement('p');
      p.className = 'chnote';
      p.textContent = text;
      chList.append(p);
    };
    if (!view) return void (chSum.textContent = 'Could not load the changes');
    if (!view.repo) return (chSum.textContent = 'No git repository'), note(view.reason);
    const mine = view.files.filter((f) => f.byBrushup);
    const other = view.files.length - mine.length;
    chSum.textContent = view.files.length ? `${view.files.length} changed` : 'No changes';
    chSum.title = `Compared with the last commit on ${view.branch}`;
    if (!view.files.length) return note('Nothing differs from the last commit yet. Edits you make on the canvas show up here.');
    for (const f of view.files) {
      const d = document.createElement('details');
      d.className = 'chfile';
      const sum = document.createElement('summary');
      const st = document.createElement('span');
      st.className = 'chst';
      st.textContent = f.status;
      const nm = document.createElement('span');
      nm.className = 'chnm';
      nm.textContent = f.file; // text only: file names and diffs are the project's data
      nm.title = f.file;
      const add = document.createElement('span');
      add.className = 'chadd';
      add.textContent = f.additions ? `+${f.additions}` : '';
      const del = document.createElement('span');
      del.className = 'chdel';
      del.textContent = f.deletions ? `−${f.deletions}` : '';
      sum.append(st, nm, add, del);
      if (f.byBrushup) {
        const by = document.createElement('span');
        by.className = 'chby';
        by.textContent = 'Brushup';
        sum.append(by);
      }
      d.append(sum);
      const pre = document.createElement('pre');
      if (!f.diff) {
        const line = document.createElement('span');
        line.className = 'chh';
        line.textContent = f.status === '?' ? 'New file, not tracked by git yet.' : 'No diff shown (binary, or too large).';
        pre.append(line);
      }
      for (const raw of f.diff.split('\n')) {
        if (!raw || /^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(raw)) continue;
        const line = document.createElement('span');
        line.className = raw.startsWith('@@') ? 'chh' : raw[0] === '+' ? 'cha' : raw[0] === '-' ? 'chd' : '';
        line.textContent = raw;
        pre.append(line);
      }
      d.append(pre);
      if (f.byBrushup && mine.length === 1) d.open = true;
      chList.append(d);
    }
    if (view.truncated) note('Some diffs were too large to show.');
    if (mine.length && other) note(`${other} other file${other === 1 ? '' : 's'} changed outside Brushup. They're listed here too, so a commit of everything would include them.`);
    chText = view.files.map((f) => f.diff).filter(Boolean).join('\n');
    chCopy.disabled = !chText;
  };

  const api = {
    host,
    root,
    setMode(mode: Mode) {
      panel.classList.toggle('preview', mode === 'preview');
      root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
      moveInk();
      if (mode === 'preview') (hoverBox.hidden = true), (selBox.hidden = true), pinsEl.setAttribute('hidden', ''), handlesEl.setAttribute('hidden', '');
      else (pinsEl.removeAttribute('hidden'), handlesEl.removeAttribute('hidden'));
    },
    /** Tell the panel where the project is on disk (for open-in-editor links). */
    setRoot(root: string) {
      projectRoot = root;
    },
    /** A short toast at the bottom of the page. `undo` adds an Undo button; errors stay until dismissed. */
    setStatus(text: string, kind: 'ok' | 'warn' | 'err' | '' = '', opts: { undo?: boolean } = {}) {
      statusEl.textContent = text;
      statusEl.className = `status ${kind}`;
      toastEl.className = `toast ${kind}`;
      toastEl.hidden = !text;
      undoBtn.hidden = !opts.undo;
      toastEl.style.animation = 'none';
      void toastEl.offsetWidth;
      toastEl.style.animation = '';
      clearTimeout(status);
      if (text && kind !== 'err') status = window.setTimeout(() => ((statusEl.textContent = ''), (toastEl.hidden = true)), kind === 'warn' ? 8000 : opts.undo ? 4500 : 2200);
    },
    /** Reposition outlines. Cheap enough to run every frame. */
    layout(hovered: Element | null, selected: Element | null, active: boolean) {
      if (selected !== lastSelected) {
        // Glide the outline to a newly chosen element, but never while it follows a drag.
        if (lastSelected && selected) {
          selBox.classList.add('glide');
          window.setTimeout(() => selBox.classList.remove('glide'), 180);
        }
        lastSelected = selected;
        dodge(selected);
      }
      place(hoverBox, active && hovered !== selected ? hovered : null);
      place(selBox, active ? selected : null);
    },
    /** Drop focus from any panel field so keyboard shortcuts and fresh values reach the canvas. */
    blur() {
      (root.activeElement as HTMLElement | null)?.blur();
    },
    /** Fill the property fields from the element's computed style. `detail` is a source hint shown under the tag. */
    show(el: HTMLElement | null, detail = '', noteTarget = '', suggest: NoteKind = 'element', src: SourceRef | null = null) {
      fieldsEl.hidden = sharedLabel.hidden = !el;
      target = noteTarget;
      suggestedKind = suggest;
      addBtn.disabled = !el;
      addBtn.textContent = el ? `+ Add a note on ${noteTarget || 'this element'}` : 'Select an element to add a note';
      if (!el) {
        info.textContent = 'Click an element to select it.';
        info.classList.add('idle');
        selTag.textContent = '';
        return;
      }
      info.classList.remove('idle');
      const cs = getComputedStyle(el);
      // shadcn-style components carry dozens of classes; the first few identify the element.
      const classes = [...el.classList];
      const cls = classes.slice(0, 3).map((c) => `.${c}`).join('') + (classes.length > 3 ? ` +${classes.length - 3}` : '');
      info.innerHTML = '';
      const b = document.createElement('b');
      b.textContent = `<${el.tagName.toLowerCase()}>${el.id ? `#${el.id}` : ''}${cls}`;
      info.append(b);
      if (src) {
        info.append(document.createElement('br'), src.prefix);
        const link = document.createElement('a');
        link.className = 'src';
        link.textContent = src.shown;
        const url = editorUrl(src);
        if (url) (link.href = url), (link.title = 'Open in your editor');
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'copy';
        copy.title = 'Copy path';
        copy.setAttribute('aria-label', 'Copy file path');
        copy.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/></svg>';
        copy.addEventListener('click', () => {
          const where = `${src.path}:${src.line}`;
          void navigator.clipboard?.writeText(where).then(() => api.setStatus(`Copied ${where}`, 'ok'));
        });
        info.append(link, copy);
        if (detail) info.append(` · ${detail}`);
      } else if (detail) info.append(document.createElement('br'), detail);
      selTag.textContent = el.tagName.toLowerCase();
      const container = /flex|grid/.test(cs.display);
      for (const f of FIELDS) {
        const input = inputs.get(f.prop)!;
        if (document.activeElement === input || root.activeElement === input) continue;
        const raw = cs.getPropertyValue(f.prop);
        if (f.kind === 'px') input.value = Number.isFinite(parseFloat(raw)) ? round(parseFloat(raw)) : '';
        else if (f.kind === 'ratio') input.value = raw === 'normal' ? '1.2' : round(parseFloat(raw) / parseFloat(cs.fontSize), 2);
        else if (f.kind === 'color') {
          const h = toHex(raw);
          input.value = h.slice(0, 7);
          const box = hexInputs.get(f.prop);
          if (box && root.activeElement !== box) (box.value = h), box.removeAttribute('aria-invalid');
        }
        else input.value = String(Math.round(parseInt(raw, 10) / 100) * 100);
        input.disabled = !!f.needsContainer && !container;
      }
    },

    /* ----- notes ----- */
    /** Open the composer for a new note on the selection, or to edit an existing one. */
    openComposer(existing?: NoteView) {
      if (!existing && addBtn.disabled) return;
      showTab('notes');
      composer.hidden = false;
      editingId = existing?.id ?? null;
      composerTarget.textContent = existing ? `Editing note ${existing.n}` : `Note on ${target || 'this element'}`;
      field('kind').value = existing?.kind ?? suggestedKind;
      field('label').value = existing?.label ?? '';
      field('text').value = existing?.text ?? '';
      field('text').focus();
    },
    /** Fill the A11y tab. */
    setA11y,
    a11yOpen: () => !root.querySelector<HTMLElement>('[data-pane=a11y]')!.hidden,
    /** Fill the Changes tab. */
    setChanges,
    changesOpen: () => !root.querySelector<HTMLElement>('[data-pane=changes]')!.hidden,
    setNotes(notes: NoteView[], elsewhere: number) {
      const open = notes.filter((n) => !n.done).length;
      countEl.hidden = open === 0;
      countEl.textContent = String(open);
      listEl.textContent = '';
      if (!notes.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = `No notes on this page yet.${elsewhere ? ` (${elsewhere} on other pages)` : ''} Select an element and press N.`;
        listEl.append(empty);
      }
      for (const n of notes) {
        const item = document.createElement('div');
        item.className = `note${n.done ? ' done' : ''}${n.found ? '' : ' missing'}`;
        const head = document.createElement('div');
        head.className = 'head';
        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = String(n.n);
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = n.label || n.kind;
        const kind = document.createElement('span');
        kind.className = 'kind';
        kind.textContent = n.kind;
        head.append(num, name, kind);
        const text = document.createElement('p');
        text.textContent = n.text;
        item.append(head, text);
        if (!n.found) {
          const warn = document.createElement('p');
          warn.className = 'warn';
          warn.textContent = 'Element not found on this page right now.';
          item.append(warn);
        }
        if (n.reply) {
          const reply = document.createElement('p');
          reply.className = 'reply';
          reply.textContent = `Claude: ${n.reply}`;
          item.append(reply);
        }
        const acts = document.createElement('div');
        acts.className = 'acts';
        const act = (label: string, fn: () => void) => {
          const b = document.createElement('button');
          b.textContent = label;
          b.addEventListener('click', fn);
          acts.append(b);
        };
        if (n.found) act('Locate', () => hooks.onNoteLocate(n.id));
        act('Edit', () => api.openComposer(n));
        act(n.done ? 'Reopen' : 'Done', () => hooks.onNoteDone(n.id, !n.done));
        act('Delete', () => hooks.onNoteDelete(n.id));
        item.append(acts);
        listEl.append(item);
      }
      if (notes.length && elsewhere) {
        const more = document.createElement('div');
        more.className = 'empty';
        more.textContent = `+ ${elsewhere} note${elsewhere === 1 ? '' : 's'} on other pages`;
        listEl.append(more);
      }
    },
    /** Position the numbered pins. `rect` null hides a pin whose element isn't on screen. */
    layoutPins(pins: { id: string; n: number; rect: DOMRect | null; done: boolean }[], onClick: (id: string) => void) {
      const live = new Set(pins.map((p) => p.id));
      for (const [id, el] of pinEls) if (!live.has(id)) (el.remove(), pinEls.delete(id));
      for (const p of pins) {
        let el = pinEls.get(p.id);
        if (!el) {
          el = document.createElement('div');
          el.className = 'pin';
          el.addEventListener('click', (e) => (e.stopPropagation(), onClick(p.id)));
          pinsEl.append(el);
          pinEls.set(p.id, el);
        }
        el.textContent = String(p.n);
        el.classList.toggle('done', p.done);
        el.hidden = !p.rect;
        if (p.rect) {
          // Just outside the element's top-left corner, so it doesn't sit on the selection's tag.
          el.style.left = `${Math.min(Math.max(p.rect.left - 14, 12), innerWidth - 12)}px`;
          el.style.top = `${Math.min(Math.max(p.rect.top - 6, 12), innerHeight - 12)}px`;
        }
      }
    },
    showNotesTab: () => showTab('notes'),
    /** Fade the panel out of the way while a drag on the page is under it. */
    setGhost: (on: boolean) => panel.classList.toggle('ghost', on),

    /* ----- drag handles ----- */
    /**
     * Place the resize / padding / margin grips around the selection (`info` null hides them all).
     * While a spacing grip is hovered or dragged (`active`) the matching margin or padding band is drawn.
     */
    layoutHandles(info: HandleInfo | null, active: HandleKind | null) {
      const r = info?.rect;
      const visible = !!info && r!.width > 0 && r!.height > 0 && r!.right > 0 && r!.bottom > 0 && r!.left < innerWidth && r!.top < innerHeight;
      const roomy = visible && Math.min(r!.width, r!.height) >= 48;
      for (const kind of HANDLE_KINDS) {
        const el = handleEl(kind);
        // The extra edge and corner grips would crowd a tiny element, so they wait until it has some room.
        const extra = ['resize-w', 'resize-n', 'resize-nw', 'resize-ne', 'resize-sw'].includes(kind);
        const show = visible && (kind.startsWith('pad') ? roomy : extra ? Math.min(r!.width, r!.height) >= 24 : true);
        el.hidden = !show;
        if (!show) continue;
        const cx = r!.left + r!.width / 2;
        const cy = r!.top + r!.height / 2;
        const OFFSET = 14;
        const pos: Record<string, [number, number]> = {
          'resize-e': [r!.right, cy],
          'resize-s': [cx, r!.bottom],
          'resize-se': [r!.right, r!.bottom],
          'resize-w': [r!.left, cy],
          'resize-n': [cx, r!.top],
          'resize-nw': [r!.left, r!.top],
          'resize-ne': [r!.right, r!.top],
          'resize-sw': [r!.left, r!.bottom],
          'pad-t': [cx, r!.top + OFFSET],
          'pad-b': [cx, r!.bottom - OFFSET],
          'pad-l': [r!.left + OFFSET, cy],
          'pad-r': [r!.right - OFFSET, cy],
          'mar-t': [cx, r!.top - OFFSET],
          'mar-b': [cx, r!.bottom + OFFSET],
          'mar-l': [r!.left - OFFSET, cy],
          'mar-r': [r!.right + OFFSET, cy],
        };
        el.style.left = `${pos[kind][0]}px`;
        el.style.top = `${pos[kind][1]}px`;
      }
      const shown = active ?? hoverHandle;
      const band = (el: HTMLElement, on: boolean, box?: { left: number; top: number; width: number; height: number; widths: Sides } | null) => {
        el.hidden = !on || !box;
        if (!on || !box) return;
        Object.assign(el.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, borderWidth: `${box.widths.t}px ${box.widths.r}px ${box.widths.b}px ${box.widths.l}px` });
      };
      const { mar, pad, border } = info ?? ({} as Partial<HandleInfo>);
      band(bandMar, visible && !!shown?.startsWith('mar'), info && { left: r!.left - mar!.l, top: r!.top - mar!.t, width: r!.width + mar!.l + mar!.r, height: r!.height + mar!.t + mar!.b, widths: mar! });
      band(bandPad, visible && !!shown?.startsWith('pad'), info && { left: r!.left + border!.l, top: r!.top + border!.t, width: r!.width - border!.l - border!.r, height: r!.height - border!.t - border!.b, widths: pad! });
    },
    /** A small label near the cursor while dragging; null hides it. */
    /** The rubber-band box while dragging out a selection (null hides it). */
    setMarquee(box: { left: number; top: number; width: number; height: number } | null) {
      marqueeEl.hidden = !box;
      if (box) Object.assign(marqueeEl.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    },
    /** Alignment lines while dragging: each is a 1px horizontal or vertical segment in viewport coordinates. */
    setGuides(lines: { x1: number; y1: number; x2: number; y2: number }[]) {
      while (guidesEl.children.length > lines.length) guidesEl.lastElementChild!.remove();
      while (guidesEl.children.length < lines.length) guidesEl.append(Object.assign(document.createElement('div'), { className: 'guide' }));
      lines.forEach((l, i) => {
        const g = guidesEl.children[i] as HTMLElement;
        const vertical = l.x1 === l.x2;
        Object.assign(g.style, { left: `${Math.min(l.x1, l.x2)}px`, top: `${Math.min(l.y1, l.y2)}px`, width: vertical ? '1px' : `${Math.abs(l.x2 - l.x1)}px`, height: vertical ? `${Math.abs(l.y2 - l.y1)}px` : '1px' });
      });
    },
    setTip(text: string | null, x = 0, y = 0) {
      tipEl.hidden = text === null;
      if (text === null) return;
      tipEl.textContent = text;
      tipEl.style.left = `${Math.min(x + 14, innerWidth - 160)}px`;
      tipEl.style.top = `${Math.min(y + 14, innerHeight - 28)}px`;
    },
    /** Outlines for every selected element besides the primary one. */
    layoutSelection(extra: Element[]) {
      while (extraEls.length < extra.length) {
        const el = document.createElement('div');
        el.className = 'sel2';
        root.append(el);
        extraEls.push(el);
      }
      extraEls.forEach((el, i) => place(el, extra[i] ?? null));
    },
  };
  return api;
}
