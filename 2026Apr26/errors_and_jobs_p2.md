# Errors and Jobs — 2026 Apr 26 (Part 2)

## 本次工作摘要

---

### 🎤 語音輸入功能重寫（MediaRecorder + GCP Speech-to-Text）

**問題根源**：原先使用 Web Speech API，只會請求麥克風權限但不轉文字，且在非 HTTPS 環境下完全無效。

**修復方案**：
- 前端改用 `MediaRecorder` 錄製音頻，錄完後送至後端
- 後端接 Google Cloud Speech-to-Text API 進行轉錄
- 新增 `api/speech-to-text.ts`（Vercel 格式，後被廢棄）
- 最終改為 Express 路由 `server/routers/speechApi.ts`

| 檔案 | 變更 |
|------|------|
| `client/src/components/VoiceInputButton.tsx` | 完全重寫，改用 `MediaRecorder` + Busboy multipart 上傳 |
| `server/routers/speechApi.ts` | 新增 Express 路由，使用 `GOOGLE_APPLICATION_CREDENTIALS_JSON` 初始化 GCP |
| `server/_core/index.ts` | 注冊 `registerSpeechApiRoutes`（修正：原先錯誤注冊到未使用的 app.ts） |
| `api/speech-to-text.ts` | 建立但因 Fly.io 不支援 Vercel 格式而無效，保留備用 |

**環境變數**（Fly.io 已設置）：
- `GOOGLE_APPLICATION_CREDENTIALS_JSON` — GCP 服務帳戶 JSON 字串

**安裝套件**：
- `busboy@1.6.0` — multipart 音頻解析
- `@types/busboy@1.5.4`
- `@google-cloud/speech@^7.3.0`

---

### 🔇 麥克風按鈕擴展至所有輸入框

**已加上語音輸入的位置**：

| 頁面 | 輸入框 | 對應 state |
|------|--------|-----------|
| `PlatformPage.tsx` | 聚焦 Prompt（你这轮最想判断什么） | `focusPrompt` |
| `PlatformPage.tsx` | 主分析 Prompt | `question` |
| `MVAnalysis.tsx` | 主分析 Prompt | `prompt` |
| `WorkflowNodes.tsx` | 主 Prompt | `prompt` |
| `WorkflowNodes.tsx` | 腳本編輯框 | `scriptText` |
| `WorkflowNodes.tsx` | 配樂 Prompt | `musicPrompt` |
| `WorkflowNodes.tsx` | 語音實驗室文字框 | `voiceLabText` |
| `WorkflowNodes.tsx` | 每個 Scene Prompt（分鏡編輯） | `scene.scenePrompt` |
| `WorkflowNodes.tsx` | 每個 Scene Prompt（大卡片） | `scene.scenePrompt` |
| `WorkflowNodes.tsx` | 每個場景旁白文字 | `sceneVoiceTextMap[key]` |
| `WorkflowNodes.tsx` | Render Still Prompt | `renderStillPromptMap[sceneIndex]` |

**按鈕規格**：`size={28}`，絕對定位於輸入框右上角，`pr-12` 避免文字被遮擋

---

### 🐛 已修復錯誤

#### P0-020：語音路由注冊至未使用的 `app.ts`
- **現象**：部署成功但 `/api/speech-to-text` 返回 HTML（SPA fallback），說明 Express 未找到路由
- **根因**：`server/_core/app.ts` 定義了 `createApp()` 但實際伺服器入口為 `server/_core/index.ts`，兩者並不相關
- **修復**：在 `server/_core/index.ts` 中 import 並注冊 `registerSpeechApiRoutes`

#### P0-021：`lang` prop TypeScript 構建錯誤（TS2322）
- **現象**：`VoiceInputButton` 重寫後移除了 `lang` prop，但三個頁面仍傳 `lang="zh-CN"`
- **修復**：移除 `PlatformPage.tsx`、`MVAnalysis.tsx`、`WorkflowNodes.tsx` 中的 `lang` prop

