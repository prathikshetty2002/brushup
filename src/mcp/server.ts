import { existsSync } from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getNotes, getRecentEdits, getSelection, inspect, updateNote, type ToolContext, type ToolResult } from './tools';

/** `--root`, `BRUSHUP_ROOT`, else the nearest folder at or above the working directory that has a `.brushup/`. */
export function findRoot(argv = process.argv.slice(2), env = process.env, cwd = process.cwd()): string {
  const flag = argv.indexOf('--root');
  const explicit = (flag >= 0 && argv[flag + 1]) || env.BRUSHUP_ROOT;
  if (explicit) return path.resolve(explicit);
  let dir = cwd;
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, '.brushup'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return cwd;
}

const asContent = (result: ToolResult) => ({
  content: [{ type: 'text' as const, text: result.ok ? JSON.stringify(result.data, null, 2) : result.error }],
  isError: !result.ok,
});

export function createServer(ctx: ToolContext) {
  const server = new McpServer({ name: 'brushup', version: '0.1.0' });
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

  server.registerTool(
    'brushup_get_notes',
    {
      title: 'Get Brushup design notes',
      description:
        'The notes the user pinned on elements, sections and components in the Brushup design canvas, each with the source file and line it lives at and the element\'s classes/text. ' +
        'Call this before changing UI, and do what each open note asks. The "number" matches the pin the user sees on the canvas.',
      inputSchema: {
        status: z.enum(['open', 'done', 'all']).optional().describe('Which notes to return. Default: open.'),
        page: z.string().optional().describe('Only notes made on this URL path, e.g. "/pricing".'),
      },
      annotations: readOnly,
    },
    async (input) => asContent(await getNotes(ctx, input)),
  );

  server.registerTool(
    'brushup_update_note',
    {
      title: 'Mark an Brushup note done or reopen it',
      description: 'Set a note\'s status once you have handled it. Only changes .brushup/notes.json, never source code.',
      inputSchema: { id: z.string().describe('Note id from brushup_get_notes.'), status: z.enum(['open', 'done']) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => asContent(await updateNote(ctx, input)),
  );

  server.registerTool(
    'brushup_get_selection',
    {
      title: 'Get the element selected on the Brushup canvas',
      description: 'The element the user currently has selected on the canvas (file, line, tag, classes, text). Use it to resolve "this" or "the selected element".',
      annotations: readOnly,
    },
    async () => asContent(await getSelection(ctx)),
  );

  server.registerTool(
    'brushup_recent_edits',
    {
      title: 'Get recent manual edits made on the Brushup canvas',
      description:
        'The user\'s latest manual tweaks (size, spacing, position, text), newest first, with the element and the new values. They are already written to source: keep them, do not revert or redo them.',
      inputSchema: { limit: z.number().int().min(1).max(50).optional().describe('How many entries. Default 10.') },
      annotations: readOnly,
    },
    async (input) => asContent(await getRecentEdits(ctx, input)),
  );

  server.registerTool(
    'brushup_inspect',
    {
      title: 'Inspect how an element renders right now',
      description:
        'Ask the open Brushup canvas how an element actually renders: size and position, computed layout/spacing/typography/colors, whether its content is clipped (and how far content extends past the box), and its parent. ' +
        'Defaults to the selected element; pass note_id to inspect the element a note is pinned to. Needs the app running and open in a browser. Use it instead of asking the user for a screenshot.',
      inputSchema: {
        note_id: z.string().optional().describe('Inspect the element this note is pinned to instead of the selection.'),
        note_ids: z.array(z.string()).max(10).optional().describe('Inspect the elements of several notes at once (up to 10); each answers separately.'),
      },
      annotations: { ...readOnly, openWorldHint: false },
    },
    async (input) => asContent(await inspect(ctx, input)),
  );

  return server;
}

export async function main() {
  const root = findRoot();
  const server = createServer({ root });
  await server.connect(new StdioServerTransport());
  // stdout is the protocol channel; diagnostics go to stderr.
  console.error(`brushup MCP server ready (project: ${root})`);
}
