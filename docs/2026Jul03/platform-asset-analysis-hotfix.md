# 平台页 · 素材分析热修记录（2026-07-03 凌晨）

## 背景

用户于 `/platform` → **自定义创作工作台 → 素材分析** Tab 上传 2 张 PNG（封面 + 2×4 分镜），消耗 **80 积分**（40×2），却得到仅数行的泛化文案，且页面出现内部实现措辞（「成长营套话快照」「GPT-5.5」等），存在投诉与合规风险。

## 根因

1. **静默占位 fallback**：`server/growth/analyzeGrowthCampImages.ts` 在 LLM/GCS/校验任一步失败时，`catch` 后返回 `buildFallbackImageAnalysis()` 固定模板（「已接收 N 张图片…保守增长判断」），Job 仍标记成功并**照扣积分**。
2. **用户可见文案泄漏**：`PlatformAssetAnalysisPanel` 说明区、分析进度、Debug 区暴露 GPT-5.5、备用路径、主路径失败原因等后台信息。
3. **结果 UI 过薄**：即使 LLM 成功，面板只渲染 `summary` / `strengths` / `improvements`，未展示 `reverseEngineering`、`premiumContent.actionableTopics`、`remixExecution.imageTextNoteGuide` 等完整字段。
4. **图片传输方式不当（中期改动）**：曾改为服端读 GCS 再 **base64** 塞进 Evolink 请求体，体积膨胀约 33%，且不必要。

## 交付分支与 PR

- **分支**：`fix/platform-asset-analysis-user-copy`
- **PR**：[ #689 ](https://github.com/gabrieltan0506-prog/mvstudiopro/pull/689) → `main`
- **状态（文档撰写时）**：已 push，待 merge / 部署

### 提交序列（相对 `main`）

| Commit | 摘要 |
|--------|------|
| `ecc8edc` | 移除「成长营套话快照」等用户可见内部措辞；信号轮播副标题去「非顾问套话」 |
| `30d32ca` | 分析进度文案去掉 GPT-5.5 |
| `7e0f902` | 删除静默占位 fallback；扩充结果区展示 |
| `95b1488` | 主模型失败时 fallback 至 **Gemini 3.5 Flash**（Vertex，完整 strategist 分析） |
| `b461ecc` | 前端错误与 Debug 区过滤模型名 / fallback 细节 |
| `140f726` | 图片改 GCS 签名 HTTPS / `gs://` 直传，不再 base64 塞请求体 |

---

## 实现要点

### 1. 文案与合规（前端）

**文件**：`client/src/components/platform/PlatformAssetAnalysisPanel.tsx`、`client/src/pages/PlatformPage.tsx`

- 说明改为中性产品表述：「系统将根据您的图片与业务背景生成视觉分析与策略建议」，保留按张积分说明。
- 进度提示：「正在分析您的素材，约需 30–90 秒…」
- `sanitizeAssetAnalysisUserMessage()`：用户可见错误若含 GPT/Gemini/EVOLINK/主备路径等关键字，统一为「图片分析暂时不可用，请稍后重试」。
- Debug 区（仅 `debugMode`）：去掉 Provider / Model / 备用路径 / `primaryError` 展示。

**文件**：`client/src/lib/growthCampImagePipeline.ts`

- `GROWTH_CAMP_IMAGE_PIPELINE_DEBUG_NOTE` 改为不含模型名的管道描述。

### 2. 分析链路（后端）

**文件**：`server/growth/analyzeGrowthCampImages.ts`

| 阶段 | 行为 |
|------|------|
| 主路径 | `gpt-5.5` @ Evolink，`runGrowthCampStrategistForImages` 完整 JSON strategist 输出 |
| 主路径失败 | 自动重试 **Gemini 3.5 Flash** @ Vertex（`resolveGrowthCampExtractScanEngine`） |
| 两路均失败 | `throw` → Job 失败 → **退积分**（`runner.ts` 已有 `refundCredits`） |
| 占位模板 | **已删除** `buildFallbackImageAnalysis` |

**图片引用（不再 base64）**：

| 引擎 | 传参方式 |
|------|----------|
| Evolink / GPT-5.5 | `image_url.url` = GCS **V4 签名 HTTPS 直链**（1h），上游自行拉取 |
| Vertex / Gemini fallback | `image_url.url` = **`gs://bucket/object`**，Vertex `fileData.fileUri` 直读 GCS |

**文件**：`server/_core/llm.ts` — `contentPartToGeminiPart` 对 `image_url` 中的 `gs://` 走 `fileData`，不经服端 download→base64。

**文件**：`server/growth/growthCampStrategistPass.ts`

- `runGrowthCampStrategistForImages` 新增可选 `strategistEngine` 覆写。
- `growthAnalysisScoresSchema.safeParse` 失败时抛出可读校验错误（不再被外层吞掉）。

**文件**：`server/jobs/runner.ts`

- 移除「`fallback === true` 即失败」逻辑（Gemini 备用成功时 `fallback: true` 但结果为真分析）。
- Job `debug` 仍含 `fallback` / `primaryError` 供运维日志，**不向前端用户展示**。

### 3. 结果 UI 扩充

**文件**：`client/src/components/platform/PlatformAssetAnalysisPanel.tsx`

新增展示（有则显示）：

- 构图 / 色彩 / 冲击 / 传播 分数条
- `realityCheck`（现实查验）
- `reverseEngineering`（抓眼策略、浏览情绪曲线、商业承接）
- `premiumContent.actionableTopics`（可执行选题）
- `remixExecution.imageTextNoteGuide`（图文笔记改法）

### 4. 计费（沿用 #687 已 merge 逻辑）

- 每张 **40 积分**（`CREDIT_COSTS.growthCampGrowth`）
- `flatImageAnalysisCost(growthMode, images.length)` 按张合计
- UI：`platformAssetAnalysisTotalCredits(readyAssetCount)`

---

## 本地验证（2026-07-03）

| 项 | 结果 |
|----|------|
| GCS 上传 2 张 + 签名读回 | ✅ HTTP 200，字节一致 |
| 无 `EVOLINK_API_KEY` 时主路径 | ✅ 抛错，**不再**返回占位模板 |
| Fly 未登录 | 未能做生产 Evolink 端到端烟测 |
| 用户截图文案 | 与已删 `buildFallbackImageAnalysis` **逐字吻合**，确认为 fallback 非真分析 |

---

## 部署后验收清单

- [ ] `/platform` → 素材分析：说明区无「套话」「快照」「GPT-5.5」「Gemini」等字样
- [ ] 上传 2 张图分析：结果为具体视觉/选题内容，非「保守增长判断」模板句
- [ ] 主路径失败时：用户仍看到完整分析（Gemini 备用）或明确失败提示 + **积分退回**
- [ ] 失败提示不含模型名 / API 名
- [ ] 按张积分显示与扣费正确（2 张 = 80 积分）

---

## 关联文档

- 迁移总计划：[`growth-camp-to-platform-migration.md`](./growth-camp-to-platform-migration.md)
- 预览与按张计费（#687，已 merge）：横版分镜 `object-contain`、张数不限

## 后续（用户休息后再议）

- Merge **#689** 并线上复测 2 张真实素材
- 若 Evolink 拉取 GCS 签名 URL 仍失败：查 Evolink 侧 egress / 签名桶权限（服端已不再 base64）
- Canvas / 平台 PR-B～E 迁移项未在本热修范围
