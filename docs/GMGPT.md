# GMGPT — 雙語編導翻譯 + GPT-IMAGE-2 原生 2×4 平台合成管線

**文檔日期**：2026-05-04  
**適用倉庫**：`mvstudiopro`（平台頁分鏡 / 小紅書單張合成大圖）  
**代號說明**：前置步驟將中文劇本轉為英文生圖指令；**實際出圖一律採用 GPT-IMAGE-2**（經既有 API 閘道；主路徑失敗時另有系統內建兜底，不在此披露具體後端名稱）。  
**職責邊界（補記）**：**雙語編導人設僅用於 Gemini 文本任務**（讀中文、組裝**一條完整英文視覺 prompt**）；**GPT-IMAGE-2 只接收該英文串做文生圖**，不承擔翻譯、不應假設其「讀懂中文 raw」。

---

## 1. 產品目標

- **廢除**平台頁分鏡表 / 小紅書卡片的 **DOM 疊字、網格遮罩** 等複雜前端排版。
- **改為**：先以**雙語編導式翻譯**將中文劇本整理成帶有「**簡體中文排版死命令**」與「**動態高級背景**」說明的 **英文生圖 prompt**，再交由 **GPT-IMAGE-2** 一次性產出 **原生 2×4 圖文大圖**（字在畫內）。
- **計價**：分鏡圖文參考、小紅書圖文參考 **統一 16 Credits / 次**（`platformStoryboardSheet` 與 `platformXhsDualNote` 同價）。

---

## 2. 架構流程

```text
中文 scriptContext（≤12000，翻譯任務內截斷 3500）
    → 編導級英文 prompt 組裝（分鏡 / 小紅書兩套模板）
    → 翻譯服務（專用 API Key，詳見部署環境）
    → 純英文 final prompt 字串
    → GPT-IMAGE-2 生成（PROXY_OPENAI_API_KEY 等既有生圖閘道）
    → 主路徑失敗時走系統內建兜底出圖
```

**對外說明口徑**：圖片生成採用 **GPT-IMAGE-2**。

**同型管線補記（代碼已接線者）**：戰略智庫封面、GodView 章節扉頁、平台選題單張參考圖等，同樣為 **Gemini 產出英文 raw prompt → `generateGptImage2FromRawEnglishPrompt`（GPT-IMAGE-2）**，失敗再回退既有 Vertex / Imagen / `generateImageGpt2WithImagenFallback` 等路徑；細節以倉庫實作為準。

---

## 3. 關鍵檔案

| 路徑 | 職責 |
|------|------|
| `server/services/geminiPlatformCompositeTranslation.ts` | 翻譯任務組裝、`translatePlatformCompositeToEnglishPrompt`、`runGemini31ProPreviewText`；任務內含 **bilingual 編導人設**及 **CRITICAL PIPELINE**（明示下游僅 GPT-IMAGE-2、不翻譯） |
| `server/services/proxyImageService.ts` | `generatePlatformCompositeSheetImage`：先翻譯再生圖（**GPT-IMAGE-2** 主路徑）；`generateGptImage2FromRawEnglishPrompt`（已定稿之英文 prompt → GPT-IMAGE-2 + 兜底） |
| `server/services/deepResearchService.ts` | on-demand / 非同步封面：Gemini 英文指令 → GPT-IMAGE-2 優先，失敗再走 Fly Vertex / Consumer Flash |
| `server/routers.ts` | `generatePlatformCompositeSheet`、`generateTopicImage`、`generateAllPlatformTopicImages`、`generateGodViewChapterPosters` |
| `shared/plans.ts` / `server/plans.ts` | 兩類合成均 **16** 點及說明表 |
| `client/src/pages/PlatformPage.tsx` | **分鏡圖文參考**全寬卡片，僅嵌圖 + `contain`；**對外 UI 僅高亮 GPT-IMAGE-2**；**「參考分鏡圖文」橫向滾動欄**（`referenceStoryboardGraphicStrip`）匯總批量單幀與 **2×4 合成**，**僅展示、不可點擊滾動定位**；選題卡仍帶 `execution-card-…` id |
| `server/services/htmlReportTemplate.ts` | 分鏡 / 小紅書區塊改為 **單 `<img>`**，無絕對定位網格與 HTML 疊字 |

---

## 4. 環境變數（僅列類別，不寫具體模型名）

