# dispatchers/

Framework for autonomous LLM task dispatchers that read Markdown task files and spawn gateway sessions to execute them. This is the mechanism behind daily briefings, social media content generation, and other standing-order operations.

## Scripts

| Script | Description |
|--------|-------------|
| `daily-digest.ts` | Reads `{CONTENT_DIR}/digest/TASK.md` and dispatches a gateway session to generate and publish a daily digest. Injects authoritative date context. |
| `social-posts.ts` | Dynamically builds a task from pipeline-config refs and content paths, then dispatches a session to generate social media posts to a Notion database. |

## Task-File-Dispatcher Framework

The core framework lives in `lib/task-file-dispatcher.ts`. It provides a generic pattern:

1. Read a task definition from a Markdown file (or build one dynamically)
2. Optionally inject date/timezone context as a quoted block
3. Wrap execution in `runScript()` for error handling
4. Delegate to `runDispatcher()` from jeeves-runner with `SPAWN_WORKER_PATH`

### Usage

```typescript
import { taskFileDispatcher } from './lib/task-file-dispatcher.js';

taskFileDispatcher({
  taskFile: path.join(CONTENT_DIR, 'my-domain/TASK.md'),
  scriptName: 'dispatchers/my-dispatcher',
  jobId: 'my-dispatcher-job',
  thinking: 'low',
  timeout: 600,
  injectDateContext: true,
});
```

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

## Standing Orders Convention

Dispatchers implement a "standing orders" pattern:

- **Static tasks** (daily-digest): Read a fixed TASK.md file that rarely changes. The LLM session follows the standing orders each run.
- **Dynamic tasks** (social-posts): Build the task string at runtime from configuration refs, content paths, and business rules. The `buildTask()` function constructs the full instruction set.

Both patterns ultimately call `runDispatcher()` which spawns a gateway worker session to execute the task autonomously.

## Prerequisites

- Gateway API accessible (`GATEWAY_HOST`, `GATEWAY_PORT`)
- `SPAWN_WORKER_PATH` pointing to `spawn-worker.ts`
- TASK.md files present in expected content directories
- For social-posts: Notion database ID and Slack channels configured in pipeline-config refs (see [Configuration Files](../lib/README.md#configuration-files) for `pipeline-config.json` schema and creation instructions)

## Key Files

| File | Purpose |
|------|---------|
| `lib/task-file-dispatcher.ts` | Core framework — reads task file, injects date context, delegates to `runDispatcher()` |
| `../lib/constants.ts` | Provides `CONTENT_DIR`, `SPAWN_WORKER_PATH` |
| `../lib/pipeline-config.ts` | Provides `getRef()` for external service IDs |
| `../lib/spawn-worker.ts` | Gateway session spawner invoked by `runDispatcher()` |
