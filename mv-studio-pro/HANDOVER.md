# MV Studio Pro — 完整交接文檔

**項目名稱：** MV Studio Pro — 智能 MV 製作與發布平台  
**交接日期：** 2026-02-22  
**代碼量：** ~50,600 行 TypeScript/TSX  
**最新 Checkpoint：** `e6d97b7c`  
**線上域名：** https://www.mvstudiopro.com  

---

## 一、項目概述

MV Studio Pro 是一個**一站式 AI 視頻創作平台**，面向中國市場（小紅書、B站、抖音、視頻號），整合多個 AI API 提供從文案→分鏡→圖片→音樂→視頻→3D 的完整創作流程。商業模式為 **Credits 按次收費**（暫不推訂閱制）。

---

## 二、技術棧

| 層級 | 技術 |
|------|------|
| 前端框架 | Expo SDK 54 + React Native 0.81 + TypeScript 5.9 |
| 路由 | Expo Router 6（文件系統路由） |
| 樣式 | NativeWind 4（Tailwind CSS for React Native） |
| 後端 | Express + tRPC（server/ 目錄） |
| 數據庫 | MySQL（Drizzle ORM） |
| 支付 | Stripe（已部分接入） |
| 部署 | Vercel（Web 版）+ Expo Go（移動端測試） |

---

## 三、項目結構

```
mv-studio-pro/
├── app/                          # 頁面路由（Expo Router）
│   ├── (tabs)/                   # Tab 頁面
│   │   ├── index.tsx             # 首頁
│   │   ├── storyboard.tsx        # 智能腳本與分鏡生成
│   │   ├── avatar.tsx            # 虛擬偶像生成
│   │   ├── analyze.tsx           # 視頻 PK 評分
│   │   ├── pricing.tsx           # 定價頁面
│   │   ├── publish.tsx           # 發布策略
│   │   ├── 3d-studio.tsx         # 3D Studio（2D→3D）
│   │   └── _layout.tsx           # Tab 佈局
│   ├── kling-studio.tsx          # Kling AI 工作室（視頻/動作/口型同步）
│   ├── effects.tsx               # 分鏡轉視頻
│   ├── login.tsx                 # 登入頁
│   ├── credits-dashboard.tsx     # Credits 儀表板
│   ├── student-verification.tsx  # 學生驗證
│   ├── showcase.tsx              # 作品展廳
│   ├── team-manage.tsx           # 團隊管理
│   ├── admin-*.tsx               # 管理員後台（多個頁面）
│   └── ...                       # 其他頁面
├── server/                       # 後端代碼
│   ├── _core/                    # 框架核心（不要修改）
│   │   ├── llm.ts                # LLM 調用（Gemini 3 Flash/Pro 雙模型）
│   │   ├── imageGeneration.ts    # Forge 圖片生成
│   │   ├── index.ts              # Express 服務入口
│   │   ├── oauth.ts              # OAuth 認證
│   │   └── env.ts                # 環境變量
│   ├── routers/                  # tRPC 路由模塊
│   │   ├── kling.ts              # Kling 視頻/動作/口型同步
│   │   ├── suno.ts               # Suno 音樂生成
│   │   ├── nanoBanana.ts         # NBP 圖片生成
│   │   ├── hunyuan3d.ts          # 3D 模型生成（Trellis）
│   │   ├── stripe.ts             # Stripe 支付
│   │   ├── usage.ts              # 用量追蹤
│   │   ├── team.ts               # 團隊功能
│   │   └── ...                   # 其他路由
│   ├── kling/                    # Kling API 服務層
│   │   ├── client.ts             # JWT 簽名 + 多 Key 輪換
│   │   ├── omni-video.ts         # 3.0 Omni Video
│   │   ├── motion-control.ts     # 2.6 動作遷移
│   │   ├── lip-sync.ts           # 口型同步
│   │   └── elements.ts           # 角色元素
│   ├── plans.ts                  # 方案定義 + Credits 定價
│   ├── credits.ts                # Credits 扣費邏輯
│   ├── fal-3d.ts                 # fal.ai 3D 生成（Trellis）
│   ├── gemini-image.ts           # Gemini 圖片生成
│   └── routers.ts                # 主路由聚合
├── shared/                       # 前後端共用
│   ├── credits.ts                # Credits 消耗定價常量
│   ├── types.ts                  # 共用類型
│   └── const.ts                  # 共用常量
├── drizzle/                      # 數據庫 Schema
│   ├── schema.ts                 # 主表（users）
│   ├── schema-extended.ts        # 擴展表（credits, usage 等）
│   ├── schema-stripe.ts          # Stripe 支付表
│   ├── schema-teams.ts           # 團隊表
│   ├── schema-sessions.ts        # Session 持久化表
│   └── ...                       # 其他 schema
├── components/                   # 共用組件
│   ├── model-viewer.tsx          # 3D WebGL 預覽器
│   ├── nbp-engine-selector.tsx   # 圖片引擎選擇器
│   ├── upgrade-modal.tsx         # 升級提示彈窗
│   └── ...                       # 其他組件
├── tests/                        # 測試文件（500+ 測試）
├── todo.md                       # 待辦事項清單
├── design.md                     # 設計文檔
└── package.json                  # 依賴配置
```

