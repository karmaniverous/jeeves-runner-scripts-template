#!/usr/bin/env tsx
/**
 * @module poll-feed
 *
 * Polls the home timeline for an account via X API v2.
 *
 * Entry-point script invoked by the runner scheduler. Unlike other pollers,
 * writes feed items directly to the account's feed/ directory on disk and
 * prunes entries older than seven days.
 *
 * Uses {@link X_ACCOUNTS} from constants to resolve the account base directory.
 */

import fs from 'node:fs';
import path from 'node:path';

import { runScript } from '@karmaniverous/jeeves';

import type { XTweet } from './lib/x-api.js';
import {
  getOAuthPath,
  pollHomeTimeline,
  requireAccountDir,
  requireXHandle,
  withAutoRefresh,
} from './lib/x-api.js';

const handle = requireXHandle('poll-feed.ts');
const accountDir = requireAccountDir(handle);
const FEED_DIR = path.join(accountDir, 'feed');
const PRUNE_DAYS = 7;

function writeFeedItems(
  tweets: XTweet[],
  source: string,
): { written: number; skipped: number } {
  let written = 0,
    skipped = 0;
  for (const t of tweets) {
    if (!t.id) continue;
    const filePath = path.join(FEED_DIR, `${t.id}.json`);
    if (fs.existsSync(filePath)) {
      skipped++;
      continue;
    }
    const entry = {
      ...t,
      _feedSource: source,
      _ingestedAt: new Date().toISOString(),
    };
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2) + '\n', 'utf8');
    written++;
  }
  return { written, skipped };
}

function pruneOldFiles(): number {
  const cutoff = Date.now() - PRUNE_DAYS * 86400000;
  let pruned = 0;
  for (const file of fs.readdirSync(FEED_DIR)) {
    if (!file.endsWith('.json')) continue;
    const stat = fs.statSync(path.join(FEED_DIR, file));
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(path.join(FEED_DIR, file));
      pruned++;
    }
  }
  return pruned;
}

async function main(): Promise<void> {
  fs.mkdirSync(FEED_DIR, { recursive: true });

  const tweets = await withAutoRefresh(handle, (client) =>
    pollHomeTimeline(client, handle, { maxResults: 100 }),
  );

  const result = writeFeedItems(tweets, 'timeline');
  const pruned = pruneOldFiles();

  console.log(
    `feed: fetched=${String(tweets.length)} (new=${String(result.written)}, dedup=${String(result.skipped)}), pruned=${String(pruned)}`,
  );
}

runScript('x/poll-feed', () => {
  if (!fs.existsSync(getOAuthPath(handle))) {
    console.log('[skip] X OAuth2 credentials not configured');
    return;
  }

  main().catch((err: unknown) => {
    console.error(
      'poll-feed: FATAL',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  });
});
