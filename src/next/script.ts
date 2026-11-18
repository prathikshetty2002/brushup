import { createElement } from 'react';

/**
 * Put `<AscendScript />` in your root layout (inside <body>). In development it loads the Ascend canvas;
 * in production it renders nothing. Server and client render the same single <script src> tag, so
 * there is no hydration mismatch.
 */
export function AscendScript() {
  const raw = process.env.NEXT_PUBLIC_ASCEND;
  if (!raw) return null;
  const { overlay, ws } = JSON.parse(raw) as { overlay: string; ws: string };
  return createElement('script', { src: overlay, async: true, 'data-ascend-mode': 'dev', 'data-ascend-ws': ws });
}

export default AscendScript;
