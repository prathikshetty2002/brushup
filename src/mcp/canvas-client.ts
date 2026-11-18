import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { pidAlive, readHostFile } from '../server/host-file';

export type CanvasAnswer = { ok: true; data: unknown } | { ok: false; error: string };

const NOT_RUNNING = 'Brushup is not running for this project. Start your dev server (next dev / vite) or `brushup <page.html>` and open the page in a browser.';

/**
 * Ask the open canvas a question. The server named in `.brushup/host.json` forwards it to the browser page
 * the user touched last; the answer comes back the same way. One short-lived connection per question.
 */
export async function askCanvas(root: string, ask: Record<string, unknown>, timeoutMs = 7000): Promise<CanvasAnswer> {
  const host = await readHostFile(root);
  if (!host || !pidAlive(host.pid)) return { ok: false, error: NOT_RUNNING };

  return new Promise<CanvasAnswer>((resolve) => {
    const id = randomBytes(6).toString('hex');
    let settled = false;
    const done = (answer: CanvasAnswer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve(answer);
    };
    const ws = new WebSocket(host.wsUrl);
    const timer = setTimeout(() => done({ ok: false, error: 'Timed out waiting for the Brushup canvas.' }), timeoutMs);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'hello', role: 'agent' }));
      ws.send(JSON.stringify({ type: 'ask', id, ask }));
    });
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'answer' && msg.id === id) done(msg.ok ? { ok: true, data: msg.data } : { ok: false, error: String(msg.error ?? 'The canvas could not answer.') });
      } catch {
        /* not for us */
      }
    });
    ws.on('error', () => done({ ok: false, error: NOT_RUNNING }));
    ws.on('close', () => done({ ok: false, error: NOT_RUNNING }));
  });
}
