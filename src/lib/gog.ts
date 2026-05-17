/**
 * @module gog
 *
 * Google Workspace CLI wrapper — retry-aware invocation of the gog
 * binary for Gmail and Calendar operations.
 *
 * Called by email/poll.ts, email/download.ts, and calendar/poll.ts.
 * Sets APPDATA to CREDENTIALS_DIR so gog finds its config on the
 * data volume rather than the system default (Windows-specific; on
 * Linux, gog uses XDG_CONFIG_HOME or ~/.config by default).
 *
 * Config dependencies: GOG_BIN, CREDENTIALS_DIR from constants.ts.
 */

import { runWithRetry } from '@karmaniverous/jeeves';

import { CREDENTIALS_DIR, GOG_BIN } from './constants.js';

export const GOG = GOG_BIN;

// Set APPDATA so gog finds credentials.
process.env.APPDATA = CREDENTIALS_DIR;

/**
 * Run a gog command with retry logic for transient network errors.
 */
export function gogWithRetry(
  args: string[],
  opts: { retries?: number; backoffMs?: number } = {},
): string {
  return runWithRetry(GOG, args, {
    retries: opts.retries ?? 2,
    backoffMs: opts.backoffMs ?? 5000,
    isRetryable: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      return /context deadline exceeded|timed out|timeout/i.test(msg);
    },
  });
}
