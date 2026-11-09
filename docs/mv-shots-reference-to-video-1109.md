# MV 工作区「生成缺失镜头」改参考生视频 · 设计稿（2026-11-09）

> 状态：设计稿，待用户过目后施工。分支 `feat/mv-shots-reference-to-video-1109`（自 origin/main 4f8f7c45）。
> 不自创流程：全部沿用知识库已验工艺（0908 白模 @视频1 + 多图锁外观 + 一条母轨）与仓库既有链路（`musicMvShot` → `canvasRunBlock` → `/api/jobs?op=seedanceI2V`）。

## 0. 今天线上的真因（为什么是 text_to_video）

| 环节 | 现状（代码真源） | 结果 |
|---|---|---|
| 铺镜头 | `client/src/lib/canvasMusicMvWorkflow.ts#createMusicMvShotBlocks`：`seedance25WorkMode = referenceImages.length ? "reference_to_video" : "text_to_video"`；`referenceImages` 来自分镜 `shot.referenceIndices` 指向用户在「视觉方案」上传的图 | 项目 d31a3a49 没上传参考图 → 五镜全是 `text_to_video`，`refImageUrl/editFusionUrls` 皆空 |
| 出片 | `client/src/lib/canvasRunBlock.ts` 3580 行：`workMode = useSeedance25 ? normalize(...) : undefined` —— **2.0-mini 根本不传 workMode** | 服务端 `api/jobs.ts` mini 分支 `taskInput` 无 `workMode`，`buildEvolinkSeedanceRequest` 用 `inferSeedanceMode` 推断：无图无视频 → `text_to_video` |
| 回执 | `canvasVideoStatus` 返回 `task.workMode`（提交后由 provider 回填） | 用户看到 `workMode=text_to_video` |

结论：不是通道坏，是**MV 镜头没有任何参考就放行了**。本次改法 = 参考组装 + 模式硬锁 + 无参考拒发。

## 1. 必读文档逐条引用（读过、用在哪）

