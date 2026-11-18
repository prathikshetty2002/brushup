import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { wireProject, type WireResult } from './wire';

const START = '<!-- ascend:start -->';
const END = '<!-- ascend:end -->';

/** What goes into CLAUDE.md so Claude Code knows how to use Ascend's notes and respects manual edits. */
export const CLAUDE_BLOCK = `${START}
## Ascend design notes

This project uses Ascend, a visual canvas where the user makes small UI changes by hand (text, size, spacing, position) and pins notes on elements, sections and components.

Before changing UI:
- Read \`.ascend/notes.md\`: open notes the user pinned, each with the source file:line of the element when known. Do what each note asks.
- Read \`.ascend/edits.jsonl\`: recent manual edits made on the canvas. Keep them; do not revert or redo them.
- \`.ascend/selection.json\` is the element currently selected on the canvas, usually what "this" refers to.
- When you finish a note, set its \`"status"\` to \`"done"\` in \`.ascend/notes.json\`.
- Do not spend effort on trivial visual tweaks the user can make on the canvas themselves.
- If the \`ascend\` MCP tools are available, prefer them: \`ascend_get_notes\`, \`ascend_update_note\`, \`ascend_get_selection\`, \`ascend_recent_edits\`, and \`ascend_inspect\` (how an element renders right now, instead of asking for a screenshot).
${END}
`;

async function exists(file: string) {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

export interface InitResult {
  claudeMd: 'created' | 'updated' | 'unchanged';
  gitignore: 'updated' | 'unchanged' | 'absent';
  /** Only set when `mcp` was requested. */
  mcp?: 'created' | 'updated' | 'unchanged' | 'invalid-json';
  /** The Next.js / Vite files hooked up (omitted with `wire: false`). */
  wire?: WireResult;
}

/** Register the Ascend MCP server in the project's `.mcp.json`, leaving every other server as it was. */
async function initMcp(root: string): Promise<NonNullable<InitResult['mcp']>> {
  const file = path.join(root, '.mcp.json');
  const entry = { command: 'npx', args: ['ascend-mcp'] };
  if (!(await exists(file))) {
    await writeFile(file, JSON.stringify({ mcpServers: { ascend: entry } }, null, 2) + '\n');
    return 'created';
  }
  let config: { mcpServers?: Record<string, unknown> };
  try {
    config = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return 'invalid-json'; // never overwrite a file we can't parse
  }
  if (config.mcpServers?.ascend) return 'unchanged';
  config.mcpServers = { ...config.mcpServers, ascend: entry };
  await writeFile(file, JSON.stringify(config, null, 2) + '\n');
  return 'updated';
}

/** Idempotent project setup: CLAUDE.md block, `.ascend/` in .gitignore, optional MCP entry, and the Next/Vite wiring. */
export async function initProject(root: string, options: { mcp?: boolean; wire?: boolean } = {}): Promise<InitResult> {
  await mkdir(path.join(root, '.ascend'), { recursive: true });

  const claude = path.join(root, 'CLAUDE.md');
  let claudeMd: InitResult['claudeMd'];
  if (!(await exists(claude))) {
    await writeFile(claude, CLAUDE_BLOCK);
    claudeMd = 'created';
  } else {
    const current = await readFile(claude, 'utf8');
    const start = current.indexOf(START);
    const end = current.indexOf(END);
    if (start >= 0 && end > start) {
      const next = current.slice(0, start) + CLAUDE_BLOCK.trimEnd() + current.slice(end + END.length);
      claudeMd = next === current ? 'unchanged' : 'updated';
      if (claudeMd === 'updated') await writeFile(claude, next);
    } else {
      await appendFile(claude, (current.endsWith('\n') ? '\n' : '\n\n') + CLAUDE_BLOCK);
      claudeMd = 'updated';
    }
  }

  const gitignore = path.join(root, '.gitignore');
  let ignore: InitResult['gitignore'] = 'absent';
  if (await exists(gitignore)) {
    const current = await readFile(gitignore, 'utf8');
    if (/^\.ascend\/?$/m.test(current)) ignore = 'unchanged';
    else {
      await appendFile(gitignore, (current.endsWith('\n') ? '' : '\n') + '.ascend/\n');
      ignore = 'updated';
    }
  }
  return { claudeMd, gitignore: ignore, ...(options.mcp ? { mcp: await initMcp(root) } : {}), ...(options.wire === false ? {} : { wire: await wireProject(root) }) };
}
