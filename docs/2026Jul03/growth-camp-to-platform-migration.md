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

## 实施阶段（建议 2026-07-03 起）

### Phase A — 入口与退役（0.5d）

- [ ] `/creator-growth-camp` 顶部 CTA 改为跳转 `/creator-growth-camp/platform#platform-custom-workspace`
- [ ] 保留 REMIX 子路由或合并到 platform（产品确认）
- [ ] Navbar「创作者成长营」可改为「平台创作」或双入口并存过渡期

### Phase B — 平台页素材上传（1d）

- [ ] 在 `PlatformPage` 自定义工作台增加「上传封面 / 分镜」区（复用 `MVAnalysis` 的 PNG 多选 + GCS 直传）
- [ ] 调用 `growth_analyze_images` Job，debug 面板复用 PR #679 的 imagePipeline
- [ ] **数据源白名单**：Job 输出 + 用户 context + `platformTrend` **live 窗口**（3/7/15 天）；**黑名单**：`growthSnapshot.titleExecutions`、`referenceExamples` 模板串、archived 真值条目

### Phase C — 视觉绑定文案优化（1–2d）

- [ ] 新 mutation：`optimizeCustomCopyWithAssets`（images[] + sourceText + brief）
- [ ] Prompt：system 强制引用 vision 分析 JSON + 用户原文，禁止 unrelated 模板
- [ ] **近期热点注入**：从 trend store / Stage1 样本取 **updatedAt 在窗口内** 的标题/标签/话题，写入 prompt；无 live 数据时明确告知「暂无近期样本，仅基于素材优化」，**禁止** fallback 到旧模板
- [ ] 废弃 `getGrowthSnapshot` 驱动的 titleExecutions / referenceExamples 在**素材分析路径**上的调用

### Phase D — 退役 MVAnalysis 结果 UI（1d）

- [ ] 删除或 feature-flag：`explosiveIndex` 全 0 区块、复读 reference cases、generic platform cards
- [ ] `/creator-growth-camp` 路由 302 → platform（或只留 upload redirect）

### Phase E — 闭环生图（0.5d）

- [ ] 优化结果一键「用此文案生 2×4 / 单页卡片」
- [ ] 积分展示：优化 25 + 生图 60/50 分项合计

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