| 文档 | 用到的结论 | 落到设计哪一条 |
|---|---|---|
| 知识库 `00-总索引.md` | 1109 三条硬规则：LLM 三层 fallback；合并前问探针；部署间隔 30 分钟；探针落 GCS 检查点 | §7 探针、§8 交付 |
| `工作规矩/工作规矩速查.md` | 烧钱前出检查单等用户回「批/跑」；媒体一律 GCS 签名 URL 禁 base64；一次批准只对一份提交体；生产密钥只留 Fly | §7 探针报价行；§3 全部参考走 gcsUri 现签 |
| `漫剧工厂/0908-白模站位参考视频工艺与30秒成片实录.md` | **参考视频镜头语言权重高于文字，白模是什么机位成片就是什么机位**；槽位表 @图片N/@视频1/@音频1 按数组顺序编号；四图只定义身份造型不继承定妆背景；上传件签名 60 分钟出片前重签；参考视频 ≤30 s；节点旧成片别当第二条参考 | §3 槽位表与 prompt 职责声明；§4 重签；§4 不送本镜旧成片 |
| `漫剧工厂/0913-子任务-角色模型表演.md` | 官方 Mini r2v 页：`image_urls` 0–9、`video_urls` 0–3，视频角色含 motion reference 与 camera movement，`@image1/@video1` 从各自数组 1 起编号；A/B 探针从未给外观图 → 不能说明「加图必成功」；文档无「仅迁移动作不继承形态」字段 | §3 上限 9/3/3；§3 必须配外观锚图；§9 风险 |
| `漫剧工厂/0911-动作白模骨骼关节升级与验收.md` | 单次 Mini r2v 已跑通：5.04 s / 864×496 / USD 0.113；整体动作跟随但姿态时序不逐帧一致；原始+解析 JSON 各 16 份永久保存 | §7 探针预算与判据；§5 证据 |
| `漫剧工厂/0917-绑骨的好处与用法.md` | 白模视频当 @视频参考（锁站位+景别+运镜+动作），静帧锁脸服场，母轨锁音——三件套一起进 Seedance；「采用为本段参考」路径 | §3 @video 槽来源优先级；§4 白模自动带入 |
| `漫剧工厂/1007-特效与创作顾问交接.md`（1741 行附近） | 旧口径「每次最多 5 秒」**已作废**（用户 1109：镜长跟分镜走，不锁 5/15 秒） | §3 时长按所选模型引擎表 |
| `素材档案/八月素材档案.md`「EvoLink Seedance 调用规范」→ `通道路由/0921-Seedance2.5-EvoLink参考生成核对.md`、`通道路由/EvoLink.md` | 2.5 r2v 图 ≤30/视频 ≤10（合计 ≤30 s）/音频 ≤10（合计 ≤30 s）；`quality` 字段非 `resolution`；产物链接 24 h 需镜像 GCS；纯参考生成用描述式动作指令避免触发 edit/extend | §3 正式档上限；§4 不改既有镜像链 |
| `工作规矩/LLM调用三层fallback-1109.md` | 任何 LLM 调用三跳 GLM@EvoLink→GLM@OpenRouter→DeepSeek v4.1 Flash；写坏也算失败；每跳回包永久保存 | §4 关键词推荐 LLM 走既有 `stockFootage.suggestKeywords`（已三跳）；视频通道按 §6 fallback |
| `工作规矩/工作机探针必须落GCS检查点-1109.md` | 工作机无持久卷；每步落 `gs://mv-studio-pro-vertex-video-temp/probes/<类别>/<runId>/checkpoints/`；长跑命令必须 `FLY_PROCESS_GROUP=rig tsx scripts/with-worker-probe-lease.mts` 包裹；禁 sleep 保活；不 stop 机器 | §7 |
| 仓库 `.cursor/knowledge/kb/channels.md` 视频节 | BytePlus/OR 挡真人脸只出 CG；仿真人一律 EvoLink；CG 走便宜通道被「太像真人」退回 → EvoLink 接手是标准 fallback；mode 枚举下划线；探针一律 mini 480p | §6 |
| `kb/billing.md` | 不改价；扣费 `chargeKey` 幂等；管理员 0 积分但上游成本真实 | §5 不改积分 |
| `kb/deploy-verify.md` | 合并前问探针；30 分钟部署间隔；`pnpm check > file; echo $?` | §8 |
| `.cursor/rules/product-guardrails-always.mdc` | 前台零技术泄漏（不写 Seedance/EvoLink/Pexels 以外供应商名——Pexels 署名是许可要求例外）；探针只用 mini 480p；原始/解析 JSON 永久、禁截断 | §4 UI 文案；§5；§7 |

## 2. 现有可复用件（不新造）

- 分镜与镜头绑定：`shared/canvasMusicMv.ts` `canvasMusicMvShotSchema.referenceIndices`、`canvasMusicMvShotBindingSchema.referenceImages`；镜头块 `musicMvShot`（`shared/manhuaCloudDraft.ts`）。
- 参考槽位：`CanvasBlock.refImageUrl / editFusionUrls / seedance25RefVideoUrls / seedance25RefAudioUrls / seedance25WorkMode / manhuaSegmentRefs.previs`，出站在 `canvasRunBlock.ts` 3516–3700 行统一组 `imageUrls/videoUrls/audioUrls`。
- 共用素材抽屉：`client/src/components/stockFootage/StockFootageDrawer.tsx`（`purpose/usage/orientation/onPick{asset,inSec,outSec}`），服务端 `stockFootage.search / suggestKeywords（LLM 三跳已接）/ adopt / listAdoptions`；已采用资产 = 本人 GCS `gcsUri` + 来源证据（`shared/stockFootage.ts`）。MV 剪辑已用 `purpose="mv"` 替换片段（`CanvasMvTimelineEditor.tsx` 785 行）。
- 歌曲切片：`server/routers/canvasMusicMv.ts#prepareSinging` 已有 `audio_trim`（ffmpeg post_prod）按 `shot.startSec/endSec` 裁唱段并写 `musicMvShot.singingAudio`，出片时注入 `seedance25RefAudioUrls`。
- 白模：`server/routers/manhuaPrevis.ts`（adminProcedure，`scopeId/clipId`）、`ManhuaPrevisStudio.tsx`「采用为本段参考」写 `manhuaSegmentRefs.previs`；出站 `segmentPrevisUrl`（现仅 `isClip`）。
- 服务端 Mini 路由：`api/jobs.ts` 5940–6110 行（BytePlus 优先 → 人脸拒绝回落 EvoLink，`canvasVideoTask.ts#submitSeedance25Byteplus`）；探针分支 `probe=1 + x-canvas-probe-secret`。
- 证据样板：`canvasVideoTask.ts#persistInkVideoSubmitReceipt`（submit-raw.json / submit-parsed.json 分存）。

