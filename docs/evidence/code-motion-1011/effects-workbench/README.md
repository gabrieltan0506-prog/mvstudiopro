# 特效選單與示範工程（2026-10-11）

本次產品變更：`CodeMotionEffects` 使用 shared catalog 的分組、用途與效果說明，顯示可採用的代码鏡頭數；全原片覆蓋、非逐鏡模式及忙碌時不可採用。程序化 3D 配方屬免費代碼能力，付費建模／3DGS 仍受原權限限制，沒有解除資產工作台門檻。

`ArtMotionStudio` 使用普通 art-motion block 隊列，該隊列原本拒絕新映客 composition；因此新增的是 `/yingke` 新分頁入口，明示需在映客選素材、採用、保存，當前 block 不自動導入。沒有修改原隊列、扣費、生成或保存合同。

## 本次驗證

- 新增離線真元件 browser：`client/src/lib/codeMotionEffectsMenu.browser.test.ts`。測四配方選擇顯示→真 shared apply→compile→本地保存重載、原視頻鏡頭保留、免費程序效果與付費資產分流、忙碌與全原片禁用、Art 工作台新頁導航不改 block。不呼叫 renderer、模型或遠端 API；這不是線上工作流驗收。
- 初次命令僅導航因 Vitest min/max worker 設定衝突，**0 tests**；修正旗標後全檔啟動仍卡本地監聽。最小 `http.listen(0,127.0.0.1)` 已明確返回 `EPERM`，補 `server.once('error', reject)` 後停止該次未完成 runner（exit130，沒有案例 PASS）。主環境接手同檔必要驗證；預期原始 log `/tmp/pr1697-effects-menu-test-main.log`，結果在確認後更新，未確認不記為 PASS。
- 新增 `server/services/codeMotionEffectsDemo.real.test.ts` 需要明確環境旗標才執行；未設旗標自動 skip。`INK_EFFECTS_DEMO_PREPARE=1` **1 PASS**，只以正式 compiler 驗證並保存工程，未渲染。原始 `/tmp/pr1697-effects-demo-prepare.log`。

## 22 秒示範交接

外部獨立目錄 `task/ink-effects-workbench-demo` 已保存 `project.json`、`request.json`、`sources.json`、`boundary.json`。工程為 720×1280／30fps，五鏡 4+4+4+6+4 秒：雪山照片揭示→三圖累積注記→紙頁堆疊→球體／圓環程序點雲與環繞→品牌收尾。既有原 BGM 22 秒沿原秒位播放。本輪未聽辨音訊，不宣稱新畫面與音乐節拍一一對齊。

原素材来自未改動的 V2.1 demo：29.jpg 雪山、16.jpg 海岸與漂流木、10.jpg 森林遠水、audio/window-v2.wav；`sources.json` 記錄來源路徑、bytes、SHA-256。使用正式 `applyCodeMotionEffect` 逐鏡套用新配方、`compileCodeMotion`、`renderArtMotion`；沒有另寫示範 renderer。僅存儲邊界替換成封閉本地映射：來源 URI 必須在確切四素材白名單、原始/規範化回執寫本地、輸出複製到新目錄。虛擬 gs://local-demo 與 local-demo.invalid 只標識本地 adapter，不是真實上傳／對外播放網址。

父代理確認推送後才執行：

```sh
INK_EFFECTS_DEMO_RENDER=1 pnpm exec vitest run server/services/codeMotionEffectsDemo.real.test.ts --minWorkers=1 --maxWorkers=1 > /tmp/pr1697-effects-demo-render.log 2>&1
```

正式 renderer 會保存逐幀摘要／ffprobe 原始與解析 JSON，驗 660 幀、一條音軌與畫幅。輸出 `task/ink-effects-workbench-demo/ink-effects-22s.mp4`。此次 local adapter 不新增網路下載、模型生成或雲上寫入；瀏覽器請求仍受正式 renderer 同源攔截。

完成後以獨立 Range 服務展示（不碰既有 8880 服務）：`node ../ink-effects-workbench-demo/serve-preview.mjs`，由啟動輸出取得實際隨機 port。尚未執行本次新渲染、Range 播放或線上驗收，不將 PREPARE PASS 當成新片完成。

主環境補驗：menu-test-main.log 3/3 PASS（真元件操作、保存恢復與compile、免費3D與付費資產區分、原特效工作台新頁入口）。子代理首輪sandbox EPERM，0 cases，不算產品失敗亦不算PASS。
