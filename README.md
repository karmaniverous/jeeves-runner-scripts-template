# jeeves-scripts

TypeScript runner scripts for [jeeves-runner](https://github.com/karmaniverous/jeeves-runner). This repo provides a structured home for your scheduled jobs: shared infrastructure in `src/lib/`, domain scripts organized by folder, and a full quality-gate pipeline.

## Setup

```bash
npm install
```

### Runner Configuration

Register `.ts` file execution in your jeeves-runner config so the runner knows how to execute TypeScript scripts:

```jsonc
// jeeves-runner config
{
  "runners": {
    "ts": "node <scripts-root>/node_modules/tsx/dist/cli.mjs"
  }
}
```

Each job references a script by absolute path:

```jsonc
{
  "id": "my-job",
  "name": "My Scheduled Job",
  "schedule": "every 1h",
  "script": "/path/to/jeeves-scripts/src/my-domain/my-script.ts",
  "source_type": "path"
}
```

> **Note:** The runner defaults to plain `node` for file extensions not in the `runners` map. Plain Node can strip TypeScript types but cannot resolve `.js` → `.ts` imports, so the tsx runner entry is required.

## Repo Structure

```text
src/
  lib/            Shared infrastructure (constants)
  example/        Sample script — delete when you start building
  {domain}/       Your scripts, organized by domain (e.g. github/, email/, slack/)
```

- **`src/lib/`** — Generic, reusable modules. Constants, shell execution helpers, and filesystem utilities live here. Add shared logic here when multiple scripts need it.
- **`src/{domain}/`** — Scripts grouped by domain. Each script is a standalone entry point executed directly via `tsx`.
- **`src/example/hello.ts`** — A minimal working script demonstrating the standard pattern. Delete it once you've written your first real script.

## Writing a Script

Every script follows the same pattern:

```typescript
import { runScript } from '@karmaniverous/jeeves';
import { getRunnerClient } from '@karmaniverous/jeeves-runner';

runScript('my-script', async () => {
  const client = getRunnerClient();

  // Use client.getState / client.setState for persistent key-value state.
  // Use client.enqueue / client.claim for work queues.

  // ... your logic here ...

  client.close();
});
```

- **`runScript()`** (from `@karmaniverous/jeeves`) wraps your logic in a crash handler that logs failures and exits with code 1.
- **`getRunnerClient()`** (from `@karmaniverous/jeeves-runner`) creates a typed client connected to the runner's SQLite database. Honors the `JR_DB_PATH` env var (set automatically by the runner executor).

## Dispatcher Pattern

Scripts that need to spawn an OpenClaw Gateway LLM session use the dispatcher pattern:

```typescript
import { runScript } from '@karmaniverous/jeeves';
import { runDispatcher } from '@karmaniverous/jeeves-runner';

import { SPAWN_WORKER_PATH } from '../lib/constants.js';

runScript('my-dispatcher', () => {
  const task = 'Analyze the latest data and post a summary to #reports.';

  runDispatcher(task, {
    jobId: 'my-dispatcher',
    timeout: 300,
    label: 'worker-my-dispatcher',
  }, SPAWN_WORKER_PATH);
});
```

- **`runDispatcher()`** pipes the task prompt to a spawn-worker script that handles the Gateway HTTP API.
- **`SPAWN_WORKER_PATH`** points to `src/lib/spawn-worker.ts`, which manages session creation, polling, and token tracking.
- The `--dry-run` flag prints the task JSON without dispatching, useful for testing.

### Task File Dispatcher

For scripts that read a task from a Markdown file (the most common pattern), use the `taskFileDispatcher()` helper:

```typescript
import { taskFileDispatcher } from '../dispatchers/lib/task-file-dispatcher.js';

taskFileDispatcher({
  scriptName: 'my-domain/my-briefing',
  jobId: 'my-briefing',
  taskFile: '/path/to/TASK.md',
  timeout: 600,
  injectDateContext: true,       // Prepend authoritative date/day-of-week
  dateTimezone: 'America/New_York',
});
```

This reads the task file, optionally injects a date context header (so the LLM knows the current date), and dispatches it.

## Quality Gates

| Gate | Command | What it checks |
|------|---------|----------------|
| Typecheck | `npm run typecheck` | TypeScript strict mode, no emit |
| Lint | `npm run lint` | ESLint strict + Prettier formatting |
| Test | `npm run test` | Vitest test suite |
| Knip | `npm run knip` | Unused exports and dependencies |
| **STAN** | `npx stan run --sequential --no-archive` | Runs all of the above in sequence |

Run STAN before committing to catch all issues in one pass.

## Assistant Instructions

> This section is for LLM coding assistants working in this repo.

When asked to create or modify runner scripts:

1. **Use `runScript()` wrapper** for every script entry point. This provides crash handling and structured logging.
2. **Use `getRunnerClient()`** for state and queue access. Never construct the client manually.
3. **Import from packages, not local wrappers.** Use `runScript` from `@karmaniverous/jeeves` and `getRunnerClient` from `@karmaniverous/jeeves-runner`. Do not create local wrapper modules for functionality already exported by these packages.
4. **Add shared logic to `src/lib/`**, keep script entry points thin. A script should orchestrate; utilities should do the work.
5. **Write tests for lib modules**, not for script entry points. Lib modules are pure-ish functions; scripts are side-effectful orchestrators.
6. **All files under 300 LOC.** If a file is getting long, extract a module.
7. **Run STAN before committing:** `npx stan run --sequential --no-archive`. Zero errors AND zero warnings.
8. **No `eslint-disable` comments.** Fix the code, don't suppress the warning.
9. **Organize by domain.** New scripts go in `src/{domain}/`, not in the root `src/` directory.
10. **Update `src/lib/constants.ts`** when adding deployment-specific paths or config values. Keep them centralized.
11. **Use the dispatcher pattern** for scripts that need LLM sessions. Pair `runDispatcher()` with a TASK.md file and the `taskFileDispatcher()` helper when applicable.
