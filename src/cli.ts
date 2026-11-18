import { stat } from 'node:fs/promises';
import path from 'node:path';
import { initProject } from './init';
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
  const wire = !rest.includes('--no-wire');
  const root = path.resolve(rest.find((a) => !a.startsWith('--')) ?? '.');
  const r = await initProject(root, { mcp, wire });
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
  console.log('Claude Code will now read .brushup/notes.md before changing UI. Pin notes on the canvas with N.');
  process.exit(0);
}

const portFlag = args.indexOf('--port');
const port = portFlag >= 0 ? Number(args.splice(portFlag, 2)[1]) : 4321;
const file = args[0];

if (!file || !Number.isInteger(port)) {
  console.error('Usage: brushup <page.html> [--port 4321]\n       brushup init [project-folder] [--mcp] [--no-wire]   (set up a project: CLAUDE.md, Next/Vite wiring; --mcp registers the MCP server)');
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
