import { createElement } from 'react';

/**
 * Put `<BrushupScript />` in your root layout (inside <body>). In development it loads the Brushup canvas;
 * in production it renders nothing. Server and client render the same single <script src> tag, so
 * there is no hydration mismatch.
 */
export function BrushupScript() {
  const raw = process.env.NEXT_PUBLIC_BRUSHUP;
  if (!raw) return null;
  const { overlay, ws } = JSON.parse(raw) as { overlay: string; ws: string };
  return createElement('script', { src: overlay, async: true, 'data-brushup-mode': 'dev', 'data-brushup-ws': ws });
}

export default BrushupScript;
