# 平台页成长营迁移 · 最终版（PR #694）

> **状态**：✅ 已 merge `main`（`960575a`，2026-07-03 21:14 UTC+8）

## 产品标准（用户 2026-07-03 明确要求）

1. **全部** creator-growth-camp 能力迁到 **`/platform`**（不是 `/creator-growth-camp/platform`）
2. 每一步用**两句话**说明，不要长文
3. **同页完成**，不跳新页、不强制切 Tab
4. 自定义工作台 **busy 时**，下方平台全案分析区 **自动隐藏**
5. 版面简洁、审美统一

## 路由

| 路径 | 行为 |
|------|------|
| `/platform` | 平台页 + 自定义创作工作台（正式入口） |
| `/creator-growth-camp` | `GrowthCampRedirect` → `/platform`（支持 `?tab=assets` 等） |
| `/creator-growth-camp/platform` | 同上 redirect |
| `/creator-growth-camp/legacy` | 旧版成长营页（调试/legacy） |
| `/analysis`、`/viral` | redirect → `/platform` |

**Query 参数**：`?tab=copy|topic|assets|matting` 打开对应工作台 Tab。

## 自定义创作工作台 · 四 Tab 结构

| Tab | 步骤卡片 | 核心能力 |
|-----|----------|----------|
| 自定义文案 | ① 粘贴文案 → ② 生成结果 | 单页图文卡片 / 2×4 分镜 / 深度优化；优化后可同 Tab 生图 |
| 自定义选题 | ① 填写设定 → ② 上传人像 → ③ 一键生成 | 文案+封面+分镜，主人公融合 |
| 素材分析 | ① 上传分析 → ② 深度优化 → ③ 生成图片 | 成长营图片 pipeline 全链路 |
| 自定义抠像 | ① 描述场景 → ② 生成下载 | 按描述生人物/场景，可选去背景 |

组件：`client/src/components/platform/PlatformWorkspaceStepHint.tsx`

## 素材分析 Tab（成长营核心迁移）

**文件**：`PlatformAssetAnalysisPanel.tsx` + `PlatformPage.tsx` handlers

### 流程（同 Tab，不跳页）

```
上传 PNG/JPG（可多张）
  → growth_analyze_images Job（40 积分/张）
  → 展示视觉分析 JSON 结果
  → 步骤 2：深度优化（platformOptimizeCustomCopy + visionContext + live 7d 趋势）
  → 步骤 3：用优化稿生 2×4 分镜（60 cr）或单页图文卡片（50 cr）
  → 生成图预览在本 Tab 下方
```

### 后端（#693 保留，#694 继续用）

| 模块 | 说明 |
|------|------|
| `server/services/platformLiveTrendBrief.ts` | trendStore 近 7 天 live 热点摘要 |
| `server/services/platformOptimizeCustomCopy.ts` | `visionContext`、`includeLiveTrends` |
| `client/src/lib/platformAssetAnalysisHandoff.ts` | 分析结果 → 优化 payload 格式化 |
| `client/src/lib/growthCampImagePipeline.ts` | GCS 上传 + Job 派发 |

### busy 态与版面

```ts
const customWorkspaceOperating =
  customNoteBusy || customTopicBusy || customMattingBusy || assetAnalysisBusy;
```

- `assetAnalysisBusy` 由 `PlatformAssetAnalysisPanel.onBusyChange` 上报
- `customWorkspaceOperating === true` 时：
  - 显示一行提示：「自定义创作进行中，下方全案分析区已收起…」
  - `#7019` 以下「平台顾问台 / 全案分析」整块 `hidden`

## 全站入口更新（#694）

| 文件 | 改动 |
|------|------|
| `HomeNavbar.tsx` | `/platform` |
| `HomeHero.tsx` | `/platform` |
| `HomeFeatureCarousel.tsx` | `/platform` |
| `MVAnalysis.tsx` | `/platform`、`/platform?tab=assets` |
| `MyReportsPage.tsx` | `/platform?reportId=...` |

## 关键前端文件

```
client/src/pages/PlatformPage.tsx
client/src/pages/GrowthCampRedirect.tsx
client/src/components/platform/PlatformAssetAnalysisPanel.tsx
client/src/components/platform/PlatformWorkspaceStepHint.tsx
client/src/App.tsx
```

## 验收清单

- [ ] 旧 URL 全部落到 `/platform`
- [ ] 素材分析：上传 → 分析 → 优化 → 生图，无 Tab 切换
- [ ] 四 Tab 均有步骤卡片（每步两行）
- [ ] 生成中下方全案区隐藏
- [ ] 分析/优化不引用 mock snapshot 套话（见 migration 文档数据白名单）
