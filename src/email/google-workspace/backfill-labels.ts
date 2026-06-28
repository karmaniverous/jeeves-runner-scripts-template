#!/usr/bin/env tsx
/**
 * @module backfill-labels
 *
 * One-shot backfill: enqueue addLabel actions for threads that have
 * classification fields but no corresponding labelApplied entries.
 *
 * Run manually as an entry-point script. Iterates all thread-state
 * entries in SQLite, checks for missing labelApplied records against
 * existing classification fields, and enqueues addLabel actions to
 * `email-updates`. Supports --live flag; defaults to dry-run.
 *
 * Depends on email-state for thread data access and pipeline-config
 * for the account list.
 */

import { nowIso, runScript } from '@karmaniverous/jeeves';
import { getRunnerClient } from '@karmaniverous/jeeves-runner';

import { getEmailAccounts } from '../../lib/pipeline-config.js';
import { getThreadState, seenKey, setThreadState } from '../email-state.js';

function main(): void {
  const live = process.argv.includes('--live');
  console.log(`Mode: ${live ? 'LIVE' : 'DRY-RUN'}\n`);

  const accounts = getEmailAccounts();
  const client = getRunnerClient();

  try {
    let totalChecked = 0;
    const counts: Record<string, number> = {
      receipt: 0,
      junk: 0,
      VC: 0,
      JGS: 0,
    };

    for (const account of accounts) {
      const keys = client.listItemKeys('email', seenKey(account));
      console.log(`${account}: ${String(keys.length)} threads`);
      let acctLabels = 0;

      for (const tid of keys) {
        totalChecked++;
        let ts;
        try {
          ts = getThreadState(client, account, tid);
        } catch {
          // Skip old-format state items (bare ISO strings from pre-ThreadState era)
          continue;
        }
        if (!ts) continue;

        const applied = ts.labelApplied || {};
        const labelsToApply: string[] = [];

        if (ts.receiptCandidate && !applied['receipt'])
          labelsToApply.push('receipt');
        if (ts.junkCandidate && !applied['junk']) labelsToApply.push('junk');
        if (ts.bucket === 'VC' && !applied['VC']) labelsToApply.push('VC');
        if (ts.bucket === 'JGS' && !applied['JGS']) labelsToApply.push('JGS');

        if (labelsToApply.length === 0) continue;

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
              source: 'backfill-labels',
              reason: 'Backfill label for pre-existing classification',
              createdAt: stamp,
            });
            updatedApplied[lbl] = stamp;
          }
          counts[lbl]++;
          acctLabels++;
        }

        if (live && labelsToApply.length > 0) {
          setThreadState(client, account, tid, {
            ...ts,
            labelApplied: updatedApplied,
          });
        }
      }

      console.log(`  → ${String(acctLabels)} labels to enqueue`);
    }

    console.log('\n=== Summary ===');
    console.log(`Total threads checked: ${String(totalChecked)}`);
    console.log('Labels to enqueue by type:');
    for (const [lbl, count] of Object.entries(counts)) {
      if (count > 0) console.log(`  ${lbl}: ${String(count)}`);
    }
    if (!live) console.log('\nRe-run with --live to actually enqueue.');
  } finally {
    client.close();
  }
}

runScript('email/backfill-labels', main);