## 3. 每镜参考组装（「喂满」，总数 ≤9）

单类上限按所选成片模型读漫剧引擎表 `COMPILER_ENGINE_LIMITS`（Seedance 2.0 系 9/3/3、2.5 为 30/10/10、H3 9/3/3、Wan 3.0 10/5/5；HappyHorse 仅首帧一图不入 MV）；总数按用户拍板 ≤9。不锁 Mini。

| 槽 | 数量 | 来源 | 职责（写进 prompt） |
|---|---|---|---|
| @image1 主锚图 | 恒 1 | 抽屉 Pexels 照片（`purpose=mvShot, usage=reference`），用户/顾问方案选定，**全片五镜共用** | 全片人物/服装/场景基调与色彩连续性，不继承构图 |
| @image2…@imageN 本镜补充图 | 2–4 | 抽屉 Pexels 照片，按本镜 `visualPrompt + cameraPrompt + cinema（palette/lighting/lens）` 自动出关键词（`suggestKeywords`），用户勾选 | 本镜场景/光线/道具/色调 |
| @video1（@video2）动作/运镜参考片 | 1–2，总时长 ≤ 本镜目标时长且 ≤30 s | ① 该作品若有白模工作台产物（`manhuaSegmentRefs.previs`，scopeId=MV 块 id、clipId=shot id）自动带入；② 否则抽屉 Pexels 视频（`kind=video`，入点/出点裁到本镜秒数） | 站位、景别、机位运动、动作节拍；**不继承外观** |
| @audio1 本镜歌曲切片 | 1 | 复用 `prepareSinging` 的 `audio_trim`（从所选歌曲/高光区间按 `shot.startSec–endSec` 裁出，≤ 本镜时长）；对口型镜头已有，其余镜头新增同样裁法 | 节奏/情绪卡点；对口型镜头额外写口型同步 |

- 计数规则：`1 + 补充图(2–4) + 视频(1–2) + 音频(1) ≤ 9`，各类 ≤ 9/3/3；超出在 UI 立即拒绝，不裁剪后放行（沿用 0908「编号必须对应完整数组」）。
- 每镜时长：请求时长 = 分镜时长 + 1 秒余量向上取整，按所选模型最短/最长秒数钳制（`mvShotGenerateDurationSec`，复用 `COMPILER_ENGINE_LIMITS`；H3 取 5/10/15 档）；**不锁 5 秒或 15 秒**。出片后合成前 ffprobe 实测、只裁不变速（`fitMusicMvClips`），短缺的段单独重做。
- prompt 职责声明追加在既有镜头 prompt 之后，**不改既有提示词编译规则**，只加一段固定格式（与 0908 v5 同语法）：

```
@image1定义全片人物造型、服装与场景基调，五镜共用，不继承其构图。
@image2、@image3定义本镜的场景、光线与色调，只取氛围不取人物。
@video1提供本镜的站位、景别与机位运动，逐段照做；成片不继承其外观、材质与人物。
@audio1是本镜 12.0–17.0 秒的歌曲切片，画面节奏与其卡点严格同步；不另生成音乐。
```

### 参考槽位表示例（当前 MV 项目 d31a3a49 · 高光 140–185 s · 9:16 · 五镜）

> 镜头文字以线上分镜实际 `visualPrompt/cameraPrompt` 为准，下表是槽位示意；用户称「敦煌 MV」，方案 c1《隔着一层玻璃：雨夜霓虹的说不出口》。

