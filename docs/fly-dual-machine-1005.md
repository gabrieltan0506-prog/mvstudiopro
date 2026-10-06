# 2026-10-06 当前配置更新（历史方案见下文）

用户本轮要求一次改好分流配置后推送。`fly.toml` 现将 app 固定为 shared 4 核／8GB、rig 固定为 performance 2 核／8GB；两端进程命令均设置 `MANHUA_HEAVY_WORKER_SPLIT=1` 与 `MANHUA_HEAVY_MACHINE_ID=7812595b294778`。HTTP 与 `/data` 仍仅属于 app，rig 保留角色与禁用 growth 的设置。

当前线上网站已单独切为 shared 4 核／8GB；本批完整分流配置尚未部署，跨机回写、启停恢复及持续负载尚未线上验收。代码推送不代表这些验收通过。合并由用户本人执行，合并前须核对在途任务和部署窗口。

配置生成器现支持旧版未启用配置与当前已启用配置，不重复插入参数，也不静默改绑其他机器。`worker` 阶段明确生成 app/rig 均为 performance 2 核／8GB 的方案；`shared` 阶段生成上述目标规格。只输出配置，不执行部署。历史记录中的“默认关闭”“未改 fly.toml”描述旧 PR1666，不代表本批状态。

部署必须使用包含本批配置的新提交，不重跑 PR1665/1666 的旧 SHA。旧 run 会读取旧配置并覆盖机器规格。部署后核对两端命令、机器 ID、真实 CPU/RAM、worker ready、原任务结果回写和工作流恢复；不新增机器、凭证或付费模型任务。需要回退时先排空任务再制定配置，不在任务中途关闭分流。

---

# Fly 雙機方案：草稿，待另行部署批准

本批從 `main@5455edee5f85823235a2a8a19244f4c5dba03246` 建立獨立分支 `feat/fly-dual-machine-1005`。原 voice 工作樹及 PR #1665 的未提交改動保持原樣；只帶入使用者指定的 Fly 規則。目標為網站 shared-cpu-4x / 8GB 常駐，重任務 performance-2x / 8GB 按需運行。**本 PR 未改正式 fly.toml、未合併、未部署、未開機，尚未節費或正式線上驗收。**

## 現況核對與授權

2026-10-06 北京時間本次接手以 Machines list 唯讀盤點（不是只看 fly status）：

| Machine | 區域 | process / 用途 | 狀態 | CPU / RAM | 卷 |
|---|---|---|---|---|---|
| d892541f602228 | sin | app，正式網站/API | started | performance-2x / 8192MB | vol_re11dko8l5g79z34，/data，11GB |
| 7812595b294778 | sin | rig，既有綁骨/白模 | stopped | performance-4x / 8192MB | 無 |
| d895d5db2e1428 | sin | 無 process 標籤，歷史機 | stopped | performance-4x / 8192MB | 無 |
| 48ed647b541658 | sjc | 無 process 標籤，歷史機 | stopped | performance-2x / 8192MB | 無 |
| 8257d4b7076008 | sjc | 無 process 標籤，歷史機 | stopped | performance-2x / 8192MB | 無 |
| 84e695c24975d8 | sjc | 無 process 標籤，歷史機 | stopped | performance-2x / 8192MB | 無 |
| 891e455b424608 | nrt | voice 隔離機，禁止本任務使用 | **started** | performance-2x / 8192MB | 無 |

東京機與交接所述 stopped 不一致，已回報；本任務未啟動、停止或重用它。未查讀或介入使用者在途媒體任务，不能宣稱當下已無任務。歷史停止機仍可能有 rootfs 費用，本批不刪機、卷、素材或 JSON。

只授權必要實作、離線測試、提交推送及獨立草稿 PR。合併由使用者本人執行；正式部署、機器建立/啟停/改規格、新增憑證、擴权、付費模型與生產負載測試均未授權。

推送前已查 `.github/workflows`：Fly Deploy 與 PDF 部署的 push 僅 main，其他手動入口未觸發；模板掃描為 schedule/manual。Vercel清理器workflow會因index.ts執行既有離線回歸，並不刪正式部署。既有 Blender PR workflow 不匹配本次變更。`vercel.json` 只對本 PR 分支設 `git.deploymentEnabled=false`，防止 Preview；不改其他分支部署政策。新 `PR Heavy Media Offline` 僅執行無 secrets 的離線 SQL/FFmpeg/types/client build，不部署或呼叫供應商。

