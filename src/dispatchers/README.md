# dispatchers/

Framework for autonomous LLM task dispatchers that read Markdown task files and spawn gateway sessions to execute them. This is the mechanism behind daily briefings, social media content generation, and other standing-order operations.

## Scripts

| Script | Description |
|--------|-------------|
| `daily-digest.ts` | Reads `{CONTENT_DIR}/digest/TASK.md` and dispatches a gateway session to generate and publish a daily digest. Injects authoritative date context. Prerequisite: TASK.md must exist. |
| `social-posts.ts` | Dynamically builds a task from pipeline-config refs and content paths, then dispatches a session to generate social media posts to a Notion database. Prerequisite: `notion.socialPostsDatabaseId`, `slack.socialChannel`, `slack.operatorDm` refs in pipeline-config. |

## Activation

Dispatchers are **not** included in the `jobs/` manifests. They are registered as runner jobs manually per instance, because each instance's dispatcher configuration (task content, schedule, channels) is unique.

To activate a dispatcher:

1. Ensure prerequisites are met (see each script's module-level JSDoc)
2. For static dispatchers (`daily-digest`): create the TASK.md file with your standing orders
3. For dynamic dispatchers (`social-posts`): populate the required `pipeline-config.json` refs
4. Register as a runner job: `runner_create_job({ id: 'generate-daily-digest', script: 'src/dispatchers/daily-digest.ts', schedule: { freq: 'daily', byhour: 6 }, ... })`

## Creating a New Dispatcher

### Static Task Dispatcher (reads a TASK.md file)

```typescript
import fs from 'node:fs';
import path from 'node:path';

import { CONTENT_DIR } from '../lib/constants.js';
import { taskFileDispatcher } from './lib/task-file-dispatcher.js';

const taskFile = path.join(CONTENT_DIR, 'my-domain/TASK.md');

if (!fs.existsSync(taskFile)) {
  console.log(`[skip] Not configured — create ${taskFile}`);
  process.exit(0);
}

taskFileDispatcher({
  scriptName: 'dispatchers/my-dispatcher',
  jobId: 'my-dispatcher-job',
  taskFile,
  thinking: 'low',
  timeout: 600,
  injectDateContext: true,
});
```

### Dynamic Task Dispatcher (builds task at runtime)

```typescript
import { runScript } from '@karmaniverous/jeeves';
import { runDispatcher } from '@karmaniverous/jeeves-runner';

import { CONTENT_DIR, SPAWN_WORKER_PATH } from '../lib/constants.js';
import { getRef } from '../lib/pipeline-config.js';

function buildTask(): string {
  const channel = getRef('slack.myChannel');
  if (!channel) throw new Error('Missing slack.myChannel in pipeline-config');
  return `Do the work. Post results to ${channel}.`;
}

runScript('dispatchers/my-dispatcher', () => {
  const requiredRef = getRef('slack.myChannel');
  if (!requiredRef) {
    console.log('[skip] Not configured — set slack.myChannel in pipeline-config.json');
    return;
  }
  runDispatcher(buildTask(), { jobId: 'my-job', thinking: 'low', timeout: 600 }, SPAWN_WORKER_PATH);
});
```

## Task-File-Dispatcher Framework

The core framework lives in `lib/task-file-dispatcher.ts`. It provides a generic pattern:

1. Read a task definition from a Markdown file (or build one dynamically)
2. Optionally inject date/timezone context as a quoted block
3. Wrap execution in `runScript()` for error handling
4. Delegate to `runDispatcher()` from jeeves-runner with `SPAWN_WORKER_PATH`

### Options

| Option | Type | Description |
|--------|------|-------------|
| `taskFile` | `string` | Path to the task Markdown file |
| `scriptName` | `string` | Script name for `runScript()` crash handler |
| `jobId` | `string` | Runner job ID for `runDispatcher()` |
| `thinking` | `string` | Thinking budget level (e.g., `'low'`) |
| `timeout` | `number` | Session timeout in seconds |
| `injectDateContext` | `boolean` | Prepend authoritative date/day-of-week context |
| `dateTimezone` | `string` | IANA timezone for date injection (default: `'Asia/Makassar'`) |

## TASK File Anatomy

A TASK file is a Markdown document containing standing orders for an LLM session. It defines:

- **What to do** — the goal of the session (generate a digest, write social posts, etc.)
- **Data sources** — which files/directories/APIs to read
- **Output destinations** — where to write results (Notion, Slack, filesystem)
- **Rules and constraints** — content guidelines, formatting requirements, routing instructions

Example location: `{CONTENT_DIR}/digest/TASK.md`

When `injectDateContext: true`, the framework prepends:

```
> **Today is Monday, 2025-05-19 (Asia/Makassar).** Use this as the authoritative date reference...
```

## Prerequisites

- Gateway API accessible (`GATEWAY_HOST`, `GATEWAY_PORT`)
- `SPAWN_WORKER_PATH` pointing to `spawn-worker.ts`
- Per-dispatcher prerequisites documented in each script's module-level JSDoc

## Key Files

| File | Purpose |
|------|---------|
| `lib/task-file-dispatcher.ts` | Core framework — reads task file, injects date context, delegates to `runDispatcher()` |
| `../lib/constants.ts` | Provides `CONTENT_DIR`, `SPAWN_WORKER_PATH` |
| `../lib/pipeline-config.ts` | Provides `getRef()` for external service IDs |
| `../lib/spawn-worker.ts` | Gateway session spawner invoked by `runDispatcher()` |
