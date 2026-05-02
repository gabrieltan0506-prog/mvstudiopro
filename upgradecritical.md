# GodView 战略扉页画廊 · 关键升级说明（upgradecritical）

## 目标

补齐 **GodView 完成后** 的「交互式战略扉页画廊」：从报告 Markdown 的 `##` 章节自动提炼标题与至多 500 字上下文，一键调用 **免积分** 生图路由，生成 STRATEGIC 模式 9:16 扉页；试读水印与整单 `strategicImagesTrialWatermark`（首购尝鲜）严格对齐，避免仅靠正文内嵌图带来的视觉张力不足。

## 后端

### `mvAnalysis.generateGodViewChapterPosters`（`server/routers.ts`）

- **鉴权**：`protectedProcedure`，必须登录。
- **输入**：`jobId` + `chapters[]`，每项含稳定 `id`、`title`、`context?`（最多 24 章）。
- **护栏**：
  - `readJob(jobId)` 且 `userId` 匹配；
  - 仅允许 `completed` / `awaiting_review`；
  - `reportMarkdown` 过短则拒绝（防滥用占用生图算力）。
- **水印**：**不信任**客户端「是否首购」传参；以任务落盘字段 `strategicImagesTrialWatermark` 为准，传入 `generateImageGpt2WithImagenFallback({ mode: "STRATEGIC", isTrial })`。
- **扣费**：**不扣积分**；`totalCost` 恒为 `0`。
- **输出**：`{ ok, totalCost, results: { id, title, url | null }[], isTrial }`；若全部失败则抛错。

### `deepResearch.status` 扩展

- 增加 **`strategicImagesTrialWatermark`**，供前端画廊文案与 `TrialWatermarkImage` 叠加逻辑与后端一致。

## 前端（`client/src/pages/GodViewPage.tsx`）

- **`deepResearch.status` 轮询**：`enabled` 在 `dispatched` 与 **`done`** 下均保持（仍在终态停止 `refetchInterval`），确保完成页能读到 `reportMarkdown` 与新字段。
- **`strategicChapters`**：`useMemo` 扫描 `## `，正文拼至下一段 `##` 前，上下文压到 **500 字**；`id` 为 `h2_${index}` 保证与后端回写一致。
- **状态**：`chapterPosterMap[id] → url`；`pollingJobId` 变化时清空，避免跨任务串图。
- **UI**：完成卡片上方为 **横向滚动画廊** +「一键生成专属战略扉页（免费）」；下方为 **报告正文预览**（原有 `ReportRenderer`）。
- **试读叠图**：已生成缩略图用 **`TrialWatermarkImage`**，当且仅当 `coverTrialWatermark === true`（与任务首购尝鲜一致）；文案引用 `TRIAL_READ_WATERMARK_LINE`（`MVSTUDIOPRO.COM · 试读`），与生图 prompt 常量一致。

## 验收要点

1. 完成一单 GodView 后，首屏下方出现画廊；点击一键生成后卡片逐个出现 9:16 图。
2. 浏览器网络面板：`generateGodViewChapterPosters` 请求成功，无积分扣减相关错误。
3. 首购尝鲜单：生图与水印 overlay 均体现试读水印；非首购单：生图 `isTrial: false` 且前端不叠 `TrialReadWatermarkOverlay`。
4. `npx tsc --noEmit` 通过。

## 依赖能力

- `PROXY_OPENAI_API_KEY`（gpt-image-2）+ 可选 Vertex Imagen 兜底（与 Platform 批量生图同栈）。
