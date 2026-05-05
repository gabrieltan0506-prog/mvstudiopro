# Platform 高定收口說明（mdx）

> **PR #420**：https://github.com/gabrieltan0506-prog/mvstudiopro/pull/420  
> **分支**：`fix/platform-mod06-gemini-preview-ui`  
> 本檔彙總同 PR 內「翻譯後端 + 平台頁 UI/畫廊」相關提交，供審閱與 merge 前對照。

---

## 提交索引（此 PR 相對於已合併 #419 後的 `main`）

| Commit | 摘要 |
|--------|------|
| `6e2d8f6` | AI Studio 翻譯改 `gemini-3.1-pro-preview`；具名英文色彩死命令；選題卡片去掉虛線占位與卡片內 2×4 大區塊 |
| `09fc84a` | 頂部 **`PLATFORM_REFERENCE_GALLERY_ID`** 改 **Grid** + **`ImageUpscaleBar`**，資料源沿用 `referenceStoryboardGraphicStrip` |
| `1fe5eec` | 畫廊卡片精裝：頂欄、粉/綠標籤、`min-h-[300px]` + `max-h-[600px]`、`object-contain`、pending 色與文案 |

---

## 1. 後端：`server/services/geminiPlatformCompositeTranslation.ts`

- **`callGemini31ProForImagePrompt`**（含 **`translatePlatformCompositeToEnglishPrompt`**、與 routers 內選題單幀翻譯）請求 **Google AI Studio**：  
  `…/models/gemini-3.1-pro-preview:generateContent`，避免 **`gemini-3.1-pro`** 節點 404 → 空 `imageUrl`。
- **`buildVideoStoryboardGeminiPrompt` / `buildXhsNoteGeminiPrompt` / `buildPlatformTopicReferenceGeminiTask`**：輸出中須逐字包含 **具名英文色**（如 blood red / neon cyan / golden yellow），禁止只寫籠統 emotional colors。

---

## 2. 前端：`client/src/pages/PlatformPage.tsx`

### 選題卡片（精簡）

- **`details` + 文案**、**單幀** `platformImageMap`（無圖 **`null`**，無虛線框）。
- **單一智慧按鈕**：依 `item.format` 觸發分鏡表或小紅書雙卡；**不再**在卡片底部渲染 `showVisualReference` 大預覽區。

### 頂部 2×4 / 小紅書畫廊

- **`id={PLATFORM_REFERENCE_GALLERY_ID}`**：**`md:grid-cols-2`**，每格對應 **`referenceStoryboardGraphicStrip`** 一條（含 **pending**，同一選題可分「分镜」與「小红书」兩卡）。
- **`onUpscaled`**：依 **`ref.key.includes("xhs-sheet")`** 寫入 **`platformXhsNoteMap`** 或 **`platformStoryboardSheetMap`**。
- **視覺**：深灰卡片、頂欄標題 + 粉/綠 **`kindLabel`** pill、圖區自適應比例、底部 **ImageUpscaleBar**。

### PDF 快照（若當前分支已含 #419 合併線）

- 僅克隆 **`#platform-report`**、`optimizePdfSnapshotHtml`、**`injectPlatformPdfSnapshotSanitizeIntoHead`**、**`details`** 行內展開、圖片 **lazy→eager / load / decode** 等（詳見 `main` 上 #419 歷史）。

---

## 3. 與 mod06 / mod2 檔案關係

- 早期在 **`~/Downloads/2026May6/mod06.md`**、**`mod2.md`** 曾記錄對應邏輯；**`mdx.md`（本檔）** 為倉庫內單一匯總，與 **PR #420** 一併審閱即可。

---

## 審閱完成後

- 於 GitHub **Merge PR #420** → `main`，即可一次帶上上述後端與畫廊體驗。