| 镜 | 秒位 | @image1 主锚 | 本镜补充图 | @video | @audio1 | 合计 |
|---|---|---|---|---|---|---|
| 1 | 140–149 | 同一张雨夜霓虹街景人物锚图 | @image2 雨夜霓虹街景 · @image3 玻璃窗雨滴 | @video1 Pexels 竖屏「人物站在窗前慢推」 | 歌曲 140–149 s 切片 | 1+2+1+1=5 |
| 2 | 149–158 | 同上 | @image2 车灯虚化 · @image3 玻璃倒影 · @image4 冷蓝街灯 | @video1 Pexels「车窗外霓虹横移」 | 149–158 s | 6 |
| 3 | 158–167 | 同上 | @image2 人物侧脸特写光线 · @image3 暖色室内灯 | @video1 白模（若有）/ Pexels「转身回望」 · @video2 Pexels「手触玻璃」 | 158–167 s | 6 |
| 4 | 167–176 | 同上 | @image2 雨中街道全景 · @image3 伞下剪影 · @image4 路面反光 · @image5 霓虹招牌 | @video1 Pexels「低机位街道后拉」 | 167–176 s | 8 |
| 5 | 176–185 | 同上 | @image2 玻璃后人影 · @image3 霓虹渐暗 | @video1 白模（若有）/ Pexels「人物离开镜头」 | 176–185 s | 5 |

## 4. 代码改动点（施工时逐项对照）

**shared**
1. `shared/stockFootage.ts`：`STOCK_FOOTAGE_PURPOSES` 加 `mvShot`，允许用法 `["reference"]`（参考不入片，与 `mv` 的 insert 区分），标签「MV 镜头参考」。
2. `shared/canvasMusicMv.ts`：`canvasMusicMvShotBindingSchema` 新增可选 `references`：
   `{ anchorImage?: {assetId,gcsUri,width,height}, images: [...≤8], videos: [{assetId|previs, gcsUri, inSec, outSec, durationSec}] ≤3, songSlice?: {jobId,gcsUri,startSec,endSec} }`；`canvasMusicMvStateSchema` 新增 `shotReferences: Record<shotId, …>` 与 `anchorImage`。保持旧字段 `referenceImages` 兼容。
3. `shared/canvasMusicMvReferences.ts`（新）：纯函数 `assembleMvShotReferences(binding, model)` → `{imageUrls, videoUrls, audioUrls, promptAppendix, counts}`，校验 ≤9 与 9/3/3（2.5 为 30/10/10），不足（无主锚图或 0 补充且 0 视频）抛中文错误。单元测试覆盖上限、缺锚、白模优先、音频切片秒位。

**client**
4. `canvasMusicMvWorkflow.ts#createMusicMvShotBlocks`：由 `references` 填 `refImageUrl=anchor`、`editFusionUrls=补充图`、`seedance25RefVideoUrls`、`seedance25RefAudioUrls`（切片现签）、`seedance25WorkMode="reference_to_video"` **恒定**；prompt 追加 §3 职责段。无参考 → 不再写 `text_to_video`，块标 `error="请先为本镜选参考素材"`。
5. `CanvasMusicMvStudio.tsx` 第 4 步前新增「3.5 为镜头选参考素材」区块（`CanvasMvShotReferencePicker.tsx` 新组件）：
   - 顶部「全片主锚图」：打开 `StockFootageDrawer purpose="mvShot" usage="reference" kind=photo`；按钮「一键套到全部镜头」。
   - 每镜一行：已选 `图 n / 片 n / 歌 1`、缺失提示（无锚/补充图<2/无动作参考）、「找场景图」「找动作参考片」「用白模」「裁歌曲切片」。
   - 关键词预填：`stockFootage.suggestKeywords({text: visualPrompt+cameraPrompt+cinema 摘要, purpose:"mvShot"})`，可编辑。
   - 白模：`manhuaPrevis` 工作台已开放普通用户（每账号在跑上限），镜头块已采用/最近一次白模产物可一键作 @视频1；复杂镜头（≥2 人/强动作/接触/≥2 机位或场景）站位参考必填，缺了整批拒发。
   - 文案无供应商名；Pexels 署名按 `stockAttributionText` 显示（许可要求）。
