# Creator Growth Camp Handoff

## Scope

This handoff covers the support-track migration from the old `viral / 爆款分析師` product surface to `創作商業成長營`, plus the related deployment constraints now in effect for Vercel and Fly.

## Product Renaming And Routing

- The old `爆款分析師` product surface was renamed to `創作商業成長營`.
- Compatibility routes were preserved so existing entry points do not break.
- Active routes:
  - `/creator-growth-camp`
  - `/analysis`
  - `/viral`
- Main page implementation remains centered on:
  - `client/src/pages/MVAnalysis.tsx`

## Growth Data Collection

- A live 30-day trend collection module was added for:
  - Douyin
  - Xiaohongshu
  - Bilibili
- Core files:
  - `server/growth/trendCollector.ts`
  - `server/growth/trendStore.ts`
  - `server/growth/growthSchema.ts`
  - `shared/growth.ts`
- Local cache is written to:
  - `.cache/growth-trends.json`
- Growth snapshot now supports:
  - `live`
  - `hybrid`
  - `fallback`

## Growth Snapshot Expansion

- Growth snapshot output was expanded beyond platform trend cards.
- New structured fields now exist in `shared/growth.ts` and are generated in `server/growth/growthSchema.ts`:
  - `structurePatterns`
  - `monetizationTracks`
  - `creationAssist`
- These are now used by the growth camp report page instead of relying only on frontend-only derivation.

## Frontend Report Enhancements

- `client/src/pages/MVAnalysis.tsx` now includes:
  - trend insight display using backend snapshot output
  - commercial path cards
  - structure pattern cards
  - creation brief area
  - copy actions for:
    - execution brief
    - 7-day growth plan
    - storyboard prompt
    - workflow prompt
- Current design intent:
  - Vercel hosts the frontend shell
  - Fly hosts the backend API behavior

## Local Regression Work

- Full local flow regression was completed against the growth camp path.
- Validated chain:
  - route load
  - auth state path
  - usage check
  - analyze frame
  - growth snapshot
  - refresh growth trends
- To make local regression possible without full production infra, controlled fallbacks were added:
  - `server/_core/sdk.ts`
    - local-dev authenticated fallback user when no database is configured
  - `server/routers/authApi.ts`
    - `/api/me` fallback response when DB is unavailable
  - `server/storage.ts`
    - local data URL fallback when legacy storage proxy env is absent
  - `server/routers.ts`
    - deterministic `analyzeFrame` fallback when model invocation fails

## Environment And Infra Notes

- Legacy storage proxy envs are no longer the target direction for new work:
  - `BUILT_IN_FORGE_API_URL`
  - `BUILT_IN_FORGE_API_KEY`
- New image-generation-related work should follow the FAL path instead:
  - `FAL_API_KEY`
  - `FAL_KEY`
- Login env work was explicitly deferred for later discussion.

## Deployment Constraint Now In Force

- Deployment rule agreed and treated as current project policy:
  - `Vercel` only keeps minimal frontend deployment ability
  - `/api/*` should go to `Fly`
  - new backend capabilities should not be added to Vercel functions
- Another agent already landed the deployment constraint:
  - `vercel.json` rewrites `/api/:path*` to `https://mvstudiopro.fly.dev/api/:path*`
  - `.vercelignore` excludes `api/`
- Operational rule going forward:
  - frontend pages and static shell -> Vercel
  - backend APIs, auth, jobs, workflow, generation, blob, trpc -> Fly

## Vercel Function Limit Cleanup

- Before the deployment constraint fully took over, the repo still had extra files under `api/_core`.
- These three files were removed because they were orphaned and still counted toward Vercel function risk:
  - `api/_core/env.js`
  - `api/_core/workflow.js`
  - `api/_core/banana.js`
- After removal, direct `api/*` file count dropped from `13` to `10`.
- Commit for that cleanup:
  - `7d3015e` `Reduce Vercel function count under hobby limit`

## Key Commits Mentioned In This Track

- `9853f13` `Add Creator Growth Camp live trend collectors`
- `0d8da5e` `Finish creator growth camp regression flow`
- `420b1aa` `Extend creator growth camp strategy output`
- `0ce3a17` `Fix growth structure platform typing`
- `7d3015e` `Reduce Vercel function count under hobby limit`

## Active Deployment Targets

- Fly app:
  - `https://mvstudiopro.fly.dev/`
  - `https://mvstudiopro.fly.dev/creator-growth-camp`
- Vercel frontend-only UI deployment created during this work:
  - `https://mvsp-creator-growth-ui.vercel.app`

## Coordination Notes For Mainline

- Workflow-owned files were intentionally avoided unless necessary.
- If mainline wants true one-click handoff from growth camp into workflow or storyboard, mainline still needs to accept a handoff payload on the workflow side.
- Current growth camp support-track implementation only provides:
  - generated prompts
  - copy actions
  - entry links to workflow/storyboard
- It does not yet implement a workflow-prefill contract.

## Recommended Next Steps

- Keep all new backend capability on Fly only.
- If login is revisited, unify the frontend login path with the Fly-hosted backend direction.
- If workflow handoff is required, define one payload contract and let mainline consume it explicitly.
- If 30-day trend reliability needs to improve, add:
  - deeper pagination
  - retry logic
  - scheduled collection
  - duplicate cleanup
