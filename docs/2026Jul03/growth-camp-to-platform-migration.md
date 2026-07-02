# 成长营全页分析 → 平台页迁移计划（2026-07-03）

## 背景与问题（用户反馈 2026-07-02）

用户上传 **封面 PNG + 2×4 分镜 PNG**（苏轼×哈佛医学博士×心理健康主题），在 `/creator-growth-camp` 选择「完整商业分析」并填写详细背景，期望得到**针对素材的优化建议**。

实际输出：

- 爆款指数全 0、战略点评为空模板
- 标题建议变成「京剧黑暗独奏队」「7 连跪剪成艺术」等**与素材完全无关**的内容
- 参考案例、话题库、平台推荐全是**同一段套话**重复粘贴
- 未读取封面/分镜视觉信息，仅把用户 prompt 里的字面句 echo 回「话题库」

**根因（技术）**：

1. `MVAnalysis.tsx` 主路径在图片分析完成后，仍 merge **growth snapshot / 趋势真值 / 模板化 titleExecutions**，与 vision 分析结果弱绑定。
2. Stage 输出依赖 `getGrowthSnapshot`、平台热词库等**与用户素材脱钩**的静态模板。
3. 平台页 `/creator-growth-camp/platform` 已有 **自定义文案 → 单页卡片 / 2×4 分镜** 生图能力，但**缺少「先优化文案再出图」**的闭环；成长营页与生图能力分裂。

**产品决策**：`/creator-growth-camp` 的「 grandmother 时代」全页分析 **退役**；能力迁到 **平台页**，以「上传素材 → 视觉理解 → 文案优化 → 可选生图」为主链路。

### ⚠️ 迁移硬性约束（用户 2026-07-03 明确要求）

**上传图片分析时，禁止读取旧套话模板与过期趋势数据。**

| 禁止 | 改用 |
|------|------|
| `getGrowthSnapshot` / 真值库里 **3 个月前** 的静态模板 | **不调用**；或仅作 debug 对照 |
| `titleExecutions` / `referenceExamples` 整段复读套话（「这条内容能跳起来…」） | **删除**该路径 |
| 平台热词「40 分」泛化标签、与素材无关的爆款选题 seed | **实时/近期**趋势：平台页已有 live 样本、Fly 抓取窗口、`readTrendStore` **最近 N 天**（默认 7–15 天，可配置） |
| 与用户上传图无关的 generic platform cards | 仅输出：**vision 分析 JSON + 用户 brief + 近期可参考热门话题**（须标注来源窗口与平台） |

**原则**：分析结果必须 **(1) 绑定上传封面/分镜视觉** + **(2) 引用可验证的近期热点**；二者缺一不得当作「商业分析」展示给用户。

---

## 目标态（平台页 `/creator-growth-camp/platform`）

### Hero · 自定义创作工作台

| 生成类型 | 能力 | 积分（已定） |
|---------|------|-------------|
| 单页图文卡片 | 上篇+下篇 GPT-Image-2 | 50（25×2） |
| 2×4 分镜图 | 宽幅分镜单张 | 60 |
| **优化自定义文案**（新增） | GPT-5.5 深度改写，不出图 | **25/次** |

「优化自定义文案」定价依据：

- 纯 LLM（无出图），成本低于分镜 60 / 卡片 50
- 深度高于趋势续问 18 cr、决策智库重新生成 20 cr
- 与单页卡片 **单篇 25 cr** 对齐，便于用户理解「先优化 25 → 再出图 50/60」

### 待迁移能力（原成长营页）

1. **封面 + 分镜 PNG 上传**（成长营已有 GCS 直传 + `growth_analyze_images` Job）
2. **视觉绑定分析**：Job 输出必须 feed 进文案优化 prompt，禁止走 generic snapshot 模板
3. **结果区**：只展示与上传素材相关的标题/钩子/分镜改法/平台适配；**删除**全站套话区块（参考案例复读、热词 40 分模板等）
4. **可选一键**：优化结果 → 填入「自定义文案」→ 生 2×4 或单页卡片

---

## 工期承诺（用户 2026-07-03）

**2 个自然日全部完工**（非重写，接线 + 删错路径 + 验收）。

| 日 | 交付 |
|----|------|
| **D1** | Platform 上传封面/分镜 → `growth_analyze_images` Job → `optimizeCustomCopyWithAssets`（vision + **live 趋势**）→ 新结果 UI（无套话区块） |
| **D2** | 成长营页跳转 platform、旧结果区下线、优化稿一键生 2×4/单页卡片、线上用你的封面+分镜验收 |

---

## 数据怎么读（勿猜 · 已有稳定采集）

**Debug 面板所见 = 正式应接的数据源**（`MVAnalysis` 开 Debug → `getGrowthSystemStatus` + `getGrowthSnapshot` debug 块）。

