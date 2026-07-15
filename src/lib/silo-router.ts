/**
 * @module silo-router
 *
 * Multi-tenant data routing — resolves email domains, GitHub orgs,
 * and Slack workspaces to their correct base content paths.
 *
 * Called by email, github, slack, and meeting scripts to determine
 * where pipeline output should be written. Reads a silo-routing.json
 * config file and caches the result. Single-tenant instances (most
 * new instances) have all data routed to the default base path.
 *
 * Config dependencies: SILO_ROUTING_CONFIG_PATH from constants.ts.
 */

import fs from 'node:fs';
import path from 'node:path';

import { CONTENT_DIR, SILO_ROUTING_CONFIG_PATH } from './constants.js';

export interface GitHubOrgEntry {
  githubOrg: string;
  relativePath: string;
}

export type GitHubOrgSpec = string | GitHubOrgEntry;

export interface SiloConfig {
  emailDomains?: string[];
  githubOrgs?: GitHubOrgSpec[];
  slackWorkspaces?: string[];
  jira?: boolean;
  linear?: boolean;
  basePath: string;
}

export interface RoutingConfig {
  defaultBasePath: string;
  silos: Record<string, SiloConfig>;
}

let _config: RoutingConfig | null = null;

export function getConfig(): RoutingConfig {
  if (!_config) {
    if (fs.existsSync(SILO_ROUTING_CONFIG_PATH)) {
      _config = JSON.parse(
        fs.readFileSync(SILO_ROUTING_CONFIG_PATH, 'utf8'),
      ) as RoutingConfig;
    } else {
      _config = { defaultBasePath: CONTENT_DIR, silos: {} };
    }
  }
  return _config;
}

/** Reset cached config (for testing). */
export function resetConfig(): void {
  _config = null;
}

export function getBasePathForEmailDomain(emailDomain: string): string {
  const config = getConfig();
  const domain = emailDomain.toLowerCase();
  for (const silo of Object.values(config.silos)) {
    if (silo.emailDomains?.some((d) => d.toLowerCase() === domain)) {
      return silo.basePath;
    }
  }
  return config.defaultBasePath;
}

export function getBasePathForGitHubOrg(org: string): string {
  const config = getConfig();
  const orgLower = org.toLowerCase();
  for (const silo of Object.values(config.silos)) {
    for (const entry of silo.githubOrgs ?? []) {
      if (typeof entry === 'string') {
        if (entry.toLowerCase() === orgLower) return silo.basePath;
      } else {
        if (entry.githubOrg.toLowerCase() === orgLower) {
          return path.join(silo.basePath, entry.relativePath);
        }
      }
    }
  }
  return config.defaultBasePath;
}

export function getBasePathForSlackWorkspace(teamId: string): string {
  const config = getConfig();
  for (const silo of Object.values(config.silos)) {
    if (silo.slackWorkspaces?.includes(teamId)) {
      return silo.basePath;
    }
  }
  return config.defaultBasePath;
}

export function getBasePathForMeeting(participantEmails: string[]): string {
  const config = getConfig();
  const domainCounts: Record<string, number> = {};

  for (const email of participantEmails) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) continue;

    for (const [siloName, silo] of Object.entries(config.silos)) {
      if (silo.emailDomains?.some((d) => d.toLowerCase() === domain)) {
        domainCounts[siloName] = (domainCounts[siloName] ?? 0) + 1;
      }
    }
  }

  let bestSilo: string | null = null;
  let bestCount = 0;
  let tied = false;

  for (const [siloName, count] of Object.entries(domainCounts)) {
    if (count > bestCount) {
      bestSilo = siloName;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  }

  if (bestSilo && !tied) {
    return config.silos[bestSilo].basePath;
  }
  return config.defaultBasePath;
}

export function getBasePathForJira(): string {
  const config = getConfig();
  for (const silo of Object.values(config.silos)) {
    if (silo.jira) return silo.basePath;
  }
  return config.defaultBasePath;
}

/**
 * Return the base path for the silo with `linear: true`.
 * Falls back to defaultBasePath if no silo is configured for Linear.
 */
export function getBasePathForLinear(): string {
  const config = getConfig();
  for (const silo of Object.values(config.silos)) {
    if (silo.linear) return silo.basePath;
  }
  return config.defaultBasePath;
}

/**
 * Return deduplicated list of entity root directories for a given
 * content subdirectory (e.g. 'meetings') across all configured silos.
 */
export function getEntityDirs(subdir: string): string[] {
  const config = getConfig();
  const dirs = [path.join(config.defaultBasePath, subdir)];
  for (const silo of Object.values(config.silos)) {
    dirs.push(path.join(silo.basePath, subdir));
  }
  return [...new Set(dirs)];
}

export function getEmailBaseForAccount(account: string): string {
  const domain = (account || '').split('@')[1];
  if (!domain) return path.join(getConfig().defaultBasePath, 'email');
  const basePath = getBasePathForEmailDomain(domain);
  return path.join(basePath, 'email');
}

export function getCalendarBaseForAccount(account: string): string {
  const domain = (account || '').split('@')[1];
  if (!domain) return path.join(getConfig().defaultBasePath, 'calendar');
  const basePath = getBasePathForEmailDomain(domain);
  return path.join(basePath, 'calendar');
}
