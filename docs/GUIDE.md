# Ascend + Claude Code: the guide

Ascend is a visual canvas that sits on your running app. It gives you three ways to change UI, so you only spend a Claude prompt when you actually need one.

| Loop | You do | Claude / tokens |
| --- | --- | --- |
| **A. By hand** | Resize, nudge, re-space, retype, multi-select, right on the page | Not involved. Zero prompts, zero tokens |
| **B. Notes** | Pin a note on an element, section or component: "more space above this, smaller on mobile" | One short prompt: *"Handle the open Ascend notes."* Claude gets the file and line for every note |
| **C. Let Claude look** | Select an element and ask a question | Claude asks the live canvas how it renders, so you never paste a screenshot |

Everything is written to your real source files (Tailwind classes, JSX, CSS), as small diffs you can review in git.

> Watch it first: `demo/out/ascend-claude-demo.mp4` (2 minutes, real Claude Code runs). How it was made is at the end of this guide.

---

## 1. What you need

- **Node 20.9 or newer.**
- **A project**: Next.js 15.3+ (tested on 16.4, App Router, Turbopack and webpack), Vite 5+ with React (tested on 8), or a plain HTML file. Tailwind and shadcn/ui are supported, not required.
- **Claude Code** (any recent version) for loops B and C.
- A **Chromium-based browser** (tested on Chrome; Firefox and Safari are untested).

Ascend isn't published to npm yet, so installs use the tarball built from this repo (`npm run build && npm pack` produces `ascend-0.1.0.tgz`).

## 2. Set up (about two minutes)

Work on a branch, or commit first: Ascend edits your files, and `git diff` is the best way to see exactly what it did.

### Next.js or Vite

```bash
npm install -D /path/to/ascend-0.1.0.tgz
npx ascend init --mcp
```

That is the whole setup. `init` is idempotent and does all of this:

- wires Ascend into your project: wraps the export in `next.config.*` with `withAscend(...)` and adds `<AscendScript />` inside `<body>` of the root layout (Next), or adds `ascend()` to `plugins` in `vite.config.*` (Vite);
- adds a short block to `CLAUDE.md` (between `<!-- ascend:start -->` markers) telling Claude Code how to use Ascend's notes;
- adds `.ascend/` to `.gitignore` (if you have one);
- adds an `ascend` entry to `.mcp.json` without touching your other servers (that is the `--mcp` part).

Config edits are small text splices on shapes it recognises (`export default nextConfig`, `module.exports = ...`, a `plugins: [...]` array, a `</body>` in the layout). If your file looks different it leaves it alone and prints the exact lines to add; `--no-wire` skips this step. Check the result with `git diff`.

By hand, the two Next edits are:

```ts
// next.config.ts   (CommonJS next.config.js works too: const { withAscend } = require("ascend/next"))
import { withAscend } from "ascend/next";
export default withAscend(nextConfig);
```

```tsx
// app/layout.tsx, inside <body>
import { AscendScript } from "ascend/next/script";
<body>{children}<AscendScript /></body>
```

and the Vite one: `import ascend from "ascend/vite"` and `plugins: [react(), ascend()]`.

`withAscend` only does anything under `next dev`. In `next build` it does nothing, and `<AscendScript />` renders nothing, so production output has no Ascend code (verified).

### Plain HTML

```bash
npx ascend page.html        # serves http://127.0.0.1:4321
```

## 3. Connect Claude Code

1. Open Claude Code in your project folder. It asks you to approve the project's `ascend` MCP server (from `.mcp.json`). Approve it. (`/mcp` lists it and shows whether it's connected.)
2. That's it. Claude Code now sees five tools, and reads the `CLAUDE.md` block automatically.

You can add the server by hand instead: `claude mcp add ascend -- npx ascend-mcp`.

## 4. Your first session

Start your dev server as usual (`npm run dev`) and open the app. A small **Ascend** panel appears at the top right with a green "Connected" status.

### Loop A: change things by hand

Click an element to select it. The panel shows what it is and where it lives in source (for a component: `<Button> · page.tsx`).

| You want to | Do this | What gets written |
| --- | --- | --- |
| Move something | Drag it, or arrow keys (Shift = 10px) | `margin-left/top` (or `left/top` if positioned) |
| Resize | Drag the **blue squares** on the right edge, bottom edge or corner | `width` / `height`, e.g. `w-[232px]` |
| Padding | Drag the **green** grips just inside an edge, inward to grow | `pl-[24px]` etc. |
| Margin | Drag the **orange** grips just outside an edge, outward to grow | `mt-[16px]` etc. |
| Precise values | Type in the **Style** tab (size, weight, colour, line height, spacing) | Tailwind class, inline style, or the CSS rule |
| Change text | Double-click it, type, Enter (Esc cancels) | The text in your JSX/HTML |
| Several at once | **Shift+click** more elements, then do any of the above | One edit, **one undo step** |
| Undo / redo | `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` | The file is restored |
| Use the page normally | Switch the panel to **Preview** | Nothing |

