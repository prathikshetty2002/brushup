# Brushup

A visual canvas that runs next to your coding agent.

1. **Trivial changes never touch an LLM.** Drag, resize, retype and re-space elements on the canvas; the edit is written straight into your source (HTML, CSS, JSX, Tailwind). No prompt, no screenshot, no tokens.
2. **Notes make Claude's changes better.** Pin a note on an element, a section or a component. Claude reads `.brushup/notes.md`, which says what you want and exactly which file and line it lives in.

When your agent changes the code, the canvas updates in place.

**New here? Read the [step-by-step guide](docs/GUIDE.md)** (setup, the three workflows with Claude Code, troubleshooting) and watch the demo: `demo/out/brushup-claude-demo.mp4`.

| | Static HTML | Vite (React) | Next.js (App Router) |
| --- | --- | --- | --- |
| Edits go to | HTML / linked CSS | JSX: Tailwind classes or `style={{}}` | JSX: Tailwind classes or `style={{}}` |
| shadcn/ui | n/a | yes | yes |
| Live updates | Brushup's file watcher | Vite HMR | Next Fast Refresh |
| Notes | yes | yes | yes |

## Tested on

| | Tested | Notes |
| --- | --- | --- |
| Node | 22 / 26 locally; dependency ranges verified for **Node 20.9+** | CI runs Node 20, 22 and 24 |
| Next.js | 16.4 (Turbopack and webpack) | `>=15.3` is the lowest version with the stable `turbopack.rules` config |
| Vite | 8 | plugin API is unchanged back to 5, untested |
| React | 19 | |
| Tailwind | 4 | v3 uses the same arbitrary-value classes, untested |
| shadcn/ui | current Base UI version | Radix-based versions forward props the same way, untested |
| Browser | Chrome | Firefox and Safari untested |
| OS | Linux | macOS and Windows untested |

## Quick start (Next.js + Tailwind + shadcn/ui)

```bash
npm install -D brushup         # (or the packed tarball while it is unpublished)
npx brushup init --mcp         # wires next.config / layout / vite.config, adds Claude instructions + MCP server, ignores .brushup/ in git (--no-wire skips the config edits)
```

```ts
// next.config.ts
import { withBrushup } from "brushup/next";
export default withBrushup(nextConfig);
```

```tsx
// app/layout.tsx  (inside <body>)
import { BrushupScript } from "brushup/next/script";
...
<BrushupScript />
```

Run `next dev` as usual. `withBrushup` only acts in `next dev`; in `next build` it does nothing, and `<BrushupScript />` renders nothing (a production build contains no Brushup code or tags; verified on Next 16.4 with Turbopack).

It tags JSX through a build loader that works under both Turbopack (`turbopack.rules`) and webpack. Your own loaders and `webpack()` function keep working. Options: `withBrushup(config, { style: 'auto' | 'tailwind' | 'inline', components: true })`.

## Quick start (Vite + React)

```ts
// vite.config.ts
import brushup from 'brushup/vite'
export default defineConfig({ plugins: [react(), tailwindcss(), brushup()] })
```

## Quick start (plain HTML)

```bash
npx brushup page.html          # http://127.0.0.1:4321
```

## Using the canvas

