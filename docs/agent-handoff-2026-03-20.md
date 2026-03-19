# Agent Handoff 2026-03-20

## Goal

This handoff compresses the work from the last long session so a new Codex thread can continue without replaying the full conversation.

Primary product goals:

1. Fix growth data drift and make recovery stable across restart/release/store changes.
2. Fix Growth Camp stage two:
   - stable video analysis
   - remove backend-analysis leakage from frontend
   - kill default templated monetization paths
   - make outputs diverge across different videos
   - eventually exceed single-model Gemini output by adding structured decision layers

Model-parameter tuning is intentionally deferred until the analysis chain is stable.

## Repo / Deploy Context

- Repo: `mvstudiopro`
- Working repo path during this session: `/Users/tangenjie/.codex/worktrees/974b/mvstudiopro`
- Git remote: `origin https://github.com/gabrieltan0506-prog/mvstudiopro.git`
- Fly app: `mvstudiopro`
- Fly machine seen during session: `56834e7da47408`
- Fly volume mount from `fly.toml`:
  - `GROWTH_STORE_DIR=/data/growth`
  - `GROWTH_LEGACY_STORE_FILE=/data/growth-trends.json`
  - mount destination `/data`

Important consequence:

- Local `.cache/growth/current.json` is not the live store.
- The live site reads `/data/growth/current.json` on Fly.

## Data Layer Findings

Root cause of drift:

1. `server/routers.ts` mixed store state and computed stats with `Math.max(...)`.
2. `server/growth/trendStore.ts` let multiple sources act as historical truth:
   - `collections/current`
   - `archiveIndex`
   - `backfill.platforms[].archivedTotal`
3. Douyin creator-center debug counts were effectively derived from bucket/index counts, not a single deduped historical source.

Observed mismatch:

- Local recovered store was high-water.
- Fly volume still held a low-water store.
- That is why the user still saw low numbers in the debug panel after code changes.

## Data Layer Changes Already Done

Pushed commit:

- `ec301df` `Stabilize growth store recovery and history ledger`

Files changed:

- `server/growth/trendStore.ts`
- `server/growth/trendScheduler.ts`
- `server/routers.ts`
- `scripts/rebuild-growth-store-from-recovery.ts`
- `scripts/snapshot-growth-store.ts`
- `scripts/restore-growth-store-from-snapshot.ts`
- `docs/growth-data-warehouse.md`
- `data/growth-snapshots/.gitkeep`
- `package.json`

What those changes do:

1. Introduce `history-ledger` as the historical truth layer.
2. Stop treating backfill progress as canonical archive totals.
3. Reconcile history state before scheduler/bootstrap.
4. Add snapshot / restore / rebuild scripts.

## Recovery Sources Used

CSV recovery dirs:

- `/Users/tangenjie/Downloads/2026Mar19/recovery-merged-15-19`
- `/Users/tangenjie/Downloads/2026Mar19/recovery-merged-17-19`
- `/Users/tangenjie/Downloads/2026Mar19/recovery-merged-18-19`

Rebuilt current snapshots:

- `/Users/tangenjie/Downloads/2026Mar19/rebuilt-platform-store/current.json`
- `/Users/tangenjie/Downloads/2026Mar19/rebuilt-platform-store/_remote-current-snapshot.json`
- `/Users/tangenjie/Downloads/2026Mar19/rebuilt-platform-store-15-19/current.json`

## Local High-Water Store After Recovery

At one point after rebuild, local `.cache/growth/current.json` showed:

- `douyin: 100225`
- `xiaohongshu: 75805`
- `bilibili: 34541`
- `kuaishou: 751`
- `toutiao: 241`

This local current also contained high-water `history` counts.

## Live Fly Store Snapshot Before Sync

Downloaded backup from Fly to:

- `/tmp/fly-growth-backup-20260320/current.json`
- `/tmp/fly-growth-backup-20260320/growth-trends.json`

Fly `/data/growth/current.json` was still low-water, roughly:

- `douyin: 878`
- `xiaohongshu: 947`
- `kuaishou: 11`
- `toutiao: 194`
- `bilibili: 764`

That low-water file is the direct reason the user still saw low debug counts.

## Important Recovery Detail

The remote Fly current was not a pure subset of the local rebuilt store. It contained some newer burst items not present locally.

Comparison against local rebuilt current:

- `douyin remote=878 missing_in_local=541`
- `xiaohongshu remote=947 missing_in_local=95`
- `kuaishou remote=11 missing_in_local=0`
- `toutiao remote=194 missing_in_local=11`
- `bilibili remote=764 missing_in_local=235`

Because of that, do not blindly overwrite Fly with an older local snapshot. Merge the remote current into rebuild inputs first.

## Current Sync Status When This Handoff Was Written

Progress reached:

1. Verified that the critical live file is `/data/growth/current.json`.
2. Re-ran rebuild locally with extra input:
   - `pnpm exec tsx scripts/rebuild-growth-store-from-recovery.ts --rebuilt-current /tmp/fly-growth-backup-20260320/current.json`
3. Confirmed local high-water current now includes both merged backups and remote Fly additions.

What was not fully completed yet:

- Fly volume sync was in progress.
- Full archive/history sync proved too slow over SFTP.
- Plan shifted to syncing `current.json` first, because live reads start from that file.

Key technical note:

- `readTrendStore()` reads `STORE_FILE` (`/data/growth/current.json`) directly.
- It does not read `history-ledger` before returning the store file.
- Therefore, replacing live `current.json` is the fastest way to correct live debug counts.

## Recommended Next Action For Data Layer

1. Upload local `.cache/growth/current.json` to Fly as a temp file:
   - `/data/growth/current.json.next`
2. Atomically swap it into place on Fly:
   - backup old current
   - rename `current.json.next` -> `current.json`
3. Restart Fly machine or redeploy so the app re-reads the new store.
4. Verify live counts from Fly shell.
5. Only after live counts are correct, optionally backfill `history-ledger` / `archive` directories.

Suggested verification command:

```bash
flyctl ssh console -a mvstudiopro -C "node -e \"const d=require('/data/growth/current.json'); console.log(JSON.stringify({updatedAt:d.updatedAt, counts:Object.fromEntries(Object.entries(d.collections||{}).map(([k,v])=>[k,(v.items||[]).length])), history:d.history?.platforms||{}}, null, 2))\""
```

## Stage Two Findings

Main product problems:

1. Video upload flow was too heavy and unstable.
2. Frontend leaked backend/internal decision logic to users.
3. Frontend contained residual template shaping.
4. Monetization defaults over-pushed:
   - `社群会员`
   - `知识付费`
   - related service-template paths

## Stage Two Changes Already Done

Pushed commit:

- `9f9e677` `Stabilize growth camp video analysis path`

Files changed:

- `server/growth/analyzeVideo.ts`
- `server/growth/growthSchema.ts`
- `client/src/pages/MVAnalysis.tsx`

What those changes do:

### `server/growth/analyzeVideo.ts`

- uploads source video to public storage first
- extracts a small set of keyframes
- performs one consolidated vision analysis with the keyframes
- avoids the previous extremely heavy multi-step path

### `server/growth/growthSchema.ts`

- clamps `知识付费` and `社群会员` unless explicit evidence supports them
- reduces default fall-through into those routes

### `client/src/pages/MVAnalysis.tsx`

- debug visibility restricted to supervisor
- generic track rendering instead of hardcoded special-case copy
- backend-analysis leakage reduced

## Additional Frontend Cleanup After `9f9e677`

An extra commit was created afterward:

- `080012e` `Trim growth camp summary helper copy`

This removes the small explanatory helper paragraphs under:

- `趋势洞察`
- `商业洞察`
- `推荐平台`

These were explicitly requested by the user to be removed.

## Deployment Note

Pushing to GitHub does not guarantee Fly has the latest code or latest store.

At the time of this handoff:

- the repo had the new commits
- the live Fly site still appeared to be serving old code and old data

So the next agent should verify both:

1. code deployment state
2. live Fly volume state

## Explicit User Requirements

The user made these points repeatedly:

1. Do not expose backend reasoning logic to end users.
2. Do not default to generic monetization template routes.
3. Do not add model-parameter tuning yet.
4. Each meaningful change must be verifiable in the website UI, not just locally.
5. Current infrastructure should stay pragmatic:
   - Vercel frontend
   - Fly backend / jobs
   - no major GCP migration now

## What Still Needs To Be Completed

### Data layer

- finish live Fly current.json replacement
- verify live debug counts match recovered high-water store
- optionally complete ledger/archive sync after current.json is stable

### Growth Camp

- ensure latest stage-two code is deployed
- verify:
  - video analysis no longer 502/503s
  - different videos produce clearly different results
  - no backend-analysis leakage in user UI
  - no easy fallback into `社群会员 / 知识付费 / 咨询陪跑`

### Later, but not now

- only after pipeline stability: add controlled Gemini parameter tuning

## Suggested New-Thread Prompt

Use this in the next Codex thread:

> Read `/Users/tangenjie/.codex/worktrees/974b/mvstudiopro/docs/agent-handoff-2026-03-20.md` first. Continue from the Fly live-store sync and stage-two deployment verification. Do not add model parameter tuning yet. First fix live debug counts by syncing Fly `/data/growth/current.json` to the rebuilt high-water store that already merged remote burst additions, then verify the Growth Camp UI no longer leaks backend logic and no longer shows the removed helper copy.
