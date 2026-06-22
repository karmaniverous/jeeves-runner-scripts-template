#!/usr/bin/env tsx
/**
 * @module patch-also-allow-policy
 *
 * Patch OpenClaw's `hasRestrictiveAllowPolicy` to respect the
 * `IMPLICIT_ALLOW_ALL_FROM_ALSO_ALLOW` symbol.
 *
 * Without this patch, `tools.alsoAllow` entries (e.g. `["group:plugins"]`)
 * trigger `hasRestrictiveAllowPolicy`, which captures an incomplete
 * effective tool allowlist on the gateway HTTP surface. Child sessions
 * spawned via HTTP (e.g. jeeves-meta synthesis) inherit this restricted
 * list and lose core tools (`read`, `write`, `exec`).
 *
 * The upstream `pickSandboxToolPolicy` already marks alsoAllow-only
 * policies with `IMPLICIT_ALLOW_ALL_FROM_ALSO_ALLOW = true`, but
 * `hasRestrictiveAllowPolicy` never checks it. This patch adds the
 * missing early bail.
 *
 * - Idempotent: no-ops if already patched.
 * - Designed to run after every `npm install -g openclaw@latest`.
 */

import fs from 'node:fs';
import path from 'node:path';

import { runScript } from '@karmaniverous/jeeves';

import { resolveOpenClawDist } from './lib/resolve-openclaw-dist.js';

// ── Config ─────────────────────────────────────────────────────────────

/**
 * The unpatched function body. We match the exact minified output so we
 * can detect drift when OpenClaw updates change the file.
 */
const UNPATCHED = [
  'function hasRestrictiveAllowPolicy(policy) {',
  '\treturn Array.isArray(policy?.allow) && policy.allow.some((entry) => {',
  '\t\tconst normalized = normalizeToolName(entry);',
  '\t\treturn Boolean(normalized) && normalized !== "*" && normalized !== "__openclaw_default_plugin_tools__";',
  '\t});',
  '}',
].join('\n');

/**
 * The patched function body. Adds an early return when the policy was
 * produced exclusively from `alsoAllow` (additive, not restrictive).
 *
 * `IMPLICIT_ALLOW_ALL_FROM_ALSO_ALLOW` is already imported at the top of
 * the target file from `sandbox-tool-policy-*.js`.
 */
const PATCHED = [
  'function hasRestrictiveAllowPolicy(policy) {',
  '\tif (policy?.[IMPLICIT_ALLOW_ALL_FROM_ALSO_ALLOW] === true) return false;',
  '\treturn Array.isArray(policy?.allow) && policy.allow.some((entry) => {',
  '\t\tconst normalized = normalizeToolName(entry);',
  '\t\treturn Boolean(normalized) && normalized !== "*" && normalized !== "__openclaw_default_plugin_tools__";',
  '\t});',
  '}',
].join('\n');

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Find the dist file containing `hasRestrictiveAllowPolicy`.
 * Scans `tool-policy-*.js` files (excludes audit, match, pipeline variants).
 */
function findTargetFile(distDir: string): string | null {
  const candidates = fs
    .readdirSync(distDir)
    .filter(
      (f) =>
        f.startsWith('tool-policy-') &&
        f.endsWith('.js') &&
        !f.includes('audit') &&
        !f.includes('match') &&
        !f.includes('pipeline'),
    );

  for (const file of candidates) {
    const filePath = path.join(distDir, file);
    const content = fs.readFileSync(filePath, 'utf8');

    if (content.includes('function hasRestrictiveAllowPolicy')) {
      return filePath;
    }
  }

  return null;
}

// ── Core logic ─────────────────────────────────────────────────────────

function patchAlsoAllowPolicy(): void {
  const distDir = resolveOpenClawDist();
  console.log(`[patch-also-allow-policy] OpenClaw dist: ${distDir}`);

  const filePath = findTargetFile(distDir);

  if (!filePath) {
    console.error(
      '[patch-also-allow-policy] Could not find hasRestrictiveAllowPolicy in any tool-policy file.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[patch-also-allow-policy] Found target: ${path.basename(filePath)}`,
  );

  const content = fs.readFileSync(filePath, 'utf8');

  // Check if already patched.
  if (content.includes(PATCHED)) {
    console.log('[patch-also-allow-policy] Already patched — nothing to do.');
    return;
  }

  // Verify the unpatched source matches what we expect.
  if (!content.includes(UNPATCHED)) {
    console.error(
      '[patch-also-allow-policy] Function body does not match expected unpatched source. ' +
        'OpenClaw may have updated — review and adjust the patch.',
    );
    process.exitCode = 1;
    return;
  }

  // Verify the IMPLICIT_ALLOW_ALL_FROM_ALSO_ALLOW symbol is imported.
  if (!content.includes('IMPLICIT_ALLOW_ALL_FROM_ALSO_ALLOW')) {
    console.error(
      '[patch-also-allow-policy] IMPLICIT_ALLOW_ALL_FROM_ALSO_ALLOW import not found in target file.',
    );
    process.exitCode = 1;
    return;
  }

  // Apply the patch.
  const newContent = content.replace(UNPATCHED, PATCHED);

  // Atomic write.
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, newContent, 'utf8');
  fs.renameSync(tmpPath, filePath);

  console.log('[patch-also-allow-policy] Patched successfully.');
}

runScript('patch-also-allow-policy', patchAlsoAllowPolicy);
