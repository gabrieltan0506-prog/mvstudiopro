# 圖片元素局部矩形揭示

基線 HEAD：`bf42ff4e6ee8a462c86b1e1dc9081288bdf57691`。本代理不commit/push/merge/deploy。

## 修改與正式路徑

- `shared/codeMotionComposition.ts`：plan/resolved image共同增加選填`revealDirection=left/right/top/bottom`，既有transform/keyframes.reveal 0..1控制。模型編排guide同步說明，`server/services/codeMotionPlan.ts`已引用同guide。
- `client/public/art-motion/engine/composition.js`：只改圖片局部clip矩形；先套原有元素旋轉/scale，再在元素local coords揭示。原cover/contain計算與drawImage不變，不壓縮原圖。save/restore保護兄弟圖層。
- 生產者／消費鏈：CodeMotionPlan guide → plan image schema → CodeMotionSceneEditor JSON解析／保存 → resolveCodeMotionCompositionImages的`...rest`保留欄位 → compileCodeMotion → artMotionSpec → CodeMotionPreview的studio iframe／artMotionRender載入同studio+composition.js。
- 未設direction時沿原非零reveal行為；reveal=0原本就不畫元素。選填字段不改既有草稿，無新素材／費用／外部請求，無覆蓋用戶媒體。

## 定向驗證

新前提是圖片局部wipe，舊通過測試不涵蓋；只新增`client/src/lib/codeMotionImageReveal.browser.test.ts`。

真JPEG：倉庫既有`client/public/showcase/shenzhen.jpg`，深圳夜景照片素材，不生成新素材。不導出新成片。11項：四方向×contain/cover（8）、35度旋轉×0.7縮放（1）、未填direction非零reveal舊行為（1）、實際React Preview range seek與export共用studio像素一致（1）。矩陣同時檢查兄弟layer、逐像素顏色、逆向seek確定性及原圖內容未被縮放到遮罩。

命令：

```sh
INK_IMAGE_REVEAL_EVIDENCE=docs/evidence/code-motion-1011/image-reveal/pixel-results.json ./node_modules/.bin/vitest run client/src/lib/codeMotionImageReveal.browser.test.ts > docs/evidence/code-motion-1011/image-reveal/test.log 2>&1
```

首次子executor sandbox執行：localhost listen EPERM，setup等待180秒後失敗、11項全skip，非產品像素失敗。原日誌`sandbox-attempt.log`與sandbox-pixel-results.json保留；本新test已補server error reject避免等滿hook。主代理與子executor權限不同，由主代理默认環境執行同一新檔；未發起切換權限的測試、未啟動Fly。

主環境首次結果：10項PASS、僅local-rotation-scale失敗；原始日誌first-main-attempt.log，全部像素統計first-main-pixel-results.json。四方向×兩種fit、未填direction與React/匯出runtime像素相等皆通過（hash皆1881545052）。旋轉35度×縮放0.7在25%/75%揭示有27/102個採樣像素差，50%及逆向50%零差，兄弟layer正常。後續只重跑此失敗項：rotation-diagnostic.log 首次頁面載入15秒逾時；setup已用DOM contentloaded及45秒等待，rotation-diagnostic-r2.json取得完整位置/RGBA。全部129差異都在旋轉外框0.99631 local px內，離揭示線至少5.7486px，證明外框抗鋸齒是根因。最終只對旋轉案例排除1.5 local px外框，內部仍要求逐像素零差，沒有容許任意錯誤個數。rotation-final.log及rotation-final.json：1 PASS、10 SKIP；四個進度內部零差、兄弟layer正確、逆向seek相同。

最終覆蓋是首跑10 PASS +修正後單項1 PASS，合計11個不同案例；未重新跑已過10項。原始失敗/diagnostic全保留。完整TS由主代理統一執行，子代理未跑。此後runtime加點雲分支與選填orbit，舊預設projector路徑維持數值；相關新增驗證另見point-morph，不能算成圖片全套重跑。

## 邊界

驗證的是實際JPEG解碼、schema素材映射、正式export共用studio runtime及React Preview seek；沒有跑artMotionRender→FFmpeg完整成片、上線驗收或新模型呼叫。只提供矩形硬邊四向揭示，沒有任意遮罩、羽化、照片內部人物動作或新調色；前後對比需要兩張已有圖片同位置分層。
