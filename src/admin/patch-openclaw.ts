#!/usr/bin/env tsx
/**
 * @module patch-openclaw
 *
 * Orchestrator: run all OpenClaw post-install patches in sequence.
 *
 * Designed to run after every `npm install -g openclaw@latest`.
 * Invokes patch-tool-order and patch-spawn-description as child processes.
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runScript } from '@karmaniverous/jeeves';

// ── Config ─────────────────────────────────────────────────────────────

/** Patch scripts to run, in order. */
const PATCHES = ['patch-tool-order.ts', 'patch-spawn-description.ts'];

// ── Core logic ─────────────────────────────────────────────────────────

function patchOpenClaw(): void {
  const adminDir = path.dirname(fileURLToPath(import.meta.url));

  for (const script of PATCHES) {
    const scriptPath = path.join(adminDir, script);
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[patch-openclaw] Running: ${script}`);
    console.log('─'.repeat(60));

    execSync(`tsx "${scriptPath}"`, {
      stdio: 'inherit',
      encoding: 'utf8',
    });
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log('[patch-openclaw] All patches applied.');
}

runScript('patch-openclaw', patchOpenClaw);
