/**
 * Browser entry point for the hosted composer. esbuild bundles this to
 * `docs/app.bundle.js`, exposing the same renderer the sender uses under
 * `window.Bulletproof`, so the preview page and the emails you send can never
 * drift apart.
 */
export { renderBulletproofEmail, renderText, inlineFormat } from "./html/render.js";
export { renderSimpleEmail } from "./html/templates.js";
export { blocksFromText } from "./html/markdown.js";
export { escapeHtml, safeUrl, safeColor } from "./html/escape.js";
export { DEFAULT_THEME } from "./html/types.js";
export type { BulletproofEmailInput, EmailBlock, EmailTheme, RenderedEmail } from "./html/types.js";