6. `render()`（生成缺失镜头）：提交前逐镜跑 `assembleMvShotReferences`，任一镜不达标即整批不发、列出缺哪镜缺什么。
7. `canvasRunBlock.ts`：`musicMvShot` 分支现签 `references` 全部 gcsUri；**mini 也传 `workMode`**（`seedanceOpts.workMode = block.musicMvShot ? "reference_to_video" : (useSeedance25 ? workMode : undefined)`）；`segmentPrevisUrl` 对 `musicMvShot` 放开（原仅 isClip）。

**server**
8. `api/jobs.ts` mini 分支：读 `b.workMode`，`taskInput.workMode` 透传；当 `b.mvShot` 存在而 `workMode!=="reference_to_video"` 或参考数组全空 → 400「MV 镜头必须带参考素材」。probe 分支同样传 `mode`。
9. `canvasVideoTask.ts`：任务记录新增 `mvShot?: {planRequestId, shotId, userId}`；对 mvShot 任务挂 `persistSubmitReceipt` → `canvas-music-mv/u<uid>/<planRequestId>/shots/<shotId>/<taskId>/submit-raw.json | submit-parsed.json`，终态回执同样 raw/parsed 分存（仿 `persistInkVideoSubmitReceipt`）。
10. `server/routers/canvasMusicMv.ts`：`prepareSinging` 泛化为 `prepareShotSongSlice`（保留旧名导出）——任何 kind 的镜头都可裁 `startSec–endSec`，高光模式按高光区间内秒位；jobId 幂等不变。
11. `stockFootage` 服务：`mvShot` 用途通过 `assertStockUsageAllowed`；`adopt` 的 `context.shotId/projectId` 记录归属。

## 5. 不改的东西
- 积分：Mini 480p 每镜 39 积分、2.5 既有定价、`chargeCanvasVideoCredits` 幂等键不动；Pexels 采用不计费（既有）。
- 提示词编译规则、分镜 schema 时长约束、合成链（`canvasMusicMvAssemble`）、剪辑器。
- 原始/解析 JSON 永久保存：新增的 mvShot 回执只增不删；探针 JSON 按 `probes/` 既有规则永久。

## 6. 通道与 fallback（沿 kb/channels.md，不新造）
- 判定：参考里有 Pexels 实拍人物（抽屉资产 `kind=video/photo` 且 Pexels 来源）→ 视为「有真人素材」→ 直接 EvoLink（`hasPhotorealReferenceUrl` 扩展：GCS 路径前缀 `stock-footage/` 或 mvShot 标记 `hasRealPerson=true` 由用户勾选「含真人」）。
- 纯 CG/景物 → BytePlus（mini）→ 被「真人脸/PrivacyInformation」拒 → EvoLink 接手（`submitSeedance25Byteplus` 既有）。
- 超时/断线：沿 `canvasVideoTask` 既有 `timed_out_pending_reconcile` 对账，不自动重发；提交体一字不改才可重试（工作规矩 -1 条）。
- 探针档：Seedance 2.0 mini 480p（只是探针便宜档）；正式档由 MV 工作区「镜头成片模型」下拉选择（漫剧同一模型表 + 会员闸门 `filterCanvasVideoModelOptions`，再筛能收参考图+歌曲切片的引擎）。

## 7. 探针（施工后、合并前）
- 机器：工作机 7812595b294778，隔离目录 `/app/isolated/mv-r2v-<runId>`；命令全部 `FLY_PROCESS_GROUP=rig tsx scripts/with-worker-probe-lease.mts node …`；禁 sleep；不 stop 机器；每步落 `gs://mv-studio-pro-vertex-video-temp/probes/mv-shot-r2v/<runId>/checkpoints/`。
- 用户 999999001；步骤：① Pexels 真搜（照片 ×3 + 视频 ×1）并 adopt（purpose=mvShot）→ 检查点；② `audio_trim` 裁 5 s 歌曲切片 → 检查点；③ 组装 1 锚 + 2 图 + 1 片 + 1 音 = 5 项，经 `/api/jobs?op=seedanceI2V&probe=1`（mini 480p 5 s，`mode=reference_to_video`）一发 → 原始/解析回执落 GCS；④ 轮询至终态，断言 provider 回执 `mode==="reference_to_video"` 且 `image_urls.length>=3 && video_urls.length>=1 && audio_urls.length>=1`，产物镜像 GCS。
- 报价（发前报用户批）：Pexels 0 积分；mini 480p 5 s 上游约 USD 0.11（0911 实测 0.113）；共 1 发。
- 判据只看：模式 + 参考数组非空 + 产物可播；**不**判动作跟随质量（0911 结论：Mini 跟随不逐帧一致）。

