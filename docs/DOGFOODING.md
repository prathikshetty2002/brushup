# Trying Brushup on a real project

A one-to-two week checklist. The goal is to find out what breaks or annoys on a codebase that isn't a demo, before adding features.

## Setup (10 minutes)
- [ ] `npm i -D brushup && npx brushup init --mcp` in a real project (Next.js or Vite + React; Tailwind if you use it).
- [ ] Start the dev server and open the page. Note anything that needed more than the README says.
- [ ] Take the guided tour (the `?` in the panel).

## Use it for real work
Make your normal small UI changes on the canvas instead of prompting. For each one, note whether it worked:
- [ ] Change text (a literal, a prop, a constant, a list item, a translation).
- [ ] Resize, move, change spacing and typography.
- [ ] A shadcn/ui component: did the edit land at the usage site?
- [ ] An element inside a `.map()` or reused component.
- [ ] Undo, then redo.
- [ ] Pin a note on a section or component, then ask Claude to handle it.
- [ ] Let Claude change the same file while the canvas is open: does the canvas keep up, and are your edits still there?
- [ ] Select a tall section or footer: does the panel stay out of the way?

## After each session, check
- [ ] `git diff`: are the changes small and what you expected? Any class soup or reformatting?
- [ ] Anything left in your source that shouldn't ship (`data-brushup-*` attributes, the script tag in a production build)?

## Write down
For every problem: what you did, what you expected, what happened, the file and line. Mark each one **blocked me**, **annoyed me** or **nice to have**.

## Then decide
- Fix the "blocked me" list first.
- Count what you wished it could do. If a missing feature shows up three times (breakpoints, hover states, add/delete elements, another framework), that's the next thing to build.
