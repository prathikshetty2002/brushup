import { stat } from 'node:fs/promises';
import path from 'node:path';
import { initProject } from './init';
import { run } from './install';
import { startServer } from './server/index';
import { VERSION } from './version';

const args = process.argv.slice(2);

if (args[0] === '--version' || args[0] === '-v') {
  console.log(VERSION);
  process.exit(0);
}

if (args[0] === 'init') {
  const rest = args.slice(1);
  const mcp = rest.includes('--mcp');
  const agents = rest.includes('--agents');
  const wire = !rest.includes('--no-wire');
  const shareNotes = rest.includes('--share-notes');
  const root = path.resolve(rest.find((a) => !a.startsWith('--')) ?? '.');
  // One command is the whole setup: add the package to the project first if it isn't there, since the wiring imports it.
  if (!rest.includes('--no-install')) {
    const { installSelf } = await import('./install');
    const installed = await installSelf(root, (command, args, cwd) => (console.log(`Adding brushup to this project: ${[command, ...args].join(' ')}`), run(command, args, cwd)));
    if (installed.status === 'failed') {
      console.error(`Could not install brushup (${installed.message}). Nothing was changed. Run this yourself, then run init again:\n  ${installed.command}`);
      process.exit(1);
    }
    if (installed.status === 'no-package-json') console.log('No package.json here, so brushup was not installed. For a plain HTML page you do not need to: run  npx brushup <page.html>.');
  }
  const r = await initProject(root, { mcp, wire, agents, shareNotes });
  if (r.sharedNotes) console.log(`Shared notes: one file per note in .brushup/notes/ (${r.sharedNotes.moved} moved from notes.json), and .gitignore keeps that folder and ignores the rest of .brushup/. Commit .brushup/notes/ and .gitignore, and your teammates' notes arrive with git pull.`);
  console.log(`/brushup-notes command: ${r.command === 'kept' ? 'a file of that name already exists, left alone' : r.command}`);
  console.log(`CLAUDE.md: ${r.claudeMd}   .gitignore: ${r.gitignore === 'absent' ? 'no .gitignore found' : r.gitignore}${r.mcp ? `   .mcp.json: ${r.mcp}` : ''}`);
  if (r.wire?.next) {
    console.log(`next.config: ${r.wire.next.config}   root layout / _document: ${r.wire.next.layout}`);
    if (r.wire.next.config === 'manual') console.log('Could not edit the Next config safely. Wrap your export:  export default withBrushup(nextConfig);  with  import { withBrushup } from "brushup/next";');
    if (r.wire.next.layout === 'manual') console.log('Could not edit the root layout or _document. Add  <BrushupScript />  inside <body>  with  import { BrushupScript } from "brushup/next/script";');
  }
  if (r.wire?.vite) {
    console.log(`vite.config: ${r.wire.vite}`);
    if (r.wire.vite === 'manual') console.log('Could not edit the Vite config safely. Add  brushup()  to plugins with  import brushup from "brushup/vite";');
  }
  if (r.mcp === 'invalid-json') console.log('.mcp.json is not valid JSON, so it was left alone. Add the server by hand: { "mcpServers": { "brushup": { "command": "npx", "args": ["brushup-mcp"] } } }');
  if (r.mcp) console.log('Claude Code asks you to approve project MCP servers the first time; approve "brushup".');
  if (r.agents) {
    console.log(`AGENTS.md: ${r.agents.agentsMd}   .cursor/mcp.json: ${r.agents.cursor}   (Codex, Cursor, Copilot and others read AGENTS.md)`);
    if (r.agents.cursor === 'invalid-json') console.log('.cursor/mcp.json is not valid JSON, so it was left alone. Add the server by hand: { "mcpServers": { "brushup": { "command": "npx", "args": ["brushup-mcp"] } } }');
    console.log('Codex keeps MCP servers in your user config, so run this once:   codex mcp add brushup -- npx brushup-mcp');
    console.log('Gemini CLI: add  "mcpServers": { "brushup": { "command": "npx", "args": ["brushup-mcp"] } }  to .gemini/settings.json');
  }
  console.log('Claude Code will now read .brushup/notes.md before changing UI. Pin notes on the canvas with N.');
  process.exit(0);
}

if (args[0] === 'stats') {
  const { readSavings } = await import('./server/savings');
  const { roundTokens, SIMPLE_TOKENS, VISUAL_TOKENS } = await import('./core/savings');
  const root = path.resolve(args[1] ?? '.');
  const { total } = await readSavings(root, Infinity);
  if (!total.edits) console.log(`No canvas edits logged in ${path.join(root, '.brushup', 'edits.jsonl')} yet.`);
  else {
    console.log(`${total.edits} canvas edit${total.edits === 1 ? '' : 's'}, counted as ${total.changes} tweak${total.changes === 1 ? '' : 's'}: about ${roundTokens(total.tokens)} tokens you did not spend asking an agent (an estimate).`);
    console.log(`Each tweak is counted as about ${SIMPLE_TOKENS.toLocaleString('en')} tokens (${VISUAL_TOKENS.toLocaleString('en')} for a visual one, which would have needed a screenshot). It leaves out the conversation re-sent with every request and any follow-up rounds, so the real saving is probably larger. How it is worked out: the guide, "How the token estimate works".`);
  }
  process.exit(0);
}

const portFlag = args.indexOf('--port');
const port = portFlag >= 0 ? Number(args.splice(portFlag, 2)[1]) : 4321;
const file = args[0];

if (!file || !Number.isInteger(port)) {
  console.error('Usage: brushup <page.html> [--port 4321]\n       brushup init [project-folder] [--mcp] [--agents] [--no-wire] [--no-install] [--share-notes]   (set up a project, installing brushup if needed: CLAUDE.md, Next/Vite wiring; --mcp registers the MCP server; --agents also sets up AGENTS.md and Cursor)');
  process.exit(1);
}

const entry = path.resolve(file);
try {
  if (!(await stat(entry)).isFile()) throw new Error();
} catch {
  console.error(`Not a file: ${entry}`);
  process.exit(1);
}

const server = await startServer(entry, port);
console.log(`Brushup canvas for ${path.relative(process.cwd(), entry)}\n  ${server.url}\n`);
console.log('Edits on the canvas are written to the source files; changes made to them (by you or your agent) appear live.');
console.log('Notes (press N on a selected element), edits and the selection are written to .brushup/ next to the page.');

process.on('SIGINT', () => void server.close().then(() => process.exit(0)));
