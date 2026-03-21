# Growth Storage Repair and Prevention (2026-03-21)

## Current live data paths on Fly
- `/data/growth/current.json`: live working set
- `/data/growth/runtime-meta.json`: scheduler/backfill/mail runtime state
- `/data/growth/history-ledger/*.json`: historical aggregate ledger per platform
- `/data/growth/archive/<YYYY-MM-DD>/*.json`: cold archive shards

## What filled the disk
The Fly volume was filled by archive shards and export/backup leftovers, not by `current.json` itself.

Observed sizes:
- `current.json`: about 23MB
- `runtime-meta.json`: about 120KB
- `history-ledger`: about 22MB
- `archive`: about 1.9GB

## Repair changes
1. CSV exports no longer default to `/data/growth/exports` on Fly. They now write to `/tmp/growth-exports`.
2. Scheduler ENOSPC no longer downgrades runtime frequency labels to low-yield mode. It preserves the last successful state and keeps burst cadence.
3. Backfill ENOSPC no longer marks the worker as failed/inactive or overwrites platform totals with failed-round low-water values. It keeps the last successful totals and writes a storage note instead.
4. Added GitHub backup workflow every 6 hours for `current.json` and `runtime-meta.json`.
5. Added GitHub archive offload workflow every 6 hours to move old archive shard directories off Fly and then delete them from Fly after upload succeeds.

## GitHub backup/offload workflows
- `.github/workflows/growth-backup.yml`
- `.github/workflows/growth-archive-offload.yml`

## Analysis rule after archive offload
- Hot path reads from Fly only:
  - `current.json`
  - `runtime-meta.json`
  - `history-ledger`
- Cold archive shards live in GitHub artifacts.
- Analysis must:
  1. check local working set first
  2. if local data is insufficient, read a shard manifest / artifact directory listing
  3. fetch only required archive shards
  4. merge in a temp cache
  5. run analysis from merged temp data
- Never download the full historical archive for each request.
- Never treat GitHub as the live query store.

## Prevention rules
- Do not keep long-term backups on Fly.
- Keep Fly for live working set and recent archive only.
- Offload old archive shards every 6 hours.
- Keep monotonic guard in deploy workflow so post-deploy totals cannot regress under the protected baseline.
- Do not restart the Fly machine casually.

## Manual recovery checklist
1. Verify live paths:
   - `/data/growth/current.json`
   - `/data/growth/runtime-meta.json`
   - `/data/growth/history-ledger`
2. Check disk usage:
   - `df -h /data`
   - `du -sh /data/growth/archive /data/growth/current.json /data/growth/history-ledger`
3. If archive is too large, confirm GitHub offload artifact exists before deleting old day directories.
4. Restore the current recovery package if needed.
5. Verify `getGrowthSystemStatus` and platform totals do not regress.
