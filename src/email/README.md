# email/

Gmail polling, download, triage, and classification pipeline. Polls configured accounts for new threads, classifies them into buckets, downloads message bodies, and applies Gmail labels.

## Scripts

| Script | Description |
|--------|-------------|
| `poll.ts` | Polls Gmail accounts for new/updated threads, classifies them (receipt, junk, bucket), and enqueues for download |
| `download.ts` | Dequeues threads from `email-pending` and downloads full message bodies, headers, and attachments |
| `drain-updates.ts` | Dequeues label-change actions from `email-updates` and applies them to Gmail via `gog gmail thread modify` |
| `backfill-bodies.ts` | One-shot: finds cached threads missing downloaded message bodies and enqueues them |
| `backfill-classification.ts` | One-shot: classifies threads missing receipt/junk/bucket fields and enqueues label actions |
| `backfill-historical.ts` | One-shot: searches Gmail for threads in a date range predating the pipeline and processes them |
| `backfill-labels.ts` | One-shot: enqueues label actions for threads with classification but no applied labels |
| `inventory.ts` | Prints a summary table of thread directories, message files, and state counts per account |

## Data Flow

```
poll  →  classify (receipt/junk/bucket)  →  enqueue email-pending + email-updates
                                                    ↓                    ↓
                                              download             drain-updates
                                           (fetch bodies)       (apply Gmail labels)
                                                    ↓
                                          per-message JSON files
                                          (silo-routed by account)
```

1. **poll** searches Gmail via `gog gmail search`, classifies each thread, enqueues important threads to `email-pending` for body download and label actions to `email-updates`.
2. **download** dequeues from `email-pending` (up to 50/run), fetches full messages via `gog gmail get`, extracts headers/body/attachments, and writes per-message JSON files.
3. **drain-updates** dequeues from `email-updates` (up to 100/run), pre-creates missing Gmail labels, applies label changes with rate limiting (60 calls/min).

### Classification

- **Receipt candidate**: matches financial receipt/invoice keywords in subject/snippet/from
- **Junk candidate**: matches newsletter/promo/marketing keywords
- **Bucket**: domain-based classification via pipeline-config (e.g., VC, Sales, Personal)
- Labels are computed by `computeLabelsToApply()` and applied idempotently

### State Management

- Per-thread state stored in runner SQLite via `email-state.ts` (classification, seen timestamps, label application)
- Per-account scalar state tracks last poll timestamp
- Thread cache files (`thread.json`) store message metadata, labels, and provenance history

## Prerequisites

- Gmail OAuth configured via `gog` CLI
- Email accounts listed in `pipeline-config.json` with `emailPolling: true`
- `GOG_CLIENT_PATH` set in `constants.ts`

| Job | Schedule |
|-----|----------|
| `email-poll` | Every 11 min |
| `email-download` | Every 13 min |
| `email-drain-updates` | Every 17 min |

## Key Files

| File | Purpose |
|------|---------|
| `email-cache.ts` | Per-thread JSON cache — load, save, create/update, detect label changes |
| `email-fetch.ts` | Fetch full thread metadata from Gmail, update cache/provenance, enqueue for download |
| `email-state.ts` | Per-thread and per-account state in runner SQLite store |
| `email-triage.ts` | Pure-function classification helpers (receipt, junk, bucket, importance) |
| `../lib/email.ts` | Gmail payload parsing (headers, body decoding, attachment extraction) |
| `../lib/gog.ts` | Google Workspace CLI wrapper with retry |
| `../lib/pipeline-config.ts` | Account lists and domain-to-bucket routing |
| `../lib/silo-router.ts` | Per-account filesystem path routing |