| Action | How |
| --- | --- |
| Select | Click an element (`Parent` selects its container, `Esc` deselects) |
| Move the panel | **Drag its header** anywhere; the spot is remembered. The dock button snaps it back to a side (and flips sides) |
| Margin and padding | One nested box in the Style panel: the eight values sit on their sides, and **dragging a cell sideways** scrubs it (a click edits the number). The panel hops to the other side when a newly selected element is under it, and fades while you drag on the page |
| Undo from the toast | Every save shows a toast with **Undo**; errors and warnings stay until dismissed |
| Colour | A swatch plus a **hex box** (`#abc`, `#aabbcc`, `#aabbcc80`) in the Style panel |
| Open in editor | In dev modes the selected element's `file:line` is a link that opens your editor at that line (VS Code by default; `localStorage['brushup:editor'] = 'cursor' \| 'windsurf' \| 'zed' \| 'vscode-insiders'`), with a button that copies the path |
| Scrub a value | **Drag a field's label** sideways in the Style panel (Shift = ×10): the page previews it live and the drop saves it. **↑/↓** in a field steps it (Shift ×10, Alt ×0.1) |
| Select several | **Shift+click** to add or remove. Moves, nudges, handle drags and Style-panel changes apply to all of them as **one undo step** |
| Move | Drag (Shift locks to one axis) or arrow keys (Shift = 10px) |
| Resize | Drag the blue squares on the right edge, bottom edge or corner (width / height) |
| Padding | Drag the **green** grips just inside each edge inward to grow it (hidden on elements smaller than 48px) |
| Margin | Drag the **orange** grips just outside each edge outward to grow it |
| Snap | Handle drags snap to the 4px grid (Tailwind's spacing step); hold **Shift** for 1px precision. A label shows the value as you drag, and hovering a padding/margin grip shades the area |
| Edit text | Double-click an element that only contains text; Enter commits, Esc cancels |
| Type, spacing, size | Fields in the **Style** tab |
| Add a note | Select an element, press **N** (or Notes tab) |
| Undo / redo | `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` |
| Use the page normally | Switch to **Preview** |

Handles write the same way as every other edit (a Tailwind class, inline style or CSS rule, at the component usage site for shadcn). When several elements are selected and one handle is dragged, every selected element gets the same resulting value. Elements that come from one JSX line (a `.map()`) are patched once.

## Notes for Claude

Press **N** on a selected element, choose what it is, and say what should change:

- **Element**: "this card feels cramped".
- **Section**: name a region ("Hero", "Pricing cards") so you can refer to it later.
- **Component**: "this is the primary button pattern, keep it consistent".

Notes show as numbered pins on the page and in the **Notes** tab (Locate, Edit, Done, Delete). They are saved to:

- `.brushup/notes.md`: what Claude reads. Each open note has your text, the file and line of the element (and, for shadcn components, the place the component is used), its classes and text. Numbers match the pins.
- `.brushup/notes.json`: the data. Claude (or you) can set a note's `"status"` to `"done"` and the canvas updates.
- `.brushup/edits.jsonl`: every manual edit you made, so Claude keeps them. `.brushup/selection.json` is what is selected right now.

`npx brushup init` adds a short block to `CLAUDE.md` telling Claude Code to read these before changing UI. It only touches the block between its `<!-- brushup:start -->` / `<!-- brushup:end -->` markers and is safe to re-run.

Notes are anchored by the build's source tags when present and by a fingerprint (tag, classes, text) otherwise, so they survive code moves and also work on pages with no plugin.

## MCP server for Claude Code

The files in `.brushup/` already work with any agent. The MCP server is the faster, richer path: Claude asks for exactly what it needs, and can ask the **open canvas** how something renders instead of asking you for a screenshot.

```bash
npx brushup init --mcp          # writes .mcp.json (other servers untouched); Claude Code asks you to approve it once
# or, per user:  claude mcp add brushup -- npx brushup-mcp
```

| Tool | What it gives Claude |
| --- | --- |
| `brushup_get_notes` | Your pinned notes (open by default), each with the file and line, the component usage site, the element's classes/text, and the pin number you see on the canvas |
| `brushup_update_note` | Mark a note done or reopen it. The only write: it changes `.brushup/notes.json`, never your source |
| `brushup_get_selection` | The element you have selected right now, to resolve "this" |
| `brushup_recent_edits` | Your latest manual tweaks (newest first, batches flattened) so Claude keeps them |
| `brushup_inspect` | How the selected element, or the element a note is pinned to, renders **right now**: position and size, computed layout / spacing / typography / colours, whether it overflows, its parent. Needs the app running and open in a browser |

Everything except `brushup_update_note` is read-only. Claude still changes your code with its normal file tools.

**How it works.** Each Brushup server (static, Vite, Next) writes `.brushup/host.json` with its address. The MCP process (started by Claude Code in your project folder; `--root` or `BRUSHUP_ROOT` override it) connects to it as an *agent* and forwards a question to the browser tab you used most recently; the page answers from the live DOM. Notes, selection and edits are read from `.brushup/` directly, so those tools work even when no dev server is running; `brushup_inspect` says clearly when it can't reach one. Long class lists are capped at 12 (with the total) so shadcn components don't flood the context.

## How edits are written

Source files are the single source of truth; the canvas holds no state of its own.

**JSX (Vite and Next.js)**
- Tailwind projects get Tailwind's own utilities: values on the default spacing scale become plain classes (`ml-10`, `-mt-4`, `w-64`, `gap-3`, and any half-step such as `ml-9.5` on Tailwind 4), and everything else an arbitrary value (`ml-[38px]`, `text-[40px]`). Each edit replaces the utility it conflicts with. Plain classes are only written when the page's root font size is 16px and assume the default spacing scale; with a customised scale, values still work but may not be what you'd have typed; variants like `md:ml-8` are left alone, and the canvas warns when one would still win (or, for a computed `className` that falls back to inline style, would be overridden). Replacing a named size such as `text-5xl` also pins its line-height so spacing doesn't change. Other projects get `style={{ marginLeft: 38 }}`.
- **shadcn/ui and other component libraries:** the build tags both host elements (`data-brushup-src`) and component usages (`data-brushup-use="file:line:col#Button"`), and the tag reaches the DOM through the component's `{...props}`. Edits go to the **usage site** (`<Button className="h-[40px]">`), so tweaking one button doesn't change every button; the component's own `cn()`/tailwind-merge resolves the conflict. Text written in the usage (`<Button>Save</Button>`) is edited there.
- Fragments, `Suspense`, context providers and other components that take no props are never tagged.
- **Dynamic code is never guessed at.** `className={cn(...)}` falls back to an inline style; a `style` variable, or text that comes from `{expression}`, is refused with the reason.
- Elements rendered from one JSX line (a `.map()`, a reused component) change together; the canvas says how many share it. Tick *Edit the shared CSS rule* to change a CSS rule on purpose.

**HTML / CSS**
- A style edit goes to the winning CSS rule only if that rule targets this one element; otherwise it becomes an inline `style`.
- `@media` rules are never edited; selectors the matcher can't evaluate are treated as non-matches.
- Moves use `left/top` for positioned elements and `margin-left/top` otherwise.
- Edits are minimal text splices: unrelated bytes are untouched.

## Working with an agent

- Edits the agent makes appear on the canvas (selection kept).
- In dev modes an element is addressed by `file:line:col`. If the file changed under that position (the agent added lines), the server finds the element again by its class string and text; if more than one still fits it refuses instead of guessing. An edit based on a stale view of the source is otherwise rejected, and undo refuses to run if the file changed after your edit, so neither side clobbers the other.

## Security

What it protects against: **other websites in your browser** and DNS rebinding. The edit server binds to 127.0.0.1 on a random port, checks the `Host` and `Origin` headers, and requires a per-run token on its WebSocket in every mode (static, Vite, Next). It writes only to files inside your project, and only `.jsx`/`.tsx` files it was told about by a source tag.

What it does not protect against: **other users or processes on the same machine**. The token travels in the page your dev server renders, so anyone who can fetch that page can read it; that is the same trust model as any dev server (including the one you already run). Don't run it on a shared machine or expose the dev server to an untrusted network.

`.brushup/host.json` records the server's address and token (mode 0600) so the MCP server can connect; it is deleted when the server stops, and `brushup init` adds `.brushup/` to `.gitignore`. A connection must say `hello` as an agent before it may ask questions, and a canvas page cannot answer for another.

## Layout

- `src/core`: HTML and JSX mapping (`parse5`, `@babel/parser`), instrumenter, selector matching, CSS patching, Tailwind class mapping
- `src/server`: edit sessions (read, patch, write, undo, log), notes store, WebSocket hub, watcher, servers
- `src/vite.ts`, `src/next/`: framework integrations (Vite plugin; Next config wrapper, loader, `<BrushupScript />`)
- `src/mcp/`: the MCP server (`brushup-mcp`): tools, and the client that asks the open canvas questions
- `src/overlay`: injected canvas UI: selection, panel, notes, drag, DOM morph
- `test/`: `npm test`. `npm run build` produces `dist/`.

## Not yet

- Vue, Svelte, Astro, Remix, SvelteKit (the instrumenter is JSX-only; Vite plugin works for Remix/React Router but is untested).
- CSS Modules and CSS-in-JS class resolution.
- Resizing from the left/top edges (it needs the element's position to change too), snapping to neighbouring elements, and rubber-band selection.
- Handles measure the element in the browser, so an element whose CSS ignores `width`/`height` (for example a flex child sized by `flex-basis`) can preview no change even though the class is written.
- MCP: no screenshot tool, no write tools for source (by design), and `brushup_inspect` answers one element at a time.
- Tested on Linux only; Next.js tested on 16.4 + Turbopack (the webpack path is wired up but not exercised).

## License

[MIT](LICENSE)
