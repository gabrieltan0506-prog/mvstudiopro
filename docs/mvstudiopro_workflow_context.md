# MVStudioPro Workflow Context

## Workflow Pipeline
Prompt → Script (Gemini 2.5 Pro) → Storyboard → Storyboard Images (Nano Banana 2 / fal) → Character Lock → Video (Veo 3.1 reference-to-video / Kling fallback) → Music (Suno) → Voice (OpenAI TTS) → Render → Final Video

## Router
server/router/modelRouter.ts

## Workflow Engine
server/workflow/
 ├ engine.ts
 ├ store/workflowStore.ts
 ├ types/workflow.ts
 └ steps/
    ├ scriptStep.ts
    ├ storyboardStep.ts
    ├ storyboardImagesStep.ts
    ├ videoStep.ts
    └ renderStep.ts

## APIs
/api/jobs
/api/workflow-status
/api/google
/api/blob-put-image

## Models
Gemini 2.5 Pro → script
Fal nano-banana-2 → storyboard images
Veo 3.1 reference-to-video → video
Suno → music
OpenAI TTS → voice

## UI Pages
/workflow
/client/src/pages/WorkflowStoryboardToVideo.tsx

## Branch
codex/974b-workflow-engine
