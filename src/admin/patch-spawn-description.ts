#!/usr/bin/env tsx
/**
 * @module patch-spawn-description
 *
 * Patch OpenClaw's describeSessionsSpawnTool function to prepend a
 * Claude Code gate instruction to the spawn tool description.
 *
 * This steers the model to prefer `exec` with `claude --print` for
 * tasks that only need filesystem/shell access, reserving sessions_spawn
 * for tasks that genuinely need OpenClaw gateway tools.
 *
 * - Idempotent: no-ops if already patched.
 * - Claude Code-aware: only patches if `claude` CLI is installed.
 *   Removes existing patch if `claude` is not found.
 * - Designed to run after every `npm install -g openclaw@latest`.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { runScript } from '@karmaniverous/jeeves';

import { resolveOpenClawDist } from './lib/resolve-openclaw-dist.js';

// ── Config ─────────────────────────────────────────────────────────────

/** Gate text to prepend as the first element of baseDescription. */
const GATE_TEXT = `STOP: If this task only needs filesystem access and shell commands (file edits, builds, git operations), use \`exec\` with \`claude --permission-mode bypassPermissions --print <task>\` instead of this tool. Only use sessions_spawn when the task requires OpenClaw gateway tools (messaging, browser, watcher, runner, meta, memory, web search, canvas, etc.).`;

/** Sentinel string used to detect existing patch. */
const GATE_SENTINEL = 'STOP: If this task only needs filesystem access';

// ── Helpers ────────────────────────────────────────────────────────────

/** Check whether the `claude` CLI is available on PATH. */
function isClaudeInstalled(): boolean {
  try {
    execSync('claude --version', { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the dist file containing describeSessionsSpawnTool.
 * Scans tool-policy-shared-*.js files.
 */
function findSpawnDescriptionFile(distDir: string): string | null {
  const candidates = fs
    .readdirSync(distDir)
    .filter((f) => /^tool-policy-shared.*\.js$/.test(f));

  for (const file of candidates) {
    const filePath = path.join(distDir, file);
    const content = fs.readFileSync(filePath, 'utf8');

    if (content.includes('describeSessionsSpawnTool')) {
      return filePath;
    }
  }

  return null;
}

// ── Core logic ─────────────────────────────────────────────────────────

function patchSpawnDescription(): void {
  const claudeAvailable = isClaudeInstalled();
  console.log(
    `[patch-spawn-description] Claude Code CLI: ${claudeAvailable ? 'installed' : 'not found'}`,
  );

  const distDir = resolveOpenClawDist();
  console.log(`[patch-spawn-description] OpenClaw dist: ${distDir}`);

  const filePath = findSpawnDescriptionFile(distDir);

  if (!filePath) {
    console.error(
      '[patch-spawn-description] Could not find describeSessionsSpawnTool in any tool-policy-shared file.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[patch-spawn-description] Found target in: ${path.basename(filePath)}`,
  );

  const content = fs.readFileSync(filePath, 'utf8');
  const alreadyPatched = content.includes(GATE_SENTINEL);

  // ── Claude NOT installed: remove existing patch if present ──
  if (!claudeAvailable) {
    if (!alreadyPatched) {
      console.log(
        '[patch-spawn-description] Claude not installed, no existing patch — nothing to do.',
      );
      return;
    }

    // Remove the gate element. It's a backtick-string line ending with a comma
    // inserted right after `baseDescription = [`.
    // Match non-backtick chars OR escaped backticks (\`) up to the closing backtick.
    const gateLineRe =
      /\n\t\t`STOP: If this task only needs filesystem access(?:[^`]|\\`)*`,/;
    const newContent = content.replace(gateLineRe, '');

    if (newContent === content) {
      console.error(
        '[patch-spawn-description] Gate text detected but could not remove it cleanly. Manual fix needed.',
      );
      process.exitCode = 1;
      return;
    }

    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, newContent, 'utf8');
    fs.renameSync(tmpPath, filePath);

    console.log(
      '[patch-spawn-description] Claude not installed — removed existing patch.',
    );
    return;
  }

  // ── Claude IS installed: apply patch if not already present ──
  if (alreadyPatched) {
    console.log('[patch-spawn-description] Already patched — nothing to do.');
    return;
  }

  // Find the baseDescription array opening.
  const marker = 'baseDescription = [';
  const markerIdx = content.indexOf(marker);

  if (markerIdx === -1) {
    console.error(
      '[patch-spawn-description] Could not find baseDescription array. Aborting.',
    );
    process.exitCode = 1;
    return;
  }

  // Insert the gate text as the first array element after the opening bracket.
  const insertPos = markerIdx + marker.length;
  const escapedGate = GATE_TEXT.replace(/`/g, '\\`');
  const gateElement = `\n\t\t\`${escapedGate}\`,`;
  const newContent =
    content.slice(0, insertPos) + gateElement + content.slice(insertPos);

  // Atomic write.
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, newContent, 'utf8');
  fs.renameSync(tmpPath, filePath);

  console.log('[patch-spawn-description] Patched successfully.');
}

runScript('patch-spawn-description', patchSpawnDescription);
