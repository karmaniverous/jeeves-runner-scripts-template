# admin/

Token metrics collection, session cost management, and OpenClaw post-install patches.

## Scripts

| Script | Description |
|--------|-------------|
| `collect-token-metrics.ts` | Scans OpenClaw session transcripts and Claude Code session logs, writes immutable hourly rollup buckets to disk |
| `session-refresh.ts` | Rotates bloated gateway sessions by resetting idle sessions with high cacheRead values |
| `token-metrics.ts` | Queries pre-rolled hourly buckets and aggregates into a cost report for a given time range (also a CLI: `tsx src/admin/token-metrics.ts [--from ISO] [--to ISO]`) |
| `refresh-token-rates.ts` | Dispatches an LLM session to fetch current published API pricing and update the rate card config |
| `recalculate-token-metrics.ts` | Safe recalculation of token metrics for a date range with backup and dry-run support |
| `patch-openclaw.ts` | Orchestrator that runs all OpenClaw post-install patches in sequence |
| `patch-tool-order.ts` | Patches OpenClaw's toolOrder array to insert Jeeves component tools above grep |

## Data Flow

```
collect-token-metrics  →  hourly bucket JSON files  →  token-metrics (query/aggregate)
                                                    ←  refresh-token-rates (rate card)

session-refresh  →  gateway API (refresh idle/oversized sessions)

patch-openclaw  →  patch-tool-order (post npm install -g openclaw)
```

- **collect-token-metrics** incrementally scans JSONL transcripts (OpenClaw + Claude Code), rolls usage into per-hour bucket files partitioned by channel and model.
- **token-metrics** reads those buckets and the rate card to produce aggregated cost reports.
- **session-refresh** polls active sessions and refreshes any that exceed the cacheRead threshold after being idle long enough.

## Prerequisites

No external prerequisites — all jobs run against local filesystem and gateway API.

| Job | Schedule |
|-----|----------|
| `collect-token-metrics` | Every 97 min |
| `session-refresh` | Every 23 min |
| `refresh-token-rates` | Every 59 min |

## Documentation

- [Token Metrics Operational Runbook](../../docs/token-metrics-runbook.md) — pipeline stages, recalculation procedures, troubleshooting

## Key Files

| File | Purpose |
|------|---------|
| `lib/bucket-io.ts` | Hourly bucket file I/O — read, write, merge, flush |
| `lib/channel-mapper.ts` | Maps session transcripts to channel keys (Slack, DM, heartbeat, subagent, meta-synthesis) |
| `lib/claude-code-scanner.ts` | Scans Claude Code session JSONL files for Anthropic usage records |
| `lib/patch-tool-order-utils.ts` | Pure helpers for toolOrder parsing and formatting |
| `lib/rate-card.ts` | Token rate card loader and cost calculator ($/MTok) |
| `lib/recalc-utils.ts` | Pure helpers for recalculation: hour enumeration and cursor reset logic |
| `lib/resolve-openclaw-dist.ts` | Resolves global npm openclaw dist directory for patching |
| `lib/session-scanner.ts` | Session file scanning with cursor management and range filtering (shared by collector and recalculator) |
| `lib/usage-parser.ts` | OpenClaw transcript line parser and usage normalizer (shared by collector and recalculator) |
| `types/token-metrics.ts` | Shared types across collector and query layers |
