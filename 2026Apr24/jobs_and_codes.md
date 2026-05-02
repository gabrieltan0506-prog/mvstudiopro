# MV Studio Pro — Jobs & Codes · 2026-04-24

## 本次 PR 工作摘要

本文件記錄 2026 年 4 月 24 日本 PR 所涉及的所有任務、代碼改動點及邏輯說明。

---

## 一、功能清單

### 1. 水印邏輯修正
**目標**：只有「試用包」帳號強制加水印，正式付費包不加水印。

- **後端 `resolveWatermark`**（`server/routers.ts`）：查詢用戶的付款記錄（`paymentSubmissions`）及積分交易（`creditTransactions`），判斷用戶是否僅為試用狀態，返回布爾值決定是否加水印。

---

### 2. 二創中心（Remix Center）無痕視窗可見
**目標**：未登入用戶也能訪問二創中心，不強制跳轉登入頁。

- 新增 `RemixLanding` 公開落地頁，讓未登入用戶能瀏覽功能介紹，點擊操作時才提示登入。

---

### 3. Credits 加值頁面改版
**目標**：更大字體、方格排列、直接展示 WeChat Pay / Alipay QR Code，降低用戶付款摩擦。

- **`client/src/pages/Pricing.tsx`**：
  - 卡片文字使用 `clamp(...)` 動態字號，佔卡片版面 80% 以上。
  - QR Code 直接展示在右側（`grid grid-cols-2`），不需額外點擊。

---

### 4. 首頁教育專案卡片
**目標**：首頁新增教育機構合作詢價表單，用戶填寫後發送至 `benjamintan0506@163.com`。

- **`client/src/components/HomeEducation.tsx`**：表單元件（姓名、郵箱、電話、機構、備注）。
- **`server/routers/education.ts`**：tRPC mutation，收集表單數據並透過 SMTP 發送郵件。

---

### 5. 積分消耗修正

| 功能 | 積分 | 備注 |
|---|---|---|
| 成長營分析（GROWTH） | 40 cr / 次 | |
| 成長營配樂生成 | 10 cr / 次 | 另扣 |
| 二創分析（REMIX） | 60 cr / 次 | |
| 二創配樂生成 | 8 cr / 次 | 另扣 |
| 平台數據分析（主看板） | 50 cr / 次 | |
| 趨勢數據追問 | 6 cr / 次 | 正式包每日首次免費；試用包不支援 |
| 生成參考圖 | 12 cr / 張 | |
| 參考圖高清放大 2× | 36 cr | 固定費率 |
| 參考圖高清放大 4× | 48 cr | 固定費率 |

**涉及檔案**：
- `server/plans.ts`：更新 `CREDIT_COSTS` 常數
- `shared/plans.ts`：同步 `CREDIT_COSTS`；新增 `UPSCALE_COST_OVERRIDES`（固定放大費率）
- `server/routers/suno.ts`：按 `source` 欄位分別扣費（`growthCampGrowthMusic` / `growthCampRemixMusic`）
- `server/routers.ts`（`askPlatformFollowUp`）：每日首次免費邏輯 + 試用包攔截

---

### 6. 試用包 PDF/Word 導出封鎖
**目標**：試用包用戶不能使用 PDF / Word 導出功能。

- **`server/routers.ts`**（`exportPDF` mutation）：判斷 `resolveWatermark` 結果，試用包直接拋出錯誤訊息。

---

### 7. 所有生成圖片旁邊加高清放大菜單
**目標**：成長營場景圖、故事板、微信貼圖等所有生成圖片均支援 2× / 4× 高清放大。

- **`client/src/pages/Storyboard.tsx`**：場景圖下方掛載 `<ImageUpscaleBar baseCreditKey="workflowSceneImage" />`
- **`client/src/pages/WechatSticker.tsx`**：貼圖下方掛載 `<ImageUpscaleBar baseCreditKey="forgeImage" />`

---

### 8. 圖片生成全面遷移至 Google Vertex AI（移除 Kling）
**目標**：所有圖片生成使用 Google 模型，不再使用 Kling AI。

- **`server/services/provider-manager.ts`**：從 `GenerationProvider` 類型移除 `"kling_image"`
- **`server/services/tier-provider-routing.ts`**：所有 tier 的 `image` provider chain 移除 `kling_image`
- **`server/routers.ts`**（`virtualIdol.generate`）：移除 Kling 分支，統一使用 `generateGeminiImage`
- **`server/jobs/runner.ts`**：`kling_image` action 路由至 `nano_image`（Vertex AI）保持向後兼容
- **`client/src/components/NbpEngineSelector.tsx`**：移除 `kling_1k` / `kling_2k`，重命名為 Google 2K / 4K
- **`client/src/pages/RemixStudio.tsx`**（`KlingImagePanel`）：改用 `/api/google?op=nanoImage`

