# INK 付費長片：只讀設計審查

審查者：`/root/pr1697_images`。時間：2026-10-10 21:58 UTC（北京2026-10-11 05:58）。基準HEAD `0ad90a8a7b21ffc5d20993657c80c894cd7eadc9`，另含主代理／production正在修改的工作樹；以下行號以本次讀取為準，沒有改PR代碼、執行模型、重跑TS或聲稱線上驗收。

**結論：付費長片不能用放寬max完成。** 可保留目前編譯器與模型的單段上限作內部chunk，但需要一個不以30／35／180秒作產品上限的根作品manifest，管理多段生成、可恢復渲染、整片音軌和大檔交付。這是新增持久化編排層的中等以上工程，不是UI小修。

## 已核實的限制

| 層 | 現況／代碼 | 影響 |
|---|---|---|
| 作品schema | `shared/codeMotion.ts:31–39,106–145`：request2000字、text4000字、15–180秒、8圖、12鏡、每鏡≤180秒；`codeMotionStore.ts:13`單JSON512,000B | 長作品還沒入隊就被擋；單純取消duration限制仍過不了素材／鏡頭／儲存 |
| 編排與底層渲染schema | `shared/codeMotionComposition.ts:30,154,232–248`：局部時間≤180、18鏡、總長≤180、總元素≤512；`shared/artMotion.ts:32,69,86,103`：時間≤180、60cues、35scenes | 可以保留為chunk資源合同，不能把整片直接塞進現有編譯器 |
| 一鍵生產grant | `codeMotionProductionGrant.ts:29,45–54,189–198`：slot index≤5、4–6鏡、≤60秒、speech總300字，**目前套在free和paid之前** | paid付費也被短片約束；最後僅1–3鏡的chunk同樣不能開始 |
| 圖像與視頻生產 | `codeMotionImages.ts:46,90`／`shared/codeMotionImageProduction.ts:11,35`：4–6圖；`shared/codeMotionVideo.ts:11,17–31`：視頻素材和clip各6、clip起點≤180、每clip≤5秒；`codeMotionProduction.ts:89`採用sceneIndex≤5 | 素材應分頁和按chunk綁定；5秒模型輸出可以保留，不能變成整片上限 |
| 音訊 | `shared/codeMotionAudio.ts:4–6,32,49–92`：總片180秒、generated source最多360秒、24clip；`codeMotionMedia.ts:15,42`：speech sceneIndex≤11、14sources；`codeMotionAudio.ts:208`用戶上傳音源>180直接拒絕、單源64MiB | 即使用戶給完整長旁白，正式入口也不能接受；必須分句／分窗，但保留完整原源與整片定位 |
| 參考音軌 | `codeMotionProductionAudio.ts:76–106`每個5秒模型片段都先重混整片、再裁窗；另有180秒固定AbortSignal | 長片N鏡會重複做N次整片混音，接近O(N×片長)，且內層固定超時不受worker心跳續期保護 |
| 時序分析 | `shared/codeMotionTiming.ts:10,34,45`來源時碼≤360、word/beat各≤360；service使用短分析窗 | native讀音合同可保留短窗，結果需分頁保存並映射全片時碼，不能只留下第一窗 |
| 導出grant與quota | `codeMotionTask.ts:60–80`未找到grant時僅4–6鏡且≤60秒自建grant，否則走`enqueueInkFree`；paid表是每grant一個export，`codeMotionProductionGrant.ts:375+` | 無grant的付費長片可能走免費領取鏈。必須先依伺服器tier選付費root，不可用一個free claim換無限child |
| worker | `runner.ts:4416–4443`30秒持久心跳；`postProdJob.ts:81–142`10分鐘是**連續無成功心跳窗** | 已是續期機制，不能誤報成總10分鐘上限。需要增加chunk進度與checkpoint，而不是盲目延長這個數字 |
| 實際渲染 | `artMotionRender.ts:162,331–385`逐幀Canvas／PNG流入編碼器，幀hash留整個array，僅整片末尾上傳；`codeMotionVideoFrames.ts:17,76–113`先展開所有影片PNG | 放寬總長將增加磁碟與memory，重啟會失去整段已算畫面；不可只增加schema |
| 拼接與檔案 | `postProduction.ts:53–61,171,343–415`：每次12段、來源512MiB、累計1.5GiB、產物512MiB，下載有固定120秒；目前concat每次重新編碼 | 樹狀12段拼接仍會撞最終512MiB；反覆重編碼亦增加耗時與損失。必須同時設計串流／分片產物與大檔下載 |
| 修改與UI | `shared/codeMotionRevision.ts:6,20`sceneIndex≤5，最多6更改；`CodeMotionStudio.tsx:388,909,1349,1456`本地生成12鏡、時長選單與60秒speech gate | 局部修改需要root sceneId→chunk映射；不能讓用戶手動拆JSON或自己拼片 |