## 接入現有入口的實作

- 預設關閉 `MANHUA_HEAVY_WORKER_SPLIT`。開啟後既有 app jobs 編排、驗證、使用者確認、模型呼叫、付費帳本/退款及 UI 所見 parent job 保持在 app；內部媒體工作不做扣費或重試。
- 重用 Neon `jobs`：內部 `media_work` 行保存 owner、parent、輸入版本、CAS 執行身份、進度、取消與結果。`jobs.type` 是 text，無新資料庫/遷移。主 worker 永不消費內部行；rig 共用單一重任務通道。
- 原 `renderWorkflowFinalVideo` 入口將純媒體工作分流，返回同一 URL 與 `onSubtitleTimeline` 的真實字幕時間表。既有合成服務與 paidJobLedger 仍負責結果保存、採用與退款。
- 原 `post_prod` 全部 FFmpeg 字幕、音訊、串接與重編碼改由 rig 領取；原本 Blender 綁骨/白模繼續使用既有服務與素材登記校驗。
- 原生學習保留 `prepareEpisodeVideos`、來源刷新、分組上傳/讀片回呼及所有原生參數。媒體準備、ffprobe、yt-dlp metadata 與 null-output 可解碼檢查移至 rig。callback metadata 沿同一持久任務串行交換，避免 worker 等 app、app 又等同一 worker 的死鎖；分組消費完成才繼續原回呼。
- 本機上傳先驗 owner / SHA / duration，串流暫存到本專案 GCS `heavy-media-sources/u<user>/<sha>.mp4`；rig 只下載自己 owner 的物件、再次驗 SHA，重用原安全探測與原生切片。沒有把 `/data` 檔案路徑當作跨機共享。
- 原生 Gemini 模型、thinking、MEDIUM、65536、temperature、採樣、重試、分段規格、音訊時間與內容 schema 均未調整。無新 paid request。

## 持久化、啟停與失敗處理

`MANHUA_HEAVY_MACHINE_ID` 必須顯式指向既有 sin rig。就緒前檢查 machine identity、DB、物件儲存配置和 ffmpeg/ffprobe/yt-dlp 可執行；未就緒不領單。執行前 CAS queued/attempts=0 → running/attempts=1。重送同一 parent/input 使用同 ID；owner 不匹配或內容改變拒絕，取消後不重領。

原始 metadata stdout/stderr 及回呼命令結果先持久保存才由 app 解析。完成结果使用 GCS `heavy-media-evidence/<id>/result.json`，含 user、bytes、SHA-256、version，create-if-absent 不覆寫；回呼結果以 parent+sequence hash 定位。JSON 與暫存媒体分開，無自動清理；既有付費模型原始/解析 JSON 留存機制不變。rig 的本地後期回執僅為 `/tmp` 快取，完成前另寫 GCS。跨機恢復只取回已保存結果或記錄失聯，**不自動重跑媒體/模型/扣費**。物件讀取網路/權限/校驗錯誤不當成 404。

心跳只在 DB 寫成功後續期。後期原失聯窗口保留（一般10分鐘，綁骨沿用自己的窗口）；新的純媒體任務連續10分鐘無成功心跳才中止。每10分鐘長任務告警不按總長強殺。原生學習已凍結的媒體抓取/命令 timeout 原值不變。取消 signal 貫通下載、上傳及子程序；等待 close 後才釋放資源。SIGINT 先關領取、取消並排空；heavy rig內層退出清理窗口250秒（其他原入口仍30秒），rig不讀app付費帳本；部署 kill_timeout=300 仍是平台上限，因此必須在部署前確認無在途任務，不能把程序排空保證當作任意時刻可部署。

空閒停止沿用原 idle 規則並加強：先關領取闸，再檢查持久 queued/running、執行標誌、資源預留、子程序、上傳和待保存回執，全部清空才發 stop。DB 失聯或 API 失敗不是空佇列。stop 回應不明時保持闸關閉，超過既有5分鐘調和窗口後還須確認機器 started 才重開。晚於最終檢查抵達的新單仍留在 DB；app 下輪只喚醒指定 stopped rig，不在 stopping 時把任務交給將停機的進程。start/stop API 失敗保留任務、記錄告警並按既有冷卻重查，不重建機器或重做工作。

