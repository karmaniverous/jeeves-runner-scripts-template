#!/usr/bin/env tsx
/**
 * @module dispatchers/daily-digest
 *
 * Dispatcher: Generate Daily Digest.
 * Reads task from CONTENT_DIR/digest/TASK.md and dispatches via gateway.
 */

import path from 'node:path';

import { CONTENT_DIR } from '../lib/constants.js';
import { taskFileDispatcher } from './lib/task-file-dispatcher.js';

taskFileDispatcher({
  scriptName: 'dispatchers/daily-digest',
  jobId: 'generate-daily-digest',
  taskFile: path.join(CONTENT_DIR, 'digest/TASK.md'),
  thinking: 'low',
  timeout: 600,
  injectDateContext: true,
});
