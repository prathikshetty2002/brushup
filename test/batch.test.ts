import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Edit } from '../src/core/edit-types';
import { DevProject } from '../src/server/dev-project';
import { Project } from '../src/server/project';

let dir: string;
beforeEach(async () => void (dir = await mkdtemp(path.join(os.tmpdir(), 'ascend-batch-'))));
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('batch edits in a JSX project', () => {
  // Two buttons on ONE line: patching the first shifts the second's column, the trap that last-to-first ordering avoids.
  const SRC = `export default function Page() {
  return (
    <div>
      <Button>One</Button> <Button>Two</Button>
      <p>Para</p>
    </div>
  );
}
`;
  const ref = (needle: string, name: string, nth = 0) => {
    let at = -1;
    for (let i = 0; i <= nth; i++) at = SRC.indexOf(needle, at + 1);
    const before = SRC.slice(0, at).split('\n');
    return `src/page.tsx:${before.length}:${before[before.length - 1].length}${name ? `#${name}` : ''}`;
  };

  async function setup() {
    await mkdir(path.join(dir, 'src'));
    await writeFile(path.join(dir, 'src/page.tsx'), SRC);
    return new DevProject(dir, { style: 'tailwind' });
  }

  it('patches every element even when they share a line, in a single write', async () => {
    const project = await setup();
    const edits: Edit[] = [
      { kind: 'style', id: ref('<Button>', 'Button', 0), tag: 'button', props: { width: '120px' } },
      { kind: 'style', id: ref('<Button>', 'Button', 1), tag: 'button', props: { width: '120px' } },
      { kind: 'style', id: ref('<p>', ''), tag: 'p', props: { 'margin-top': '8px' } },
    ];
    const out = await project.editMany(edits);
    expect(out.files).toHaveLength(1);
    const code = await readFile(path.join(dir, 'src/page.tsx'), 'utf8');
    expect(code).toContain('<Button className="w-[120px]">One</Button> <Button className="w-[120px]">Two</Button>');
    expect(code).toContain('<p className="mt-[8px]">Para</p>');
  });

  it('is one undo step for the whole batch, and redo restores it', async () => {
    const project = await setup();
    await project.editMany([
      { kind: 'style', id: ref('<Button>', 'Button', 0), tag: 'button', props: { width: '120px' } },
      { kind: 'style', id: ref('<Button>', 'Button', 1), tag: 'button', props: { width: '120px' } },
    ]);
    await project.undo();
    expect(await readFile(path.join(dir, 'src/page.tsx'), 'utf8')).toBe(SRC);
    await project.redo();
    expect(await readFile(path.join(dir, 'src/page.tsx'), 'utf8')).toContain('<Button className="w-[120px]">Two</Button>');
  });

  it('applies nothing if one edit in the batch is invalid', async () => {
    const project = await setup();
    await expect(
      project.editMany([
        { kind: 'style', id: ref('<Button>', 'Button', 0), tag: 'button', props: { width: '120px' } },
        { kind: 'style', id: 'src/page.tsx:99:0#Nope', tag: 'button', props: { width: '1px' } },
      ]),
    ).rejects.toThrow(/no longer at/);
    expect(await readFile(path.join(dir, 'src/page.tsx'), 'utf8')).toBe(SRC);
  });

  it('logs one entry listing every edit', async () => {
    const project = await setup();
    await project.editMany([
      { kind: 'style', id: ref('<Button>', 'Button', 0), tag: 'button', props: { width: '120px' } },
      { kind: 'style', id: ref('<p>', ''), tag: 'p', props: { 'margin-top': '8px' } },
    ]);
    const lines = (await readFile(path.join(dir, '.ascend/edits.jsonl'), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).edits).toHaveLength(2);
  });
});

describe('batch edits in a static HTML project', () => {
  it('edits several elements as one undo step', async () => {
    const entry = path.join(dir, 'index.html');
    const html = '<!doctype html><html><body><h1>A</h1><p>B</p></body></html>';
    await writeFile(entry, html);
    const project = new Project(entry);
    const { hash } = await project.render();
    const id = async (tag: string) => /data-ascend-id="(a\d+)"/.exec((await project.render()).html.slice((await project.render()).html.indexOf(`<${tag} `)))![1];
    await project.editMany(
      [
        { kind: 'style', id: await id('h1'), tag: 'h1', props: { color: 'red' } },
        { kind: 'style', id: await id('p'), tag: 'p', props: { color: 'blue' } },
      ],
      hash,
    );
    const after = await readFile(entry, 'utf8');
    expect(after).toContain('<h1 style="color: red">');
    expect(after).toContain('<p style="color: blue">');
    await project.undo();
    expect(await readFile(entry, 'utf8')).toBe(html);
  });
});

describe('edit log', () => {
  it('records what the user did, not the locating fingerprint or hints', async () => {
    await mkdir(path.join(dir, 'src'));
    await writeFile(path.join(dir, 'src/page.tsx'), 'export default function P() {\n  return <p className="a">Hi</p>;\n}\n');
    const project = new DevProject(dir, { style: 'tailwind' });
    await project.edit({ kind: 'style', id: 'src/page.tsx:2:9', tag: 'p', props: { 'margin-left': '8px' }, ident: { cls: 'a', text: 'Hi' }, hints: { rootPx: 16 } });
    const entry = JSON.parse((await readFile(path.join(dir, '.ascend/edits.jsonl'), 'utf8')).trim());
    expect(entry.edit).toMatchObject({ kind: 'style', props: { 'margin-left': '8px' } });
    expect(entry.edit.ident).toBeUndefined();
    expect(entry.edit.hints).toBeUndefined();
  });
});
