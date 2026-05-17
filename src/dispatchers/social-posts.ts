#!/usr/bin/env tsx
/**
 * @module dispatchers/social-posts
 *
 * Dispatcher: Generate Social Posts.
 *
 * Reads content sources from CONTENT_DIR and dispatches a social-post
 * generation task via the gateway. Customize the task template below
 * for your instance's content directories and Slack channels.
 */

import path from 'node:path';

import { runScript } from '@karmaniverous/jeeves';
import { runDispatcher } from '@karmaniverous/jeeves-runner';

import { CONTENT_DIR, SPAWN_WORKER_PATH } from '../lib/constants.js';
import { getRef } from '../lib/pipeline-config.js';

const JOB_ID = 'generate-social-posts';

function buildTask(): string {
  const notionDb = getRef('notion.socialPostsDatabaseId');
  const socialChannel = getRef('slack.socialChannel');
  const operatorDm = getRef('slack.operatorDm');
  const xDir = path.join(CONTENT_DIR, 'x');
  const githubDir = path.join(CONTENT_DIR, 'github');
  const emailDir = path.join(CONTENT_DIR, 'email');
  const globalDir = path.join(CONTENT_DIR, 'global');
  return `Generate social media content.

Read:
- ${path.join(xDir, 'blotter.md')} (PRIMARY)
- ${path.join(githubDir, 'meta-summary.md')}, ${path.join(xDir, '.meta/meta.json')}, ${path.join(emailDir, '.meta/meta.json')}, ${path.join(globalDir, 'digest')}, ${path.join(globalDir, 'summary.md')}

Write to Notion DB ${notionDb}.

Generate 8 posts (5 tweets, 3 longer). 4+ must be Original=true.

BLOTTER RULES: Themes (follow always), Corrections (follow strictly), Ideas (use then REMOVE), Notes (read/update freely).

VARIETY: contrarian, practical, narrative-continuation, reflective, light/humorous.

FIELD RULES: Post (title) = short headline, Body (rich_text) = FULL content. Every post MUST have Body.

LINK VERIFICATION: NEVER include unverified links. Use web_fetch to confirm.

Then post summary to Slack #social (${socialChannel}).

ROUTING: Send your completion summary to operator DM (${operatorDm}). Do NOT post to any other DM.`;
}

runScript('dispatchers/social-posts', () => {
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
