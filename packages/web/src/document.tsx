/**
 * The viewer's HTML document, as a Preact component rather than an `index.html`
 * Vite transforms. Same idiom as the Local Preview chrome (ADR-0011): one view
 * runtime all the way out to `<html>`, and the only thing that differs between dev
 * and production is which asset URLs get emitted.
 */

/** Where the client bundle lives. Vite's dev server and its manifest disagree. */
export interface Assets {
  js: string[];
  css: string[];
}

/** In dev, Vite serves the entry from source and injects its own client itself. */
export const DEV_ASSETS: Assets = { js: ["/src/entry-client.tsx"], css: [] };

interface DocumentProps {
  /** The SSR'd app markup, already rendered. */
  html: string;
  /** Dehydrated query cache, replayed into the client's cache on hydrate. */
  state: string;
  assets: Assets;
}

export function Document({ html, state, assets }: DocumentProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>scholia</title>
        {assets.css.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
      </head>
      <body>
        <div id="app" dangerouslySetInnerHTML={{ __html: html }} />
        {/* The cache the server warmed, so the client doesn't refetch what it can
            already see rendered above. Serialized by `serializeState`, which escapes
            `<` so no string in the data can close this tag early. */}
        <script dangerouslySetInnerHTML={{ __html: `window.__SCHOLIA_STATE__=${state}` }} />
        {assets.js.map((src) => (
          <script key={src} type="module" src={src} />
        ))}
      </body>
    </html>
  );
}
