# P0 Errors & Fixes — Part 3

**日期**：2026-04-25  
**涵蓋 PR**：#291、#292、#293、#294 + 數個 hotfix commits

---

## P0-008：兌換碼欄位位置錯誤

**現象**：`HomeRedeemCode` 元件被放在頁面底部，用戶找不到。

**根本原因**：`Home.tsx` 中 `<HomeRedeemCode />` 插入位置在 `<HomeEducation />` 之後。

**修復**：
- `client/src/pages/Home.tsx`：將 `<HomeRedeemCode />` 移至 `<HomeNoticeBar />` 正下方（頁面頂部）。

**PR**：#291

---

## P0-009：兌換邀請碼後積分不更新（雙層快取問題）

**現象**：兌換成功後積分仍顯示 0，刷新或重新登入均無效。

**根本原因**（三層）：

1. **`addCredits()` 只寫 `creditBalances`，不寫 `users.credits`**  
   `auth.me`（tRPC）讀 `users.credits`，兩表不同步。

2. **`useAuth` 雙查詢覆蓋問題**  
   `useAuth` 同時查詢 `trpc.auth.me` 與 REST `/api/me`，合併時 `apiMeQuery.data` spread 覆蓋 `trpcUser`，且 REST 查詢設定 `staleTime: Infinity`，登入時快取的 `credits: 0` 永不自動刷新。

3. **`refresh()` 只刷新 tRPC，不刷新 REST**  
   `useAuth.refresh()` 只呼叫 `meQuery.refetch()`，REST `/api/me` 快取未被清除，覆蓋後積分仍為舊值。

**修復**：
- `server/credits.ts`：`addCredits()` 在更新 `creditBalances.balance` 的同時，用 `COALESCE` 原子操作同步更新 `users.credits`。
- `client/src/_core/hooks/useAuth.ts`：`refresh()` 同時呼叫 `meQuery.refetch()` 和 `queryClient.invalidateQueries({ queryKey: ["api-me"] })`。
- `client/src/components/HomeRedeemCode.tsx`：兌換成功後額外呼叫 `queryClient.invalidateQueries({ queryKey: ["api-me"] })`。

**PR**：#291、#292

---

## P0-010：分析頁面洩漏 AI 模型名稱

**現象**：`PlatformPage` 和 `MVAnalysis` 的用戶可見文字中出現 Gemini / GPT 等供應商模型名稱。

**涉及位置**：
- `参考视觉风格 (Gemini 3.1 Flash)`
- `分析模型：Gemini 3.1 Pro Preview` 標籤
- `Gemini 2.5 Pro 正在根据你的背景生成...` 載入文字
- Debug 面板內多個「模型: gemini-xxx」行

**修復**：
- `client/src/pages/PlatformPage.tsx`：移除 3 處用戶可見模型名稱，Debug 面板改為功能描述。
- `client/src/pages/MVAnalysis.tsx`：移除 Debug 面板中的模型/服務商行。

**PR**：#292

---

## P0-011：Debug 面板對一般用戶可見

**現象**：多個頁面的 debug 面板或「调试输出」按鈕對所有用戶顯示，暴露內部實現。

**涉及頁面**：
- `RemixStudio`：3 個 `<details>调试输出</details>` 無保護直接顯示
- `TestLab`：「返回数据（调试）」面板無保護
- `AIFilmFactory`：`<pre>{JSON.stringify(debug)}</pre>` 直接渲染
- `WorkflowNodes` / `WorkflowStoryboardToVideo`：debug 按鈕以 `localStorage` 判斷 supervisor 身份，容易被繞過

**根本原因**：
- `RemixStudio`、`TestLab`、`AIFilmFactory` 完全沒有 supervisor 保護。
- `isSupervisorSession()` 只查 `localStorage.getItem("mvs-supervisor-access")`，任何訪問過 `?supervisor=1` 的用戶均可繞過。

**修復**：
- `RemixStudio.tsx`：刪除全部 3 個調試 `<details>` 區塊。
- `TestLab.tsx`：刪除「返回数据（调试）」面板。
- `AIFilmFactory.tsx`：刪除 debug `<pre>` 輸出。
- `WorkflowNodes.tsx`：引入 `useAuth()`，改用 `user?.role === "supervisor" || user?.role === "admin"` 驗證，移除 `isSupervisorSession()`。
- `WorkflowStoryboardToVideo.tsx`：同上。
- `PlatformPage.tsx` / `MVAnalysis.tsx`：Debug 按鈕保留給 supervisor，一般用戶完全不可見。

**PR**：#292、#294

---

## P0-012：積分顯示錯誤（帳號混淆）

**現象**：用戶反覆確認積分為 0，所有修復後仍無效。

**根本原因**：用戶有兩個帳號：
- `benjamintan0506@163.com`（supervisor，credits=300）
- `benjamintan0318@gmail.com`（free，credits=0，**實際使用的帳號**）

所有邀請碼兌換記錄在 163 帳號，但用戶一直用 Gmail 帳號登入，Gmail 帳號積分為 0。

**修復**：
- 直接 SQL 補丁：從 `beta_code_usages` 加總 Gmail 帳號實際兌換總額（900 credits），同步更新 `users.credits` 和 `creditBalances.balance`。
- Gmail 帳號 role 維持 `free`（測試帳號，不升為 supervisor）。

**涉及帳號**：
| 帳號 | Role | Credits |
|------|------|---------|
| benjamintan0506@163.com | supervisor | 300 |
| benjamintan0318@gmail.com | free（測試） | 900 |

---

## PR 清單

| PR | 標題 | 狀態 |
|----|------|------|
| #291 | 兌換邀請碼 UI 位置 + 積分即時同步顯示 | merged |
| #292 | 隱藏模型名稱 + 積分即時同步 + debug 面板權限控制 | merged |
| #293 | Fix/hide models and credits sync（CI rerun） | success |
| #294 | 移除/保護所有頁面 Debug 面板 | merged |
