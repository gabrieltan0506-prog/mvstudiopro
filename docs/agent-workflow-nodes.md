# Agent Task - Workflow Nodes Migration

## Mission
Migrate the current `/workflow` execution flow into `/workflow-nodes` without breaking the existing production workflow page.

## Core Rule
- `/workflow` must remain available and unchanged as fallback.
- `/workflow-nodes` becomes the new debug and incremental development surface.
- Do not rewrite backend execution contracts unless absolutely necessary.
- Reuse existing request payloads and API ops from [api/jobs.ts](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/api/jobs.ts).

## Source Of Truth
- Current working page:
  [client/src/pages/WorkflowStoryboardToVideo.tsx](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/client/src/pages/WorkflowStoryboardToVideo.tsx)
- Node canvas shell:
  [client/src/pages/WorkflowNodes.tsx](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/client/src/pages/WorkflowNodes.tsx)
- Backend workflow ops:
  [api/jobs.ts](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/api/jobs.ts)
- Render path:
  [server/vercel-api-core/render.ts](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/server/vercel-api-core/render.ts)

## Scope You Should Implement

### Phase 1
Make `/workflow-nodes` actually executable:
- Load real workflow state
- Load selected node details
- Show request / response debug panel
- Allow executing these nodes:
  - Prompt
  - Script
  - Storyboard
  - Scene Assets
  - Render Still
  - Voice
  - Music
  - Final Render

### Phase 2
Add a right-side inspector that supports:
- current selected node title
- current node status
- editable inputs for that node
- execute button
- latest output snapshot

## Non-goals
Do not spend time on:
- freeform drag persistence
- layout save/load
- full node engine rewrite
- new backend orchestration layer

## Existing Ops To Reuse
From [api/jobs.ts](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/api/jobs.ts):
- `workflowGenerateScript`
- `workflowGenerateStoryboard`
- `workflowGenerateSceneImage`
- `workflowUploadSceneImage`
- `workflowGenerateRenderStill`
- `workflowGenerateSceneVoice`
- `workflowGenerateMusic`
- `workflowGenerateSceneVideo`
- `workflowRenderVideo`
- `workflowStatus`
- `envStatus`

## UI Strategy
Do not rebuild the flow from scratch.

Instead:
1. Read from the same workflow payload shape used by `/workflow`
2. Mirror the same request bodies from `/workflow`
3. Put execution controls in the selected-node panel
4. Keep node canvas as the top-level mental model, not as a fake static illustration

## Required Deliverables

### Deliverable A
Make `/workflow-nodes` load:
- current `workflowId`
- current `workflow`
- outputs
- scene bundles
- last debug response

### Deliverable B
Implement selected-node controls for:
- Script node
- Storyboard node
- Scene Assets node
- Render Still node
- Voice node
- Music node
- Final Render node

### Deliverable C
Show request / response JSON in a debug box similar to `/workflow`.

## Implementation Hints
- Reuse helper logic from:
  [client/src/pages/WorkflowStoryboardToVideo.tsx](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/client/src/pages/WorkflowStoryboardToVideo.tsx)
- It is acceptable to extract shared helpers into local component-level utilities if needed.
- Prefer small extracted components over one giant file if doing so speeds delivery.

## Acceptance Criteria
- `/workflow-nodes` can trigger real workflow operations
- Selected node inspector is interactive
- Debug request/response is visible
- `/workflow` still works
- `npm run build` passes

## Suggested Start Order
1. Read and reuse payload-building logic from `/workflow`
2. Add workflow status loading to `/workflow-nodes`
3. Add node inspector
4. Wire Script -> Storyboard -> Scene Assets
5. Wire Render Still / Voice / Music / Final Render
6. Verify build

## Command To Validate
```bash
cd /Users/tangenjie/Downloads/Clone\ github/mvstudiopro
npm run build
```

