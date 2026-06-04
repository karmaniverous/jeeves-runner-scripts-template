import { describe, expect, it } from 'vitest';

import {
  buildToolOrderString,
  parseToolOrder,
} from './patch-tool-order-utils.js';

// ── parseToolOrder ──────────────────────────────────────────────────

describe('parseToolOrder', () => {
  it('parses "const toolOrder = [...]" and captures const prefix', () => {
    const content = `const toolOrder = ["grep", "glob", "read"]`;
    const result = parseToolOrder(content);
    expect(result).not.toBeNull();
    expect(result!.prefix).toBe('const ');
    expect(result!.tools).toEqual(['grep', 'glob', 'read']);
  });

  it('parses "let toolOrder = [...]" and captures let prefix', () => {
    const content = `let toolOrder = ["a", "b"]`;
    const result = parseToolOrder(content);
    expect(result!.prefix).toBe('let ');
    expect(result!.tools).toEqual(['a', 'b']);
  });

  it('parses "var toolOrder = [...]" and captures var prefix', () => {
    const content = `var toolOrder = ['x', 'y', 'z']`;
    const result = parseToolOrder(content);
    expect(result!.prefix).toBe('var ');
    expect(result!.tools).toEqual(['x', 'y', 'z']);
  });

  it('parses "toolOrder = [...]" with no declaration keyword (empty prefix)', () => {
    const content = `toolOrder = ["grep", "glob"]`;
    const result = parseToolOrder(content);
    expect(result!.prefix).toBe('');
    expect(result!.tools).toEqual(['grep', 'glob']);
  });

  it('returns null when content has no toolOrder', () => {
    const content = `const foo = ["a", "b"];\nconst bar = 42;`;
    expect(parseToolOrder(content)).toBeNull();
  });

  it('handles multiline array', () => {
    const content = `const toolOrder = [
\t\t"grep",
\t\t"glob",
\t\t"read"
\t]`;
    const result = parseToolOrder(content);
    expect(result!.tools).toEqual(['grep', 'glob', 'read']);
  });

  it('returns the full match string for replacement', () => {
    const content = `const toolOrder = ["a", "b"]`;
    const result = parseToolOrder(content);
    expect(result!.match).toBe('const toolOrder = ["a", "b"]');
  });

  it('handles single-quoted strings', () => {
    const content = `toolOrder = ['grep', 'glob']`;
    const result = parseToolOrder(content);
    expect(result!.tools).toEqual(['grep', 'glob']);
  });
});

// ── buildToolOrderString ────────────────────────────────────────────

describe('buildToolOrderString', () => {
  it('builds string with empty prefix', () => {
    const result = buildToolOrderString('', ['grep', 'glob']);
    expect(result).toBe(`toolOrder = [\n\t\t"grep",\n\t\t"glob"\n\t]`);
  });

  it('builds string with "const " prefix', () => {
    const result = buildToolOrderString('const ', ['a', 'b', 'c']);
    expect(result).toBe(
      `const toolOrder = [\n\t\t"a",\n\t\t"b",\n\t\t"c"\n\t]`,
    );
  });

  it('formats each tool on its own tab-indented line', () => {
    const result = buildToolOrderString('', ['x']);
    expect(result).toBe(`toolOrder = [\n\t\t"x"\n\t]`);
  });

  it('produces valid replacement for round-trip with parseToolOrder', () => {
    const original = `const toolOrder = ["grep", "glob", "read"]`;
    const parsed = parseToolOrder(original)!;
    const rebuilt = buildToolOrderString(parsed.prefix, parsed.tools);
    // Re-parse the rebuilt string to verify tools are preserved
    const reparsed = parseToolOrder(rebuilt);
    expect(reparsed!.tools).toEqual(parsed.tools);
    expect(reparsed!.prefix).toBe(parsed.prefix);
  });
});