---

## 四、環境變量（API Keys）

以下是項目運行所需的所有環境變量。通過 Manus 平台的 Settings > Secrets 面板管理：

| 環境變量 | 用途 | 必需 |
|---------|------|------|
| `GEMINI_API_KEY` | Google Gemini 3 Flash/Pro API | 是 |
| `FAL_API_KEY` | fal.ai（NBP 圖片 + Trellis 3D） | 是 |
| `KLING_ACCESS_KEY` | Kling API Access Key | 是 |
| `KLING_SECRET_KEY` | Kling API Secret Key | 是 |
| `KLING_REGION` | Kling API 區域（`cn` 或 `global`） | 是 |
| `SUNO_API_KEY` | Suno 音樂生成 API（CometAPI） | 是 |
| `SUNO_API_BASE` | Suno API 基礎 URL（默認 `https://api.sunoapi.org`） | 否 |
| `STRIPE_SECRET_KEY` | Stripe 支付密鑰 | 是（支付功能） |
| `STRIPE_WEBHOOK_SECRET` | Stripe Webhook 密鑰 | 是（支付功能） |
| `STRIPE_PRO_MONTHLY_PRICE_ID` | Stripe Pro 月付價格 ID | 是（支付功能） |
| `STRIPE_PRO_YEARLY_PRICE_ID` | Stripe Pro 年付價格 ID | 是（支付功能） |
| `STRIPE_ENTERPRISE_PRICE_ID` | Stripe Enterprise 價格 ID | 是（支付功能） |
| `STRIPE_CREDIT_PACK_*_PRICE_ID` | Stripe Credits 包價格 ID | 是（支付功能） |
| `DATABASE_URL` | MySQL 連接字符串 | 是 |
| `FRONTEND_URL` | 前端 URL（用於 OAuth 回調） | 否 |

> **注意：** `BUILT_IN_FORGE_API_URL` 和 `BUILT_IN_FORGE_API_KEY` 由 Manus 平台自動注入，不需要手動設置。

---

## 五、AI API 整合狀態

### 5.1 已完成整合（後端已就緒）

| API | 服務文件 | 狀態 | 說明 |
|-----|---------|------|------|
| **Gemini 3 Flash** | `server/_core/llm.ts` | 已測試 | 日常文案生成（tier: "flash"） |
| **Gemini 3.1 Pro** | `server/_core/llm.ts` | 已測試 | 高級文案/分析（tier: "pro"） |
| **Gemini 3 Pro Image** | `server/gemini-image.ts` | 已測試 | Gemini 圖片生成 |
| **Forge AI** | `server/_core/imageGeneration.ts` | 已測試 | 免費版圖片生成（平台內置） |
| **NBP (Nano Banana Pro)** | `server/routers/nanoBanana.ts` | 已測試 | 付費版 2K/4K 圖片（via fal.ai） |
| **Trellis 3D** | `server/fal-3d.ts` | 已測試 | 2D→3D 模型轉換（via fal.ai） |
| **Kling Omni Video 3.0** | `server/kling/omni-video.ts` | 已測試 | 文生視頻 / 圖生視頻 |
| **Kling Motion Control 2.6** | `server/kling/motion-control.ts` | 已測試 | 動作遷移 |
| **Kling Lip-Sync** | `server/kling/lip-sync.ts` | 已測試 | 口型同步 |
| **Kling Elements 3.0** | `server/kling/elements.ts` | 已測試 | 角色元素管理 |

### 5.2 後端已定義但前端未完成

