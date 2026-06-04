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
  SESSIONS_DIR,
  TOKEN_METRICS_CC_CURSOR_KEY,
  TOKEN_METRICS_CURSOR_KEY,
  TOKEN_METRICS_NAMESPACE,
} from '../lib/constants.js';
import {
  bucketPath,
  currentHourBoundaryMs,
  flushBuckets,
  mergeUsage,
  tsToHour,
} from './lib/bucket-io.js';
import { detectChannel, registerChannelName } from './lib/channel-mapper.js';
import { listCCSessionFiles, parseCCLine } from './lib/claude-code-scanner.js';
import { computeCosts, loadRateCard } from './lib/rate-card.js';
import type {
  CursorState,
  HourlyBucket,
  TokenCategory,
} from './types/token-metrics.js';
import { TOKEN_CATEGORIES } from './types/token-metrics.js';

// ── Helpers (shared with collect-token-metrics) ─────────────────────

interface RawUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
}

function parseUsageLine(line: string): {
  tsMs: number;
  model: string;
  provider: string;
  rawUsage: RawUsage;
} | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (parsed.type !== 'message') return null;

  const msg = parsed.message as Record<string, unknown> | undefined;
  if (!msg?.usage) return null;

  const usage = msg.usage as RawUsage;
  if (!usage.cost && !usage.totalTokens) return null;

  const model = typeof msg.model === 'string' ? msg.model : 'unknown';
  const provider = typeof msg.provider === 'string' ? msg.provider : 'unknown';

  let tsMs: number;
  const outerTs = parsed.timestamp;
  if (typeof outerTs === 'string') {
    tsMs = new Date(outerTs).getTime();
  } else if (typeof outerTs === 'number') {
    tsMs = outerTs > 1e12 ? outerTs : outerTs * 1000;
  } else {
    const msgTs = msg.timestamp;
    if (typeof msgTs === 'number') {
      tsMs = msgTs > 1e12 ? msgTs : msgTs * 1000;
    } else {
      return null;
    }
  }

  if (isNaN(tsMs)) return null;

  return { tsMs, model, provider, rawUsage: usage };
}

function normalizeUsage(
  raw: RawUsage,
  modelKey: string,
): Record<TokenCategory, { count: number; cost: number }> {
  const counts = {} as Record<TokenCategory, number>;
  for (const cat of TOKEN_CATEGORIES) {
    const count = raw[cat];
    counts[cat] = typeof count === 'number' ? count : 0;
  }

  const costs = computeCosts(modelKey, counts);
  const result = {} as Record<TokenCategory, { count: number; cost: number }>;
  for (const cat of TOKEN_CATEGORIES) {
    result[cat] = { count: counts[cat], cost: costs[cat] };
  }
  return result;
}

// ── Enumerate hours in range ────────────────────────────────────────

function enumHours(fromMs: number, toMs: number): string[] {
  const hours: string[] = [];
  const cursor = new Date(fromMs);
  cursor.setUTCMinutes(0, 0, 0);
  const end = new Date(toMs);

  while (cursor.getTime() <= end.getTime()) {
    hours.push(tsToHour(cursor.getTime()));
    cursor.setUTCHours(cursor.getUTCHours() + 1);
  }
  return hours;
}

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

// ── Reset cursors for the targeted range ────────────────────────────

function resetCursorsForRange(
  cursors: CursorState,
  fromMs: number,
): CursorState {
  const reset: CursorState = {};
  for (const [key, cursor] of Object.entries(cursors)) {
    // If the cursor's last timestamp is before the from boundary,
    // keep it as-is (data before range is untouched).
    if (cursor.lastTimestamp < fromMs) {
      reset[key] = cursor;
    } else {
      // Reset: set byte offset to 0 so the file is re-scanned from the start.
      // The collector will re-process the file and only emit records in range.
      reset[key] = { byteOffset: 0, lastTimestamp: cursor.lastTimestamp };
    }
  }
  return reset;
}

// ── Collect for range (mirrors collect-token-metrics logic) ─────────

