#!/usr/bin/env tsx
/**
 * @module backfill-classification
 *
 * One-shot backfill: classify threads missing receiptCandidate/junkCandidate/
 * bucket fields in thread state and enqueue corresponding label actions.
 *
 * Run manually as an entry-point script. Iterates all thread-state entries
 * in SQLite, reads thread.json for subject/from/snippet, runs triage
 * classification, and enqueues addLabel actions to `email-updates`.
 * Supports --live and --reclassify-buckets flags; defaults to dry-run.
 *
 * Depends on pipeline-config bucket domain mappings for classification
 * and email-state/email-cache for thread data access.
 */

import path from 'node:path';

import { nowIso, readJson, runScript } from '@karmaniverous/jeeves';
import { getRunnerClient } from '@karmaniverous/jeeves-runner';

import { getEmailAccounts } from '../lib/pipeline-config.js';
import { getThreadsPath, type ThreadCache } from './email-cache.js';
import {
  getThreadState,
  seenKey,
  setThreadState,
  type ThreadState,
} from './email-state.js';
import {
  classifyBucket,
  computeLabelsToApply,
  isJunkCandidate,
  isReceiptCandidate,
} from './email-triage.js';

function main(): void {
  const live = process.argv.includes('--live');
  const reclassifyBuckets = process.argv.includes('--reclassify-buckets');
  console.log(
    `Mode: ${live ? 'LIVE' : 'DRY-RUN'}${reclassifyBuckets ? ' (reclassify buckets)' : ''}\n`,
  );

  const accounts = getEmailAccounts();
  const client = getRunnerClient();

  try {
    let grandTotal = 0;
    let grandAlready = 0;
    let grandClassified = 0;
    let grandLabels = 0;
    const counts: Record<string, number> = {
      receipt: 0,
      junk: 0,
      VC: 0,
      JGS: 0,
      Tribify: 0,
      Personal: 0,
    };

    for (const account of accounts) {
      const keys = client.listItemKeys('email', seenKey(account));
      let acctTotal = 0;
      let acctAlready = 0;
      let acctClassified = 0;
      let acctLabels = 0;

      for (const tid of keys) {
        acctTotal++;

        let ts: ThreadState | null;
        try {
          ts = getThreadState(client, account, tid);
        } catch {
          // Skip old-format state items (bare ISO strings from pre-ThreadState era)
          continue;
        }
        if (!ts) continue;

        // Already classified — skip (unless reclassifying buckets)
        if (ts.receiptCandidate !== undefined && !reclassifyBuckets) {
          acctAlready++;
          continue;
        }

        // Read thread.json for subject, from, snippet
        const threadJsonPath = path.join(
          getThreadsPath(account, tid),
          'thread.json',
        );
        let cache: ThreadCache | null;
        try {
          cache = readJson<ThreadCache | null>(threadJsonPath, null);
        } catch {
          continue;
        }
        if (!cache) continue;

        const subject = cache.subject || '';
        // ThreadCache uses participants; first entry is typically the sender.
        // CacheMessage has from; use first message's from if available.
        const msgs = Object.values(cache.messages ?? {});
        const firstMsg = msgs.at(0);
        const from = firstMsg?.from || '';
        const to = firstMsg?.to || '';
        const snippet = firstMsg?.snippet || '';

        // Classify
        const receipt = reclassifyBuckets
          ? (ts.receiptCandidate ??
            isReceiptCandidate(subject, snippet, from, account))
          : isReceiptCandidate(subject, snippet, from, account);
        const junk = reclassifyBuckets
          ? (ts.junkCandidate ?? isJunkCandidate(subject, snippet, from))
          : isJunkCandidate(subject, snippet, from);
        const bucket = classifyBucket(account, to, subject, snippet, from);

        // In reclassify mode, only count if bucket actually changed
        if (reclassifyBuckets && bucket === ts.bucket) {
          acctAlready++;
          continue;
        }

        acctClassified++;

        // Determine labels to apply
        const applied = ts.labelApplied || {};
        const labelsToApply = computeLabelsToApply({
          receiptCandidate: receipt,
          junkCandidate: junk,
          bucket,
          labelApplied: applied,
        });

        const msgId =
          (ts.seenMessageIds && Object.keys(ts.seenMessageIds)[0]) || tid;
        const stamp = nowIso();
        const updatedApplied: Record<string, string> = { ...applied };

        for (const lbl of labelsToApply) {
          if (live) {
            client.enqueue('email-updates', {
              account,
              messageId: msgId,
              threadId: tid,
              action: 'addLabel',
              label: lbl,
              source: 'backfill-classification',
              reason: 'Backfill classification for pre-Phase-1 thread',
              createdAt: stamp,
            });
            updatedApplied[lbl] = stamp;
          }
          counts[lbl]++;
          acctLabels++;
        }

        // Update thread state with classification + labelApplied
        if (live) {
          setThreadState(client, account, tid, {
            ...ts,
            receiptCandidate: receipt,
            junkCandidate: junk,
            bucket,
            labelApplied:
              labelsToApply.length > 0 ? updatedApplied : ts.labelApplied,
          });
        }
      }

      grandTotal += acctTotal;
      grandAlready += acctAlready;
      grandClassified += acctClassified;
      grandLabels += acctLabels;

      console.log(`${account}: ${String(acctTotal)} threads`);
      console.log(`  already classified: ${String(acctAlready)}`);
      console.log(`  newly classified:   ${String(acctClassified)}`);
      console.log(`  labels enqueued:    ${String(acctLabels)}`);
    }

    console.log('\n=== Grand Total ===');
    console.log(`Total threads:       ${String(grandTotal)}`);
    console.log(`Already classified:  ${String(grandAlready)}`);
    console.log(`Newly classified:    ${String(grandClassified)}`);
    console.log(`Labels enqueued:     ${String(grandLabels)}`);
    console.log('Labels by type:');
    for (const [lbl, count] of Object.entries(counts)) {
      if (count > 0) console.log(`  ${lbl}: ${String(count)}`);
    }
    if (!live) console.log('\nRe-run with --live to actually enqueue.');
  } finally {
    client.close();
  }
}

runScript('email/backfill-classification', main);
