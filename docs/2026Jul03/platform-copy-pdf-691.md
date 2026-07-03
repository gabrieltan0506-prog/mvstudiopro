# 平台文案清扫 + 自定义文案 PDF 导出（PR #691）

> **状态**：✅ 已 merge `main`（`cc25cbd`，2026-07-03 ~15:17 UTC+8）

## 交付内容

### 1. 用户可见文案清扫

- 统一 `sanitizePlatformUserMessage()` 过滤 GPT/Gemini/EVOLINK 等内部字眼
- 平台页进度、Debug（用户态）、错误提示改为中性产品表述
- 延续 #689/#690 素材分析合规方向

### 2. 自定义文案 PDF 导出

**入口**：`/platform` → 自定义创作工作台 → 「自定义文案」Tab 旁 **导出 PDF** 按钮

**导出内容**（有则包含）：

- 用户原始粘贴文案
- 深度优化结果与摘要
- 生成的上篇 / 下篇图片或分镜图

**实现**：

- `client/src/lib/customCopyPdfExport.ts` — HTML 组装
- 复用现有 `pdf-worker` / Puppeteer 链路（与平台分析 PDF 同源模式）
- `canExportCustomCopyPdf` 控制按钮可用态

## 关键文件

```
client/src/lib/platformUserFacingCopy.ts
client/src/lib/customCopyPdfExport.ts
client/src/pages/PlatformPage.tsx  （handleExportCustomCopyPdf）
```

## 验收

- [ ] 平台页用户可见区无模型/API 内部名
- [ ] 有文案或生成图时可导出 PDF
- [ ] PDF 含文案 + 优化稿 + 图片（如有）
