// Installs a packed Brushup tarball into a throwaway project and exercises what a user would: the commands,
// both module formats, the MCP server and the static server. Uses only Node built-ins, so it runs on the
// oldest supported Node (20.9) where the dev tooling (vitest, tsc) cannot.
//   node scripts/smoke.mjs path/to/brushup-0.1.0.tgz
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tarball = path.resolve(process.argv[2] ?? '');
if (!existsSync(tarball)) throw new Error('Usage: node scripts/smoke.mjs <brushup-*.tgz>');
const dir = mkdtempSync(path.join(tmpdir(), 'brushup-smoke-'));
const bin = (name) => path.join(dir, 'node_modules', '.bin', name);
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
  if (!ok) failed++;
};
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', ...opts });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`node ${process.version}, project ${dir}`);
run('npm', ['init', '-y']);
const install = run('npm', ['install', tarball, '--no-audit', '--no-fund']);
check('npm install of the tarball', install.status === 0, install.stderr.slice(-300));

const usage = run(bin('brushup'), []);
check('brushup prints usage', /Usage: brushup/.test(usage.stdout + usage.stderr));

const init = run(bin('brushup'), ['init', '.', '--mcp']);
check('brushup init writes CLAUDE.md and .mcp.json', init.status === 0 && existsSync(path.join(dir, 'CLAUDE.md')) && existsSync(path.join(dir, '.mcp.json')), init.stderr);
check('.mcp.json registers the brushup server', existsSync(path.join(dir, '.mcp.json')) && 'brushup' in JSON.parse(readFileSync(path.join(dir, '.mcp.json'), 'utf8')).mcpServers);

const cjs = run('node', ['-e', "const n=require('brushup/next'),v=require('brushup/vite');if(typeof n.withBrushup!=='function'||typeof (v.default||v)!=='function')process.exit(1)"]);
check('CommonJS: brushup/next and brushup/vite', cjs.status === 0, cjs.stderr.slice(-300));
const esm = run('node', ['--input-type=module', '-e', "import {withBrushup} from 'brushup/next'; import v from 'brushup/vite'; if(typeof withBrushup!=='function'||typeof v!=='function')process.exit(1)"]);
check('ESM: brushup/next and brushup/vite', esm.status === 0, esm.stderr.slice(-300));

// MCP server over stdio
const mcp = spawn(bin('brushup-mcp'), [], { cwd: dir, stdio: ['pipe', 'pipe', 'ignore'] });
let out = '';
mcp.stdout.on('data', (d) => (out += d));
const send = (m) => mcp.stdin.write(JSON.stringify(m) + '\n');
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } });
await sleep(1500);
send({ jsonrpc: '2.0', method: 'notifications/initialized' });
send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
await sleep(1500);
mcp.kill();
const lines = out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } });
const tools = lines.find((l) => l?.id === 2)?.result?.tools?.map((t) => t.name).sort() ?? [];
check('MCP server lists its 5 tools', tools.length === 5 && tools.every((t) => t.startsWith('brushup_')), JSON.stringify(tools));

// static server
writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>t</title><h1>Hello</h1>');
const server = spawn(bin('brushup'), ['index.html', '--port', '4399'], { cwd: dir, stdio: 'ignore' });
let page = '';
for (let i = 0; i < 20 && !page; i++) {
  await sleep(500);
  page = await fetch('http://127.0.0.1:4399/').then((r) => r.text()).catch(() => '');
}
server.kill();
check('brushup <page.html> serves the page with the canvas', page.includes('__brushup') && page.includes('Hello'));

rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