故障仍有邊界：下載/輸出成功而 JSON 保存前整機崩潰時，可能留下孤兒媒體；恢復標記失聯、保留原素材，不猜成功、不再執行。需按原 task ID 對账。新模式未部署前沒有真實跨機崩潰或啟停驗收。

## 網站背景 CPU / 記憶體盤點與切 shared 門檻

| 工作 | 此批位置 | 仍需驗證 |
|---|---|---|
| 最終合成、post_prod FFmpeg、綁骨/白模 | 開旗後 rig | 多素材/字幕/原聲/音訊、取消與恢復、8GB峰值 |
| 原生學習探測、下載、切片、上傳 | 開旗後 rig；模型編排 app | 原生正式 UI 分組讀片、來源刷新、回執與恢復 |
| growth 定時採集/回填、JSON parse/stringify、gzip、歷史整形 | app，未搬移 | 持續CPU、event loop、GC、上傳/API並行 |
| Puppeteer/PDF、sharp圖片處理、OCR、參考圖/參考片前處理 | app 或既有各自入口，未全面改寫 | 各入口流量、峰值RSS及CPU |
| legacy 非原生學習密集抽幀/输出檔案 sampler | app，未搬移 | 使用量、是否必須再分流，不能稱全部媒體都已卸載 |
| 模型回應解析/整形、音樂與資產編排、檔案雜湊 | app | 大JSON、buffer/並發RSS、UI持久化 |

**保留兩台8GB。** 已有 OOM 與 Node RSS 4.05GiB 峰值，不能減記憶體。先前5秒52.1%、60秒1.95%只是短樣本，不是 benchmark。shared CPU 與 performance 的可用 CPU 時間不同，不能把4核shared視作2核performance的等效替代。

正式 shared 切換的門檻尚未通過：在另行授權的隔離環境，使用固定 fixture 及本地既有素材、禁止 paid model/生產 queue；採集網站/API p50/p95/p99、錯誤率、event-loop delay、RSS/OOM、隊列等待/完成時間、CPU持續限速。需覆蓋空閒、單重任務、並發讀寫/上傳、growth/PDF重疊及連續長負載，固定版本/輸入/依賴並保存原始指標與對照 perf2/8GB。通過標準須配合真實流量需求確定，不能以短 fixture 成功取代。未滿足前仍用正式 performance-2x/8GB。

## 待批准的部署與回滾

以下只產出待審配置，不執行 Fly 命令、不更改 fly.toml：

```sh
node ops/prepare-fly-dual-config.mjs worker 7812595b294778 > /tmp/fly-worker-proposal.toml
node ops/prepare-fly-dual-config.mjs shared 7812595b294778 > /tmp/fly-shared-proposal.toml
```

1. 使用者本人合併前注意 main push 會觸發現有正式部署；先安排已授權部署窗口並核對真實在途任務、所有 Machines、後端/前端流水線。現在使用者有任務在跑，代理不合併或觸發部署。
2. 首階段只在**另行批准後**配置既有 sin rig 為 performance-2x/8GB；app 保留performance-2x/8GB。核對既有 Fly secret 名稱、GCS/Neon/原有 Machines API 權限已能用；缺少時停止，不導出憑證到本機、不自建新token。這些 flags/目標 ID 是非秘密配置。不要用 scale count/new app 隱式建立機器，不掛共享 volume。
3. 先以flag off部署相容程式、核對隊列已排空，再於同一維護窗口讓 app/rig 一致啟旗。避免混版 app 繼續領取本應卸載的 post_prod。原 /data 持久帳本、素材與原始/解析JSON保留。
4. 由正式工作流入口逐項驗原任務 → worker就緒領取 → 媒體結果 → parent保存 → UI預覽/採用 → 重新進入後仍存在；另驗取消、API啟停失敗、重複領取、worker失聯與GCS恢復。真實生成需要額外付費授權，不把 fixture `writerConfirmed=true` 當確認。正式验收由使用者確認。
5. 無在途工作且上傳/持久化已完成後觀察 idle stop；新單與 stop 競態在授權隔離環境验证。完成上節 sustained benchmark，才提出 shared 配置給使用者批准；不能直接部署shared草案。
6. 回滾前停止接受新重任務，核對所有 queued/running 子任務、子程序及回執；正在運行時不關旗、不部署換機。已完成結果先對賬；失聯任务只恢复/标失败，不重放。安全排空後關旗回既有路由、app保持/恢復performance-2x/8GB與原8GB rig規格。保留GCS/DB/卷與JSON；不要把回滾當作刪除/新建資源。混版或無法確認排空則保留現況並人工核對。