## 8. 交付
- 单独一张 PR（MV 性质），中文；commit/PR 末尾署名按会话规则；不合并、不部署；GitHub 仅 `gh api`。
- 合并前按 kb/deploy-verify 问用户「跑不跑隔离探针」；部署间隔 30 分钟由用户执行。
- 验证口径：`pnpm check > /tmp/check.log 2>&1; echo $?`、相关 vitest 文件、Vite build；线上验收在正式 MV 工作流（0929 规矩）。

## 9. 风险与边界
- Mini 对「白模/实拍参考片只取动作不取外观」没有官方保证（0913 结论），靠 prompt 职责声明 + 主锚图压制；若成片带入 Pexels 人物外观，下一步是换白模或 2.5，不是改提示词编译器。
- Pexels 实拍人物进参考 → BytePlus 必拒 → 全走 EvoLink，成本比便宜通道高（channels.md +10%~30%），设计已直接路由避免扣费后退回。
- 白模路由是 adminProcedure：普通用户只有 Pexels 片作运镜参考，文案不提白模。
- 旧「每镜 ≤5 秒」拍板已撤销：镜长跟分镜走，请求时长按所选模型上限（见 §3）。


## 11. 1109 下午追加（以本节为准）

- **逐窗节拍**由 MV 创作顾问第三阶段输出（同一三跳链 `runCreativeHopChain`，分块 ≤6 镜）：每镜按 audiomap 切 2–4 秒窗，每窗 表情/视线与动作、景别与运镜、灯光与氛围、情绪与转折、<环境/事件音效>；另给 `continuesFromPrevious`（尾帧接龙）与 `complexity`（站位参考阈值）。编译器 `compileMvShotTimedPrompt` 只按知识库 A 段版式排版（复用漫剧 `compileSegmentPromptDetailed` 块状版式），不再按标点拆句；旧方案无逐窗字段 → 整镜一窗降级并标注（演唱段不降级，直接拒发）。
- **audiomap**：`computeSongBeatGrid` 一次产出（BPM 以创作说明为准否则自相关估计、相位、全曲与分段拍点置信度、分段能量、节奏模式 beat/phrase/free + `pacingOverride`），写进 `plan.beatGrid`；下游只读不重测。只有 beat 段的非演唱剪点/窗界吸附拍点。
- **演唱段**：歌词按「对白」处理。高光区间旁「本段歌词」栏：Gemini 听音（Vertex → EvoLink 两跳，OpenRouter 不可用）出待确认版 → 用户逐句改字/改起止/增删 → 确认；演唱镜的唱句窗只读确认版（`singingWindowsFromLyricLines`），未确认不得生成演唱段。合成时演唱镜按原歌绝对时间帧精确落位，出片后用生成片自带音轨与原歌互相关求偏移，漂移 >2 帧或不够唱句尾 → 该段重做。
- **主锚图**：按主角描述生成角色定妆帧（漫剧同一生图链 `canvas_gpt_image2`，Sunburst，资产线），Pexels 只提供场景/光线/运镜参考。
- **声音**：成片 = 原歌整段 0 dB 一次贴上 + 镜头环境/事件音效 −20 dB 背景层（−40～−12 可调）；演唱段的模型音轨按原唱复现，只用于落位核验与环境层。
- **参考片自动裁切**：参考视频是整条送给模型的（1109 探针：供应商拒「参考视频超 15.2 秒」），送前裁到 min(本镜时长, 所选模型单条上限)，入点用户可调、默认运动最强段（`trimShotMotionClip`）；合计时长按模型上限；裁后仍短于 2 秒才拒发。
- **高光只取有歌词的部分**：整首歌词按 ≤45 秒分块听写（整首一次听写实测大段缺失）→ 推荐高光 = 30–60 秒窗内歌词句数最多且含高能量段、起止对齐乐句；高光与逐句秒位对外 0.1 秒，内部剪点按帧。
