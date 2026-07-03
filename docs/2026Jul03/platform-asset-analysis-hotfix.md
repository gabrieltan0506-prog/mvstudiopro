# 平台页 · 素材分析热修记录（2026-07-03）

> 完整技术细节见仓库 `docs/2026Jul03/platform-asset-analysis-hotfix.md`。本文件为 downloads 目录摘要。

## 问题

用户上传 2 张 PNG 消耗 80 积分，却得到泛化占位文案，且页面出现「成长营套话快照」「GPT-5.5」等内部措辞。

## 根因

1. `analyzeGrowthCampImages.ts` 失败时静默返回 `buildFallbackImageAnalysis()` 占位模板并仍扣积分
2. 前端说明/Debug 泄漏模型名与备用路径
3. 结果 UI 未展示完整 strategist JSON 字段

## 修复（#689 / #690，Jul 2–3 merge）

- 删除静默占位 fallback；主备均失败 → Job 失败 + **退积分**
- 主路径 GPT-5.5 @ Evolink；失败 fallback Gemini @ Vertex
- 图片改 GCS 签名 URL / `gs://`，不再 base64 塞请求体
- 前端 `sanitizePlatformUserMessage` + 扩充结果区展示
- 每张 40 积分（`platformAssetAnalysisTotalCredits`）

## 与 #694 关系

热修保证「分析结果是真分析」；#694 保证「分析→优化→生图同 Tab 闭环」与版面体验。二者叠加为现行素材分析链路。

## 部署后验收

- [ ] 说明区无套话/模型名字样
- [ ] 2 张图分析为具体视觉内容，非「保守增长判断」模板
- [ ] 失败时积分退回
