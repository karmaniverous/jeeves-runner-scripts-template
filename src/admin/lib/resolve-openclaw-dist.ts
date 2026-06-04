/**
 * @module resolve-openclaw-dist
 *
 * Resolves the global npm openclaw dist directory. Shared by all
 * OpenClaw post-install patch scripts (patch-*.ts entry points in admin/).
 *
 * Used after `npm install -g openclaw` to apply runtime patches to the
 * installed openclaw distribution (e.g. fixing gateway spawn behavior).
 *
 * Falls back to scanning nvm directories when `npm root -g` is not
 * available (e.g. non-interactive shells on managed instances where
 * nvm is only loaded in interactive .bashrc).
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Try resolving via `npm root -g`. Returns the dist path or null.
 */
function tryNpmRoot(): string | null {
  try {
    const npmRoot = execSync('npm root -g', {
      encoding: 'utf8',
      timeout: 10_000,
    }).trim();
    const distDir = path.join(npmRoot, 'openclaw', 'dist');
    if (fs.existsSync(distDir)) return distDir;
  } catch {
    // npm not on PATH — fall through to nvm fallback
  }
  return null;
}

/**
 * Scan nvm node version directories for an openclaw global install.
 * Checks NVM_DIR env var, then falls back to ~/.nvm.
 */
function tryNvmFallback(): string | null {
  const nvmDir = process.env.NVM_DIR ?? path.join(os.homedir(), '.nvm');
  const versionsDir = path.join(nvmDir, 'versions', 'node');

  if (!fs.existsSync(versionsDir)) return null;

  // Check 'current' symlink first (created by jeeves-tools bootstrap)
  const currentLink = path.join(nvmDir, 'current');
  if (fs.existsSync(currentLink)) {
    const distDir = path.join(
      currentLink,
      'lib',
      'node_modules',
      'openclaw',
      'dist',
    );
    if (fs.existsSync(distDir)) return distDir;
  }

  // Scan version directories (newest first by sort order)
  const versions = fs
    .readdirSync(versionsDir)
    .filter((d) => d.startsWith('v'))
    .sort()
    .reverse();

  for (const version of versions) {
    const distDir = path.join(
      versionsDir,
      version,
      'lib',
      'node_modules',
      'openclaw',
      'dist',
    );
    if (fs.existsSync(distDir)) return distDir;
  }

  return null;
}

/** Resolve the global npm openclaw dist directory. */
export function resolveOpenClawDist(): string {
  const distDir = tryNpmRoot() ?? tryNvmFallback();

  if (!distDir) {
    throw new Error(
      'OpenClaw dist directory not found. ' +
        'Checked: npm root -g, NVM_DIR/versions/node/*/lib/node_modules/openclaw/dist, ' +
        '~/.nvm/current/lib/node_modules/openclaw/dist. ' +
        'Is openclaw installed globally?',
    );
  }

  return distDir;
}
