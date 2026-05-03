# GodView 戰略扉頁畫廊 · 關鍵升級說明（upgradecritical）

## 目標

補齊 **GodView 完成後** 的「交互式戰略扉頁畫廊」：從報告 Markdown 的 `##` 章節自動提煉標題與至多 500 字上下文，一鍵調用 **免積分** 生圖路由，生成 STRATEGIC 模式 9:16 扉頁；試讀水印與整單 `strategicImagesTrialWatermark`（首購嘗鮮）嚴格對齊，避免僅靠正文內嵌圖帶來的視覺張力不足。

## 後端

### `mvAnalysis.generateGodViewChapterPosters`（`server/routers.ts`）

- **鑑權**：`protectedProcedure`，必須登入。
- **輸入**：`jobId` + `chapters[]`，每項含穩定 `id`、`title`、`context?`（最多 24 章）。
- **護欄**：
  - `readJob(jobId)` 且 `userId` 匹配；
  - 僅允許 `completed` / `awaiting_review`；
  - `reportMarkdown` 過短則拒絕（防濫用占用生圖算力）。
- **主路徑（文生圖職責，補記）**：
  - **Gemini**：`buildChapterPosterGeminiTask` + `runGemini31ProPreviewText` — **雙語編導**人設，讀中文標題與節選，產出 **一條英文視覺 prompt**（**GPT-IMAGE-2 不翻譯、只接收英文**）。
  - **GPT-IMAGE-2**：`generateGptImage2FromRawEnglishPrompt`（9:16 + 可選試讀 prompt 尾綴），失敗則 Imagen 兜底（見 `proxyImageService`）。
- **兜底**：若 Gemini 或主路徑出圖失敗，回退 **`generateImageGpt2WithImagenFallback`（`mode: "STRATEGIC"`, `isTrial`；畫內零字策略）**。
- **水印**：**不信任**客戶端「是否首購」傳參；以任務落盤欄位 `strategicImagesTrialWatermark` 為準；試讀時在 **英文** raw prompt 末尾追加 `TRIAL_READ_WATERMARK_IMAGE_PROMPT_INSTRUCTION`。
- **扣費**：**不扣積分**；`totalCost` 恆為 `0`。
- **輸出**：`{ ok, totalCost, results: { id, title, url | null }[], isTrial }`；若全部失敗則拋錯。

### `deepResearch.status` 擴展

- 增加 **`strategicImagesTrialWatermark`**，供前端畫廊文案與 `TrialWatermarkImage` 疊加邏輯與後端一致。

## 前端（`client/src/pages/GodViewPage.tsx`）

- **`deepResearch.status` 輪詢**：`enabled` 在 `dispatched` 與 **`done`** 下均保持（仍在終態停止 `refetchInterval`），確保完成頁能讀到 `reportMarkdown` 與新欄位。
- **`strategicChapters`**：`useMemo` 掃描 `## `，正文拼至下一段 `##` 前，上下文壓到 **500 字**；`id` 為 `h2_${index}` 保證與後端回寫一致。
- **狀態**：`chapterPosterMap[id] → url`；`pollingJobId` 變化時清空，避免跨任務串圖。
- **UI**：完成卡片上方為 **橫向滾動畫廊** +「一鍵生成專屬戰略扉頁（免費）」；下方為 **報告正文預覽**（原有 `ReportRenderer`）。
- **試讀疊圖**：已生成縮略圖用 **`TrialWatermarkImage`**，當且僅當 `coverTrialWatermark === true`（與任務首購嘗鮮一致）；文案引用 `TRIAL_READ_WATERMARK_LINE`（`MVSTUDIOPRO.COM · 試讀`），與生圖 prompt 常量一致。

## 驗收要點

1. 完成一單 GodView 後，首屏下方出現畫廊；點擊一鍵生成後卡片逐個出現 9:16 圖。
2. 瀏覽器網路面板：`generateGodViewChapterPosters` 請求成功，無積分扣減相關錯誤。
3. 首購嘗鮮單：生圖與水印 overlay 均體現試讀水印；非首購單：生圖不追加試讀 prompt 尾綴且前端不疊 `TrialReadWatermarkOverlay`。
4. `npx tsc --noEmit` 通過。

## 依賴能力

- **`GEMINI_API_KEY`**：扉頁 **英文視覺 prompt**（雙語編導文本任務）。
- **`PROXY_OPENAI_API_KEY`（GPT-IMAGE-2）** + 可選 Vertex **Imagen** 兜底（與 Platform 批量生圖同棧）。
