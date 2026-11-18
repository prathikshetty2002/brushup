import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditError } from '../src/core/edit-types';
import { Project } from '../src/server/project';

let dir: string;
let entry: string;
let project: Project;

const HTML = '<!doctype html>\n<html><body>\n<h1>Hi</h1>\n<p>There</p>\n</body></html>\n';

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'ascend-'));
  entry = path.join(dir, 'index.html');
  await writeFile(entry, HTML);
  project = new Project(entry);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const idOf = async (tag: string) => {
  const { html } = await project.render();
  return /data-ascend-id="(a\d+)"/.exec(html.slice(html.indexOf(`<${tag} `)))![1];
};

describe('Project', () => {
  it('writes an edit once and recognises its own write exactly once', async () => {
    const { hash } = await project.render();
    const out = await project.edit({ kind: 'style', id: await idOf('h1'), tag: 'h1', props: { color: 'red' } }, hash);
    expect(out.files).toEqual([entry]);
    const written = await readFile(entry, 'utf8');
    expect(written).toContain('<h1 style="color: red">Hi</h1>');
    expect(project.consumeOwnWrite(entry, written)).toBe(true);
    expect(project.consumeOwnWrite(entry, written)).toBe(false);
  });

  it('rejects an edit based on a stale hash', async () => {
    const { hash } = await project.render();
    await writeFile(entry, HTML.replace('Hi', 'Hello'));
    await expect(project.edit({ kind: 'style', id: await idOf('h1'), tag: 'h1', props: { color: 'red' } }, hash)).rejects.toThrow(EditError);
  });

  it('undoes and redoes', async () => {
    const edit = { kind: 'text', id: await idOf('p'), tag: 'p', text: 'Changed' } as const;
    await project.edit(edit, (await project.render()).hash);
    await project.undo();
    expect(await readFile(entry, 'utf8')).toBe(HTML);
    await project.redo();
    expect(await readFile(entry, 'utf8')).toContain('<p>Changed</p>');
  });

  it("refuses to undo over the agent's later changes, and keeps the edit undoable", async () => {
    const edit = { kind: 'text', id: await idOf('p'), tag: 'p', text: 'Changed' } as const;
    await project.edit(edit, (await project.render()).hash);
    const agent = (await readFile(entry, 'utf8')).replace('Hi', 'Agent was here');
    await writeFile(entry, agent);
    await expect(project.undo()).rejects.toThrow(/changed since/);
    expect(await readFile(entry, 'utf8')).toBe(agent);
    // Once the agent's change is out of the way the edit can still be reverted.
    await writeFile(entry, agent.replace('Agent was here', 'Hi'));
    await project.undo();
    expect(await readFile(entry, 'utf8')).toBe(HTML);
  });

  it('records the selection for the agent', async () => {
    await project.setSelection({ id: await idOf('p'), tag: 'p' });
    const sel = JSON.parse(await readFile(path.join(dir, '.ascend', 'selection.json'), 'utf8'));
    expect(sel).toMatchObject({ file: 'index.html', tag: 'p', line: 4, text: 'There' });
  });
});
