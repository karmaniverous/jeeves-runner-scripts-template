#!/usr/bin/env tsx
/**
 * @module backfill-historical
 *
 * One-shot backfill: search Gmail for threads in a date range that
 * predate the pipeline, classify them, and enqueue for full processing.
 *
 * Run manually as an entry-point script. Searches each account via
 * `gog gmail search` with --after/--before date filters, skips already-
 * known threads, runs triage classification, fetches metadata via
 * email-fetch, and enqueues label actions. Supports --live, --accounts,
 * --after, --before, and --max flags; defaults to dry-run.
 *
 * Depends on EMAIL_EVENTS_DIR for event logging and pipeline-config
 * bucket mappings for classification.
 */

import { ensureDir, nowIso, runScript } from '@karmaniverous/jeeves';
import { getRunnerClient } from '@karmaniverous/jeeves-runner';

import { EMAIL_EVENTS_DIR } from '../lib/constants.js';
import { gogWithRetry } from '../lib/gog.js';
import { fetchThreadMetadata } from './email-fetch.js';
import { getThreadState, setThreadState } from './email-state.js';
import {
  classifyBucket,
  computeLabelsToApply,
  isJunkCandidate,
  isReceiptCandidate,
} from './email-triage.js';

function parseArg(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1];
}

function main(): void {
  const live = process.argv.includes('--live');
  const accounts = parseArg(
    '--accounts',
    'alice@example.com,jscroft@gmail.com',
  ).split(',');
  const after = parseArg('--after', '2025/12/31');
  const before = parseArg('--before', '2026/02/09');
  const max = Number(parseArg('--max', '500'));

  console.log(`Mode: ${live ? 'LIVE' : 'DRY-RUN'}`);
  console.log(`Accounts: ${accounts.join(', ')}`);
  console.log(`Date range: after:${after} before:${before}`);
  console.log(`Max per search: ${String(max)}\n`);

  const query = `after:${after} before:${before}`;
  const client = getRunnerClient();

  try {
    ensureDir(EMAIL_EVENTS_DIR);

    let grandFound = 0;
    let grandKnown = 0;
    let grandNew = 0;
    let grandLabels = 0;

    for (const account of accounts) {
      console.log(`--- ${account} ---`);

      const out = gogWithRetry(
        [
          'gmail',
          'search',
          query,
          '--max',
          String(max),
          '--json',
          '--account',
          account,
        ],
        { retries: 2, backoffMs: 5000 },
      );
      const payload = out
        ? (JSON.parse(out) as {
            threads?: Array<Record<string, unknown>>;
          })
        : {};
      const threads = payload.threads ?? [];

      const acctFound = threads.length;
      let acctKnown = 0;
      let acctNew = 0;
      let acctLabels = 0;

      for (const t of threads) {
        const tid = (t.threadId as string) || (t.id as string) || '';
        if (!tid) continue;
        const subj = (t.subject as string) || '';
        const snip = (t.snippet as string) || '';
        const from = (t.from as string) || '';
        const to = (t.to as string) || '';
        const date = (t.date as string) || null;
        const mc = Number.isFinite(t.messageCount)
          ? (t.messageCount as number)
          : null;
        const labels = Array.isArray(t.labels) ? (t.labels as string[]) : [];

        // Skip if already known
        let prev;
        try {
          prev = getThreadState(client, account, tid);
        } catch {
          // Old-format state item (bare ISO string) — skip
          acctKnown++;
          continue;
        }
        if (prev) {
          acctKnown++;
          continue;
        }

        // Classify
        const rc = isReceiptCandidate(subj, snip, from, account);
        const jc = !rc && isJunkCandidate(subj, snip, from);
        const bucket = classifyBucket(account, to, subj, snip, from);

        acctNew++;

        // Determine labels to enqueue
        const labelsToApply = computeLabelsToApply({
          receiptCandidate: rc,
          junkCandidate: jc,
          bucket,
        });

        if (live) {
          // Fetch full thread metadata (creates cache, enqueues for download)
          fetchThreadMetadata({
            account,
            threadId: tid,
            subject: subj,
            from,
            to,
            receiptCandidate: rc,
            junkCandidate: jc,
            bucket,
            labels,
            query,
            client,
          });

          // Enqueue label actions
          const msgId = tid; // no seenMessageIds yet for new threads
          const stamp = nowIso();
          const labelApplied: Record<string, string> = {};

          for (const lbl of labelsToApply) {
            client.enqueue('email-updates', {
              account,
              messageId: msgId,
              threadId: tid,
              action: 'addLabel',
              label: lbl,
              source: 'backfill-historical',
              reason: 'Historical backfill for pre-pipeline thread',
              createdAt: stamp,
            });
            labelApplied[lbl] = stamp;
            acctLabels++;
          }

          // Set thread state with classification
          setThreadState(client, account, tid, {
            seenAt: stamp,
            date: date ?? undefined,
            messageCount: mc ?? undefined,
            labels,
            receiptCandidate: rc,
            junkCandidate: jc,
            bucket,
            labelApplied,
          });
        } else {
          // Dry-run: just count labels
          acctLabels += labelsToApply.length;
        }
      }

      grandFound += acctFound;
      grandKnown += acctKnown;
      grandNew += acctNew;
      grandLabels += acctLabels;

      console.log(`  Found:         ${String(acctFound)}`);
      console.log(`  Already known: ${String(acctKnown)}`);
      console.log(`  New:           ${String(acctNew)}`);
      console.log(`  Labels:        ${String(acctLabels)}`);
    }

    console.log('\n=== Grand Total ===');
    console.log(`Found:         ${String(grandFound)}`);
    console.log(`Already known: ${String(grandKnown)}`);
    console.log(`New:           ${String(grandNew)}`);
    console.log(`Labels:        ${String(grandLabels)}`);
    if (!live) console.log('\nRe-run with --live to actually process.');
  } finally {
    client.close();
  }
}

runScript('email/backfill-historical', main, EMAIL_EVENTS_DIR);
