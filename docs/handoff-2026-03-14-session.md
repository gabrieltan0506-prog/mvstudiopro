# Handoff - 2026-03-14 Session

## Current Objective
- Continue the `/workflow` to `/workflow-nodes` migration as the mainline task.
- Run the product rename and repositioning from `爆款分析師` to `創作商業成長營 / Creator Growth Camp` as a parallel supporting track.

## Ownership Split

### Mainline agent
- Owns `/workflow-nodes` migration
- Owns shared workflow execution behavior
- Owns integration validation
- Owns final GitHub push and Fly deployment after acceptance

### Supporting agent
- Owns `爆款分析師 -> 創作商業成長營` page/product line
- Owns supporting UI and content implementation from the product docs
- Must avoid changing shared workflow contracts without coordination

## Source Documents
- [docs/agent-workflow-nodes.md](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/docs/agent-workflow-nodes.md)
- [docs/agent-creator-growth-camp.md](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/docs/agent-creator-growth-camp.md)
- [docs/codex-handoff-2026-03-14.md](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/docs/codex-handoff-2026-03-14.md)
- [docs/mvstudiopro_workflow_context.md](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/docs/mvstudiopro_workflow_context.md)

## Mainline Progress: Workflow Nodes

### File touched
- [client/src/pages/WorkflowNodes.tsx](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/client/src/pages/WorkflowNodes.tsx)

### Completed in this session
- Added real workflow state restoration via `workflowId`
- Added `workflowId` input + manual refresh in the right-side status panel
- Added request payload normalization before node execution
- Added response write-back helper so node operations sync workflow state consistently
- Added selected-node runtime status
- Added selected-node latest output snapshot panel
- Added storyboard confirm flow using `workflowConfirmStoryboard`
- Fixed payload names for:
  - `workflowGenerateSceneVoice`
  - `workflowGenerateMusic`
  - `workflowGenerateSceneVideo`
  - `workflowRenderVideo`
- Kept `/workflow` unchanged as fallback

### Current node status
- Prompt: connected
- Script: connected
- Storyboard: connected
- Scene Assets: connected
- Render Still: connected
- Scene Voice: connected
- Music: connected
- Scene Video: connected
- Final Render: connected
- Background Removal: not yet migrated

## Acceptance Plan

### Round 1
- Prompt
- Script
- Storyboard
- Scene Assets

### Round 2
- Render Still
- Scene Voice
- Scene Video

### Round 3
- Music
- Final Render
- workflow restore / refresh / debug

## Remaining Mainline Work
- Add missing upload-side controls still present in `/workflow` but not fully migrated into `/workflow-nodes`
- Add any missing scene-level actions needed for production parity
- Run full build and smoke validation once Node tooling is available
- Prepare final acceptance pass
- Push to GitHub
- Deploy to Fly

## Environment Constraint Found
- This machine session currently does not expose `node`, `npm`, or `pnpm` in `PATH`
- Because of that, build validation could not be executed inside this session
- Required later:
  - `npm run build` or `pnpm build`

## Supporting Track Direction
- Rename product from `爆款分析師` to `創作商業成長營`
- Use [docs/agent-creator-growth-camp.md](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/docs/agent-creator-growth-camp.md) as the implementation brief
- Keep work isolated from shared workflow contracts

## Recommended Next Step
1. Continue mainline on `/workflow-nodes`
2. Let supporting agent work on `創作商業成長營`
3. Review Round 1 workflow-node acceptance
4. Finish migration rounds
5. Push GitHub and deploy Fly after approval
