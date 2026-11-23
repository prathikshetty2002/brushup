# Brushup + Claude Code: the guide

Brushup is a visual canvas that sits on your running app. It gives you three ways to change UI, so you only spend a Claude prompt when you actually need one.

| Loop | You do | Claude / tokens |
| --- | --- | --- |
| **A. By hand** | Resize, nudge, re-space, retype, multi-select, right on the page | Not involved. Zero prompts, zero tokens |
| **B. Notes** | Pin a note on an element, section or component: "more space above this, smaller on mobile" | One short prompt: *"Handle the open Brushup notes."* Claude gets the file and line for every note |
| **C. Let Claude look** | Select an element and ask a question | Claude asks the live canvas how it renders, so you never paste a screenshot |

Everything is written to your real source files (Tailwind classes, JSX, CSS), as small diffs you can review in git.

> Watch it first: the [60-second walkthrough](https://raw.githubusercontent.com/prathikshetty2002/brushup/main/docs/media/brushup-demo.mp4) (real Chrome, real edits on the [Cadence example](../examples/cadence)). How it was made is at the end of this guide.

---

## 1. What you need

- **Node 20.9 or newer.**
- **A project**: Next.js 15.3+ (tested on 16.4, App Router, Turbopack and webpack), Vite 5+ with React (tested on 8), React Router v7 or Remix on Vite (tested on React Router 7 with Tailwind 4), or a plain HTML file. Tailwind and shadcn/ui are supported, not required.
- **Claude Code** (any recent version) for loops B and C.
- A modern browser (checked in Chromium, Firefox and WebKit; Safari itself is untested).

Brushup is on npm: [npmjs.com/package/brushup](https://www.npmjs.com/package/brushup).

## 2. Set up (about two minutes)

Work on a branch, or commit first: Brushup edits your files, and `git diff` is the best way to see exactly what it did.

### Next.js or Vite

```bash
npx brushup init --mcp
```

That one command is the whole setup. `init` is idempotent and does all of this (it first adds `brushup` to your project's dev dependencies with whichever package manager your lock file shows, unless it is already there; `--no-install` skips that):

- wires Brushup into your project: wraps the export in `next.config.*` with `withBrushup(...)` and adds `<BrushupScript />` inside `<body>` of the root layout (Next), or adds `brushup()` to `plugins` in `vite.config.*` (Vite);
- adds a short block to `CLAUDE.md` (between `<!-- brushup:start -->` markers) telling Claude Code how to use Brushup's notes;
- writes a `/brushup-notes` command (`.claude/commands/brushup-notes.md`): type it in Claude Code to have it handle your open notes, or add a focus such as `/brushup-notes pricing page`;
- adds `.brushup/` to `.gitignore` (if you have one);
- adds an `brushup` entry to `.mcp.json` without touching your other servers (that is the `--mcp` part).

Config edits are small text splices on shapes it recognises (`export default nextConfig`, `module.exports = ...`, a `plugins: [...]` array, a `</body>` in the layout). If your file looks different it leaves it alone and prints the exact lines to add; `--no-wire` skips this step. Check the result with `git diff`.

By hand, the two Next edits are:

```ts
// next.config.ts   (CommonJS next.config.js works too: const { withBrushup } = require("brushup/next"))
import { withBrushup } from "brushup/next";
export default withBrushup(nextConfig);
```

```tsx
// app/layout.tsx, inside <body>
import { BrushupScript } from "brushup/next/script";
<body>{children}<BrushupScript /></body>
```

and the Vite one: `import brushup from "brushup/vite"` and `plugins: [react(), brushup()]`.

`withBrushup` only does anything under `next dev`. In `next build` it does nothing, and `<BrushupScript />` renders nothing, so production output has no Brushup code (verified).

### Plain HTML

```bash
npx brushup page.html        # serves http://127.0.0.1:4321
```

## 3. Connect Claude Code

1. Open Claude Code in your project folder. It asks you to approve the project's `brushup` MCP server (from `.mcp.json`). Approve it. (`/mcp` lists it and shows whether it's connected.)
2. That's it. Claude Code now sees seven tools, and reads the `CLAUDE.md` block automatically.

You can add the server by hand instead: `claude mcp add brushup -- npx brushup-mcp`.

## 4. Your first session

Start your dev server as usual (`npm run dev`) and open the app. A small **Brushup** panel appears at the top right with a green "Connected" status.

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

**Lining up several elements.** Shift-click two or more elements and a **Line up** row appears at the top of the Style tab: align left edges, centres or right edges, align top, middle or bottom, and (for three or more) space them evenly across or down. Each element that has to move gets the same kind of edit a drag writes (a margin in normal flow, `top`/`left` when it is positioned), as one undo step. Elements already in place are left alone, and it says so when nothing needs to move.

**Editing only for wider screens (Tailwind projects).** Under the Style fields there is a closed row, *Only on wider screens…*. Open it and choose the second button, named for how wide your window is right now (say *768px and wider*), and your edits are written as `md:ml-4` instead of `ml-4`: only screens at least that wide get the change, and narrower ones keep their current look. (`md:` and `xl:` are Tailwind's names for 768px and 1280px.) The window decides which size you are looking at, so resize it, or open your browser's device mode (Ctrl/Cmd+Shift+M in Chrome) and pick a phone or tablet. Closing the row puts edits back to every screen. Only Tailwind classes can carry this, so on a `className` built with `cn(...)`, or on a plain HTML page, Brushup refuses with the reason instead of writing the change for every size. Hover, focus and dark-mode styles aren't edited on the canvas, since the page can't show them while you edit: leave a note for Claude instead.

**Text size and spacing steps (Tailwind projects).** Under Size there is a row of Tailwind's named sizes (`xs` to `9xl`), with the one the element has now highlighted; click one and Brushup writes that class (`text-3xl`) in place of the old size instead of a bracketed pixel value. Under the margin and padding box there is a row of spacing steps (0, 4, 8, 12, 16, 24 … px): click a margin or padding box, then a step, and it is written the usual way (`mt-12`). If your theme defines its own `--text-*` or `--spacing-*` (Tailwind 4's `@theme`), those appear as extra chips and are written by name (`text-display`, `px-gutter`). The default sizes and steps are Tailwind's, the same in versions 3 and 4; a project that changes them is only picked up for the custom names it adds, so check the result on the page. Not shown for projects that don't use Tailwind.

**Theme colours.** If your project defines colours as `--color-*` variables (Tailwind 4's `@theme` does), the Style tab shows them as swatches under Color. Click one and Brushup writes the theme's own class, such as `text-accent`, so the colour stays tied to your design system instead of becoming a one-off hex.

**Three things worth knowing**

- **One line of JSX can be many elements.** The three cards in a `.map()` are one `<Card>` in your source, so resizing one resizes all three. The status line tells you ("2 elements share this JSX").
- **Edits go to where you use a component.** Tweaking one shadcn `<Button>` writes `<Button className="px-6">` at that usage, not into the shared `button.tsx`, so other buttons stay as they are.
- **Brushup refuses rather than guesses.** See [section 7](#7-when-brushup-says-no).

### Loop B: brief Claude with notes

Select an element and press **N**.

- **Element**: "this card feels cramped".
- **Section**: name a region ("Hero", "Pricing cards") so you can refer to it.
- **Component**: "this is the primary button pattern; keep it consistent".

A numbered pin appears on the page, and the note appears in the panel's **Notes** tab (Locate, Edit, Done, Delete). Notes are saved to `.brushup/notes.md` and `.brushup/notes.json`.

Write notes the way you would brief a colleague: what you want and why, not where the code is. Brushup records the file, line, classes and text for you.

| Weak | Better |
| --- | --- |
| "fix this" | "Heading feels cramped under the badge. More space above, smaller on mobile." |
| "make bigger" | "Make the primary button more prominent: larger text, more horizontal padding." |

Then, in Claude Code:

> **Handle the open Brushup design notes for this project.**

Claude reads the notes (via `.brushup/notes.md` or the `brushup_get_notes` tool), opens the right files at the right lines, makes the changes, and marks each note **done** (`brushup_update_note`). The pins turn green on your canvas. In the demo, Claude changed `mt-4 text-5xl` to `mt-8 text-4xl sm:text-5xl` for the hero note, and added `px-5 text-base` to just the one button for the CTA note, leaving the shared component alone.

If you disagree with a change, press Undo in your editor or `git checkout` the file, edit the note, and ask again.

**Sharing notes with your team (optional).** By default notes stay on your machine (`.brushup/` is git-ignored). To share them, run `npx brushup init --share-notes` once, then commit `.brushup/notes/` and `.gitignore`. Notes then live one per file in `.brushup/notes/`, so two people adding notes add two files and git never reports a conflict; a teammate's notes arrive with `git pull`, appear on your canvas, and are what your Claude reads. Your existing notes are moved across. Everything else in `.brushup/` (your edit log, selection, checks you ignored) stays local. Two things to know: a note is an instruction for Claude, so review notes in pull requests the way you would review `CLAUDE.md`; and if two people edit the very same note, git will conflict on that one file, which you resolve like any other.

### Loop C: let Claude look instead of screenshotting

Select an element on the canvas, then ask:

> **Using the Brushup tools: how wide is the element I have selected, and is any of it clipped?**

Claude calls `brushup_get_selection` and `brushup_inspect`, which ask your open browser tab for the element's size, position, computed layout, spacing, typography, colours, whether its content is clipped, and its parent. It's text, so it costs far fewer tokens than an image, and it states exact numbers rather than guessing from pixels.

You can also ask about a note's element without selecting it: *"Inspect the element the Hero note is pinned to."*

## 5. What Claude can see and do

| Tool | Gives Claude | Writes |
| --- | --- | --- |
| `brushup_get_notes` | Your notes (open by default): text, file and line, component usage site, classes, the pin number you see; `since` returns only what is new | nothing |
| `brushup_update_note` | marks a note done or reopens it, with a one-line reply on what was done | `.brushup/notes.json` only |
| `brushup_get_selection` | the element you have selected right now | nothing |
| `brushup_recent_edits` | your latest manual tweaks, newest first, so Claude keeps them (each marked locked); `since` works here too | nothing |
| `brushup_inspect` | how the selected (or a note's) element renders right now: size, colours, contrast, accessible name, what overlaps or covers it | nothing |
| `brushup_check` | the accessibility and design problems on the open page, with where each is written and how to fix it | nothing |
| `brushup_console` | errors and warnings the page has logged, newest first | nothing |

Claude still changes your code with its normal file tools. The `CLAUDE.md` block tells it to keep your manual edits, not to redo trivial tweaks, and to use these tools when available. In the demo's second half, Claude's own summary says it "left your manual canvas edits alone".

`brushup_inspect`, `brushup_check` and `brushup_console` need the app running and open in a browser tab. If it isn't, Claude gets a clear message saying so, and the other four tools still work (they read `.brushup/` directly).

## 6. Which loop should I use?

| The change is… | Use | Why |
| --- | --- | --- |
| A size, spacing, position or text tweak you can see | **A: by hand** | Instant, free, exact |
| The same tweak on several elements | **A**, Shift+click | One edit, one undo |
| "Make this feel more X", or something with logic or design judgement | **B: note**, then one prompt | Claude needs your intent, and gets the location for free |
| A change spread across several places | **B** | Notes collect it all in one prompt |
| "Why does this look wrong?" | **C: ask Claude to inspect** | It reads real computed values |

The aim: the small things never cost a prompt, and the prompts you do send are short and land on the right line.

## 7. When Brushup says no

Brushup writes small, exact edits, and refuses when it can't be sure. These are the messages you may see:

**You never have to describe a refused change.** When Brushup declines a text edit it pins the note for Claude automatically. For every other refusal (a style change, delete, duplicate, move, wrap or image change) the message has a **Pin as note** button: one click saves a note on that element saying what you wanted (for example *Please delete this element*, or *Please set margin-left to 24px (it is 16px)*), why Brushup couldn't write it, and where the element lives. Claude reads it like any other note. No screenshot, no typing.

| Message | Meaning | What to do |
| --- | --- | --- |
| *The text in `<X>` comes from an expression or nested elements, so it can't be edited here.* | The text isn't a plain literal in JSX (e.g. `{f.title}`) | Brushup searches for where the text is written and edits that; if it's in several places, or in a database, it pins a note for Claude instead |
| *That element contains other elements: select the one holding the text.* | You double-clicked a container | Double-click the text itself |
| *This element's style prop is not an object literal.* | `style={styles.card}` is a variable | Edit it in code, or ask Claude |
| *`<X>` is no longer at …, the file changed; try again.* | The file changed between render and your edit | Retry (the page has refreshed) |
| *The source changed since the canvas last rendered it.* | (HTML mode) Same, with a hash check | Retry |
| *The source changed since that edit, so it can no longer be reverted safely.* | Undo is refused because Claude or you edited the file after | Fix forward, or `git checkout` |
| *No Brushup canvas is open in a browser.* | `brushup_inspect` found no open page | Open the app in a browser |
| *Brushup is not running for this project.* | No dev server | Start `npm run dev` |

Also good to know: a `className` built with `cn(...)`, `clsx(...)`, `twMerge(...)` or a template literal is edited **in its plain string parts**: `cn('px-4 ml-2', active && 'bg-blue-500', className)` gets the new class in `'px-4 ml-2'` and the conditional part is left as it is, with a warning if it sets the same property (it still wins while its condition holds). Only a `className` with no plain string to write into, such as `cn(buttonVariants(), className)`, falls back to an **inline style**. Inline styles beat Tailwind responsive variants like `md:`, so Brushup shows an amber warning naming the variants it would override; check small screens after such an edit. (With *Only on wider screens* chosen it refuses instead, since an inline style can't be limited to one.)

## 8. Troubleshooting

- **No panel appears.** Check you're running `next dev` (not a production build), that `<BrushupScript />` is in the layout, and that the browser console shows no blocked script. The panel's status should read *Connected*.
- **"Not connected to the Brushup server".** The dev server restarted. Reload the page.
- **Edits land on the wrong thing.** Select the element and read the panel's second line: it shows the source it will edit. If it names a shared component, switch to a more specific element, or use **Parent**/children to pick the right one.
- **Resizing does nothing visible.** Some layouts ignore `width`/`height` (a flex child sized by `flex-basis`). The class is still written; check your layout.
- **Claude doesn't see the tools.** Run `/mcp` in Claude Code. If `brushup` is missing, check `.mcp.json` exists and approve it. If it's failing, run `npx brushup-mcp` in the project; it should print `brushup MCP server ready`.
- **`brushup_inspect` says it can't reach the canvas.** Keep the app open in a tab. With several tabs, the one you used last answers.
- **Hydration warning in the console.** Make sure `<BrushupScript />` is inside `<body>` and that you haven't also added the script by hand.
- **Node errors on install.** You need Node 20.9 or newer.

## 9. Privacy and safety

- Everything runs **on your machine**. The edit server binds to `127.0.0.1` on a random port, rejects other websites (Host/Origin checks) and requires a per-run token. It only writes files inside your project.
- It does **not** protect against other users on the same computer. Don't run it on a shared machine or expose the dev server to an untrusted network.
- **What Claude receives**: only what the tools return (your notes, your selection, recent edits, and the properties of an element you point it at) plus whatever files it reads. Nothing is uploaded by Brushup itself.
- `.brushup/` holds your notes, an edit log, the current selection, and a small file with the local server's address (mode 0600). `brushup init` adds it to `.gitignore`.

## 10. Uninstall

```bash
npm uninstall brushup
```

Remove the two lines from `next.config.ts` and `layout.tsx`, the `brushup` entry from `.mcp.json`, the block between the `brushup:start`/`brushup:end` markers in `CLAUDE.md`, and the `.brushup/` folder. Your source files keep every edit that was made.

## How the token estimate works

The Changes tab shows how many tokens your canvas edits probably saved, for this session and for the project so far, and `brushup stats` prints the project total in a terminal. It is an **estimate**: Brushup never sees what an agent spends, so nothing is measured.

Each tweak is counted as the messages you did not have to send. Edits to the same element within 30 seconds count once (holding an arrow key is one tweak, not thirty), a batch of selected elements dragged together counts once, and an edit you undo doesn't count.

| Part of a prompted tweak | Tokens | Where the figure comes from |
| :- | :- | :- |
| Your sentence describing it | ~100 | typical short instruction |
| The file the agent reads first | ~1,500 | public measurements put a ~300-line file at 1,200 to 2,000 tokens |
| The agent's thinking | ~500 | [thinking is billed as output](https://platform.claude.com/docs/en/build-with-claude/extended-thinking); Anthropic publishes no average, its docs suggest a 1,024-token starting budget for simple tasks, and one small public test of a rename found only a handful. The least certain figure here |
| Extra tool calls to find and check the file | ~850 | three calls at ~150 tokens of overhead each (public estimates run 50 to 200) plus ~400 tokens of search output |
| The agent's edit and reply | ~300 | typical short edit |
| A screenshot (style, move and wrap edits only) | 1,560 | [Anthropic's vision docs](https://platform.claude.com/docs/en/build-with-claude/vision): a 1920×1080 screenshot is 1,560 tokens (2,691 on the newest high-resolution tier) |

So a text, delete, duplicate or image edit counts as about **3,250** tokens and a visual one as about **4,800**.

What it leaves out, so the real saving is probably larger: Claude Code [sends the whole conversation with every request](https://code.claude.com/docs/en/costs) (one public logging-proxy test measured about 33,000 tokens of fixed overhead per request, and Anthropic lists a 286 to 354 token tool-use system prompt on every request) and the follow-up rounds visual tweaks usually take ("a bit more to the left"). The file-read, tool-call and overhead figures come from public blog measurements, not controlled studies, so treat them as ballpark. If your agent thinks little on small edits, the real number is lower than the thinking line suggests; the figures live in `src/core/savings.ts` if you want to change them. For your own number, compare `/usage` in Claude Code for matching tasks.

## 11. Limits today

Tested by hand on Linux with Chrome, and in CI on Windows, macOS and three browser engines. Supported frameworks are Next.js (App and Pages Router), Vite + React, React Router v7 / Remix (Vite) and plain HTML. Not supported yet: Vue, Svelte, Astro, CSS Modules, CSS-in-JS, a screenshot tool (deliberately: `brushup_inspect` gives Claude numbers instead). Full list in the README.

---

## Appendix: how the demo was made

The pictures and the walkthrough in the README are made by three scripts you can run yourself. They need Chrome and ffmpeg, and the Cadence example running (`cd examples/cadence && npm install && npx vite --port 5301`):

```bash
node demo/capture-screenshots.mjs   # the screenshots, at 2x
node demo/record-demo.mjs           # the walkthrough video
bash demo/make-media.sh             # encodes them into docs/media
```

Chrome is driven for real: every edit is written to the example's source, and the example is put back with `git checkout` afterwards. The cursor, click ripples and captions are drawn over the page for the recording only. The one thing staged is the agent's reply in the Notes picture, which is written into the notes file by the script, not by a live Claude run.

### A longer version, with Claude Code running live

That older recording is real, not mocked. A script drives the Next.js app and the Brushup canvas in Chrome, and runs **Claude Code live, twice** (headless, `claude -p`), streaming its actual tool calls into the terminal panel. The setup commands are real output captured from a fresh project and replayed at typing speed.

- Run 1 (*"Handle the open Brushup design notes"*) and run 2 (*"how wide is the element I have selected…"*) each cost roughly $0.10–$0.20 on Sonnet.
- To make your own: start your app with Brushup, make sure `claude` is logged in, then:

```bash
BRUSHUP_DEMO_NEXTAPP=/path/to/your/app npm run demo:claude
```

It needs Chrome and ffmpeg, and writes `demo/out/brushup-claude-demo.mp4` (a local file; it is not published).
