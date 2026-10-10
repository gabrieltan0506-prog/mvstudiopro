# 普通付費會員 3D 正式入口：只讀接線清單

審查基準：HEAD `0ad90a8a7b21ffc5d20993657c80c894cd7eadc9` 加本次共享未提交工作樹，2026-10-10 UTC。這不是新建模驗收；沒有模型呼叫、改帳務或放寬權限。既有 GLB 真匯出／Three/Spark 播放證據屬 PR1694，不能因為此普通會員入口尚缺就否定或重收其探針费用。

**現況：INK 的付費特效選單能指向內部 3D 工作區，但普通付費會員還沒有生成→採用→INK 成片的完整路徑。** 將 adminProcedure 改名不是完整修復。

## 具體斷點

| 層 | 文件／函數 | 已有與缺少 |
|---|---|---|
| INK 選單 | `client/src/components/code-motion/CodeMotionEffects.tsx`；`server/routers/codeMotion.ts` 的 `quote` | `threeDWorkspaceAvailable` 只依 admin/supervisor；選項連 `/manhua-projects`，並提示產物不能直接匯入 INK。一般 paidGenerationAvailable 不等於可用 3D。 |
| Tripo 建模入口 | `server/routers/manhua3d.ts` 的 `importExisting`、`submit`、`submitMultiview`、`retry`、`getStatus` | 全部 `adminProcedure`。需一致的普通付費入口/所有者核驗；既有 GLB 匯入是已有素材，不應新收建模費。 |
| Marble 場景入口 | `server/routers/manhuaWorld.ts` 的 `sceneAccess`、`submit`、`retry`、`getStatus`、`listMine`、`remove`；`server/services/paidSceneAccess.ts`；`shared/paidSceneAccess.ts::resolvePaidSceneAccess` | submit/retry 雖是 protectedProcedure，但 guard 對一般 pro/enterprise 明確 `canGenerate=false/member_launch_pending`，因此**目前沒有普通會員可提交的漏洞**。開放時必須連 status/list/recovery 同步處理，這些目前仍 adminProcedure。 |
| 真工具任務 | `server/services/manhua3dTask.ts::createManhua3dTask/advanceManhua3dTask/retryManhua3dTask`；`manhuaWorldTask.ts::createManhuaWorldTask/advanceManhuaWorldTask/retryManhuaWorldTask` | 已有持久化、固定來源版本/模型/提示 digest、owner、unknown 結果不重投的任務模式。這些入口未見一般用戶積分 reserve/charge/refund 合同；上游扣 credits 不等於本站會員已付費。不能把每次 poll 算新單。 |
| 費用來源 | `server/services/worldlabsMarble.ts` 的模型價/`cost.total_credits`；Tripo provider receipt | Marble provider credits 有自己的單位，不能直接當本站積分或工具 USD。需按實際上游合同建立 quote→fixed ledger→settlement/refund，保留一般生產與局部修改既有差異；本審查不擅定新價格。 |
| 可採用的資產 | `manhua3dTask.ts::getCompletedManhua3dSource`、`importExistingManhua3dAsset`、`getManhua3dTask`；`manhuaWorldTask.ts::getManhuaWorldTask` | 可重用 owner/completed/sourceVersion/URI/hash/bytes 權威結果，不接受客戶端任意 URL 當已付款資產。匯入既有 GLB 與新模型產物都需形成同一可追溯採用記錄。 |
| INK 工程資料 | `shared/codeMotion.ts`；`shared/codeMotionComposition.ts`；`codeMotionStore.ts` | brief 只有 image/audio、plan codeVideo；composition mesh 是 box/tetrahedron/octahedron 幾何，沒有 owned GLB/SPZ、worldTaskId、角色綁定／鏡位／snapshot hash 合同。schema、保存恢復和編譯需正式 3D stage reference，不能把 GLB URL 填到 image。 |
| 可重用瀏覽器能力 | `client/src/components/canvas/ManhuaWorldStagePreview.tsx::buildStageSceneConfig/stageCameraRigs/stageSceneSignature`；`Manhua3dModelStudio.tsx` | 既有 Three/Spark 舞台有資產與鏡位配置。INK 需要選用正式已擁有結果、保存舞台配置、刷新還原與預覽；不可只顯示工作區連結。 |
| 可重用伺服端能力 | `server/services/manhuaVfxStagePage.ts`；`manhuaStageWorldSnapshot.ts`；`manhuaStageWorldBridge.ts` | GLTFLoader/Spark 已存在；bridge 目前受 signed request、owned artMotion job、`params.stageAnimation.worldTaskId` 限制。INK 需產生同等權威 stage snapshot/asset map，不能用公開臨時 URL 繞過。 |
| 成片 | `server/services/artMotionRender.ts`；`client/public/art-motion/engine/composition.js`／`product-bridge.js` | 目前 INK 是 image/codeVideo/codeAudio 的合成入口。需要 3D stage clip 的 frame/time/camera 契約、renderer ready/error／bounded資源、字幕與音訊混合，再接原 export receipt。 |

## 最小完整施工順序

1. 定好普通付費 3D quote/授權/結算和失敗退款合同，讓 Tripo/Marble 的 submit、retry、poll/list 一致；既有匯入 GLB 不多呼叫建模。
2. 新增 INK ownedStage schema 與採用服務（建议 `shared/codeMotionStage.ts`、`server/services/codeMotionStageAdoption.ts`），保存 authoritative taskId/sourceVersion/hash、transform、camera、舞台快照，拒絕跨 owner 或未知結果。
3. Effects→可選用正式產物→預覽→save/reload 接線；重用 Three/Spark，保留 stage 的世界尺度／bbox／camera，不用假模型圖代替 GLB/SPZ。
4. INK compile→render stage frame→code/audio/video mix→export；測單模型、世界+模型、丟失紋理／相機在物件內／Spark未ready。每個結果留可播放證據與具體 HEAD。
5. 用已存在 GLB/SPZ 先跑普通會員 fixture 正式 router 及本地瀏覽器/renderer（無新建模成本），再按另行具體授權測新付費生成一次。跨 owner、double-submit/unknown/restart/退款不省略。正式線上驗收仍不屬目前施工範圍。

此清單只讀，不把長片 root manifest、局部視頻修改或目前 skill v2 原型混成「3D 普通會員已完成」。
