# MV Studio Pro — 代碼庫交接文檔

## 項目概述

MV Studio Pro 是一個智能 MV 製作與發布平台，目標功能包括：虛擬偶像生成、2D 轉 3D 模型、AI 音樂生成、視頻製作、多平台發布策略。

**重要：用戶需要的是 Web 網頁端應用，不是手機 App。** 當前代碼庫基於 Expo（React Native Web），如需重構為純 Web 應用請自行決定技術棧。

---

## 技術架構

| 層級 | 技術 | 說明 |
|------|------|------|
| 前端框架 | Expo SDK 54 + React Native Web | 同時支持 Web 和移動端 |
| 路由 | Expo Router 6 | 文件系統路由 |
| 樣式 | NativeWind 4 (Tailwind CSS) | 響應式設計 |
| 後端 | Express + tRPC | API 服務器，端口 3000 |
| 數據庫 | PostgreSQL + Drizzle ORM | 用戶數據、Credits、訂閱 |
| AI 圖片生成 | Gemini 3 Flash / Pro | 虛擬偶像圖片生成 |
| 2D 轉 3D | fal.ai Trellis（已修復）+ Hunyuan3D（3D Studio 頁面） | $0.02/次 (Trellis) |
| 音樂生成 | Suno API | v4/v5 |
| 視頻生成 | Kling API | 視頻 + 口型同步 |
| 支付 | Stripe | 訂閱 + Credits |
| 存儲 | S3 兼容存儲 | 圖片、模型文件 |

---

## 目錄結構

```
mv-studio-pro/
├── app/                    # 頁面（Expo Router 文件路由）
│   ├── (tabs)/             # Tab 頁面
│   │   ├── index.tsx       # 首頁
│   │   ├── avatar.tsx      # 虛擬偶像生成 + 3D 轉換
│   │   ├── 3d-studio.tsx   # 3D 工作室（Rapid/Pro 模式）
│   │   ├── analyze.tsx     # MV 分析
│   │   ├── storyboard.tsx  # 分鏡腳本
│   │   ├── publish.tsx     # 多平台發布策略
│   │   └── pricing.tsx     # 定價頁面
│   ├── kling-studio.tsx    # Kling 視頻生成
│   ├── login.tsx           # 登入
│   ├── credits-dashboard.tsx # Credits 管理
│   └── ...                 # 其他頁面
├── components/             # 組件
│   ├── model-viewer.tsx    # 3D 模型 WebGL 預覽器（Google model-viewer）
│   ├── screen-container.tsx
│   ├── nbp-engine-selector.tsx
│   └── ...
├── server/                 # 後端
│   ├── _core/              # 核心服務（LLM、OAuth、存儲）
│   │   ├── llm.ts          # Gemini 3 Flash + Pro 智能路由
│   │   ├── imageGeneration.ts
│   │   └── index.ts        # Express 服務器入口
│   ├── routers.ts          # 主路由（virtualIdol、storyboard 等）
│   ├── routers/            # 子路由
│   │   ├── hunyuan3d.ts    # 3D Studio 的 Rapid/Pro 路由
│   │   ├── suno.ts         # Suno 音樂生成
│   │   ├── kling.ts        # Kling 視頻生成
│   │   ├── stripe.ts       # Stripe 支付
│   │   └── ...
│   ├── fal-3d.ts           # Trellis 3D 引擎（偶像頁面用）
│   ├── services/hunyuan3d.ts # Hunyuan3D 服務（3D Studio 用）
│   ├── gemini-image.ts     # Gemini 圖片生成
│   ├── credits.ts          # Credits 扣費邏輯
│   └── plans.ts            # 訂閱方案定義
├── shared/                 # 前後端共用
│   ├── credits.ts          # CREDIT_COSTS 定價表
│   └── types.ts
├── drizzle/                # 數據庫 Schema
├── hooks/                  # React Hooks
├── lib/                    # 工具庫
└── assets/                 # 靜態資源
```

---

## 環境變量（必需）

| 變量名 | 用途 | 狀態 |
|--------|------|------|
| `FAL_API_KEY` | fal.ai 3D 生成 + 圖片處理 | 已設置 |
| `GEMINI_API_KEY` | Gemini AI 圖片/文字生成 | 已設置 |
| `STRIPE_SECRET_KEY` | Stripe 支付 | 已設置 |
| `DATABASE_URL` | PostgreSQL 連接 | 已設置 |
| `SUNO_API_KEY` | Suno 音樂生成 | 需確認 |
| `KLING_ACCESS_KEY` / `KLING_SECRET_KEY` | Kling 視頻生成 | 需確認 |

---

## 已完成功能

### 1. 虛擬偶像圖片生成（`avatar.tsx` + `server/routers.ts`）
- 5 種風格：動漫、真人、Q版、賽博龐克、奇幻
- 3 種性別：女性、男性、中性
- 支持參考圖上傳
- 引擎選擇：Forge（免費）/ NBP 2K / NBP 4K
- Gemini 3 Flash + Pro 智能路由