---

### 9. Supervisor URL 直接訪問
**目標**：`?supervisor=1` 參數可不登入直接進入管理者模式。

- **`client/src/pages/PlatformPage.tsx`**（已有）：`hasSupervisorAccess()` 函數讀取 URL 參數並寫入 `localStorage`。

---

### 10. Debug 模式僅 Supervisor 可見
**目標**：普通登入用戶看不到 Debug 開關。

- **`client/src/pages/WorkflowNodes.tsx`**：新增 `isSupervisorSession()`，Debug 按鈕條件渲染。
- **`client/src/pages/WorkflowStoryboardToVideo.tsx`**：同上。

---

### 11. 邀請碼生成功能修復
**目標**：Supervisor 角色可以生成並看到邀請碼。

- **`client/src/pages/AdminPanel.tsx`**：
  - 訪問控制改為允許 `admin` 和 `supervisor` 雙角色。
  - Supervisor 用戶只顯示「邀請碼」Tab，隱藏其他管理 Tab。
  - `generateCodesMutation.onSuccess` 後調用 `myCodesList.refetch()` 刷新列表。
  - 新生成的邀請碼用高亮綠框顯示，附帶「复制全部」按鈕。

---

### 12. 首頁用戶回饋區塊（送 100 積分）
**目標**：用戶在首頁提交回饋，被採納後自動發放 100 Credits。

- **`client/src/components/HomeFeedback.tsx`**：
  - 已登入用戶：顯示「標題 + 詳細描述」表單，提交後調用 `trpc.feedback.submit`。
  - 未登入用戶：展示登入引導。
  - 提交成功顯示感謝畫面。
- **`server/routers/feedback.ts`**（已有）：`submit` mutation 保存回饋；`adopt` mutation（admin 操作）發放 100 cr 並發送郵件通知。
- **`client/src/pages/Home.tsx`**：在 `HomeEducation` 之後加入 `<HomeFeedback />`。

---

## 二、邀請碼使用說明

### 生成邀請碼
1. 以 `admin` 或 `supervisor` 角色登入後台：`/admin`
2. 進入「邀請碼」Tab
3. 設置數量（1–100）後點擊「生成邀請碼」
4. 新生成的邀請碼以綠框高亮顯示，可一鍵「复制全部」

### 兌換邀請碼
1. 新用戶前往 `/auth` 註冊或登入頁面
2. 在「邀請碼」欄位輸入對應碼
3. 提交後系統自動升級帳號等級或發放對應積分

---

## 三、積分與 Credits 說明

- 1 Credit = 系統虛擬積分單位；人民币套餐价以定价页 / 订单为准，不提供统一的「每积分¥」口径。
- 試用包有限制；正式包（充值後）解除所有限制
- 管理員可在後台為用戶手動加減積分

---

## 四、涉及主要文件清單

```
client/src/components/HomeFeedback.tsx        新增
client/src/components/HomeEducation.tsx       已有（本期新增）
client/src/components/NbpEngineSelector.tsx   移除 Kling 選項
client/src/pages/Home.tsx                     加入 HomeFeedback
client/src/pages/AdminPanel.tsx               Supervisor 訪問修復
client/src/pages/Storyboard.tsx              加入 ImageUpscaleBar
client/src/pages/WechatSticker.tsx           加入 ImageUpscaleBar
client/src/pages/WorkflowNodes.tsx           Debug 模式 Supervisor 限定
client/src/pages/WorkflowStoryboardToVideo.tsx  同上
client/src/pages/RemixStudio.tsx             KlingImagePanel → Vertex AI
server/plans.ts                              CREDIT_COSTS 更新
shared/plans.ts                              同步 CREDIT_COSTS + UPSCALE_COST_OVERRIDES
server/routers.ts                            水印、PDF 封鎖、追問免費邏輯
server/routers/suno.ts                       配樂積分分源扣費
server/routers/education.ts                  教育詢價郵件發送
server/routers/feedback.ts                   已有，100 cr 獎勵邏輯
server/services/provider-manager.ts         移除 kling_image 類型
server/services/tier-provider-routing.ts    移除 kling_image 路由
server/jobs/runner.ts                        kling_image → nano_image 向後兼容
```

---

*Generated on 2026-04-24 by Cursor Agent*