### 已被主代理修正，不算未解缺陷

`codeMotionTask.ts` 自動建立grant門檻已由30秒同步至60秒，与prepare一致；本報告不再把30/60不一致列為未解項。但超過60秒或不滿4–6鏡的paid root仍不能靠此分支走通，後續仍需明確分流。

`codeMotionProjectSchema` 尾部transform會在natural作品保存／解析時把 `brief.duration` 正規化為 scenes總和。所以不能再宣稱所有服務端載入後仍拿期望30秒裁實際35秒。主代理也已接手未保存client `adoptSound`使用effective總長的剩餘修正。本報告不重做其TS或回歸。

## 最小完整施工切片

1. **付費根作品v2／子段v1。** 新增根manifest：owner、rootProjectId、planRevision、完整原稿／音源object引用、穩定sceneId、chunkId、globalStartFrame/globalStartSample、子段spec/receipt/hash、已確認工具清單與费用、job states、final artifact。列表分頁存GCS，CAS更新根索引，不把長片所有圖、音源、字詞和幀hash塞入512KB JSON。根schema不設固定產品秒數；以安全整數時码及已批准的儲存／計算／工具預算檢查有限輸入。
2. **先句子後鏡頭，實際旁白定長。** 長文按句／段落分批規劃；原音保持全長，字詞／拍點分析按現有native合同分窗。生成旁白沿既有Qwen每句receipt，實測duration再排鏡／空白／尾聲。內部渲染段可≤60秒／≤6鏡（paid允許尾段1鏡），音源及素材引用只包含該段需要的項目；每段使用局部秒數，根manifest記全片frame/sample offset。跨段camera/continuity/transition需接續state或雙方handle，不能突然reset。
3. **root授權、chunk固定slot、工具成本分開。** 免費版原claim／兩次修改合同保留，不借長片路徑擴大free。paid root由服務端核tier；每工具job使用 `rootId/planRevision/chunkId/sceneId/kind`固定身份與digest，沿既有ledger/退款。root export和child export為同一已確認編排的內部動作，不每段重領free。unknown provider結果只恢復原job，不換requestId重打；付費修改沿現有真成本×2規則，不能順便重訂普通生成價。
4. **逐段渲染、checkpoint與恢復。** 子段送既有`art_motion`worker，完成即驗frame/audio/hash並持久化receipt，再開始下一段；中斷只恢復未完成的本地渲染段。不要重發已完成圖片／聲音／視頻模型任務。PNG只展開本段，完成可清理媒體暫存，但原始/parsed JSON永久留存。父任務聚合真進度和成功心跳，不用空timer代替工作證據。
5. **整片音樂與旁白只編排一次。** 5秒模型reference直接取與該窗相交的音軌，不每鏡重混整片。BGM用多段樂章或用戶允許的樂句循環／交叉接續，最後整片才fade-out；子段邊界不要每次淡出再淡入。片長足以容納最後一句和尾音；不得把縮短話語、倍速、硬裁或末尾補長靜音當自然收尾。混音可分PCM窗口加重疊handle，最後只做一次AAC編碼，避免每段AAC延遲累積。
6. **真正的大檔交付。** 同規格、相同timebase/GOP的silent video chunks可用受控concat demuxer stream-copy；跨段視覺轉場在chunk的handle內完成，避免整片重編碼。保留小批處理資源上限，但不能以多輪concat假裝突破512MiB最終上限。大檔路徑需獨立受權限保護的串流/可續傳上傳、容量預檢及最終MP4或分片可播放＋可下載整片；下載的120秒硬限制改為有進度續期／可恢復讀取。不要把全局MAX_RESULT_BYTES改成Infinity。
7. **正式頁面仍是一個作品。** 用戶輸入自然語言與素材，系統內部拆段；前台顯示全片旁白、段落、預覽、實際總長、費用與進度，可從任意段繼續。採用／保存／刷新與修改都映射穩定sceneId，不暴露chunk技術細節。局部修改只重作受影響段和必要接點，原未改段與聲音保留。

## 建議精確改檔

新增（名稱建議）：
- `shared/codeMotionFilm.ts`：root／chunk／global時間與資產索引schema。
- `server/services/codeMotionFilmStore.ts`：paged manifest、CAS、owner及版本一致性。
- `server/services/codeMotionFilmPlanner.ts`：句段拆分、chunk與全片offset、實際旁白回填。
- `server/services/codeMotionFilmTask.ts`：root DAG、quote/submit/recover、固定job身份。
- `server/services/codeMotionFilmAssemble.ts`：已驗子段串接、整片混音、大檔receipt。

