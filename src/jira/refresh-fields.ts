#!/usr/bin/env tsx
/**
 * @module refresh-fields
 *
 * Fetch Jira custom field metadata from `/rest/api/3/field` and write
 * `_fields.json` to the Jira domain directory.
 *
 * The field map (customfield_N → human-readable name) is used by the
 * drain script to add human-readable aliases alongside raw customfield
 * keys in persisted issue snapshots.
 *
 * Scheduled via `jobs/jira.json` (daily at 03:00 UTC). Can also be
 * run manually: `tsx src/jira/refresh-fields.ts`
 */

import fs from 'node:fs';
import path from 'node:path';

import { nowIso, runScript } from '@karmaniverous/jeeves';

import {
  JIRA_API_TOKEN_PATH,
  JIRA_EMAIL,
  JIRA_FIELDS_FILENAME,
  JIRA_SITE_URL,
} from '../lib/constants.js';
import { getBasePathForJira } from '../lib/silo-router.js';
import type { JiraField } from './lib/jira-client.js';
import { jiraGet, makeAuthHeader, readApiToken } from './lib/jira-client.js';

const DOMAIN_DIR = path.join(getBasePathForJira(), 'jira');

async function refreshFieldsMain(): Promise<void> {
  if (!JIRA_SITE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN_PATH) {
    console.log('[skip] Jira API credentials not configured');
    return;
  }

  const apiToken = readApiToken(JIRA_API_TOKEN_PATH);
  const authHeader = makeAuthHeader(JIRA_EMAIL, apiToken);

  console.log(`[refresh-fields] fetching field metadata from ${JIRA_SITE_URL}`);

  const fields = await jiraGet<JiraField[]>(JIRA_SITE_URL, authHeader, 'field');

  // Build a map of customfield_N → human-readable name (custom fields only)
  const fieldMap: Record<string, string> = {};
  for (const field of fields) {
    if (field.custom && field.id.startsWith('customfield_')) {
      fieldMap[field.id] = field.name;
    }
  }

  fs.mkdirSync(DOMAIN_DIR, { recursive: true });
  const outputPath = path.join(DOMAIN_DIR, JIRA_FIELDS_FILENAME);
  fs.writeFileSync(
    outputPath,
    JSON.stringify(fieldMap, null, 2) + '\n',
    'utf8',
  );

  console.log(
    `[refresh-fields] wrote ${String(Object.keys(fieldMap).length)} custom fields to ${outputPath} at ${nowIso()}`,
  );
}

runScript('jira/refresh-fields', () => {
  refreshFieldsMain().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
});
