#!/usr/bin/env tsx
/**
 * @module dispatchers/social-posts
 *
 * Dispatcher: Generate Social Posts.
 *
 * Builds a social-post generation task from pipeline-config refs and
 * content paths, then dispatches a gateway session to execute it.
 *
 * This is an example dispatcher — customize the task template in
 * {@link buildTask} for your instance's content sources, post targets,
 * and editorial rules.
 *
 * Prerequisites (all via pipeline-config.json refs):
 * - `notion.socialPostsDatabaseId` — Notion database to write posts to
 * - `slack.socialChannel` — Slack channel for posting summaries
 * - `slack.operatorDm` — Slack DM for completion routing
 *
 * Register as a runner job manually (not in jobs/ manifests):
 *   runner_create_job({ id: 'generate-social-posts', script: 'src/dispatchers/social-posts.ts', ... })
 */

import path from 'node:path';

import { runScript } from '@karmaniverous/jeeves';
import { runDispatcher } from '@karmaniverous/jeeves-runner';

import { CONTENT_DIR, SPAWN_WORKER_PATH } from '../lib/constants.js';
import { getRef } from '../lib/pipeline-config.js';

const JOB_ID = 'generate-social-posts';

/** Safe ref accessor — returns empty string instead of throwing when key is missing. */
function tryGetRef(key: string): string {
  try {
    return getRef(key);
  } catch {
    return '';
  }
}

function buildTask(): string {
  const notionDb = tryGetRef('notion.socialPostsDatabaseId');
  const socialChannel = tryGetRef('slack.socialChannel');
  const operatorDm = tryGetRef('slack.operatorDm');

  if (!notionDb || !socialChannel || !operatorDm) {
    throw new Error(
      'Missing required pipeline-config refs: notion.socialPostsDatabaseId, slack.socialChannel, slack.operatorDm',
    );
  }

  const xDir = path.join(CONTENT_DIR, 'x');
  const githubDir = path.join(CONTENT_DIR, 'github');
  const emailDir = path.join(CONTENT_DIR, 'email');
  const globalDir = path.join(CONTENT_DIR, 'global');

  // Customize this task template for your instance's editorial rules,
  // content sources, post targets, and volume requirements.
  return `Generate social media content.

Read:
- ${path.join(xDir, 'blotter.md')} (PRIMARY — your editorial blotter)
- ${path.join(githubDir, 'meta-summary.md')}, ${path.join(xDir, '.meta/meta.json')}, ${path.join(emailDir, '.meta/meta.json')}, ${path.join(globalDir, 'digest')}, ${path.join(globalDir, 'summary.md')}

Write to Notion DB ${notionDb}.

Generate posts based on your editorial direction in the blotter.

LINK VERIFICATION: NEVER include unverified links. Use web_fetch to confirm.

Then post summary to Slack (${socialChannel}).

ROUTING: Send your completion summary to operator DM (${operatorDm}). Do NOT post to any other DM.`;
}

runScript('dispatchers/social-posts', () => {
  const notionDb = tryGetRef('notion.socialPostsDatabaseId');
  if (!notionDb) {
    console.log(
      '[skip] Social posts dispatcher not configured — set notion.socialPostsDatabaseId in pipeline-config.json',
    );
    return;
  }

  runDispatcher(
    buildTask(),
    {
      jobId: JOB_ID,
      thinking: 'low',
      timeout: 600,
    },
    SPAWN_WORKER_PATH,
  );
});
