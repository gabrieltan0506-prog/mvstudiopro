# P0 Growth Camp Failure Report - 2026-03-17

## Severity

- Level: `P0`
- Status: `Open`
- Scope: `Growth Camp analysis engine`, `video analysis pipeline`, `frontend reporting`, `Douyin creator-index ingestion`

## Executive Summary

Growth Camp is currently failing its core product promise. For multiple user scenarios, the system is still returning repetitive, template-driven advice that is materially worse than direct Gemini usage. This is not a cosmetic issue. It is a product-level failure affecting recommendation credibility, conversion, and willingness to pay.

The largest current failure is not model capability. The failure is that the system is still collapsing user prompt, uploaded video evidence, frame-level weaknesses, platform data, and business scenario into generic fallback language. This causes wrong paths such as `知识付费` or `社群会员` to appear in obviously unrelated contexts, while missing concrete, timestamped, executable guidance.

## User-Visible Failure Symptoms

### 1. Generic recommendations override user scenario

- Outdoor sports and food blogger scenarios still receive generic commercialization tracks.
- Sports gear / outdoor content scenarios still surface language such as `知识付费` and `社群会员`.
- Business recommendations are not tied tightly enough to uploaded video content, creator identity, and stated monetization goal.

### 2. Output is worse than direct Gemini usage

- Gemini is already producing:
  - visual motif extraction
  - scene-to-business bridging
  - brand fit
  - concrete crossover use cases
  - Veo prompts
  - transition ideas
  - next-step prompt offers
- Growth Camp is still producing:
  - template cards
  - repeated platform rhetoric
  - abstract funnel labels
  - vague commercialization guidance

### 3. Video analysis pipeline is underpowered for the current product goal

- Current frame extraction still uses a fixed small frame count strategy instead of a `3-second cadence`.
- Weak frames are dropped from downstream synthesis, reducing user-facing optimization value.
- Output does not consistently provide `exact-second` optimization suggestions.
- Bad frames are not surfaced as actionable evidence for revision.

### 4. Frontend still exposes low-value or generic constructs

- Multiple cards still read like internal templates rather than user-ready advice.
- Sections remain too abstract and not sufficiently tied to the uploaded asset.
- Generic multi-day plans still appear across different scenarios.
- The report still lacks system-value layers such as:
  - AI asset extension plan
  - Veo / generative execution prompts
  - shot-level extension strategy
  - second-pass creative conversion hooks

### 5. Douyin creator-index page capture is too noisy

- Page-state fallback currently stores raw text snippets in notes.
- This pollutes trend notes with page noise instead of structured fields.
- Structured extraction exists only partially; page data is not yet normalized tightly enough for Growth Camp use.

## Concrete Evidence

### User-reported unacceptable examples

- Outdoor sports and food blogger scenario returning `知识付费` / `社群会员`.
- Growth Camp cards still reading like:
  - generic monetization tracks
  - generic platform matrix rhetoric
  - generic 7-day plan
- Gemini comparison shows higher product value by supplying:
  - timestamped interpretation
  - cross-domain commercialization mapping
  - creative transition logic
  - Veo prompt suggestions
  - technical execution framing

## Root Cause Assessment

### Root Cause A: Growth synthesis is still template-first

Current Growth Camp synthesis is still driven by reusable commercialization tracks and generic card builders. User context and video evidence influence wording, but do not sufficiently dominate the final output.

Primary affected areas:

- `buildBusinessInsights(...)`
- `buildDashboardConsole(...)`
- `buildGrowthPlan(...)`
- `buildCreationAssist(...)`

### Root Cause B: Video evidence is not being exploited deeply enough

- Fixed frame-count sampling is too sparse for a product that claims fine-grained optimization.
- Weak-frame evidence is currently demoted or removed from synthesis.
- Timestamped creative repair suggestions are not first-class output.

### Root Cause C: Frontend rendering still assumes summary cards instead of decision support

- The UI is organized, but still renders too much generic summary language.
- It does not yet force every major section to answer:
  - what in this uploaded video is working
  - what is failing
  - where it fails
  - how to fix it
  - what AI-generated extension assets to create next

### Root Cause D: Douyin creator-index ingestion is half-finished

- Interfaces for keyword, topic, video, author, and brand have been found.
- Page-state fallback exists.
- But page-capture output is still too noisy and not reduced to high-signal structured records.

## Affected Files

- [/Users/tangenjie/.codex/worktrees/974b/mvstudiopro/server/videoAnalysis.ts](/Users/tangenjie/.codex/worktrees/974b/mvstudiopro/server/videoAnalysis.ts)
- [/Users/tangenjie/.codex/worktrees/974b/mvstudiopro/server/growth/analyzeVideo.ts](/Users/tangenjie/.codex/worktrees/974b/mvstudiopro/server/growth/analyzeVideo.ts)
- [/Users/tangenjie/.codex/worktrees/974b/mvstudiopro/server/growth/growthSchema.ts](/Users/tangenjie/.codex/worktrees/974b/mvstudiopro/server/growth/growthSchema.ts)
- [/Users/tangenjie/.codex/worktrees/974b/mvstudiopro/server/growth/trendCollector.ts](/Users/tangenjie/.codex/worktrees/974b/mvstudiopro/server/growth/trendCollector.ts)
- [/Users/tangenjie/.codex/worktrees/974b/mvstudiopro/client/src/pages/MVAnalysis.tsx](/Users/tangenjie/.codex/worktrees/974b/mvstudiopro/client/src/pages/MVAnalysis.tsx)

## Required Remediation Order

### Priority 1

- Replace fixed frame count with `3-second cadence` extraction using ceiling:
  - `180s -> 60`
  - `60s -> 20`
  - `32s -> 11`
- Stop hiding weak frames from user-facing output.
- Add exact-second optimization suggestions.

### Priority 2

- Remove generic commercial tracks for non-matching contexts.
- Rewrite business synthesis to bind:
  - user prompt
  - uploaded video content
  - frame-level evidence
  - platform evidence
  - business objective

### Priority 3

- Add `AI资产延展方案`.
- Add `Veo / 生成式视频可执行输出`.
- Add shot-level or scene-level extension prompts.
- Add transition recommendations and repurposing logic.

### Priority 4

- Replace raw Douyin page text capture with structured extraction only.
- Keep page fallback, but store metrics and normalized entities instead of text blobs.

### Priority 5

- Refactor frontend sections so each block answers a concrete decision question.
- Reduce repeated template rhetoric and remove internal-only abstractions from user-facing cards.

## Acceptance Criteria

The issue is not resolved until all of the following are true:

- A sports / outdoor / food creator no longer receives `知识付费` or unrelated generic tracks.
- Growth Camp returns concrete timestamped improvement suggestions.
- Weak frames are visible to the user as optimization evidence.
- Output includes AI asset extension plans and Veo-ready prompts.
- Output demonstrates at least `2-3` system-value layers beyond direct Gemini usage.
- Douyin creator-index page fallback stores structured data, not noisy text snippets.

## Immediate Next Actions

1. Rewrite frame extraction and frame evidence handling.
2. Rewrite Growth Camp business synthesis to be scenario-locked.
3. Add AI asset extension outputs and Veo execution blocks.
4. Replace Douyin page snippet notes with structured extraction.
5. Re-run typecheck and build after code changes.

## Ownership

- Owner: `Codex`
- Requested by: `tangenjie`
- Target: restore Growth Camp to first-stage acceptance quality
