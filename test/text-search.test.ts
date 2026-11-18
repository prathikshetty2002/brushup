import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Edit } from '../src/core/edit-types';
import { TextNotHere } from '../src/core/jsx-patch';
import { needleOf, placesIn, SKIPPED, writePlace } from '../src/core/text-search';
import { DevProject } from '../src/server/dev-project';

describe('placesIn', () => {
  const find = (code: string, text: string, file = 'a.tsx') => placesIn(code, `/p/${file}`, text);

  it('finds a string, a template literal, JSX text and a text attribute', () => {
    const code = `const a = "Save";\nconst b = \`Save\`;\nexport const c = <button label="Save">Save</button>;\n`;
    expect(find(code, 'Save').map((p) => [p.kind, p.line])).toEqual([['string', 1], ['string', 2], ['attribute', 3], ['jsx-text', 3]]);
  });

  it('ignores whitespace differences, partial matches, identifiers, import paths, object keys and class names', () => {
    expect(find('const a = "  Save   changes ";', 'Save changes')).toHaveLength(1);
    expect(find('const a = "Save changes now";', 'Save changes')).toHaveLength(0);
    expect(find(`import x from "Save";\nconst o = { "Save": 1, Save: 2 };\nconst e = <p className="Save" id="Save" />;`, 'Save')).toHaveLength(0);
    expect(find(`"use client";\nexport default 1;`, 'use client')).toHaveLength(0);
  });

  it('decodes JSX text entities and skips template literals with expressions', () => {
    expect(find('export default () => <p>Tom &amp; Jerry</p>;', 'Tom & Jerry')).toHaveLength(1);
    expect(find('const a = `Hi ${name}`;', 'Hi')).toHaveLength(0);
  });

  it('reads TypeScript, and JSON values but not JSON keys', () => {
    expect(find('const x: string = "Save"; type T = { a: number };', 'Save', 'a.ts')).toHaveLength(1);
    const json = '{ "save": "Save", "Save": "Other", "nested": { "a": ["Save"] } }';
    expect(find(json, 'Save', 'm.json').map((p) => p.kind)).toEqual(['json', 'json']);
  });

  it('writes in the form each place wants', () => {
    const w = (code: string, text: string, i = 0) => writePlace(code, find(code, 'Save')[i], text);
    expect(w('const a = "Save";', 'Say "hi"')).toBe('const a = "Say \\"hi\\"";');
    expect(w("const a = 'Save';", "it's")).toBe("const a = 'it\\'s';");
    expect(w('<b label="Save" />', 'Keep')).toBe('<b label="Keep" />');
    expect(w('<b label="Save" />', 'Say "x"')).toBe(`<b label='Say "x"' />`);
    expect(w('<b label="Save" />', `a "b" 'c'`)).toBe(`<b label={"a \\"b\\" 'c'"} />`);
    expect(w('<p>\n  Save\n</p>', 'A & B')).toBe('<p>\n  A &amp; B\n</p>');
    expect(writePlace('{ "k": "Save" }', find('{ "k": "Save" }', 'Save', 'm.json')[0], 'Hi "x"')).toBe('{ "k": "Hi \\"x\\"" }');
  });

  it('needleOf picks a distinctive word, and nothing for text with none', () => {
    expect(needleOf('Save your changes')).toBe('changes');
    expect(needleOf('OK')).toBeNull();
  });

  it('skips tests, stories, node_modules and config files', () => {
    for (const f of ['a.test.tsx', 'src/__tests__/a.tsx', 'x.stories.tsx', 'node_modules/p/i.js', 'package.json', 'tsconfig.json', 'e2e/a.ts', 'types.d.ts']) expect(SKIPPED.test(f), f).toBe(true);
    for (const f of ['src/app/page.tsx', 'messages/en.json', 'src/data/items.ts']) expect(SKIPPED.test(f), f).toBe(false);
  });
});

