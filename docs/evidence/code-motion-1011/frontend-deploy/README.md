# PR1694 前端部署失敗核對

失敗部署對應 main `ace1e0d0bb5dd468991d02172a462ff564ecdcbc`，GitHub Actions run38084296209 的 Deploy app成功，前台發版檢查失敗；deployment6986531587狀態failure，Vercel deployment ID dpl_E3KANcHMPW1gzComqTcw8SrYhe7F。

## 已確認的失敗原因

用戶截圖顯示 `Git information retrieval failed for this deployment`，Duration 為 `—`。2026-10-10 20:37:50 UTC 的 Vercel 通知郵件已由來源交接執行緒核實：GitHub fetch 回傳 **403 — exceeded a secondary rate limit**，Request ID `BC8D:35B68A:F48EAA:122C7E7:6ACAA167`，對應上述 main commit 與 deployment。

失敗發生於取得 Git 資訊／原始碼階段，尚未進入前端編譯；不是已確認的編譯錯誤，也不是倉庫授權缺失。這解釋了為何沒有一般 compiler 檔名／行號日誌。先前 CLI 回傳 HTML、瀏覽器需要登入只是讀取日誌時的限制，不是部署根因。不再要求用戶提供 compiler log。

Fly run 38084296209 整體失敗是因 frontend wait；Deploy app（含 growth checks）於 20:51:35 UTC 成功，正式 domain check 跳過。PR1697 `64e35b2ec3c669f4143f655e888d098719fff5c9` 的 preview 於 21:09:19 UTC Ready，屬獨立預覽，不能作為 main／正式前端恢復的證據。以上 UTC 時間的本地日期為 2026-10-11（Asia/Shanghai）。

可驗證的結果：
- ace1e0d0已完整併入PR1697，祖先檢查成功；無需重複搬移或cherry-pick。
- 原失敗commit用git archive隔離，在現有本機依賴上執行同一 `pnpm exec vite build`，exit0，1m11s。不是Vercel環境或重新安裝依賴驗收。
- vercel.json、.vercelignore、vite.config.ts、package.json及pnpm-lock.yaml在PR1694沒有改動。
- 16個生產前端/shared變更檔312個本地匯入均存在且大小寫正確，未發現新server/Node runtime匯入。
- PR1697整合版本全庫TypeScript與Vite build已成功，证据见../root-integration/extension。

尚無正式前端恢復證據。本次只補充已核實的部署故障說明，不新增代碼修復、不更改 Git 整合設定、不自行重試部署。郵件原始連結留於原本本地知識庫，避免將私人信箱資訊提交至倉庫。