| Debug 展示项 | 后端入口 | 迁移用法 |
|-------------|---------|---------|
| 真值口径 / 当前总量 / 各平台 items | `readTrendStore({ preferDerivedFiles: true })` · `truthStore.platforms` | 取 **collections[platform].items** 近期样本 |
| 运行模式 / burst / scheduler | `readGrowthRuntimeControl` · `readTrendSchedulerState` | 仅 debug；分析 prompt 不依赖 |
| backfillLive / backfillHistory | `getGrowthSystemStatus` 返回体 | 区分 live vs 历史；**prompt 只用 live 窗口内 items** |
| 快照路由 / hasAnyLiveCollection / windowDays | `getGrowthSnapshot` 的 `debug` 字段 | 对照用；**新路径禁止走 mock** |

开发历程文档：`downloads/2026Jun27/`、`downloads/2026Jul02/`、`docs/growth-data-warehouse.md`（`readTrendStore` / `readTrendStoreForPlatforms` / `pnpm run rebuild:growth-store`）。

### 套话根因（一行）

成长营图片分析完成后调用 `getGrowthSnapshot`（**未**设 `interactivePlatform: true`）→ store 超时或空时 **`buildMockGrowthSnapshot` + `personalizeGrowthSnapshot`** → 模板标题/复读参考案例。**迁移时此路径对素材分析永久禁用。**

### 新路径数据白名单（复制即用）

```ts
// 与 platform 页 Stage1 / getGrowthSnapshot(interactivePlatform:true) 同源
readTrendStoreForPlatforms(["douyin","xiaohongshu","bilibili","kuaishou"], {
  preferDerivedFiles: true,
  preferFlyLive: true,
});
// windowDays: 7（默认）或 15；只取 collectedAt 在窗口内的 items 标题/标签进 prompt
// 无 live items → 文案写「暂无近期样本，仅基于上传素材优化」— 禁止 fallback mock
```

---

## 实施阶段（2 日压缩版）

### D1 上午 — 上传 + Job（复用，~3h）

- [x] `PlatformPage` 自定义工作台：**素材分析** Tab — PNG 多选 + GCS + `growth_analyze_images`（`client/src/lib/growthCampImagePipeline.ts` + `PlatformAssetAnalysisPanel`）
- [x] Debug 条：`imagePipeline` + `getGrowthSystemStatus`（supervisor/admin + Debug On）
- [x] **不调用** `getGrowthSnapshot`（平台素材路径）

**分支（待你开 PR）**：`feat/migrate-platform-image-upload-d1a`

### D1 下午 — 优化 mutation + 热点（~4h）

- [ ] `optimizeCustomCopyWithAssets`：vision JSON + user brief + **`readTrendStoreForPlatforms` 7d 样本摘要**
- [ ] **删除**对 `getGrowthSnapshot` / `buildMockGrowthSnapshot` / `personalizeGrowthSnapshot` 的调用（素材路径）
- [ ] 结果 UI：仅展示优化稿 + 可选近期热点引用（带来源平台+标题）

### D2 上午 — 退役 + 跳转（~3h）

- [ ] `/creator-growth-camp` → redirect `#platform-custom-workspace`（或顶栏 CTA）
- [ ] `MVAnalysis` 结果区套话区块 feature-off（referenceExamples 复读、titleExecutions 模板、全 0 指数）

### D2 下午 — 闭环 + 验收（~3h）

- [ ] 优化结果 → 一键填入「自定义文案」→ 生 2×4 / 单页卡片
- [ ] 积分：优化 25 + 生图 60/50 分项展示
- [ ] 验收：苏轼封面+分镜素材；Debug 对照 live 样本数 > 0

---

## 实施阶段（原 5 日版 · 已作废）

<details>
<summary>旧排期（勿用）</summary>

Phase A–E 合计 4–6 日 — 用户要求 2 日内完工，以上 D1/D2 为准。

</details>

---

## 已完成

- PR #680（本 PR）：`platformOptimizeCustomCopy` = **25 积分/次**；平台页 Hero 第三选项「优化自定义文案」
- PR #679（并行）：成长营 Debug 图片链路、视频/图片条件展示

---

## 验收标准

1. 上传用户同款封面+分镜，优化结果必须出现：苏轼、东坡肉、荔枝、哈佛医学博士、抑郁/心脑血管等**素材内元素**，不得出现电竞/京剧等 hallucination。
2. 不再出现「这条内容能跳起来，是因为它把…」整段复读 ≥2 次。
3. **不得**引用 3 个月前 archived 模板或 growth snapshot 套话；热点引用须来自 **近期 live/backfill 窗口** 或明确标注「无近期数据」。
4. 用户可在 platform 页完成：**优化（25 cr）→ 生分镜（60 cr）** 无需回到 `/creator-growth-camp`。

---

## 关联文件

| 文件 | 说明 |
|------|------|
| `client/src/pages/MVAnalysis.tsx` | 待退役/精简 |
| `client/src/pages/PlatformPage.tsx` | 迁移目标 + 已加 optimize 选项 |
| `server/services/platformOptimizeCustomCopy.ts` | 深度优化 LLM |
| `server/jobs/runner.ts` | `growth_analyze_images` |
| `shared/plans.ts` | `platformOptimizeCustomCopy: 25` |
