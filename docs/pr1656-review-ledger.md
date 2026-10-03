# PR #1656 跨檔案審查台帳

基線：`f2e1c571e3c57de38ca6c34aec133070b85b178d` → 已推 `797effa48f7f7b649293fb184c5f4b533859e903`（38檔，2105增178刪），另審本次未提交知識卡刷新取消。使用者明確要求一位子代理審查；子代理只讀業務檔，主代理修復、驗證、推送。所有 PR 合併由用戶本人執行。

| ID | 嚴重度／狀態 | 可重現問題、修復與證據 |
|---|---|---|
| F1 | P1 · OPEN（範圍待確認） | 刷新取消只覆蓋讀檔、提煉、派生；圖片由 `generatePlatformCompositeSheet` 背景閉包執行，已提交頁仍可生成，既有 `posterResume` 仍恢復結果。新增 `assertLive` 與頁離開旗標只能停後續頁。已向用戶明確詢問是否包含出圖，尚未取得排除授權；不能聲稱所有卡片任務刷新即完全終止。外部已建單的費用不能保證撤回。 |
| F2 | P2 · CLOSED_LOCAL，子代理已複核 | `callNovelStage` 把 HTTP200 SSE `{error:{code:401}}` 當斷流，轉 DeepSeek。子代理隔離反例實際呼叫2次；日誌 `/tmp/pr1656-review-stream.log`。修復：SSE reader 新增可選結構化錯誤回調，小說鏈以結構化 status 分類；401/403/安全/未知錯誤停止，429等明確暫時錯誤可fallback。原共享reader無回調時行為不變。子代理已靜態複核；小說13項（另含非SSE錯誤體）與共享讀流38項回歸通過（`/tmp/pr1656-novel-final-tests.log`、`/tmp/pr1656-stream-regression.log`）。 |

其餘已靜態追查：DOC/DOCX/PDF/OCR/EPUB 匯入與 worker 資源、模板→小說→劇情、原稿保存與局部改寫、漫劇畫布篩選、字幕參數。第一輪未發現其他有充分證據的阻斷；不把未付費驗證、未上線或文學品質未實測寫成無錯。

驗證口徑：初次類型檢查有 MapIterator/ES5 錯已修；共享 node_modules 的 tsbuildinfo 寫入受限，改用 `/tmp/knowledge-refresh.tsbuildinfo` 後檢查exit0。初次沙箱瀏覽器未完成已中止；獲准本機隔離瀏覽器跑15項通過，新刷新模組再定向5項通過。未合併、未部署，沒有新增付費上游生成。F1 尚開放，因此不是「整張 PR 無阻斷／可合併」結論。