| 變數 | 說明 |
|------|------|
| 翻譯服務 API Key | **必填**。缺失則翻譯失敗，合成整體失敗並退點（依路由邏輯）。實作對應如 `GEMINI_API_KEY`。 |
| 翻譯用模型覆寫（可選） | 部署時若需指定後端推理實例，使用環境變數覆寫（如平台合成 `GEMINI_PLATFORM_COMPOSITE_MODEL`、封面類 `GEMINI_COVER_PROMPT_MODEL`）；**對外文案仍不寫具體名稱**。 |
| 生圖閘道 | 與 **GPT-IMAGE-2** 對接所需之既有密鑰（如 `PROXY_OPENAI_API_KEY`）。 |
| 兜底出圖 | 沿用專案既有配置；對外可統一表述為「主路徑失敗時自動兜底」。 |

---

## 5. Prompt 規格（摘要）

### 5.1 分鏡（`storyboard_sheet_portrait` / `landscape`）

- 餵給 **GPT-IMAGE-2** 的英文 prompt **必須以**  
  `Cinematic 2x4 grid storyboard, 1k resolution, high quality, intricate details, dramatic film stills.` **開頭**（語義解析度描述；實際像素以 API 允許的橫版尺寸為準）。
- 含固定「**主標 + 每格簡體說明 + 下方燈光/鏡位/服裝/動作簡體網格**」的英文指令句。
- 含 **動態背景** 色調描述。
- **補記**：Gemini 側人設為 **bilingual Master Film Director + Prompt Engineer**，並帶 **CRITICAL PIPELINE**，強制「中文僅在此階段吸收；下游影像模型只接英文」。

### 5.2 小紅書（`xiaohongshu_dual_note`）

- 餵給 **GPT-IMAGE-2** 的英文 prompt **必須以**  
  `Cinematic 2x4 grid Xiaohongshu visual note layout, 2k high resolution, magazine editorial style, masterpiece.` **開頭**。
- 含 **主標簡體、每格下簡體、最後 2–3 格核心價值簡體 bullet** 等固定英文指令句。
- 含 **動態高級背景**。
- **補記**：Gemini 側人設為 **bilingual Master Art Director + Social Media Visual Strategist**，同樣含管線說明。

### 5.3 翻譯步驟行為

- 翻譯服務回傳僅允許 **最終英文 prompt 字串**（實作會嘗試去除 ``` 围栏與首尾引號）。

---

## 6. 前端與 HTML/PDF

- **平台頁**：合成結果與 loading 共用 **「分鏡圖文參考」** 大卡片；標籤 **原生 2×4**；**不展示任何後端模型名稱**；**對外句式採「生图采用 GPT-IMAGE-2」**：`GPT-IMAGE-2` **始終保留英文**，不以簡體字直接拼在品牌後當釋義（如不寫「GPT-IMAGE-2 生圖」「使用 GPT-IMAGE-2 生成…」這類緊貼中文動詞）；且畫面上不出現 **Gemini** 字樣。
- **「參考分鏡圖文」橫排卡片（必備欄位）**：置於「高定分鏡腳本畫廊 / 圖文筆記配圖畫廊」區塊內、選題網格**上方**，橫向滾動展示**全部選題**之（1）批量單幀、（2）分鏡 2×4 合成、（3）小紅書 2×4 合成；生成中狀態可佔位；**不提供「定位至卡片」按鈕或點擊捲動**。
- **HTML 匯出**：`buildHtmlStoryboardSheetSection`、`buildHtmlXhsNoteSection` 僅 **區塊標題 + 全寬圖**，與「畫內已排版」一致。
- **已移除**：`shared/xhsDualNoteBullets.ts` 及依賴（不再需要從 `actionableSteps` 抽 bullet 做 HTML 疊加）。

---

## 7. 驗收建議

1. 正確配置翻譯與 **GPT-IMAGE-2** 閘道後，在平台頁各觸發「分镜图文参考」「小红书图文参考」，確認扣 **16** 點、返回橫版大圖。
2. 圖上應可見 **簡體標題/說明**（質量隨 prompt 與出圖引擎而異；失敗時查日誌與退點）。
3. **「參考分鏡圖文」橫排出現**，批量渲染與 2×4 合成後自動匯入縮略卡；**不提供點擊定位至選題卡**。
4. 使用者可見介面無 **Gemini** 字樣，**GPT-IMAGE-2** 以高亮呈現。
5. `npx tsc --noEmit` 通過。
6. 導出 HTML：分鏡區 / 小紅書區僅 **單張 img**，無舊版網格 div。

---

## 8. 與前代（X10 / X11）的關係

- **X10 / X11**：幾何鎖定、雙軌 DOM、動態 bullet HTML 疊加 — **已由本管線取代**（字在圖內、前端/HTML 不再疊字）。
- 若需回溯設計決策，可對照同目錄 **`X10.md`、`X11.md`**；**GMGPT.md** 記錄 **當今上線意圖**之管線。
