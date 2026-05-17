#!/usr/bin/env tsx
/**
 * @module collect-token-metrics
 *
 * Token metrics collector — scans OpenClaw session transcripts
 * and Claude Code session logs, then writes immutable hourly
 * rollup buckets to disk.
 *
 * Data sources:
 * - OpenClaw gateway transcripts (SESSIONS_DIR)
 * - Claude Code project sessions (CLAUDE_CODE_PROJECTS_DIR)
 *
 * Designed as a runner cron job. Only processes data up to the
 * previous closed UTC hour boundary so each bucket file is
 * write-once and immutable.
 *
 * Config dependencies: SESSIONS_DIR, CLAUDE_CODE_PROJECTS_DIR,
 * TOKEN_METRICS_DIR, TOKEN_METRICS_NAMESPACE, TOKEN_METRICS_CURSOR_KEY,
 * TOKEN_METRICS_CC_CURSOR_KEY from constants.ts.
 */

import fs from 'node:fs';
import path from 'node:path';

import { runScript } from '@karmaniverous/jeeves';
import { getRunnerClient } from '@karmaniverous/jeeves-runner';

import {
  SESSIONS_DIR,
  TOKEN_METRICS_CC_CURSOR_KEY,
  TOKEN_METRICS_CURSOR_KEY,
  TOKEN_METRICS_NAMESPACE,
} from '../lib/constants.js';
import {
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

/** Raw usage shape from OpenClaw transcripts. */
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

/**
 * Parse a single JSONL line for usage data.
 * Returns null if the line has no extractable usage.
 */
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

  // Determine timestamp: prefer outer (ISO string), fall back to message (ms)
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

/**
 * Convert raw usage into the structured record we accumulate.
 * Costs are computed from the rate card, not from OpenClaw's per-message costs.
 */
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

/**
 * Process a single session file: extract usage records up to the
 * hour boundary cutoff, detect channel, and merge into buckets.
 */
function processFile(
  filePath: string,
  fileName: string,
  cursors: CursorState,
  cutoffMs: number,
  buckets: Map<string, HourlyBucket>,
  seenModels: Set<string>,
): void {
  const stat = fs.statSync(filePath);
  const cursor = cursors[fileName] as CursorState[string] | undefined;
  const byteOffset = cursor?.byteOffset ?? 0;

  // Skip if fully processed and file hasn't grown
  if (byteOffset >= stat.size) return;

  const content = fs.readFileSync(filePath, 'utf8');
  const allLines = content.split('\n');

  // Detect channel from the first few lines (always, even if resuming)
  // Use first 50 lines for channel detection. 15 was too narrow — long-lived
  // topic thread sessions often have metadata/custom lines filling the first 15,
  // pushing recognizable patterns (heartbeat, Slack context) just out of reach.
  const channelResult = detectChannel(allLines.slice(0, 50));
  if (channelResult.key.startsWith('slack:channel:')) {
    const name = channelResult.name;
    if (name.startsWith('#')) {
      registerChannelName(channelResult.key, name);
    }
  }

  // Compute byte positions per line to know where to resume
  let bytePos = 0;
  let maxProcessedTs = cursor?.lastTimestamp ?? 0;

  for (const line of allLines) {
    const lineByteLen = Buffer.byteLength(line, 'utf8') + 1; // +1 for \n
    const lineStart = bytePos;
    bytePos += lineByteLen;

    // Skip lines we've already processed
    if (lineStart < byteOffset) continue;
    if (!line.trim()) continue;

    const parsed = parseUsageLine(line);
    if (!parsed) continue;

    // Skip messages in the current (incomplete) hour
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

  // Update cursor: advance byteOffset to current file size
  cursors[fileName] = {
    byteOffset: stat.size,
    lastTimestamp: maxProcessedTs,
  };
}

/**
 * Trigger the rate card refresh job via the runner HTTP API.
 * Fire-and-forget — the collector doesn't wait for it to complete.
 */
function triggerRateCardRefresh(): void {
  try {
    const url = 'http://127.0.0.1:1937/jobs/refresh-token-rates/trigger';
    // Fire-and-forget POST
    fetch(url, { method: 'POST' }).catch(() => {
      // Ignore errors — the failure notification from this job is enough
    });
  } catch {
    // Best effort
  }
}

/**
 * Main collector entry point.
 */
function collect(): void {
  const client = getRunnerClient();

  try {
    // Load cursor state
    const rawCursors = client.getState(
      TOKEN_METRICS_NAMESPACE,
      TOKEN_METRICS_CURSOR_KEY,
    );
    const cursors: CursorState = rawCursors
      ? (JSON.parse(rawCursors) as CursorState)
      : {};

    // Compute cutoff: start of current UTC hour
    const cutoffMs = currentHourBoundaryMs();

    // List all session files
    const allFiles = fs.readdirSync(SESSIONS_DIR);
    const sessionFiles = allFiles.filter(
      (f) =>
        f.endsWith('.jsonl') ||
        f.includes('.jsonl.deleted.') ||
        f.includes('.jsonl.reset.'),
    );

    const fileCount = String(sessionFiles.length);
    const cutoffIso = new Date(cutoffMs).toISOString();
    console.log(
      `[token-metrics] Processing ${fileCount} files, cutoff: ${cutoffIso}`,
    );

    // Accumulate into hourly buckets
    const buckets = new Map<string, HourlyBucket>();
    const seenModels = new Set<string>();
    let processed = 0;
    let skipped = 0;

    for (const fileName of sessionFiles) {
      const filePath = path.join(SESSIONS_DIR, fileName);
      const cursor = cursors[fileName] as CursorState[string] | undefined;
      const stat = fs.statSync(filePath);

      if (cursor?.byteOffset !== undefined && cursor.byteOffset >= stat.size) {
        skipped++;
        continue;
      }

      processFile(filePath, fileName, cursors, cutoffMs, buckets, seenModels);
      processed++;
    }

    // ── Claude Code sessions ──
    const rawCCCursors = client.getState(
      TOKEN_METRICS_NAMESPACE,
      TOKEN_METRICS_CC_CURSOR_KEY,
    );
    const ccCursors: CursorState = rawCCCursors
      ? (JSON.parse(rawCCCursors) as CursorState)
      : {};

    const ccFiles = listCCSessionFiles();
    let ccProcessed = 0;
    let ccSkipped = 0;

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
      if (cursor?.byteOffset !== undefined && cursor.byteOffset >= stat.size) {
        ccSkipped++;
        continue;
      }

      const byteOffset = cursor?.byteOffset ?? 0;
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
      ccProcessed++;
    }

    console.log(
      `[token-metrics] Claude Code: ${String(ccProcessed)} files processed, ${String(ccSkipped)} skipped`,
    );

    // Gate: check for unknown models before writing anything
    const rateCard = loadRateCard();
    const unknownModels = [...seenModels].filter(
      (m) => !(m in rateCard.models),
    );

    if (unknownModels.length > 0) {
      console.error(
        '[token-metrics] Unknown models — refusing to write buckets:',
        unknownModels.join(', '),
      );
      console.log('[token-metrics] Triggering rate card refresh job...');
      triggerRateCardRefresh();
      process.exit(1);
    }

    // Flush buckets to disk
    const written = flushBuckets(buckets);

    // Save cursor state — both OC and CC
    client.setState(
      TOKEN_METRICS_NAMESPACE,
      TOKEN_METRICS_CURSOR_KEY,
      JSON.stringify(cursors),
    );
    client.setState(
      TOKEN_METRICS_NAMESPACE,
      TOKEN_METRICS_CC_CURSOR_KEY,
      JSON.stringify(ccCursors),
    );

    console.log(
      [
        '[token-metrics] Done:',
        String(processed),
        'OC files processed,',
        String(skipped),
        'skipped,',
        String(ccProcessed),
        'CC files,',
        String(written),
        'buckets written',
      ].join(' '),
    );
  } finally {
    client.close();
  }
}

runScript('collect-token-metrics', collect);
