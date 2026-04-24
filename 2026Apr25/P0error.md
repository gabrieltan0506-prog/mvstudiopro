# P0 錯誤記錄 — 2026 Apr 25

## 🔴 P0-001: Neon PostgreSQL 遷移程式碼未實際提交入 PR

**發現時間**: 2026-04-25 04:23 UTC+8  
**嚴重程度**: P0 — 功能完全無法運作  
**狀態**: ✅ 已修復（PR #283）

### 問題描述
PR #282（資料庫遷移 MySQL → Neon PostgreSQL）的 commit `6083336` 實際上只包含：
- `drizzle.config.ts`（dialect 改為 postgresql）
- `package.json`（新增 @neondatabase/serverless）
- `pnpm-lock.yaml`

**以下關鍵檔案完全沒有提交**：
- `server/db.ts` — 仍使用 `drizzle-orm/mysql2`
- `drizzle/schema*.ts`（18個）— 仍使用 `mysqlTable`、`int().autoincrement()`
- `server/db-extended.ts` — 仍使用 `result[0].insertId`
- 所有 router 檔案 — 仍使用 `insertId`、`onDuplicateKeyUpdate`

### 根本原因
本地編輯未被 `git add` 加入，commit 時只帶入少數檔案。

### 影響
- 生產環境（Fly.io）日誌顯示 `MySqlSelectBase`，確認使用 MySQL driver 嘗試連接 Neon PostgreSQL URL，導致所有資料庫操作失敗
- 邀請碼無法生成
- 用戶無法登入/註冊
- 所有需要資料庫的功能失效

### 修復
PR #283 重新提交所有正確的遷移代碼：
1. `server/db.ts`: `neon-http` driver，`onConflictDoUpdate`，PostgreSQL 日期函數
2. 18 個 schema 檔案: `pgTable`、`serial()`、`integer()`
3. 所有 `insertId` → `.returning({id})`（共 20+ 處）
4. TypeScript 零錯誤確認

---

## 🔴 P0-002: 邀請碼生成持續失敗（多次返工）

**發現時間**: 2026-04-24（多次）  
**嚴重程度**: P0 — 核心管理功能失效  
**狀態**: ✅ 修復中（依賴 P0-001 修復後驗證）

### 問題歷程
1. **第一次**：前端未 refetch，AdminPanel 不顯示新代碼 → 修復 refetch 邏輯
2. **第二次**：`supervisor` 角色被 AdminPanel 擋在外面 → 修復 role 檢查
3. **第三次**：資料庫表格 `beta_invite_codes` 在生產環境不存在 → 實作 `ensureBetaTables()`
4. **第四次**（P0-001 根因）：資料庫完全無法連接，MySQL driver 連 PostgreSQL URL

### 修復
- `ensureBetaTables()` 使用 Drizzle `sql` 模板
- PR #283 修復資料庫連接

---

## 🟡 P1-001: 生產環境 credits 顯示 9999

**發現時間**: 2026-04-24  
**嚴重程度**: P1 — 數據顯示錯誤  
**狀態**: ✅ 已修復（PR #281）

### 問題
`authApi.ts` 中當資料庫不可用時，fallback credits 設為 `9999` 而非 `0`，導致用戶看到假積分。

### 修復
`if (!db)` 分支改為 `credits: 0`。

---

## ⚠️ 教訓

1. **部署前必須線上驗證**：每次 PR merge 後，在請用戶測試前必須先自行用 curl/browser 驗證 API 回應正確
2. **commit 前確認 `git status`**：確保所有修改的檔案都在 staging area
3. **不要提交「沒做的功能」**：PR 描述必須與實際提交內容一致
