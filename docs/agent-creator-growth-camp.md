# Agent Task - Creator Growth Camp

## Mission
Build the MVP and support structure for `创作商业成長營 / Creator Growth Camp`, replacing the old `viral / analysis` positioning with a business-growth product direction.

## Deadline
- MVP target: 2 days
- Full first version target: 5-6 days

## Product Position
This is not just “viral score”.
It is a creator business growth system with these pillars:
- 视频分析
- 近 30 天平台趋势资料
- 热门内容结构数据库
- 商业模式推荐引擎
- 自动增长策略生成
- AI 创作辅助联动
- 推荐发布平台

## Source Of Truth
- Current analysis page:
  [client/src/pages/MVAnalysis.tsx](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/client/src/pages/MVAnalysis.tsx)
- Current submission flow:
  [client/src/pages/VideoSubmit.tsx](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/client/src/pages/VideoSubmit.tsx)
- Existing backend analysis:
  [server/routers.ts](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/server/routers.ts)
  [server/routers/videoSubmission.ts](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/server/routers/videoSubmission.ts)
  [server/videoAnalysis.ts](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/server/videoAnalysis.ts)

## Product Reference
Primary docs already provided by user and interpreted by mainline agent:
- 商业创作营完整方案
- 商业创作营架构说明
- 最终版白皮书

Use those as the product framing, but do not wait for more clarification.

## What You Should Build

### MVP Scope
Make a usable first version with these report sections:
- 内容分析
- 趋势洞察
- 商业洞察
- 增长规划
- 推荐发布平台

### Practical MVP Rule
Reuse current analysis capability wherever possible.
Do not block on having a perfect trend database before building the product shell.

## Required UI Outcome
The page should look like a distinct product, not just a renamed score page.

It should have:
- a clear hero / intro section
- input area
- result report sections
- strong recommendation cards
- platform recommendation block
- growth-plan block

## Existing Capability You Can Reuse
- `analysis.platforms` already exists in [client/src/pages/MVAnalysis.tsx](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/client/src/pages/MVAnalysis.tsx)
- `VideoSubmit` already handles platform-linked submission ideas
- backend already computes video/visual quality analysis and scoring-related result shapes

## Near-term Data Direction
Trend data collection starts tomorrow.

For now, prepare the product structure so it can accept:
- 30-day platform snapshots
- hot topic records
- content pattern records

If needed, define placeholder result sections with clear TODO hooks for incoming data.

## Non-goals For MVP
Do not block on:
- perfect crawler completeness
- full historical trend warehouse
- final automation layer
- full AI business consultant system

## Suggested Deliverables

### Deliverable A
Rename and reposition the analysis product to `创作商业成長營`.

### Deliverable B
Create a report layout with sections for:
- 内容结构分析
- 商业潜力判断
- 推荐发布平台
- 7 天增长规划

### Deliverable C
Prepare expansion points for:
- 平台趋势资料
- 热门内容结构数据库
- 商业模式推荐引擎
- AI 创作辅助联动

## Suggested Files To Touch
- [client/src/pages/MVAnalysis.tsx](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/client/src/pages/MVAnalysis.tsx)
- [client/src/pages/VideoSubmit.tsx](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/client/src/pages/VideoSubmit.tsx)
- [client/src/App.tsx](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/client/src/App.tsx)
- any extracted components under:
  [client/src/components](/Users/tangenjie/Downloads/Clone%20github/mvstudiopro/client/src/components)

## Recommended Implementation Strategy
1. Reframe current page copy and sections
2. Keep current backend result shape compatible
3. Add richer section rendering instead of waiting for new backend
4. Make recommended publishing platform much more prominent
5. Add visible placeholders or structured panels for upcoming trend data

## Acceptance Criteria
- Product naming and page framing reflect `创作商业成長營`
- Result page is organized as a business-growth report
- Recommended publishing platform is visible and meaningful
- `npm run build` passes

## Command To Validate
```bash
cd /Users/tangenjie/Downloads/Clone\ github/mvstudiopro
npm run build
```