### 2. 2D 轉 3D — 偶像頁面（`avatar.tsx` + `server/fal-3d.ts`）
- 引擎：fal-ai/trellis（$0.02/次，~17 秒）
- **關鍵修復**：`ensureAccessibleUrl()` 先下載 S3 圖片轉 base64 再傳給 fal.ai
- API 參數：`image_url`（Trellis 用這個名字）
- 返回結構：`data.model_mesh.url` → GLB 文件
- 前端 ModelViewer 組件預覽（旋轉/縮放/線框切換）
- 30 Credits/次

### 3. 2D 轉 3D — 3D Studio 頁面（`3d-studio.tsx` + `server/services/hunyuan3d.ts`）
- 引擎：fal-ai Hunyuan3D v3.1 Rapid/Pro
- Rapid：5-8 Credits，$0.225/次
- Pro：9-18 Credits，$0.375/次
- 增強選項：PBR 材質、多視角、自定義面數
- **注意**：Hunyuan3D 的 API 參數名是 `input_image_url`（不是 `image_url`）
- **注意**：同樣需要 `ensureAccessibleUrl()` 處理 S3 URL

### 4. 3D 模型預覽器（`components/model-viewer.tsx`）
- 基於 Google model-viewer Web Component
- 支持 GLB 格式的旋轉、縮放、平移
- 控制按鈕：重置視角、自動旋轉、線框模式
- Web 端用 iframe + srcdoc，原生端顯示提示

### 5. Credits 系統（`server/credits.ts` + `shared/credits.ts`）
- 完整的 Credits 扣費邏輯
- 管理員免扣費
- 多種定價層級

### 6. Stripe 訂閱支付（`server/stripe.ts` + `server/routers/stripe.ts`）
- 訂閱方案：免費/專業/企業/學生
- Webhook 處理
- Credits 充值

### 7. 用戶認證（OAuth）
- OAuth 登入
- Session 管理
- 動態 redirect_uri（解決沙盒域名問題）

### 8. Suno 音樂生成（`server/routers/suno.ts`）
- v4/v5 模型
- 歌詞生成

### 9. Kling 視頻生成（`server/kling/`）
- 視頻生成
- 口型同步
- 運動控制

### 10. 其他
- MV 分析功能
- 分鏡腳本生成
- 多平台發布策略（小紅書、B站、抖音、視頻號）
- 團隊管理
- 學生認證
- 管理後台

---

## 未完成 / 待開發功能

| 功能 | 狀態 | 說明 |
|------|------|------|
| **去背景** | 未開始 | 建議用 fal.ai BiRefNet 或 rembg |
| **3D 部署驗證** | 未驗證 | Trellis 代碼已寫好但未在線上測試過 |
| **Hunyuan3D 線上修復** | 未驗證 | 加了 ensureAccessibleUrl 但未線上驗證 |
| **視頻合成完整流程** | 部分完成 | Kling API 已接，但完整 MV 合成流程未串通 |
| **多平台一鍵發布** | 僅策略建議 | 只有文字建議，沒有實際 API 對接 |
| **批量虛擬偶像生成** | 未開始 | 用戶需求之一 |
| **Web 端優化** | 需要 | 用戶明確要求 Web 網頁端，當前是 React Native Web |

---

## 已知問題

1. **兩個代碼庫不同步**：之前有兩個 Manus agent 各自維護獨立代碼庫，本文件所在的代碼庫包含最新修復，但線上部署的版本可能不同。
2. **S3 URL 認證問題**：Manus 平台的 S3 存儲 URL 帶 signed token，外部 API（如 fal.ai）無法直接訪問。所有需要把圖片傳給外部 API 的地方都必須先用 `ensureAccessibleUrl()` 轉換。
3. **Hunyuan3D 422 錯誤**：根因是 S3 URL 不可訪問 + API 參數名錯誤（應為 `input_image_url`）。加上 ensureAccessibleUrl 和正確參數名後應該能修復，但未線上驗證。

---

## 運行方式

```bash
# 安裝依賴
pnpm install

# 開發模式（同時啟動後端 + 前端）
pnpm dev

# 後端：http://localhost:3000
# 前端：http://localhost:8081
```

---

## API 密鑰和外部服務

| 服務 | 用途 | 定價 | 文檔 |
|------|------|------|------|
| fal.ai | 3D 生成 (Trellis $0.02, Hunyuan3D $0.225-$0.375) | 按次計費 | https://fal.ai/models |
| Gemini | 圖片/文字 AI 生成 | Google AI Studio | https://ai.google.dev |
| Suno | AI 音樂生成 | 按次計費 | https://suno.com |
| Kling | AI 視頻生成 | 按次計費 | https://klingai.com |
| Stripe | 支付處理 | 標準費率 | https://stripe.com |