| API | 服務文件 | 狀態 | 待做 |
|-----|---------|------|------|
| **Suno V4/V4.5** | `server/routers/suno.ts` | 後端就緒 | 前端音樂生成 UI 未開發 |

### 5.3 未整合（待開發）

| API | 說明 | 優先級 |
|-----|------|--------|
| **Veo 3.1** | Google 視頻生成（已測試有名人過濾限制） | 中 |
| **Seedance 2.0** | 字節跳動視頻生成（via CometAPI） | 中 |
| **GPT 5.1** | OpenAI 頂級文案（via CometAPI） | 低 |

---

## 六、Credits 定價體系

### 6.1 Credits 消耗表（`shared/credits.ts` + `server/plans.ts`）

| 功能 | Credits | API 成本（¥） | 收入（¥，按 ¥0.70/Credit） | 利潤率 |
|------|---------|-------------|---------------------------|--------|
| AI 靈感生成（Flash） | 5 | ¥0.07 | ¥3.50 | 97.9% |
| NBP 2K 圖片 | 5 | ¥0.29 | ¥3.50 | 91.8% |
| NBP 4K 圖片 | 9 | ¥0.58 | ¥6.30 | 90.9% |
| Suno V4 音樂 | 12 | ¥0.36 | ¥8.40 | 95.7% |
| Suno V5 音樂 | 22 | ¥0.52 | ¥15.40 | 96.6% |
| 分鏡腳本生成 | 15 | ¥0.07 | ¥10.50 | 99.3% |
| 偶像 3D 轉換 | 30 | ¥0.14 | ¥21.00 | 99.3% |
| Kling 視頻 | 80 | ¥3.02-7.06 | ¥56.00 | 87-95% |
| Kling 口型同步 | 60 | ~¥3.00 | ¥42.00 | ~93% |

### 6.2 Credits 加值包（`server/plans.ts` CREDIT_PACKS）

| 包名 | Credits | 價格（¥） | 單價（¥/Credit） |
|------|---------|----------|----------------|
| 入門包 | 50 | ¥35 | ¥0.70 |
| 高端包 | 100 | ¥68 | ¥0.68 |
| 超值包 | 250 | ¥168 | ¥0.672 |
| 專業包 | 500 | ¥328 | ¥0.656 |

### 6.3 體驗包（待實現）

| 項目 | 設定 |
|------|------|
| 價格 | ¥19.9 |
| Credits | 30 |
| 限購 | 每人 2 次 |

---

## 七、待辦事項（按優先級排序）

### 高優先級（核心功能缺失）

1. **Suno 音樂生成前端 UI** — 後端 `server/routers/suno.ts` 已就緒，需開發前端頁面（主題曲模式 + BGM 模式，V4/V5 引擎選擇）
2. **導演包前端 UI** — 後端 `server/plans.ts` DIRECTOR_PACKS 已定義，需開發一鍵工作流界面（腳本→分鏡→音樂→視頻串聯）
3. **體驗包 ¥19.9** — 新增 30 Credits 體驗包，每人限購 2 次
4. **免費版水印** — 免費用戶生成的分鏡圖和導出文檔加 MV Studio Pro 水印
5. **AI 優化分鏡腳本** — 用 Gemini Pro 將用戶基礎腳本轉成專業 prompt（按次收費 5-12 Credits）

### 中優先級（功能增強）

6. **Veo 3.1 視頻生成接入** — Google 視頻生成引擎
7. **Seedance 2.0 + Motion Steal 接入** — 字節跳動視頻引擎
8. **定價調整 V2** — Kling 視頻降到 55 Credits，口型同步降到 42 Credits，新增 Motion Control 定價
9. **學生版改版** — 取消一年版，半年版改為 ¥130
10. **i18n 國際化** — 簡體中文 + 英文雙語支持

### 低優先級（後續迭代）

11. **企業服務訂製區** — 首頁新增企業服務入口
12. **批量購買折扣** — 大額 Credits 購買折扣邏輯
13. **淘寶/京東開店** — 電商渠道 + 激活碼系統
14. **Vercel 正式部署** — 目前通過 Manus 沙盒部署

---

## 八、關鍵業務邏輯

### 8.1 管理員特權（`server/credits.ts`）

管理員用戶（`role === "admin"`）享有以下特權：
- `getUserPlan()` 返回 enterprise 方案
- `getCredits()` 返回虛擬無限餘額（999999）
- `deductCredits()` 免扣費
- `checkFeatureAccess()` 返回 `allowed: true`

