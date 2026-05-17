#!/usr/bin/env tsx
/**
 * @module poll-likes
 *
 * Polls liked tweets for an account via X API v2.
 *
 * Entry-point script invoked by the runner scheduler. Delegates to
 * poll-x-items with the pollLikedTweets API function, enqueuing results
 * into the x-likes-{handle} runner queue for drain-queues to flush to disk.
 */

import { runXPoller } from './lib/poll-x-items.js';
import { pollLikedTweets } from './lib/x-api.js';

runXPoller('x/poll-likes', {
  pollFn: pollLikedTweets,
  queuePrefix: 'x-likes',
  typeLabel: 'likes',
});
