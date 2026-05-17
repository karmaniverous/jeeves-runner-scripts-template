/**
 * @module task-file-dispatcher
 *
 * Generic framework for dispatchers that read a task from a Markdown file
 * and spawn a gateway session to execute it.
 *
 * Instance-specific dispatchers (daily-digest, social-posts, etc.) call
 * {@link taskFileDispatcher} with a task file path and dispatch options.
 * The helper reads the file, optionally injects a date-context header,
 * then delegates to `runDispatcher` from jeeves-runner.
 *
 * Requires SPAWN_WORKER_PATH from constants.ts to locate the gateway
 * spawn worker script.
 */

import fs from 'node:fs';

import { runScript } from '@karmaniverous/jeeves';
import type { DispatchOptions } from '@karmaniverous/jeeves-runner';
import { runDispatcher } from '@karmaniverous/jeeves-runner';

import { SPAWN_WORKER_PATH } from '../../lib/constants.js';

export interface TaskFileDispatcherOptions extends DispatchOptions {
  /** Filesystem path to the task markdown file */
  taskFile: string;
  /** Script name for runScript crash handler */
  scriptName: string;
  /** If true, prepend an authoritative date/day-of-week context line to the task */
  injectDateContext?: boolean;
  /** IANA timezone for date context injection (default: 'Asia/Makassar') */
  dateTimezone?: string;
}

/**
 * Read a task from a file and dispatch it via the gateway.
 */
export function taskFileDispatcher(options: TaskFileDispatcherOptions): void {
  const {
    taskFile,
    scriptName,
    injectDateContext,
    dateTimezone,
    ...dispatchOpts
  } = options;
  let task = fs.readFileSync(taskFile, 'utf8');

  if (injectDateContext) {
    const tz = dateTimezone ?? 'Asia/Makassar';
    const now = new Date();
    const dayName = now.toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: tz,
    });
    const dateStr = now.toLocaleDateString('en-CA', { timeZone: tz }); // en-CA gives YYYY-MM-DD
    task =
      `> **Today is ${dayName}, ${dateStr} (${tz}).** Use this as the authoritative date reference for all dates in this report.\n\n` +
      task;
  }

  runScript(scriptName, () => {
    runDispatcher(task, dispatchOpts, SPAWN_WORKER_PATH);
  });
}
