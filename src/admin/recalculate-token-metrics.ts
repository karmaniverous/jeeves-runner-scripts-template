#!/usr/bin/env tsx
/**
 * @module recalculate-token-metrics
 *
 * Safe recalculation of token metrics for a given date range.
 *
 * - Backs up affected bucket files before modification.
 * - Resets cursors only for the targeted time range.
 * - Re-runs the collector for the targeted range with merge-into
 *   semantics (does not replace untouched data).
 * - Supports `--dry-run` to report what would change without modifying
 *   anything.
 *
 * Usage:
 *   tsx src/admin/recalculate-token-metrics.ts [--from ISO] [--to ISO] [--dry-run]
 *
 * Defaults: full transcript window (all time up to the previous closed
 * UTC hour boundary).
 */

import fs from 'node:fs';
import path from 'node:path';

import { getArg, runScript } from '@karmaniverous/jeeves';
import { getRunnerClient } from '@karmaniverous/jeeves-runner';

import {
  TOKEN_METRICS_CC_CURSOR_KEY,
  TOKEN_METRICS_CURSOR_KEY,
  TOKEN_METRICS_NAMESPACE,
} from '../lib/constants.js';
import {
  bucketPath,
  currentHourBoundaryMs,
  flushBuckets,
} from './lib/bucket-io.js';
import { loadRateCard } from './lib/rate-card.js';
import { enumHours, resetCursorsForRange } from './lib/recalc-utils.js';
import { scanAllSessions } from './lib/session-scanner.js';
import type { CursorState } from './types/token-metrics.js';

// ── Backup ──────────────────────────────────────────────────────────

function backupBucketFiles(hours: string[], dryRun: boolean): number {
  let backed = 0;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');

  for (const hour of hours) {
    const fp = bucketPath(hour);
    if (!fs.existsSync(fp)) continue;

    const backupFp = fp.replace(/\.json$/, `.backup-${ts}.json`);
    if (dryRun) {
      console.log(`[recalc] Would back up: ${fp}`);
    } else {
      fs.copyFileSync(fp, backupFp);
      console.log(`[recalc] Backed up: ${path.basename(fp)}`);
    }
    backed++;
  }
  return backed;
}

// ── Delete bucket files for range ───────────────────────────────────

function deleteBucketFiles(hours: string[], dryRun: boolean): number {
  let deleted = 0;
  for (const hour of hours) {
    const fp = bucketPath(hour);
    if (!fs.existsSync(fp)) continue;

    if (dryRun) {
      console.log(`[recalc] Would delete bucket: ${path.basename(fp)}`);
    } else {
      fs.unlinkSync(fp);
    }
    deleted++;
  }
  return deleted;
}

// ── Main ────────────────────────────────────────────────────────────

function recalculate(): void {
  const dryRun = process.argv.includes('--dry-run');
  const fromArg = getArg(process.argv, '--from', '');
  const toArg = getArg(process.argv, '--to', '');

  const cutoffMs = currentHourBoundaryMs();
  const fromMs = fromArg ? new Date(fromArg).getTime() : 0;
  const toMs = toArg ? Math.min(new Date(toArg).getTime(), cutoffMs) : cutoffMs;

  if (isNaN(fromMs) || isNaN(toMs)) {
    console.error('[recalc] Invalid date argument.');
    process.exitCode = 1;
    return;
  }

  console.log(
    `[recalc] ${dryRun ? 'DRY RUN — ' : ''}Range: ${fromMs === 0 ? 'epoch' : new Date(fromMs).toISOString()} → ${new Date(toMs).toISOString()}`,
  );

  // Enumerate hours affected
  const hours = enumHours(fromMs, toMs);
  console.log(`[recalc] ${String(hours.length)} hourly buckets in range`);

  // Back up existing bucket files
  const backed = backupBucketFiles(hours, dryRun);
  console.log(`[recalc] ${String(backed)} bucket files backed up`);

  // Delete existing bucket files so recollection starts fresh
  const deleted = deleteBucketFiles(hours, dryRun);
  console.log(`[recalc] ${String(deleted)} bucket files deleted`);

  if (dryRun) {
    console.log('[recalc] Dry run complete — no changes made.');
    return;
  }

  // Reset cursors for the affected range
  const client = getRunnerClient();

  try {
    const rawCursors = client.getState(
      TOKEN_METRICS_NAMESPACE,
      TOKEN_METRICS_CURSOR_KEY,
    );
    const cursors: CursorState = rawCursors
      ? (JSON.parse(rawCursors) as CursorState)
      : {};

    const rawCCCursors = client.getState(
      TOKEN_METRICS_NAMESPACE,
      TOKEN_METRICS_CC_CURSOR_KEY,
    );
    const ccCursors: CursorState = rawCCCursors
      ? (JSON.parse(rawCCCursors) as CursorState)
      : {};

    const resetOC = resetCursorsForRange(cursors, fromMs);
    const resetCC = resetCursorsForRange(ccCursors, fromMs);

    const ocResetCount = Object.values(resetOC).filter(
      (c) => c.byteOffset === 0,
    ).length;
    const ccResetCount = Object.values(resetCC).filter(
      (c) => c.byteOffset === 0,
    ).length;
    console.log(
      `[recalc] Cursors reset: ${String(ocResetCount)} OC, ${String(ccResetCount)} CC`,
    );

    // Re-collect for the range
    console.log('[recalc] Re-collecting...');
    const { buckets, seenModels } = scanAllSessions(
      fromMs,
      toMs,
      resetOC,
      resetCC,
    );

    // Check for unknown models
    const rateCard = loadRateCard();
    const unknownModels = [...seenModels].filter(
      (m) => !(m in rateCard.models),
    );

    if (unknownModels.length > 0) {
      console.error(
        '[recalc] Unknown models — refusing to write buckets:',
        unknownModels.join(', '),
      );
      process.exitCode = 1;
      return;
    }

    // Flush buckets (merge-into semantics via flushBuckets)
    const written = flushBuckets(buckets);

    // Save updated cursors
    client.setState(
      TOKEN_METRICS_NAMESPACE,
      TOKEN_METRICS_CURSOR_KEY,
      JSON.stringify(resetOC),
    );
    client.setState(
      TOKEN_METRICS_NAMESPACE,
      TOKEN_METRICS_CC_CURSOR_KEY,
      JSON.stringify(resetCC),
    );

    console.log(`[recalc] Done: ${String(written)} buckets written`);
  } finally {
    client.close();
  }
}

runScript('recalculate-token-metrics', recalculate);
