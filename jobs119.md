# 執行記錄 (jobs119)

## 修正範圍與目標
本次更新針對近期代碼審查意見與 `ReferenceError` 執行最終加固與收尾，所有改動皆嚴格遵守「終極一鍵指令」標準，徹底鎖死生圖與編導環節的穩定性。

### 1. 核心底層修復：`ReferenceError` 與模型鎖定
* **`geminiPlatformCompositeTranslation.ts`**：
  * 重建並精簡 `callGemini3_1_Pro_AiStudio` 函數，使用標準 `fetch` 直連 API，移除造成超時中斷的 `AbortSignal.timeout(300_000)`。
  * **強制鎖定** `gemini-3.1-pro-preview` 作為生圖指令大腦，並正確 `export` 該函數。
* **`proxyImageService.ts`**：
  * 於檔案頂部靜態 `import { callGemini3_1_Pro_AiStudio }`，徹底解決 `ReferenceError` 問題。

### 2. 生圖長度防禦：智能濃縮 3 次重試（零物理截斷）
* **取消全部物理字串截斷**：移除 `forceTrimPromptToHardCap` 與所有強制 `.slice(0, 800)` 的破壞性操作。
* **重構 `condenseImagePromptIfNeeded`**：
  * 當生圖長度 `> 800` 時，觸發最多 3 次智能重試。
  * 傳遞全新的極簡約束指令（濃縮至 100 詞內英文視覺 Tags）。
  * 取 `condensed.trim()` 結果校驗長度，若 3 次嘗試皆失敗或結果仍 `> 800`，直接丟出 `Error` 中止生圖，以防輸出品質崩壞。

### 3. Prompt 源頭壓制：100 詞最高約束
* 將 `MAXIMUM_IMAGE_PROMPT_TAG_CONSTRAINT` 改為最精簡的三點規則，強制要求 Gemini 只輸出核心視覺關鍵詞（Tags）並以英文逗號分隔，總長度嚴格限制在 100 詞以內。

### 4. 並發安全配置 (`server/routers.ts`)
* 直接將並發設定鎖死：`const pool = input.platformType === "graphic" ? 2 : 1;`（圖文版 2 路，短影音 1 路），防止 API 請求超載。

### 5. 前端 UI 收口 (`PlatformPage.tsx`)
* **2A Cover Skeleton**：精確套用 `<span className="text-xs font-medium tracking-widest text-gray-400 px-3 text-center">...</span>` 單行樣式與對應文案。
* **3A IP Dimension Guide**：於組件底部插入：`<p className="mt-4 text-[11px] text-gray-500">提示：在上方 IP 定位中描述得越具体，内容生成越精准。</p>`。

## 檢查結果
* `tsc --noEmit` 檢查全數通過，無任何語法錯誤或遺漏變數宣告 (`ctxStr` / `copywriting` 已正常回填)。
* 所有修改皆直接覆蓋當前 PR。