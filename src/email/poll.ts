#!/usr/bin/env tsx
/**
 * @module poll
 *
 * Poll Gmail accounts for new/updated threads, classify them, and enqueue
 * important threads for deep metadata fetch and body download.
 *
 * Called on a schedule as an entry-point script. Searches each account via
 * `gog gmail search`, runs triage classification (receipt/junk/bucket),
 * enqueues label actions to `email-updates` and threads to `email-pending`,
 * and logs events to EMAIL_EVENTS_DIR. Trims old JSONL logs after 7 days.
 *
 * Depends on EMAIL_EVENTS_DIR, emailConfig.reportOnly, and bucket domain
 * config from pipeline-config. Missing config causes classification to
 * return null buckets (labels skipped).
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  appendJsonl,
  ensureDir,
  nowIso,
  runScript,
} from '@karmaniverous/jeeves';
import { getRunnerClient } from '@karmaniverous/jeeves-runner';

import { EMAIL_EVENTS_DIR, GOG_CLIENT_PATH } from '../lib/constants.js';
import { gogWithRetry } from '../lib/gog.js';
import {
  getEmailAccounts,
  loadPipelineConfig,
} from '../lib/pipeline-config.js';
import { fetchThreadMetadata } from './email-fetch.js';
import {
  getThreadState,
  loadScalarState,
  saveScalarState,
  setThreadState,
} from './email-state.js';
import {
  classifyBucket,
  computeLabelsToApply,
  isJunkCandidate,
  isReceiptCandidate,
  looksImportantBySummary,
} from './email-triage.js';

function main(): void {
  if (!fs.existsSync(GOG_CLIENT_PATH)) {
    console.log('[skip] Google OAuth credentials not configured');
    return;
  }

  const accounts = getEmailAccounts();
  const reportOnly = loadPipelineConfig().emailConfig.reportOnly;
  const query = 'in:anywhere';
  const max = 100;
  const client = getRunnerClient();

  try {
    ensureDir(EMAIL_EVENTS_DIR);

    for (const account of accounts) {
      const state = loadScalarState(account, client);

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
      let newC = 0,
        updC = 0,
        fetchC = 0,
        msgC = 0,
        lblC = 0;

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

        const rc = isReceiptCandidate(subj, snip, from, account);
        const jc = !rc && isJunkCandidate(subj, snip, from);
        const bucket = classifyBucket(account, to, subj, snip, from);
        const prev = getThreadState(client, account, tid);
        const isUpd =
          !!prev &&
          ((mc != null &&
            prev.messageCount != null &&
            mc > prev.messageCount) ||
            (date != null && prev.date != null && date !== prev.date));

        if (!prev) {
          appendJsonl(path.join(EMAIL_EVENTS_DIR, `${account}.jsonl`), {
            at: nowIso(),
            kind: 'thread',
            account,
            threadId: tid,
            subject: subj,
            from,
            snippet: snip,
            date,
            messageCount: mc,
            labels,
            receiptCandidate: rc,
            junkCandidate: jc,
            bucket,
            source: 'poll',
            query,
          });
          newC++;
        } else if (isUpd) {
          appendJsonl(path.join(EMAIL_EVENTS_DIR, `${account}.jsonl`), {
            at: nowIso(),
            kind: 'thread_update',
            account,
            threadId: tid,
            subject: subj,
            from,
            snippet: snip,
            date,
            messageCount: mc,
            labels,
            prev: {
              date: prev.date,
              messageCount: prev.messageCount,
              labels: prev.labels,
              seenAt: prev.seenAt,
            },
            receiptCandidate: rc,
            junkCandidate: jc,
            bucket,
            source: 'poll',
            query,
          });
          updC++;
        }

        // Determine which labels need enqueuing (new or changed classifications only)
        const classChanged =
          !prev ||
          prev.receiptCandidate !== rc ||
          prev.junkCandidate !== jc ||
          prev.bucket !== bucket;
        const labelApplied: Record<string, string> = {
          ...(prev?.labelApplied || {}),
        };
        let labelC = 0;

        if (classChanged) {
          const msgId =
            (prev?.seenMessageIds && Object.keys(prev.seenMessageIds)[0]) ||
            tid;
          const labelsToApply = computeLabelsToApply({
            receiptCandidate: rc,
            junkCandidate: jc,
            bucket,
            labelApplied,
          });

          const stamp = nowIso();
          for (const lbl of labelsToApply) {
            client.enqueue('email-updates', {
              account,
              messageId: msgId,
              threadId: tid,
              action: 'addLabel',
              label: lbl,
              source: 'poll-classification',
              reason: 'Auto-label from triage classification',
              createdAt: stamp,
            });
            labelApplied[lbl] = stamp;
            labelC++;
          }
        }
        lblC += labelC;

        setThreadState(client, account, tid, {
          ...(prev || {}),
          seenAt: nowIso(),
          date: date ?? undefined,
          messageCount: mc ?? undefined,
          labels,
          receiptCandidate: rc,
          junkCandidate: jc,
          bucket,
          labelApplied,
        });

        if (
          (!prev || isUpd) &&
          looksImportantBySummary({
            labels,
            receiptCandidate: rc,
            bucket,
          })
        ) {
          const r = fetchThreadMetadata({
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
          fetchC++;
          msgC += r.newMessages;
        }
      }

      saveScalarState(state, client);
      appendJsonl(path.join(EMAIL_EVENTS_DIR, `_runs-${account}.jsonl`), {
        at: nowIso(),
        kind: 'poll',
        account,
        fetched: threads.length,
        new: newC,
        updated: updC,
        deepFetchedThreads: fetchC,
        newMessages: msgC,
        labelsEnqueued: lblC,
        reportOnly,
        query,
        max,
      });
    }

    trimJsonlFiles(EMAIL_EVENTS_DIR, 7);
  } finally {
    client.close();
  }
}

function trimJsonlFiles(dir: string, maxDays: number): void {
  if (!fs.existsSync(dir)) return;
  const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;

  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.jsonl')) continue;
    if (entry.startsWith('_runs-')) continue;

    const filePath = path.join(dir, entry);
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }

    const kept: string[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as { at?: string };
        if (obj.at && new Date(obj.at).getTime() >= cutoff) {
          kept.push(line);
        }
      } catch {
        kept.push(line);
      }
    }

    fs.writeFileSync(filePath, kept.length > 0 ? kept.join('\n') + '\n' : '');
  }
}

runScript('email/poll', main, EMAIL_EVENTS_DIR);
