# Jobs and Codes — 2026 Apr 25

## 本次工作摘要

### 🗄️ 資料庫遷移 MySQL → Neon PostgreSQL（PR #283）

**關鍵修改**：

| 檔案 | 變更 |
|------|------|
| `server/db.ts` | `drizzle-orm/mysql2` → `neon-http`，`onDuplicateKeyUpdate` → `onConflictDoUpdate`，PostgreSQL 日期函數 |
| `drizzle/schema*.ts`（18個） | `mysqlTable` → `pgTable`，`int().autoincrement()` → `serial()`，`int()` → `integer()`，移除 `.onUpdateNow()`，`mysqlEnum` → `text()` |
| `server/db-extended.ts` | 6 處 `result[0].insertId` → `.returning({id: table.id})` |
| `server/routers/workflow.ts` | 4 處 insertId 修正 |
| `server/routers/emailOtp.ts` | 2 處 insertId 修正 |
| `server/routers/beta.ts` | 2 處 insertId 修正 |
| `server/routers/emailAuth.ts` | insertId 修正 |
| `server/routers/authApi.ts` | 2 處 insertId 修正 |
| `server/routers/videoSubmission.ts` | insertId 修正 |
| `server/routers/creations.ts` | insertId 修正 |
| `server/services/video-short-links.ts` | `onDuplicateKeyUpdate` → `onConflictDoUpdate` |
| `drizzle.config.ts` | `dialect: "mysql"` → `"postgresql"` |

---

### 🖼️ 試用包圖片水印（PR #283）

**新增組件**：
- `client/src/components/TrialWatermarkImage.tsx`
  - SVG 對角線平鋪水印「試用版 · mvstudiopro」
  - 中央大字浮水印「試用版 · 僅供預覽」
  - `onContextMenu preventDefault`（禁止右鍵另存）
  - `onDragStart preventDefault`（禁止拖曳保存）
  - 透明遮罩阻擋操作

- `client/src/_core/hooks/useIsTrialUser.ts`
  - 透過 `trpc.usage.getUsageStats` 判斷是否試用包

**套用頁面**：
- `RemixStudio.tsx` — 參考圖生成
- `VirtualIdol.tsx` — 虛擬偶像生成（隱藏下載按鈕）
- `PlatformPage.tsx` — 平台趨勢圖片
- `WechatSticker.tsx` — 微信貼圖
- `Storyboard.tsx` — 分鏡場景圖

---

### 📁 用戶作品保留策略（PR #283）

**修改**：
- `server/routers.ts`：分鏡腳本 `recordCreation` 新增 `metadata.script` 和 `metadata.fullScript`，保存完整腳本文字
- `client/src/components/CreationManager.tsx`：
  - 視頻類型顯示「請下載」提醒徽章（藍色）
  - 頂部添加橙色提醒橫幅：「視頻有過期時限，請及時下載；圖片和腳本已永久保存」
  - 分鏡類型在卡片下方顯示腳本預覽

**保留策略**（schema 已定義）：
- 圖片/腳本：永久保存在 `user_creations` 資料庫
- 視頻：URL 有效期依方案（免費 10 天，Pro 3 個月），提醒下載

---

## PR 記錄

| PR | 標題 | 狀態 |
|----|------|------|
| #282 | feat: 資料庫遷移 MySQL → Neon PostgreSQL（不完整） | Merged（有缺失） |
| #283 | fix: 完整 MySQL→Neon PostgreSQL 遷移 + 試用包水印 + 作品保留 | **待 Merge** |

---

## 待確認事項（Merge PR #283 後）

1. **邀請碼生成**：管理後台 → 邀請碼 → 生成，確認出現在列表
2. **試用包水印**：使用試用包帳號在 RemixStudio 生成圖片，確認水印顯示且無法右鍵
3. **資料庫連接**：Fly.io logs 不再出現 `MySqlSelectBase`，改為 Neon 連接
4. **用戶登入**：OTP 登入、郵箱密碼登入正常

---

## 環境資訊

| 項目 | 值 |
|------|-----|
| 生產 URL | https://mvstudiopro.fly.dev |
| 自訂域名 | https://mvstudiopro.com |
| 資料庫 | Neon PostgreSQL（ap-southeast-1） |
| 部署平台 | Fly.io（app: mvstudiopro） |
| GitHub Repo | gabrieltan0506-prog/mvstudiopro |