接合既有：
- `server/routers/codeMotion.ts`、`codeMotionProduction.ts`、`client/src/pages/CodeMotionStudio.tsx`：一個root作品的正式入口／可恢復狀態；保留v1舊稿相容。
- `codeMotionProductionGrant.ts`、`codeMotionTask.ts`、`inkFreeQuota.ts`：明確free/paid/root/child分流，阻止免費擴額与付費跌回free。
- `codeMotionImages.ts`、`shared/codeMotionImageProduction.ts`、`codeMotionProductionVideo.ts`、`codeMotionSound.ts`、`shared/codeMotionMedia.ts`：paid child1–6鏡，資產歸屬沿root+sceneId；原模型／quality／單次幂等不變。
- `codeMotionAudio.ts`、`shared/codeMotionAudio.ts`、`codeMotionProductionAudio.ts`、`codeMotionTiming.ts`：完整音源登記＋bounded windows、一次混音计划、全片sample offset與paged對齊結果。
- `server/jobs/postProdInput.ts`、`postProdJob.ts`、`runner.ts`／`workerRole.ts`：root編排/合成action路由、真心跳、checkpoint、恢復，不改成固定總deadline。
- `artMotionRender.ts`、`codeMotionVideoFrames.ts`：bounded chunk資源和交界handle；保留現有schema範圍作內部guard。
- `postProduction.ts`／GCS串流層：長片專用受控字節預算／續傳與大檔出口；原短片上限不全局移除。
- `codeMotionRevision.ts`、`shared/codeMotionRevision.ts`、修改UI：root sceneId定位及所屬chunk、同工具成本合同、未知結果恢復。

## 必要驗證，不以大量單測代替交付

先無付費fixture走正式router→root/child jobs→render→adopt→保存／刷新：180秒以上、超過12鏡／8圖、尾段僅1鏡、原旁白跨邊界且完整、BGM不中斷且最後才淡出。測中段worker重啟／上傳失敗／unknown provider，原成功工具job和ledger不多一次。測chunk邊界timebase和sample精度、轉場handle與continuous粒子時鐘；原音結尾可聽且沒有AAC段縫。免費原額度及paid tier繞過測試不可省。最後必須實際驗一個超過512MiB交付與超過原時限但有真心跳的任務；沒有該探針前不稱「任意長度正式可用」。模型付費測試仍需當次具體授權，正式線上驗收不列入本次施工承諾。

**推薦下一步：** 先確認root manifest的接口，再把「已存在圖片＋完整音訊→多段純碼渲染→一支長MP4→保存恢復」做成第一個完整縱向切片；隨後接Qwen／Suno／圖片／必要5秒模型片段。第一片必須標清只覆蓋已有素材，不能當成「無素材任意長片生產已全部完成」。


## 有依據的施工量區間（不含正式線上驗收）

這是基於上述約20–30個既有觸點、5個新編排／持久化模塊及資產歸屬/計費/恢復依賴的有效工程時間估算，不含等待用戶批准付費模型、供應商排隊或部署。不是以代理運行額度換算，也不能保證所有機器渲染等待相同。

| 範圍 | 寫碼 | 必要整合／探針 | 依據 |
|---|---:|---:|---|
| 第一個完整切片：已有圖＋完整原音→paid root→分段純碼→長片播放下載／保存恢復 | 3–5小時 | 1–2小時 | root schema/store/CAS、child job/owner、音頻窗口、合成大檔、正式router/UI，至少8–12既有檔＋3–5新模塊 |
| 再接無素材生產：長文/旁白實長回填、跨chunk生圖/BGM/必要5秒視頻與費用清單 | 2–4小時 | 1–2小時 | 模型身份/固定slot、paged資產、根預算与多段混音，不能複製短片6slot當無限授權 |
| 長片局部自然語言修改／舊稿兼容／故障收口 | 1–2小時 | 1–2小時 | sceneId→chunk、素材owner及版本、原付費修改合同、unknown job恢復 |

順序單人合計約 **6–11小時寫碼＋3–6小時必要驗證**。兩位代理可拆store/task與media/assemble等少衝突部分，但正式入口、帳務和恢復需要合併核查，不能把總和直接除二。這個區間含真正突破512MiB的交付設計；若現有儲存／下載環境需另建新的續傳端點，工時落上緣或需重估。第一切片成功後應以真耗時收窄估算，再承諾第二階段。沒有執行過長片整合前，不給「2小時全部完成」的承諾。