---

### 🏗️ 首頁 UI 優化

| 項目 | 變更 |
|------|------|
| 移除 Kling AI 創作室卡片 | `HomeChangelog.tsx` MODULES 移除 |
| 移除一句話生成音樂卡片 | `HomeChangelog.tsx` MODULES 移除 |
| 全部改為簡體中文 | `HomeChangelog.tsx`、`HomeHero.tsx`、`HomeTools.tsx` |
| 「工業級」→「影視級全自動產線」 | 三個 Home 組件 |
| 移除技術棧名稱（Veo/Suno/Kling/Flux/Resend） | 所有首頁組件 |
| 滾動看板字體放大兩號 | date 11→13、tag 10→12、text 13→15 |
| 滾動看板限制在高亮邊框內 | 新增 maxWidth + 發光邊框容器 |
| 看板只顯示用戶向功能更新 | 過濾管理員/後台相關條目 |
| 功能卡片改為 2x2 排版 | `repeat(auto-fill, minmax(460px, 1fr))` |

---

### 🙈 前端隱藏功能

從路由、導航欄、SEO 全部移除以下功能入口：

| 功能 | 操作 |
|------|------|
| 虛擬偶像 `/idol` | 移除路由 + Navbar 連結 |
| 混元 3D `/3d-studio` | 移除路由 + Navbar 連結 |
| 音頻分析 | 隱藏（未建路由） |
| AI 靈感助手 | 保留後端，前端合併進工作流 |
| Kling Studio | Navbar 連結移除 |

---

### 💰 積分定價調整

| 方案 | 積分 | 售價 | 估算用量 |
|------|------|------|---------|
| 試用包 | 60 cr | ¥39 | 約 1-2 條視頻 |
| 小包 | 160 cr | ¥99 | 約 3-5 條視頻 |
| 中包 | 360 cr | ¥218 | 約 7-12 條視頻 |
| 大包 | 700 cr | ¥418 | 約 14-23 條視頻 |
| 超大包 | 1500 cr | ¥868 | 約 30-50 條視頻 |

**同步檔案**：`client/src/pages/Pricing.tsx`、`server/plans.ts`

---

### 📦 我的作品優化

- `HomeMyWorks.tsx` 分析快照卡片新增：
  - 分析類型標籤 + 日期
  - 摘要（從 `item.metadata.summary` 提取）
  - 完整可複製 URL（`window.location.origin + viewUrl`）
  - 「複製連結」+ 「查看報告」按鈕

---

## Commit 記錄

| Commit | 說明 |
|--------|------|
| `7ad9941` | fix: 語音輸入按 Gemini 方案重寫，修復 isFinal 假死 + 卸載清理 |
| `391f55f` | feat: 重新設計積分包定價（5 檔），移除偶像/Forge/貼圖功能明細 |
| `1b802d3` | feat: GCP Speech-to-Text API 接入，VoiceInputButton 改用 MediaRecorder |
| `b46972b` | fix: 移除 VoiceInputButton 的 lang prop（TS2322） |
| `8d5fc85` | feat: 為 PlatformPage 與 WorkflowNodes 所有文本輸入框添加語音輸入 |
| `69a6bcd` | fix: 語音轉文字改為 Express 路由，修正 Fly.io 上無法調用的問題 |
| `2c20bba` | fix: 語音路由注冊到正確的伺服器入口 index.ts（而非未使用的 app.ts） |

---

## 環境資訊

| 項目 | 值 |
|------|-----|
| 生產 URL | https://mvstudiopro.fly.dev |
| 自訂域名 | https://mvstudiopro.com |
| 資料庫 | Neon PostgreSQL（ap-southeast-1） |
| 部署平台 | Fly.io（app: mvstudiopro） |
| GCP 語音 | Google Cloud Speech-to-Text v1（zh-CN，WEBM_OPUS） |
| GitHub Repo | gabrieltan0506-prog/mvstudiopro |
