/**
 * @module patch-tool-order-utils
 *
 * Pure helper functions extracted from patch-tool-order for testability.
 */

/**
 * Parse the toolOrder array from file content.
 * Returns the full match string, any declaration keyword prefix, and the
 * parsed tool names.
 */
export function parseToolOrder(content: string): {
  match: string;
  prefix: string;
  tools: string[];
} | null {
  // Capture an optional declaration keyword (const/let/var) before toolOrder.
  const re = /(?:(const|let|var)\s+)?toolOrder\s*=\s*\[([\s\S]*?)\]/;
  const m = re.exec(content);

  if (!m) return null;

  const prefix = m[1] ? `${m[1]} ` : '';
  const tools = m[2]
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);

  return { match: m[0], prefix, tools };
}

/**
 * Build the patched toolOrder array string, preserving the original
 * formatting (tab-indented, one tool per line).
 */
export function buildToolOrderString(prefix: string, tools: string[]): string {
  const entries = tools.map((t) => `\t\t"${t}"`).join(',\n');
  return `${prefix}toolOrder = [\n${entries}\n\t]`;
}
