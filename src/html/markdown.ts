import type { EmailBlock } from "./types.js";

/**
 * Turn a plain/markdown-ish body into renderer blocks. Blank lines separate
 * paragraphs; a line that is exactly one `[Label](https://url)` becomes a
 * button; a line starting with `# ` becomes a heading. The inline subset
 * (`**bold**`, `*italic*`, `[text](url)`) is handled later by the renderer.
 */
export function blocksFromText(body: string): EmailBlock[] {
  const blocks: EmailBlock[] = [];
  const paragraphs = body.replace(/\r\n/g, "\n").split(/\n\s*\n/);
  for (const raw of paragraphs) {
    const para = raw.trim();
    if (!para) continue;
    const heading = para.match(/^(#{1,3})\s+(.*)$/);
    if (heading && !para.includes("\n")) {
      const level = heading[1]!.length as 1 | 2 | 3;
      blocks.push({ type: "heading", text: heading[2]!.trim(), level });
      continue;
    }
    const linkOnly = para.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (linkOnly) {
      blocks.push({ type: "button", text: linkOnly[1]!.trim(), url: linkOnly[2]! });
      continue;
    }
    blocks.push({ type: "text", text: para });
  }
  return blocks;
}
