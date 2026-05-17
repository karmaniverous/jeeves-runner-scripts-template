/**
 * @module meetings-dirs
 *
 * Shared helper to discover all meetings directories across silos.
 * Delegates to getEntityDirs() from silo-router for path resolution.
 */

import { getEntityDirs } from '../../lib/silo-router.js';

/**
 * Return deduplicated list of meetings directories from the silo config.
 */
export function getMeetingsDirs(): string[] {
  return getEntityDirs('meetings');
}