Drags snap to a 4px grid (Tailwind's spacing step). Hold **Shift** for 1px precision. A label shows the value as you drag.

**Three things worth knowing**

- **One line of JSX can be many elements.** The three cards in a `.map()` are one `<Card>` in your source, so resizing one resizes all three. The status line tells you ("2 elements share this JSX").
- **Edits go to where you use a component.** Tweaking one shadcn `<Button>` writes `<Button className="px-6">` at that usage, not into the shared `button.tsx`, so other buttons stay as they are.
- **Ascend refuses rather than guesses.** See [section 7](#7-when-ascend-says-no).

### Loop B: brief Claude with notes

Select an element and press **N**.

- **Element**: "this card feels cramped".
- **Section**: name a region ("Hero", "Pricing cards") so you can refer to it.
- **Component**: "this is the primary button pattern; keep it consistent".

A numbered pin appears on the page, and the note appears in the panel's **Notes** tab (Locate, Edit, Done, Delete). Notes are saved to `.ascend/notes.md` and `.ascend/notes.json`.

Write notes the way you would brief a colleague: what you want and why, not where the code is. Ascend records the file, line, classes and text for you.

| Weak | Better |
| --- | --- |
| "fix this" | "Heading feels cramped under the badge. More space above, smaller on mobile." |
| "make bigger" | "Make the primary button more prominent: larger text, more horizontal padding." |

Then, in Claude Code:

> **Handle the open Ascend design notes for this project.**

Claude reads the notes (via `.ascend/notes.md` or the `ascend_get_notes` tool), opens the right files at the right lines, makes the changes, and marks each note **done** (`ascend_update_note`). The pins turn green on your canvas. In the demo, Claude changed `mt-4 text-5xl` to `mt-8 text-4xl sm:text-5xl` for the hero note, and added `px-5 text-base` to just the one button for the CTA note, leaving the shared component alone.

If you disagree with a change, press Undo in your editor or `git checkout` the file, edit the note, and ask again.

### Loop C: let Claude look instead of screenshotting

Select an element on the canvas, then ask:

> **Using the Ascend tools: how wide is the element I have selected, and is any of it clipped?**

Claude calls `ascend_get_selection` and `ascend_inspect`, which ask your open browser tab for the element's size, position, computed layout, spacing, typography, colours, whether its content is clipped, and its parent. It's text, so it costs far fewer tokens than an image, and it states exact numbers rather than guessing from pixels.

You can also ask about a note's element without selecting it: *"Inspect the element the Hero note is pinned to."*

## 5. What Claude can see and do

| Tool | Gives Claude | Writes |
| --- | --- | --- |
| `ascend_get_notes` | Your notes (open by default): text, file and line, component usage site, classes, the pin number you see | nothing |
| `ascend_update_note` | marks a note done or reopens it | `.ascend/notes.json` only |
| `ascend_get_selection` | the element you have selected right now | nothing |
| `ascend_recent_edits` | your latest manual tweaks, newest first, so Claude keeps them | nothing |
| `ascend_inspect` | how the selected (or a note's) element renders right now | nothing |

Claude still changes your code with its normal file tools. The `CLAUDE.md` block tells it to keep your manual edits, not to redo trivial tweaks, and to use these tools when available. In the demo's second half, Claude's own summary says it "left your manual canvas edits alone".

`ascend_inspect` needs the app running and open in a browser tab. If it isn't, Claude gets a clear message saying so, and the other four tools still work (they read `.ascend/` directly).

## 6. Which loop should I use?

| The change is… | Use | Why |
| --- | --- | --- |
| A size, spacing, position or text tweak you can see | **A: by hand** | Instant, free, exact |
| The same tweak on several elements | **A**, Shift+click | One edit, one undo |
| "Make this feel more X", or something with logic or design judgement | **B: note**, then one prompt | Claude needs your intent, and gets the location for free |
| A change spread across several places | **B** | Notes collect it all in one prompt |
| "Why does this look wrong?" | **C: ask Claude to inspect** | It reads real computed values |

The aim: the small things never cost a prompt, and the prompts you do send are short and land on the right line.

## 7. When Ascend says no

Ascend writes small, exact edits, and refuses when it can't be sure. These are the messages you may see:

| Message | Meaning | What to do |
| --- | --- | --- |
| *The text in `<X>` comes from an expression or nested elements, so it can't be edited here.* | The text isn't a plain literal in JSX (e.g. `{f.title}`) | Edit the data, or use a note |
| *That element contains other elements: select the one holding the text.* | You double-clicked a container | Double-click the text itself |
| *This element's style prop is not an object literal.* | `style={styles.card}` is a variable | Edit it in code, or ask Claude |
| *`<X>` is no longer at …, the file changed; try again.* | The file changed between render and your edit | Retry (the page has refreshed) |
| *The source changed since the canvas last rendered it.* | (HTML mode) Same, with a hash check | Retry |
| *The source changed since that edit, so it can no longer be reverted safely.* | Undo is refused because Claude or you edited the file after | Fix forward, or `git checkout` |
| *No Ascend canvas is open in a browser.* | `ascend_inspect` found no open page | Open the app in a browser |
| *Ascend is not running for this project.* | No dev server | Start `npm run dev` |

Also good to know: a `className` built with `cn(...)` or a template falls back to an **inline style**. Inline styles beat Tailwind responsive variants like `md:`, so Ascend shows an amber warning naming the variants it would override; check small screens after such an edit.

## 8. Troubleshooting

- **No panel appears.** Check you're running `next dev` (not a production build), that `<AscendScript />` is in the layout, and that the browser console shows no blocked script. The panel's status should read *Connected*.
- **"Not connected to the Ascend server".** The dev server restarted. Reload the page.
- **Edits land on the wrong thing.** Select the element and read the panel's second line: it shows the source it will edit. If it names a shared component, switch to a more specific element, or use **Parent**/children to pick the right one.
- **Resizing does nothing visible.** Some layouts ignore `width`/`height` (a flex child sized by `flex-basis`). The class is still written; check your layout.
- **Claude doesn't see the tools.** Run `/mcp` in Claude Code. If `ascend` is missing, check `.mcp.json` exists and approve it. If it's failing, run `npx ascend-mcp` in the project; it should print `ascend MCP server ready`.
- **`ascend_inspect` says it can't reach the canvas.** Keep the app open in a tab. With several tabs, the one you used last answers.
- **Hydration warning in the console.** Make sure `<AscendScript />` is inside `<body>` and that you haven't also added the script by hand.
- **Node errors on install.** You need Node 20.9 or newer.

## 9. Privacy and safety

- Everything runs **on your machine**. The edit server binds to `127.0.0.1` on a random port, rejects other websites (Host/Origin checks) and requires a per-run token. It only writes files inside your project.
- It does **not** protect against other users on the same computer. Don't run it on a shared machine or expose the dev server to an untrusted network.
- **What Claude receives**: only what the tools return (your notes, your selection, recent edits, and the properties of an element you point it at) plus whatever files it reads. Nothing is uploaded by Ascend itself.
- `.ascend/` holds your notes, an edit log, the current selection, and a small file with the local server's address (mode 0600). `ascend init` adds it to `.gitignore`.

## 10. Uninstall

```bash
npm uninstall ascend
```

Remove the two lines from `next.config.ts` and `layout.tsx`, the `ascend` entry from `.mcp.json`, the block between the `ascend:start`/`ascend:end` markers in `CLAUDE.md`, and the `.ascend/` folder. Your source files keep every edit that was made.

## 11. Limits today

Tested only on Linux with Chrome. Supported frameworks are Next.js, Vite + React and plain HTML. Not supported yet: Vue, Svelte, Astro, CSS Modules, CSS-in-JS, resizing from the left or top edge, snapping to neighbouring elements, and a screenshot tool (deliberately: `ascend_inspect` gives Claude numbers instead). Full list in the README.

---

## Appendix: how the demo was made

The video is real, not mocked. A script drives the Next.js app and the Ascend canvas in Chrome, and runs **Claude Code live, twice** (headless, `claude -p`), streaming its actual tool calls into the terminal panel. The setup commands are real output captured from a fresh project and replayed at typing speed.

- Run 1 (*"Handle the open Ascend design notes"*) and run 2 (*"how wide is the element I have selected…"*) each cost roughly $0.10–$0.20 on Sonnet.
- To make your own: start your app with Ascend, make sure `claude` is logged in, then:

```bash
ASCEND_DEMO_NEXTAPP=/path/to/your/app npm run demo:claude
```

It needs Chrome and ffmpeg, and writes `demo/out/ascend-claude-demo.mp4`.
