# 部署與協作邊界（須遵守）

> **用途**：凡觸及「改動要讓線上用戶生效」時，**人工與自動化（含 AI 輔助）**均須對照本文件。  
> **復盤節奏**：負責人可約 **每 10 小時**對照一次，避免口頭約定被遺忘。

---

## 1. 線上生效

- 使用者明確要求 **「線上生效」「推到線上」「部署」** 時：以 **遠端可構建 / 可發版** 為完成標準。
- **禁止**只做本地 `git switch` / `reset` / `merge` 卻宣稱已生效。
- **`git push` 失敗**（憑證、權限、衝突）時：**當場說明錯誤原文**與已嘗試步驟，不裝作已完成。

## 2. 線上部署通道（Fly only）

- **生產與預覽部署只走 Fly**（`main` → GitHub Actions `Fly Deploy` → `https://mvstudiopro.fly.dev`）。
- **關閉 Vercel Git 自動部署**：`vercel.json` 已設 `git.deploymentEnabled: false` / `github.enabled: false`。不要再開 Vercel Preview、不要把 Vercel 當門禁。
- 使用者明文要求線上生效時：以 **Fly Deploy success** 為準，不以 Vercel 狀態為準。
- Agent **可**在對方要求部署時操作 Fly / `fly.toml` / Fly Deploy workflow；**禁止**為了驗證而去觸發 Vercel 部署。

## 3. Git / PR（與本倉庫 `.cursor/rules` 對齊）

- 改動落在 **功能分支**，**push 分支** 並以 **PR 合併 `main`** 為常規路徑（除非對方聲明緊急直推）。
- **開 PR 日上限**：同一自然日 **`gh pr create` ≤ 20**；另須遵守兩次 create ≥15 分鐘、串行合併、上一 Fly Deploy success 才可合下一刀。詳見 [`.cursor/rules/git-pr-workflow-always.mdc`](../.cursor/rules/git-pr-workflow-always.mdc)。

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
