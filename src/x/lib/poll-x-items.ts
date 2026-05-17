/**
 * @module poll-x-items
 *
 * Shared poller for X/Twitter items via X API v2.
 *
 * Called by each poll-* entry-point script with a specific API poll function
 * and queue prefix. Fetches items through x-api, then enqueues them into the
 * jeeves-runner queue for downstream processing by drain-queues.
 */

import fs from 'node:fs';

import { getArg, runScript } from '@karmaniverous/jeeves';
import type { RunnerClient } from '@karmaniverous/jeeves-runner';
import { getRunnerClient } from '@karmaniverous/jeeves-runner';
import type { Client } from '@xdevplatform/xdk';

import type { PollOptions, XTweet } from './x-api.js';
import { getOAuthPath, withAutoRefresh } from './x-api.js';

export { type XTweet } from './x-api.js';

export interface PollXOptions {
  /** API poll function to call */
  pollFn: (
    client: Client,
    handle: string,
    options?: PollOptions,
  ) => Promise<XTweet[]>;
  /** Queue name prefix, e.g. 'x-posts' or 'x-mentions' */
  queuePrefix: string;
  /** Type label for logging and queue payloads */
  typeLabel: string;
  /** Default count of items to fetch */
  defaultCount?: number;
}

/**
 * Run a parameterized X poll: fetch items via API, enqueue to runner.
 */
export async function pollXItems(options: PollXOptions): Promise<void> {
  const argv = process.argv.slice(2);
  const handle = argv[0] || getArg(argv, '--handle', 'karmaniverous');
  const count = Number(
    getArg(argv, '--count', String(options.defaultCount ?? 50)),
  );
  const queueName = getArg(argv, '--queue', `${options.queuePrefix}-${handle}`);

  let tweets: XTweet[];
  try {
    tweets = await withAutoRefresh(handle, (client) =>
      options.pollFn(client, handle, { maxResults: count }),
    );
  } catch (err) {
    console.error(
      `${options.typeLabel}: API error for @${handle}:`,
      err instanceof Error ? err.message : String(err),
    );
    return;
  }

  if (!tweets.length) {
    console.log(`${options.typeLabel}: no items returned for @${handle}`);
    return;
  }

  const runnerClient: RunnerClient = getRunnerClient();
  try {
    let enqueued = 0,
      dedupSkipped = 0;
    for (const t of tweets) {
      const itemId = runnerClient.enqueue(queueName, {
        id: t.id,
        createdAt: t.createdAt,
        author: t.authorId ?? handle,
        type: options.typeLabel,
        text: t.text,
        raw: t,
      });
      if (itemId === -1) dedupSkipped++;
      else enqueued++;
    }

    console.log(
      `${options.typeLabel}: @${handle} fetched=${String(tweets.length)}, enqueued=${String(enqueued)}, dedupSkipped=${String(dedupSkipped)}`,
    );
  } finally {
    runnerClient.close();
  }
}

/**
 * Entry-point wrapper for X poll scripts. Handles credential check,
 * error handling, and runScript boilerplate.
 */
export function runXPoller(scriptName: string, options: PollXOptions): void {
  runScript(scriptName, () => {
    const handle = process.argv[2] || 'karmaniverous';

    if (!fs.existsSync(getOAuthPath(handle))) {
      console.log('[skip] X OAuth2 credentials not configured');
      return;
    }

    pollXItems(options).catch((err: unknown) => {
      console.error(
        `${scriptName}: FATAL`,
        err instanceof Error ? err.message : String(err),
      );
      process.exit(1);
    });
  });
}
