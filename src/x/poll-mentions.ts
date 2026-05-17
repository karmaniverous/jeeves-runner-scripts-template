#!/usr/bin/env tsx
/**
 * @module poll-mentions
 *
 * Polls mentions for an account via X API v2.
 *
 * Entry-point script invoked by the runner scheduler. Delegates to
 * poll-x-items with the pollUserMentions API function, enqueuing results
 * into the x-mentions-{handle} runner queue for drain-queues to flush to disk.
 */

import { runXPoller } from './lib/poll-x-items.js';
import { pollUserMentions } from './lib/x-api.js';

runXPoller('x/poll-mentions', {
  pollFn: pollUserMentions,
  queuePrefix: 'x-mentions',
  typeLabel: 'mentions',
});