function collectForRange(
  fromMs: number,
  cutoffMs: number,
  cursors: CursorState,
  ccCursors: CursorState,
): { buckets: Map<string, HourlyBucket>; seenModels: Set<string> } {
  const buckets = new Map<string, HourlyBucket>();
  const seenModels = new Set<string>();

  // ── OpenClaw sessions ──
  const allFiles = fs.readdirSync(SESSIONS_DIR);
  const sessionFiles = allFiles.filter(
    (f) =>
      f.endsWith('.jsonl') ||
      f.includes('.jsonl.deleted.') ||
      f.includes('.jsonl.reset.'),
  );

  for (const fileName of sessionFiles) {
    const filePath = path.join(SESSIONS_DIR, fileName);
    const stat = fs.statSync(filePath);
    const cursor = cursors[fileName] as CursorState[string] | undefined;
    const byteOffset = cursor?.byteOffset ?? 0;

    if (byteOffset >= stat.size) continue;

    const content = fs.readFileSync(filePath, 'utf8');
    const allLines = content.split('\n');

    const channelResult = detectChannel(allLines.slice(0, 50));
    if (channelResult.key.startsWith('slack:channel:')) {
      const name = channelResult.name;
      if (name.startsWith('#')) {
        registerChannelName(channelResult.key, name);
      }
    }

    let bytePos = 0;
    let maxProcessedTs = cursor?.lastTimestamp ?? 0;

    for (const line of allLines) {
      const lineByteLen = Buffer.byteLength(line, 'utf8') + 1;
      const lineStart = bytePos;
      bytePos += lineByteLen;

      if (lineStart < byteOffset) continue;
      if (!line.trim()) continue;

      const parsed = parseUsageLine(line);
      if (!parsed) continue;

      // Only include records within range
      if (parsed.tsMs < fromMs) continue;
      if (parsed.tsMs >= cutoffMs) continue;

      const modelKey = [parsed.provider, parsed.model].join('/');
      seenModels.add(modelKey);
      const usage = normalizeUsage(parsed.rawUsage, modelKey);
      const hour = tsToHour(parsed.tsMs);

      mergeUsage(buckets, hour, channelResult.key, modelKey, usage);

      if (parsed.tsMs > maxProcessedTs) {
        maxProcessedTs = parsed.tsMs;
      }
    }

    cursors[fileName] = {
      byteOffset: stat.size,
      lastTimestamp: maxProcessedTs,
    };
  }

  // ── Claude Code sessions ──
  const ccFiles = listCCSessionFiles();

  for (const ccFile of ccFiles) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(ccFile.filePath);
    } catch {
      continue;
    }

    const cursor = ccCursors[ccFile.cursorKey] as
      | CursorState[string]
      | undefined;
    const byteOffset = cursor?.byteOffset ?? 0;
    if (byteOffset >= stat.size) continue;

    const content = fs.readFileSync(ccFile.filePath, 'utf8');
    const allLines = content.split('\n');

    let bytePos = 0;
    let maxProcessedTs = cursor?.lastTimestamp ?? 0;

    for (const line of allLines) {
      const lineByteLen = Buffer.byteLength(line, 'utf8') + 1;
      const lineStart = bytePos;
      bytePos += lineByteLen;

      if (lineStart < byteOffset) continue;
      if (!line.trim()) continue;

      const record = parseCCLine(line);
      if (!record) continue;

      if (record.tsMs < fromMs) continue;
      if (record.tsMs >= cutoffMs) continue;

      seenModels.add(record.modelKey);
      const usage = normalizeUsage(
        {
          input: record.usage.input,
          output: record.usage.output,
          cacheRead: record.usage.cacheRead,
          cacheWrite: record.usage.cacheWrite,
        },
        record.modelKey,
      );
      const hour = tsToHour(record.tsMs);
      mergeUsage(buckets, hour, ccFile.channelKey, record.modelKey, usage);

      if (record.tsMs > maxProcessedTs) {
        maxProcessedTs = record.tsMs;
      }
    }

    ccCursors[ccFile.cursorKey] = {
      byteOffset: stat.size,
      lastTimestamp: maxProcessedTs,
    };
  }

  return { buckets, seenModels };
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
    const { buckets, seenModels } = collectForRange(
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