describe('text edits that find their text by value', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'brushup-value-'));
    await mkdir(path.join(dir, 'src'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const w = (rel: string, text: string) => (mkdir(path.dirname(path.join(dir, rel)), { recursive: true }).then(() => writeFile(path.join(dir, rel), text)));
  const read = (rel: string) => readFile(path.join(dir, rel), 'utf8');
  const refOf = (code: string, needle: string, file: string) => {
    const lines = code.slice(0, code.indexOf(needle)).split('\n');
    return `${file}:${lines.length}:${lines[lines.length - 1].length}`;
  };
  const edit = (code: string, needle: string, file: string, text: string, was: string): Edit => ({ kind: 'text', id: refOf(code, needle, file), tag: needle.slice(1, -1), text, was, instance: 0 }) as Edit;

  it('a prop: edits the text where the component is used', async () => {
    const card = 'export function Card({ label }) {\n  return <p>{label}</p>;\n}\n';
    const page = 'import { Card } from "./Card";\nexport default function P() {\n  return <Card label="Save changes" />;\n}\n';
    await w('src/Card.tsx', card);
    await w('src/page.tsx', page);
    const out = await new DevProject(dir).edit(edit(card, '<p>', 'src/Card.tsx', 'Keep changes', 'Save changes'));
    expect(await read('src/page.tsx')).toContain('<Card label="Keep changes" />');
    expect(await read('src/Card.tsx')).toBe(card);
    expect(out.warning).toMatch(/Written where it's defined \(src\/page\.tsx:3\); everything that uses that text changes too/);
  });

  it('a constant and a state default', async () => {
    const page = 'const title = "Welcome back";\nexport default function P() {\n  const [label] = useState("Save changes");\n  return <div><h1>{title}</h1><p>{label}</p></div>;\n}\n';
    await w('src/page.tsx', page);
    const project = new DevProject(dir);
    await project.edit(edit(page, '<h1>', 'src/page.tsx', 'Hello again', 'Welcome back'));
    await project.edit(edit(page.replace('Welcome back', 'Hello again'), '<p>', 'src/page.tsx', 'Keep changes', 'Save changes'));
    expect(await read('src/page.tsx')).toContain('const title = "Hello again"');
    expect(await read('src/page.tsx')).toContain('useState("Keep changes")');
  });

  it('a filtered list, by matching the text the page shows', async () => {
    const page = 'const items = [{ t: "One thing" }, { t: "Another thing" }, { t: "Third thing" }];\nexport default function P() {\n  return <ul>{items.filter((i) => i.t).slice(1).map((i) => <li>{i.t}</li>)}</ul>;\n}\n';
    await w('src/page.tsx', page);
    await new DevProject(dir).edit(edit(page, '<li>', 'src/page.tsx', 'Changed thing', 'Third thing'));
    const out = await read('src/page.tsx');
    expect(out).toContain('{ t: "Changed thing" }');
    expect(out).toContain('{ t: "One thing" }');
  });

  it('a translation file', async () => {
    const page = 'export default function P() {\n  return <button>{t("save")}</button>;\n}\n';
    await w('src/page.tsx', page);
    await w('messages/en.json', '{\n  "save": "Save the page",\n  "cancel": "Cancel"\n}\n');
    await new DevProject(dir).edit(edit(page, '<button>', 'src/page.tsx', 'Store the page', 'Save the page'));
    expect(await read('messages/en.json')).toBe('{\n  "save": "Store the page",\n  "cancel": "Cancel"\n}\n');
  });

  it('refuses when several places write the text, and lists them', async () => {
    const page = 'const a = "Save changes";\nexport default function P() {\n  return <div><p>{x}</p><b>Save changes</b></div>;\n}\n';
    await w('src/page.tsx', page);
    await w('src/other.ts', 'export const b = "Save changes";\n');
    const p = new DevProject(dir).edit(edit(page, '<p>', 'src/page.tsx', 'Keep', 'Save changes'));
    await expect(p).rejects.toThrow(/written in 3 places \(.*page\.tsx:1.*other\.ts:1/);
    await expect(p).rejects.toBeInstanceOf(TextNotHere);
    expect(await read('src/page.tsx')).toBe(page);
  });

  it('ignores copies of the text in tests and stories', async () => {
    const card = 'export function Card({ label }) {\n  return <p>{label}</p>;\n}\n';
    await w('src/Card.tsx', card);
    await w('src/page.tsx', 'export default () => <Card label="Save changes" />;\n');
    await w('src/page.test.tsx', 'expect(screen.getByText("Save changes")).toBeTruthy();\n');
    await w('src/Card.stories.tsx', 'export const Primary = { args: { label: "Save changes" } };\n');
    await new DevProject(dir).edit(edit(card, '<p>', 'src/Card.tsx', 'Keep', 'Save changes'));
    expect(await read('src/page.tsx')).toContain('label="Keep"');
    expect(await read('src/page.test.tsx')).toContain('Save changes');
  });

  it('keeps the original refusal when nothing writes the text (a database, an API) or it is too short', async () => {
    const card = 'export function Card({ label }) {\n  return <p>{label}</p>;\n}\n';
    await w('src/Card.tsx', card);
    await w('src/page.tsx', 'export default () => <Card label={post.title} />;\n');
    await expect(new DevProject(dir).edit(edit(card, '<p>', 'src/Card.tsx', 'New title', 'Some post title'))).rejects.toThrow(/comes from \{label\}, which is an expression/);
    await w('src/page.tsx', 'export default () => <Card label="OK" />;\n');
    await expect(new DevProject(dir).edit(edit(card, '<p>', 'src/Card.tsx', 'Fine', 'OK'))).rejects.toThrow(/comes from \{label\}/);
    expect(await read('src/page.tsx')).toContain('label="OK"');
  });

  it('does nothing different when the element holds its own text', async () => {
    const page = 'export default () => <p>Hello there</p>;\n';
    await w('src/page.tsx', page);
    await w('src/other.ts', 'export const x = "Hello there";\n');
    await new DevProject(dir).edit(edit(page, '<p>', 'src/page.tsx', 'Hi there', 'Hello there'));
    expect(await read('src/page.tsx')).toContain('<p>Hi there</p>');
    expect(await read('src/other.ts')).toContain('Hello there');
  });
});
