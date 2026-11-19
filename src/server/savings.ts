import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { estimateSavings, parseLog, type Savings } from '../core/savings';

export interface SavingsReport {
  session: Savings;
  /** Every edit in this project's log, across sessions. */
  total: Savings;
}

/** The estimate for this server's session (edits since it started) and for the whole edit log. */
export async function readSavings(root: string, sessionStart: number): Promise<SavingsReport> {
  let log = [] as ReturnType<typeof parseLog>;
  try {
    log = parseLog(await readFile(path.join(root, '.brushup', 'edits.jsonl'), 'utf8'));
  } catch {
    /* no edits yet */
  }
  return { session: estimateSavings(log, sessionStart), total: estimateSavings(log) };
}
