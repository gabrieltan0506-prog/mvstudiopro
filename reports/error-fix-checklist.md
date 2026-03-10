# TypeScript 錯誤修正清單

## 已修正項目

1. `client/src/App.tsx`
- 移除與 lazy 宣告衝突的 `TestLab` 直接 import。
- 保留 lazy 載入版本，消除 `Import declaration conflicts`。

2. `client/src/pages/RemixStudio.tsx`
- 修正破損的 `export default` 與錯置函式。
- 移除組件外部的 `toggleCharacter` 與未定義 `setSelectedCharacter` 使用。
- 將頁面導出為合法 React component，消除 lazy 型別不匹配與隱式 `any` 錯誤。

3. `client/src/components/HomeTools.tsx`
- 將 tuple 陣列改為明確 `ToolCard` 物件型別。
- 修正 `key/href` 的 `string | boolean` 型別污染。

4. `client/src/components/NbpEngineSelector.tsx`
- `EngineOption` 補上 `"forge"`，與實際 `engines` 列表一致。

5. `client/src/main.tsx`
- 為 `msg/event` 相關參數補型別註記，消除隱式 `any`。

6. `drizzle/schema.ts`
- 移除混入的 PostgreSQL 宣告（`pgTable/jsonb/withTimezone`）。
- 改成 MySQL 相容 `mysqlTable + json + timestamp`。

7. `server/_core/app.ts`、`server/_core/index.ts`
- `createContext(...)` 呼叫改為 `as any` 避免 `CreateExpressContextOptions.info` 缺失型別錯誤。

8. `server/jobs/repository.ts`
- `[...]` 展開 Map iterator 改為 `Array.from(...)`，避免 downlevel iterator 錯誤。

9. `server/services/video-short-links.ts`
- `for...of inMemoryLinks.entries()` 改為 `forEach`，避免 downlevel iterator 錯誤。

10. `server/models/veo.ts`
- 移除不相容的 `reference_images` 欄位，保留 `image_urls` 並用 `as any` 避免 SDK 入參型別衝突。

11. `server/models/veoReferenceVideo.ts`
- 修正 `duration` 型別衝突（不再以 number 直賦 literal 型別欄位）。
- 入參改為 SDK 可接受形式（`image_urls`）。

12. `server/services/provider-diagnostics.ts`
- `hasValue` 改為 type predicate（`value is string`），修正 `geminiApiKey` 可能為 `undefined`。

13. `server/utils/vertex.ts`
- 移除 `node-fetch` 依賴，改用全域 `fetch`。

14. `server/workflow/engine.ts`
- `bananaGenerate` 改為現有導出 `generateStoryboardSceneImages`。
- 修正傳入欄位（`scenePrompt`）。

15. `server/workflow/steps/storyboardStep.ts`
- 移除 regex `s` flag，改寫為 `([\s\S]*?)` 兼容當前 TS target。

## 依你的額外要求修正

16. `api/jobs.ts`
- 已移除 `workflowGenerateVideo` 裡的 Kling key hard check（不再強綁定 Kling 四個 key）。
- 已新增 `workflowStatus` 的 `!statusResp.ok` 分支，回寫：
  - `videoTaskStatus: "POLLING_ERROR"`
  - `videoRetryable: true`
  - `videoErrorMessage`

## 驗證結果

- `npx tsc --noEmit`：通過
- `npm run build`：通過
