import { describe, expect, it } from 'vitest';
import { estimateSavings, parseLog, roundTokens, SIMPLE_TOKENS, TOKENS, VISUAL_TOKENS, type LogEntry } from '../src/core/savings';

const at = (s: number) => new Date(1_700_000_000_000 + s * 1000).toISOString();
const edit = (s: number, kind: string, id = 'src/A.tsx:1:1'): LogEntry => ({ at: at(s), edit: { kind, id } });

describe('estimateSavings', () => {
  it('counts a described tweak at the cost of a prompt, a file read and a reply, and a visual one with a screenshot too', () => {
    expect(SIMPLE_TOKENS).toBe(TOKENS.prompt + TOKENS.fileRead + TOKENS.reply);
    expect(VISUAL_TOKENS).toBe(SIMPLE_TOKENS + TOKENS.screenshot);
    expect(estimateSavings([edit(0, 'text')])).toEqual({ changes: 1, edits: 1, tokens: SIMPLE_TOKENS });
    expect(estimateSavings([edit(0, 'style')])).toEqual({ changes: 1, edits: 1, tokens: VISUAL_TOKENS });
  });

  it('counts a run of edits to one element as one tweak, not one prompt per key press', () => {
    const nudges = Array.from({ length: 20 }, (_, i) => edit(i, 'style'));
    expect(estimateSavings(nudges)).toEqual({ changes: 1, edits: 20, tokens: VISUAL_TOKENS });
  });

  it('counts edits to different elements, or far apart in time, as separate tweaks', () => {
    expect(estimateSavings([edit(0, 'style', 'a'), edit(5, 'style', 'b')]).changes).toBe(2);
    expect(estimateSavings([edit(0, 'style', 'a'), edit(120, 'style', 'a')]).changes).toBe(2);
  });

  it('a tweak that starts as text and turns visual adds the screenshot once', () => {
    expect(estimateSavings([edit(0, 'text'), edit(5, 'style'), edit(8, 'style')]).tokens).toBe(SIMPLE_TOKENS + TOKENS.screenshot);
  });

  it('takes undone edits out, and puts them back on redo', () => {
    const log: LogEntry[] = [edit(0, 'text', 'a'), edit(100, 'text', 'b'), { at: at(110), undo: ['f'] }];
    expect(estimateSavings(log).changes).toBe(1);
    expect(estimateSavings([...log, { at: at(120), redo: ['f'] }]).changes).toBe(2);
    // A new edit after an undo ends the chance to redo.
    expect(estimateSavings([...log, edit(130, 'text', 'c'), { at: at(140), redo: ['f'] }]).changes).toBe(2);
  });

  it('counts one batch (several elements dragged at once) as one tweak', () => {
    const batch: LogEntry = { at: at(0), edits: [{ kind: 'style', id: 'a' }, { kind: 'style', id: 'b' }] };
    expect(estimateSavings([batch])).toEqual({ changes: 1, edits: 2, tokens: VISUAL_TOKENS });
  });

  it('only counts the edits since a session started', () => {
    const log = [edit(0, 'text', 'a'), edit(1000, 'text', 'b')];
    expect(estimateSavings(log, Date.parse(at(500))).changes).toBe(1);
    expect(estimateSavings(log).changes).toBe(2);
  });

  it('survives a log with junk in it', () => {
    expect(parseLog('not json\n{"at":"x"}\n\n{"edit":{"kind":"text","id":"a"},"at":"' + at(0) + '"}').length).toBe(2);
    expect(estimateSavings(parseLog('garbage\n{"edit":{"kind":"text"}}')).changes).toBe(0); // no timestamp: skipped
  });
});

describe('roundTokens', () => {
  it('rounds to something that reads as an estimate', () => {
    expect(roundTokens(940)).toBe('940');
    expect(roundTokens(1900)).toBe('1.9k');
    expect(roundTokens(3000)).toBe('3k');
    expect(roundTokens(31400)).toBe('31k');
  });
});