管理員判斷函數 `isAdminUser(userId)` 在 `server/credits.ts` 中定義。

### 8.2 Kling API 多 Key 輪換（`server/kling/client.ts`）

Kling API 支持兩種配置方式：
1. `KLING_API_KEYS` — JSON 格式多 Key 輪換（推薦）
2. `KLING_ACCESS_KEY` + `KLING_SECRET_KEY` — 單 Key 模式

JWT 簽名使用 `jose` 庫，token 有效期 30 分鐘，自動刷新。

### 8.3 fal.ai 圖片 URL 轉換（`server/fal-3d.ts`）

`ensureAccessibleUrl()` 函數解決 Manus S3 signed URL 無法被 fal.ai 訪問的問題：
- 小於 6MB → 轉為 base64 data URI
- 大於 6MB → 上傳到 fal.storage
- 已是 fal.ai URL 或 data URI → 直接使用

### 8.4 Session 持久化（`server/sessionDb.ts`）

Session 存儲在數據庫中（`drizzle/schema-sessions.ts`），支持跨重啟持久化。OAuth 登入和 Email 登入都會寫入 session 到數據庫。

---

## 九、運行指令

```bash
# 安裝依賴
pnpm install

# 開發模式（同時啟動前端 + 後端）
pnpm dev

# 單獨啟動後端
pnpm dev:server

# 單獨啟動前端
pnpm dev:metro

# 運行測試
pnpm test

# TypeScript 類型檢查
pnpm check

# 數據庫遷移
pnpm db:push

# 構建後端
pnpm build
```

---

## 十、已知問題

1. **3D 轉換偶爾報錯** — fal.ai Trellis API 偶爾返回超時，需要重試機制
2. **Veo 3.1 名人過濾** — Google Veo 對含名人元素的 prompt 會拒絕生成
3. **Web 字體載入超時** — 已通過 `scripts/patch-font-timeout.js` 緩解，但偶爾仍會出現
4. **OAuth 回調域名** — 沙盒域名會變化，已通過 `/api/oauth/start` 動態生成解決

---

## 十一、重要文件快速索引

| 需求 | 文件路徑 |
|------|---------|
| 修改 Credits 定價 | `shared/credits.ts` + `server/plans.ts` |
| 新增 API 路由 | `server/routers/` 目錄下新建文件，在 `server/routers.ts` 中註冊 |
| 新增頁面 | `app/` 目錄下新建 `.tsx` 文件（自動路由） |
| 新增 Tab 頁面 | `app/(tabs)/` 目錄 + 修改 `app/(tabs)/_layout.tsx` |
| 新增 Tab 圖標 | 先在 `components/ui/icon-symbol.tsx` MAPPING 中添加 |
| 修改主題色 | `theme.config.js` |
| 修改數據庫表 | `drizzle/schema*.ts` → 運行 `pnpm db:push` |
| 修改 LLM 模型 | `server/_core/llm.ts`（MODEL_CONFIG） |
| 查看待辦事項 | `todo.md` |
| 查看設計文檔 | `design.md` |
| 定價策略報告 | `/home/ubuntu/MV-Studio-Pro-定價策略報告.md` |

---

## 十二、API 成本速查表（人民幣）

| API | 成本/次 | 說明 |
|-----|--------|------|
| Gemini 3 Flash | ¥0.07 | 日常文案 |
| Gemini 3.1 Pro | ¥0.22 | 高級文案 |
| GPT 5.1 | ¥0.36 | 頂級文案（via CometAPI） |
| Forge AI | ¥0.00 | 免費圖片（平台內置） |
| NBP 2K | ¥0.29 | 付費圖片 |
| NBP 4K | ¥0.58 | 高清圖片 |
| Kling V2 圖片 | ¥0.14 | 寫實風格圖片 |
| Suno V4 | ¥0.36 | 音樂生成（2首） |
| Suno V4.5 | ¥0.52 | 音樂生成（2首） |
| Kling 5s 標準視頻 | ¥3.02 | 視頻生成 |
| Kling 5s Pro 視頻 | ¥7.06 | 高質量視頻 |
| Kling 10s 標準視頻 | ¥6.05 | 長視頻 |
| Trellis 3D | ¥0.14 | 2D→3D 轉換 |

---

*本文檔由 Manus AI 自動生成，供接手 agent 參考。*
