# Growth Data Warehouse

This repository now supports a portable growth-store snapshot workflow for GitHub backup and recovery.

## Goals

- Keep history totals stable across restart, release switch, and store reload.
- Persist a deduped history ledger separate from backfill progress.
- Allow a repository snapshot to be committed to GitHub and restored without manual CSV merging.

## Commands

Rebuild the live growth store from the local merged recovery CSVs plus rebuilt platform snapshots:

```bash
pnpm run rebuild:growth-store
```

This command merges recovery sources into the latest `current.json` instead of blindly overwriting it, so new burst-mode items collected during recovery are preserved.

Create a portable snapshot under `data/growth-snapshots/latest`:

```bash
pnpm exec tsx scripts/snapshot-growth-store.ts
```

Restore the store from the latest committed snapshot:

```bash
pnpm exec tsx scripts/restore-growth-store-from-snapshot.ts
```

Custom paths are supported:

```bash
pnpm exec tsx scripts/snapshot-growth-store.ts /absolute/path/to/snapshot-dir
pnpm exec tsx scripts/restore-growth-store-from-snapshot.ts /absolute/path/to/snapshot-dir
```

## What gets backed up

- `current.json`
- `archive/**`
- `history-ledger/*.json`
- snapshot `manifest.json`

## Recovery rule

- History truth is rebuilt from the persisted history ledger.
- Backfill progress is progress-only and does not define historical totals.
- Recovery writes must merge on top of the latest live store so burst-mode updates are not lost during a restore.
- GitHub snapshots are intended for disaster recovery when the volume store is lost or corrupted.
