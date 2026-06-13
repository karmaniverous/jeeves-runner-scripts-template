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

import { CONTENT_DIR } from '../lib/constants.js';
import { taskFileDispatcher } from './lib/task-file-dispatcher.js';

const taskFile = path.join(CONTENT_DIR, 'digest/TASK.md');

if (!fs.existsSync(taskFile)) {
  console.log(
    `[skip] Daily digest not configured — create ${taskFile} with your digest instructions`,
  );
  process.exit(0);
}

taskFileDispatcher({
  scriptName: 'dispatchers/daily-digest',
  jobId: 'generate-daily-digest',
  taskFile,
  thinking: 'low',
  timeout: 600,
  injectDateContext: true,
});
