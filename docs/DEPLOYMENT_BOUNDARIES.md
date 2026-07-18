# 部署與協作邊界（須遵守）

> **用途**：凡觸及「改動要讓線上用戶生效」時，**人工與自動化（含 AI 輔助）**均須對照本文件。  
> **復盤節奏**：負責人可約 **每 10 小時**對照一次，避免口頭約定被遺忘。

---

## 1. 線上生效

- 使用者明確要求 **「線上生效」「推到線上」「部署」** 時：以 **遠端可構建 / 可發版** 為完成標準。
- **禁止**只做本地 `git switch` / `reset` / `merge` 卻宣稱已生效。
- **`git push` 失敗**（憑證、權限、衝突）時：**當場說明錯誤原文**與已嘗試步驟，不裝作已完成。

## 2. 線上部署通道（Fly API + Vercel 前台）

- **API / Worker**：`main` → GitHub Actions `Fly Deploy` → `https://mvstudiopro.fly.dev`（及 `api.mvstudiopro.com`）。
- **正式域名前台（www）**：`main` → **Vercel Git 自動部署**（`vercel.json`：`git.deploymentEnabled: true` / `github.enabled: true`）。合進 `main` 後前台與 API 各自發版。
- 使用者明文要求線上生效時：前台看 **Vercel production Ready**，長請求/API 看 **Fly Deploy success**；兩者都要對上才算完整。
- **不要把 Vercel Preview 當 CI 門禁**；驗證正式域名以 production 為準。

## 3. Git / PR（與本倉庫 `.cursor/rules` 對齊）

- 改動落在 **功能分支**，**push 分支** 並以 **PR 合併 `main`** 為常規路徑（除非對方聲明緊急直推）。
- **開 PR**：① **上一張未 MERGED 禁止開新 PR**（只許 push 叠進既有分支）；② 兩次 create **≥20 分鐘**；③ 同日 **≤20**；④ 上一 Fly Deploy success 才可合下一刀。詳見 [`.cursor/rules/git-pr-workflow-always.mdc`](../.cursor/rules/git-pr-workflow-always.mdc)。

## 3b. 視頻生成測試探針

- **一律 Seedance 2.0 Mini · 480p**（默認約 5s）。禁止探針默認打標準 2.0 / 高分辨率 / 2.5。詳見 [`.cursor/rules/seedance-probe-always.mdc`](../.cursor/rules/seedance-probe-always.mdc)。

## 4. 任務完整性

- 對方指令若包含「推上去 / 合併 / 開 PR」，**缺一環範即未完成**。
- 避免用泛泛的「安全」「不越界」取代 **對方已聲明的交付物**。

## 5. 與本倉庫其他規則的關係

- **PR 工作流**：見 [`.cursor/rules/git-pr-workflow-always.mdc`](../.cursor/rules/git-pr-workflow-always.mdc)。
- **AI 自動提醒**：見 [`.cursor/rules/deployment-boundaries-always.mdc`](../.cursor/rules/deployment-boundaries-always.mdc)。

---

*本文件為產品/流程約定，可透過 PR 修訂。*
