# Changelog

## Unreleased

- **The panel stays out of the way of what you select.** It re-checks after its fields have filled in, counts the element's handles and tag as part of the element, and when neither side of the page is clear (a full-width element) it shrinks into the free space above or below it.
- **Dark-mode contrast.** Text on the accent colour (Next, Save note, pins, the notes count) is dark in dark mode; white on the lighter vermilion was 3.1:1, now about 5.7:1.
- **Find-by-value leaves config alone.** `*.config.*` files and dotfiles are never searched or rewritten.
- **Message size cap.** The edit socket refuses messages over 4 MB.
- **The shared-rule switch says what it does.** Its hint reads “Off: only this element changes” / “On: every element this rule matches changes”, and a tooltip explains both.

## 0.1.4

- **A guided tour.** The `?` button in the panel walks through selecting, moving and resizing, the style fields, text editing, notes, undo and preview, highlighting each part as it goes. A dot on the button marks it until it has been opened once.
- **Panel polish.** The margin/padding widget has more room, selection handles draw behind the panel, and the shortcuts are an aligned list.

## 0.1.3

- **Text that comes from data can be edited.** Double-clicking `{f.body}` inside `items.map(...)` over a literal list in the same file now edits the string in that item of the list; `{"Save"}` and template-literal expressions are edited in place. Refusals say what the text comes from and why (a filter, a prop, state, a fetch).
- **Text is found by its value.** When the JSX doesn't hold the text (a prop, `useState("Save")`, a constant, a filtered list, a translation file like `messages/en.json`), Brushup searches the project for the one place that writes it and edits it there, with a warning that everything using that text changes too. If it's written in several places it refuses and lists them (`file:line`); tests, stories and `node_modules` are ignored; text under 3 characters isn't searched.
- **A note is pinned when the source can't hold the text.** For text from a database, an API or a CMS, the canvas restores the text and pins a note on the element (“Change this text to X (it says Y)”) so Claude can make the change with full context. Repeating the same edit doesn't pin a second note.

## 0.1.2

Windows fixes, found by driving real Vite and Next.js apps in a browser on Windows CI.

- **Elements are tagged when the project folder has two spellings.** On Windows the same folder can be `C:\Users\RUNNER~1\...` (an 8.3 short name) for the root and `C:\Users\runneradmin\...` for a file; Brushup called every file "outside the project" and tagged nothing. Drive-letter case, symlinks and junctions hit the same check. Real paths are now compared when the plain comparison says "outside".
- **Edits are accepted on Windows with Vite.** Vite gives the plugin its root as `C:/proj` while every path built from it uses backslashes, so every edit was refused with "Bad element reference". The root is now normalised once.
- Tests build their file paths for the current OS; the smoke test tolerates Windows holding its temp folder.
- CI now drives the canvas in Chromium, Firefox and WebKit on Linux, macOS and Windows, and builds real Vite and Next.js apps on all three.

## 0.1.1

- **Elements are found by what they say in the source, not where they were.** Each dev-mode tag carries a version token (a hash of the file and a fingerprint of the element). If the agent edits the file under the page, the element is found again by its fingerprint; if that is ambiguous the edit is refused instead of landing on a look-alike. `strict: false` restores the old behaviour.
- **Types for `require()` users:** `.d.cts` files for `brushup/next` and `brushup/vite`, plus the `strict` option in the types. 0.1.0 made TypeScript report these as ES-module-only under node16 resolution.
- **Setup:** `brushup init` handles the Next.js Pages Router (wires or creates `_document`) and a Vite config with no `plugins`, and follows a file's import style.
- **Canvas:** rubber-band selection, snapping guides while dragging (Ctrl/Cmd moves freely), resize from every edge and corner, `flex-basis` for flex items, and an explanation when the page refuses a size (`max-width`, `flex-grow`, grid track, …).
- **CSS Modules:** the shared-rule option edits the module's own rule for `styles.card`-style classes.
- **MCP:** `brushup_inspect` accepts `note_ids` to inspect several notes' elements in one call; the server reports the real package version; `brushup --version`.
- **Verified in CI:** Windows, macOS, Node 20.9, 22 and 24, and the canvas driven in Chromium, Firefox and WebKit. Also tested by hand on Next 15.5 (webpack and Turbopack) with Tailwind 3.
- Fixed a Windows-only test path bug and a `magic-string` ESM-only dependency that broke `require('brushup/next')` on older Node (in 0.1.0 already patched before release).

## 0.1.0

First release.