## 驗證證據與未驗範圍

本地原始日志在 `/Users/tangenjie/Documents/Codex/2026-10-06/task-2/fly-evidence/`，每輪只複驗新增/受影響/失敗項；非為刷新時間重跑。CI 使用 PR 確切 HEAD，無生产 secrets，環境不同另留 tested-sha artifact。

- `heavy-lifecycle-tests.log`：真離線Postgres/PGlite 6、啟停/競態7、子程序3，共16通過。
- `callback-fixture-tests.log`：更新後SQL7、佇列5、原生回呼3、真FFmpeg fixture1，共16通過；其中SQL/佇列因回呼持久欄位變更定向複驗，既有生命週期與子程序通過證據復用。
- `regression-tests.log`：15檔199項，初輪197通過；舊DB錯誤視為0的期望已改為拒絕判idle；另一牆鐘時限測試在型別檢查高負載時超出80ms，單獨復驗，不放寬生產時限。
- `claim-failclosed-retest.log`、`postprod-timer-retest.log`：只重驗上述失敗，各1項通過。
- `storage-readiness-localprobe-tests.log`：結果永久存儲/就緒4項通過、原片探測7/8通過；1項5秒測試runner時限遇負載失敗。`localprobe-invalid-retest.log`僅同名3個非法素材fixture通過，測試runner允許30秒；正式probe的30秒未改。
- `contract-child-retest.log`：保留timeout/buffer及原stderr分類後回呼5、子程序6，共11項通過。`transfer-tests.log`：跨機owner/SHA/上限與暫存清理2項通過。回呼恢復另以持久command序號及已消費group水位防止舊回覆誤用；`callback-resume-tests.log`記錄受影響佇列/回呼複驗。
- 新增专项合計35項（同一項多輪通過不重複計數），配置2項；既有199項回歸以原始及必要定向複驗合併對帳。
- `config-tests.log`：兩階段配置、8GB不變、禁止Tokyo/未知機器、原fly.toml不改；另用Python tomllib解析輸出配置。
- `typecheck-initial.log` 初輪2項新增型別錯已修正；`typecheck-final.log` 第二輪通過。新增回呼測試/最終差異另記最終檢查（PR確切HEAD的CI為最終版本證據）。
- `prettier-check.log`及`git diff --check`通過。`vite-build-retry.log`完整前端production build通過（8m39s），只有既有chunk/動態import警告；首輪快取symlink EPERM僅修本工作樹cache後重試。

未驗：正式UI使用者確認、採用/刷新/恢復、真正Fly啟停競態、超過舊時限的實機長任務、shared持續效能、機器/部署窗口、成本實際變化。API/單測/fixture成功均不代表這些通過。

## 成本口徑

沿用使用者提供的2026-10-05、新加坡sin、8GB、30天720小時估算：shared4常駐 $64.47/月；perf2 worker $0.1586802/運行小時；每日合計2小時即60小時，$64.47 + $0.1586802 × 60 = $73.990812，CPU/RAM約 **US$74/月**。不含rootfs/卷/快照、流量、稅或其他服務；停止機器不代表零帳單，這也不是支付預算授權。實際操作前須重新核價，未主張本PR已節費。

官方依據：[Resource Pricing](https://docs.fly.io/about/pricing)、[CPU Performance](https://docs.fly.io/machines/cpu-performance)、[fly.toml配置](https://docs.fly.io/reference/configuration)、[Vercel分支部署開關](https://vercel.com/docs/project-configuration/git-configuration)。本次查閱官方文件確認按區域/運行時間收費與shared限速差異；未將頁面默認iad價格當作sin報價。
