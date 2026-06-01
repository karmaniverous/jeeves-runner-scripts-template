# lib/

Shared infrastructure consumed by all domain scripts. This is where instance configuration, CLI wrappers, and cross-cutting utilities live.

## Modules

### constants.ts

**The first file to edit on a new instance.** Centralized paths, credentials, and integration-specific values used across all scripts.

Key exports:
- Directory paths: `CONTENT_DIR`, `SCRIPTS_DIR`, `CREDENTIALS_DIR`, `SESSIONS_DIR`, etc.
- GitHub: `GH_BIN`, `GH_CONFIG_DIR`, `GH_ACCOUNT`, `GH_BOT_USER`, `GITHUB_DIR`, `GITHUB_REGISTRY_PATH`
- Google: `GOG_BIN`, `GOG_CONFIG_DIR`, `GOG_CLIENT_PATH`
- Email: `EMAIL_EVENTS_DIR`
- Slack: `PRIMARY_WORKSPACE`, `SLACK_DOMAIN_DIR`, `SLACK_WORKSPACE_CACHE_PATH`
- X/Twitter: `X_OAUTH_DIR`, `X_ACCOUNTS`
- Meetings: `DEFAULT_MEETINGS_DIR`
- Gateway: `GATEWAY_HOST`, `GATEWAY_PORT`, `SPAWN_WORKER_PATH`
- Token metrics: `TOKEN_METRICS_DIR`, `TOKEN_RATES_PATH`, `SESSION_REFRESH_*` thresholds
- Entity types: `ENTITY_TYPES` array with `subdir`, `rejectionKeys`, `maxAgeDays` per type

### dates.ts

Thin wrappers around date-fns. No config dependencies.

- `dayOfWeek(dateStr)` — full weekday name (e.g., "Monday"). Important because LLMs cannot do day-of-week arithmetic reliably.
- `formatDate(dateStr, fmt)` — format a date using date-fns pattern
- `relativeDays(dateStr, referenceStr?)` — human-friendly relative description ("3 days ago", "today")
- Re-exports `format` and `parseISO` from date-fns

### email.ts

Gmail parsing utilities for raw Gmail API payloads. No config dependencies.

- `headerValue(headers, name)` — extract header value (case-insensitive)
- `extractTextFromPayload(payload)` — recursively extract text and HTML from MIME parts, decoding base64
- `extractAttachments(payload)` — recursively extract attachment metadata (filename, mimeType, size, attachmentId)

### gh.ts

GitHub CLI wrappers with typed invocation. Depends on `GH_BIN`, `GH_CONFIG_DIR`.

- `setupGhConfig()` — sets `GH_CONFIG_DIR` env var so `gh` finds correct auth tokens
- `gh(args, options?)` — run `gh` CLI command, return structured `GhResult` (`ok`, `status`, `out`, `err`)
- `ghJson(args)` — run `gh` and parse stdout as JSON
- `ghApi(endpoint)` — call GitHub REST API via `gh api`

### gog.ts

Google Workspace CLI wrapper with retry. Depends on `GOG_BIN`, `CREDENTIALS_DIR`.

- `gogWithRetry(args, opts?)` — run `gog` command with retry logic for transient network errors (context deadline exceeded, timeouts). Sets `APPDATA` to `CREDENTIALS_DIR` for Windows credential location.

### gateway-client.ts

Gateway HTTP client for OpenClaw tool invocation. Depends on `GATEWAY_HOST`, `GATEWAY_PORT`.

- `loadGatewayToken()` — load bearer token from `~/.openclaw/openclaw.json` or `CLAWDBOT_GATEWAY_TOKEN` env var
- `gatewayInvoke(tool, args, options?)` — invoke an OpenClaw gateway HTTP API tool
- `unwrapResult(r)` — unwrap result from gateway response

### pipeline-config.ts

Zod-validated pipeline configuration loader. Depends on `PIPELINE_CONFIG_PATH`.

- `loadPipelineConfig()` — load and cache config with Zod validation
- `getRef(key)` — get a ref value by dotted key (e.g., `'notion.socialPostsDatabaseId'`)
- `getCalendarAccounts()` — accounts with calendar config
- `getEmailAccounts()` — email addresses with `emailPolling: true`
- `getBucketForDomain(domain)` — match email domain to classification bucket
- `getBucketPriority()` — bucket name to priority index mapping

### silo-router.ts

Multi-tenant data routing by email domain, GitHub org, and Slack workspace. Depends on `SILO_ROUTING_CONFIG_PATH`.

- `getBasePathForEmailDomain(domain)` — resolve email domain to base content path
- `getBasePathForGitHubOrg(org)` — resolve GitHub org to base path (with optional relative path)
- `getBasePathForSlackWorkspace(teamId)` — resolve Slack workspace to base path
- `getBasePathForMeeting(participantEmails)` — resolve meeting to base path via majority-voting on participant email domains
- `getEntityDirs(subdir)` — deduplicated list of entity root directories across all silos
- `getEmailBaseForAccount(account)` / `getCalendarBaseForAccount(account)` — per-account path helpers

Single-tenant instances route everything to `CONTENT_DIR` by default.

### spawn-worker.ts

Gateway session spawner — executable script invoked by `runDispatcher()`.

Usage: `echo "task" | tsx spawn-worker.ts --job-id=<id> [--label=<label>] [--thinking=<level>] [--timeout=<seconds>]`

- Spawns a session via OpenClaw gateway HTTP API
- Polls for completion (checks session history and staleness)
- Waits for transcript to flush
- Outputs `WORKER_RESULT:{"sessionKey":"...","tokens":12345,"durationMs":123000}` on last stdout line
- Implements retry with exponential backoff (3 retries, 30s base)
