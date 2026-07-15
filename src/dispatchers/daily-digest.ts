#!/usr/bin/env tsx
/**
 * @module dispatchers/daily-digest
 *
 * Dispatcher: Generate Daily Digest.
 *
 * Reads a standing-order task from `{CONTENT_DIR}/digest/TASK.md`
 * and dispatches a gateway session to execute it. The TASK.md file
 * contains the full instructions the LLM session follows each run.
 *
 * Prerequisites:
 * - `{CONTENT_DIR}/digest/TASK.md` must exist with your digest instructions
 *
 * Register as a runner job manually (not in jobs/ manifests):
 *   runner_create_job({ id: 'generate-daily-digest', script: 'src/dispatchers/daily-digest.ts', ... })
 */

import fs from 'node:fs';
import path from 'node:path';

import { runScript } from '@karmaniverous/jeeves';
import { runDispatcher } from '@karmaniverous/jeeves-runner';

import { CONTENT_DIR, SPAWN_WORKER_PATH } from '../lib/constants.js';

const taskFile = path.join(CONTENT_DIR, 'digest/TASK.md');

runScript('dispatchers/daily-digest', () => {
  if (!fs.existsSync(taskFile)) {
    console.log(
      `[skip] Daily digest not configured — create ${taskFile} with your digest instructions`,
    );
    return;
  }

  let task = fs.readFileSync(taskFile, 'utf8');

  const tz = 'UTC';
  const now = new Date();
  const dayName = now.toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: tz,
  });
  const dateStr = now.toLocaleDateString('en-CA', { timeZone: tz });
  task =
    `> **Today is ${dayName}, ${dateStr} (${tz}).** Use this as the authoritative date reference for all dates in this report.\n\n` +
    task;

  runDispatcher(
    task,
    {
      jobId: 'generate-daily-digest',
      thinking: 'low',
      timeout: 600,
    },
    SPAWN_WORKER_PATH,
  );
});
