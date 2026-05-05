# modified — 平台頁生圖翻譯 & 分鏡畫廊（備援於 PR #416）

> 若 **PR #416** 未合併或需手動對照，以本檔與下列 commit 為準。

## 分支

- 建議分支：`pr/vertex-platform-merge-2026-05-05`
- 關鍵 commit：`3f0a891`（及其祖先上的 merge / Vertex `maxOutputTokens` 等）

## 變更摘要

### 1. 翻譯斷鏈（Vertex 404）→ AI Studio

| 檔案 | 說明 |
|------|------|
| `server/services/geminiPlatformCompositeTranslation.ts` | `callGemini31ProForImagePrompt` 改為 **`GEMINI_API_KEY`** + `gemini-3.1-pro`（`generativelanguage.googleapis.com`），不再經 Vertex 做 **2×4 / 小紅書合成** 的英文化 prompt。 |
| 同檔 | `runGemini31ProPreviewText` **維持 Vertex**（戰略封面 / 扉頁等「文案」路徑）。 |

### 2. Prompt：情緒字色 + 小紅書雙卡

| 檔案 | 說明 |
|------|------|
| `server/services/geminiPlatformCompositeTranslation.ts` | 分鏡 / 小紅書模板加入 **Typography Color & Emotion**（禁全白、要高對比與情緒張力）。 |
| 同檔 | 小紅書開頭改為 **16:9、2×4、左右雙豎卡**（Cover / Value bullets）。 |
| 同檔 | `buildPlatformTopicReferenceGeminiTask` 補一條色勒令（選題單幀參考）。 |

### 3. 平台頁 UI：頂欄只秀合成圖 + 折疊強化

| 檔案 | 說明 |
|------|------|
| `client/src/pages/PlatformPage.tsx` | 頂部區塊標題改 **「视频图文分镜表」**，副標說明封面在下方卡片。 |
| 同檔 | `referenceStoryboardGraphicStrip` **不再 push `batchUrl`（批量單幀封面）**，橫滑僅 **分鏡 2×4 / 小紅書 2×4**（與 loading pending）。 |
| 同檔 | `details > summary`：**橘色、`font-black`、`animate-pulse`**，文案含「点击展开…」。 |
| 同檔 | `handleDownloadPlatformPdf` 註釋：與 **GodView / MyReports** 相同 DOM → `downloadPlatformPdf` → pdf-worker 鏈路。 |

### 4. 其他（同分支歷史，可一併對照）

- `server/_core/llm.ts`：Vertex `maxOutputTokens` 寫入 `generationConfig`；json 模式預設上限等。
- `server/jobs/runner.ts`：`platform_analysis` stage 輸出上限、修正重複 `max_tokens`、parse 失敗日誌。
- `server/services/proxyImageService.ts`：`callGemini3_1_Pro` AI Studio 版（與 Vertex 檔並存時請以實際 import 為準）。

## 環境變數

- **2×4 / 小紅書英文化 prompt**：須配置 **`GEMINI_API_KEY`**。
- **封面 / 前半段 Vertex 文案**：仍依 **`GOOGLE_APPLICATION_CREDENTIALS_JSON`**、GCP 專案等。

## 驗收建議

1. 平台頁對某選題點 **分鏡圖文參考 / 小紅書圖文參考**：Network 不應再因 Vertex 翻譯 404 整條掉進無字 Nano 兜底（在日誌確認已走 AI Studio）。  
2. 頂部橫滑：**不出現**僅批量封面的單幀，只見 2×4 合成（若已生成）。  
3. **折叠**「执行细项…」視覺為橘色並有 pulse。  
4. `npx tsc --noEmit` 通過。

---
*檔名約定：若需 `.nd` 副檔名請自行複製為 `modified.nd`；內容以本 Markdown 為準。*
