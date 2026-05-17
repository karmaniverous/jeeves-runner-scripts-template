/**
 * @module resolve-openclaw-dist
 *
 * Resolves the global npm openclaw dist directory. Shared by all
 * OpenClaw post-install patch scripts (patch-*.ts entry points in admin/).
 *
 * Used after `npm install -g openclaw` to apply runtime patches to the
 * installed openclaw distribution (e.g. fixing gateway spawn behavior).
 * Throws if openclaw is not installed globally.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Resolve the global npm openclaw dist directory. */
export function resolveOpenClawDist(): string {
  const npmRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  const distDir = path.join(npmRoot, 'openclaw', 'dist');

  if (!fs.existsSync(distDir)) {
    throw new Error(`OpenClaw dist directory not found: ${distDir}`);
  }

  return distDir;
}
