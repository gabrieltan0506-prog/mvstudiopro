# Codex Handoff - 2026-03-14

## Objective
This handoff defines the split between the mainline Codex agent and the supporting Codex agent for two parallel tracks:

1. `workflow-nodes` migration
2. `viral` repositioning into `创作商业成長營 / Creator Growth Camp`

The legacy page `/workflow` must remain available until `workflow-nodes` is stable enough to replace it.

## Delivery Targets

### Track A: Workflow Nodes
Goal: migrate the existing storyboard-to-video workflow into `/workflow-nodes`.

#### Required outcome
- `/workflow-nodes` becomes the main debug and iterative development surface.
- `/workflow` remains as a stable fallback.
- Existing jobs API in [api/jobs.ts](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/api/jobs.ts) remains the execution backbone during migration.

#### Scope for “complete migration”
- Prompt input
- Script generation
- Storyboard generation
- Scene assets
- Render still
- Scene voice
- Music
- Final render
- Node status + selected node details
- Real request/response debugging in node surface

#### Timeline
- MVP nodes migration: 2-3 working days
- Stable complete migration: 7-10 working days

### Track B: Creator Growth Camp
Goal: replace the current “viral / analysis” positioning with a business growth product.

#### Required outcome
- Rename and reposition the product as `创作商业成長營 / Creator Growth Camp`
- Build a practical MVP in 2 days
- Deliver full first-version capability in 5-6 days

#### Required modules
- Video analysis
- 30-day platform trend data
- Hot content structure library
- Commercial model recommendation engine
- Auto growth strategy generation
- AI creation-assistant linkage
- Recommended publishing platform

## Ownership Split

### Mainline agent
Responsible for:
- Core architecture decisions
- All changes touching shared workflow contracts
- `api/jobs.ts`
- Final render path
- `/workflow-nodes` main interaction model
- Growth Camp overall information architecture
- Integration validation and Fly deployment

### Supporting agent
Responsible for:
- UI implementation assistance
- Secondary page sections and data presentation
- Reusable cards, forms, and result panels
- Growth Camp supporting views and report composition
- Node-side UI panels that do not change shared execution contracts
- Non-critical refactors and styling cleanup

Supporting agent must not independently change shared workflow contracts without aligning with the mainline agent.

## Existing Sources of Truth

### Workflow
- Main working page:
  [client/src/pages/WorkflowStoryboardToVideo.tsx](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/client/src/pages/WorkflowStoryboardToVideo.tsx)
- Node canvas shell:
  [client/src/pages/WorkflowNodes.tsx](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/client/src/pages/WorkflowNodes.tsx)
- Jobs backend:
  [api/jobs.ts](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/api/jobs.ts)
- Render backend:
  [server/vercel-api-core/render.ts](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/server/vercel-api-core/render.ts)

### Creator Growth Camp / Viral / Analysis
- Existing analysis page:
  [client/src/pages/MVAnalysis.tsx](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/client/src/pages/MVAnalysis.tsx)
- Existing submission flow:
  [client/src/pages/VideoSubmit.tsx](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/client/src/pages/VideoSubmit.tsx)
- Existing backend analysis and submission:
  [server/routers.ts](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/server/routers.ts)
  [server/routers/videoSubmission.ts](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/server/routers/videoSubmission.ts)
  [server/videoAnalysis.ts](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/server/videoAnalysis.ts)

## Workflow-Nodes Migration Plan

### Phase 1: Node surface becomes executable
- Keep the current canvas layout in:
  [client/src/pages/WorkflowNodes.tsx](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/client/src/pages/WorkflowNodes.tsx)
- Add real workflow state loading
- Add selected-node input/output panel
- Reuse the same request payloads already used in `/workflow`
- Add debug request/response block to nodes page

### Phase 2: Node-by-node execution
- Prompt node
- Script node
- Storyboard node
- Scene assets node
- Render still node
- Voice node
- Music node
- Final render node

### Phase 3: Replace debug workflow
- Make `/workflow-nodes` the primary debug surface
- Keep `/workflow` as fallback only

## Creator Growth Camp Plan

### MVP (2 days)
- Rename the entry and page concept to `创作商业成長營`
- Rebuild result IA into:
  - 内容分析
  - 趋势洞察
  - 商业化建议
  - 增长规划
  - 推荐发布平台
- Reuse current analysis and submission backend
- Add platform recommendation prominence
- Add basic AI growth plan generation using existing report inputs

### Full first version (5-6 days)
- 30-day platform trend data pipeline
- Hot content structure library
- Commercial recommendation engine
- Growth strategy generator
- AI creation-assistant linkage into creation workflow

## Data Collection Requirement
Trend data collection must start tomorrow.

The first implementation can be pragmatic:
- start with scheduled/public-source snapshots
- normalize into one internal shape
- store trend summaries first before building a full trend database UI

## Immediate Tasks For Supporting Agent

1. Workflow Nodes
- Build a reusable right-side node inspector component
- Add node execution buttons for prompt/script/storyboard/image/video/music/render sections
- Add debug response panel styling and request payload display

2. Creator Growth Camp
- Prepare the new page shell and section layout
- Create reusable cards for:
  - 内容分析
  - 趋势分析
  - 商业洞察
  - 增长规划
  - 推荐发布平台
- Preserve compatibility with current `MVAnalysis` result shape while preparing expansion slots

## Constraints
- Do not remove `/workflow`
- Do not break current Fly production workflow chain
- Keep execution contracts centralized in [api/jobs.ts](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/api/jobs.ts)
- Prefer incremental migration over big rewrites
