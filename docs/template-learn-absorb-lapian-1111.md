# 模板学习吸收拉片长处 · 调研结论与实现（2026-11-11）

> 范围：模板学习（站长专用，漫剧创作参考）吸收拉片的四项长处——可播放片段、镜头构造表、段落复刻提示词、视觉基因六维。拉片（普通用户）与模板学习两条线保持独立，只共用 `shared/videoBreakdown.ts` 的复刻提示词结构与格式函数。

## 1. 结论一句话

**选首选方案·派生层，不动精读契约。** 学习卡（`ManhuaViralTemplateCard`）里已有逐镜全量证据，镜头构造表可完全由确定性函数生成；复刻提示词和视觉基因中「媒介/色彩/材质」这类判词由一次便宜文字模型调用补齐（只读学习卡 JSON，不重看视频）。派生产物单独存放、单独版本号（`tpl_lapian_v1`），不写回学习卡、不改变学习卡身份、不碰段缓存指纹。

## 2. 学习卡现有字段 vs 拉片四项长处

| 拉片长处 | 学习卡可直接支撑的字段 | 缺口 | 处理 |
|---|---|---|---|
| 镜头构造表（时间｜景别｜摄影机｜调度·构图与焦点） | `beatGrid[]` 每镜：`atSec/endSec`、`shotSizeZh`、`angleZh`、`cameraMoveZh`、`compositionZh`、`blockingZh`，另有 `hintZh/lightingZh/transitionInZh/unitTypeZh` | 无。brief 镜（精读的 5 字段简写镜）没有景别/机位等，旧抽帧卡全部没有 | 纯函数逐镜映射，一镜一行、不抽样；空字段显示「—」（只是展示占位，不写回、不冒充学到） |
| 段落复刻提示词（秒锁七栏） | 段内全部镜头的 18 项证据、`audioStory.audioTrack[]`（含 cues）、`evidenceFrames`（重点时刻说明）、卡级 `reusableZh / genPromptHintZh` | 「主体一致性 / 生成约束 / 竖屏改写」是创作判断，证据里没有现成文本 | 按段懒调用一次文字模型，产出直接用拉片的 `videoBreakdownRecreatePromptSchema` 校验、`formatVideoBreakdownRecreatePrompt` 拼文本 |
| 视觉基因六维 + 复刻要点 | `lightingZh`（光线）、`compositionZh`（构图）、`angleZh/cameraMoveZh/shotSizeZh`（摄影机）逐镜全量；`classification.audiovisualTagsZh`；`genPromptHintZh` | 「媒介与美术风格 / 色彩 / 材质与质感」没有逐镜字段，只散在 `hintZh/lightingZh/compositionZh` 文本里；「反复出现的元素 / 复刻要点」需要归纳 | 函数先算全量频次（景别、机位、运镜、转场、单元类型；不截断）；全片逐镜视觉字段 + 频次交文字模型**一次**汇总成六维 + recurringElements + mustKeep（拉片 overview 同一组子 schema） |
| 可播放片段 | 卡 `provenance.nativeVideoDeepRead.segmentSpans / sourceDigest / sourceDurationSec`，可还原精读分片的恢复身份 | 卡里不存媒体地址 | 走既有 `readPreparedMedia` 找回精读用的 GCS 分片 → 按段起止秒裁切（复用 `videoPartialEditCut.cutVideoSegmentToFile`）→ 按需签名；找不回就不出片段，只保留重点时刻截图 |

**结论：** 镜头构造表、复刻提示词、视觉基因所需信息在现有学习卡里都有（或可由文字模型从现有证据可靠推出），**不需要解冻 schema**。精读提示词、基础/动态 schema、温度档、分片规格、契约 SHA、段缓存指纹、已入库卡身份全部不变。

## 3. 源视频分片是否还在 GCS（能否切片段）

- **存放：** 精读分片在 `manhua-template-learn/tmp/native-deep-read/<runId>.mp4`；生产链路（`manhuaNativeDeepReadExecution` 传 `segmentCacheSeriesKey`）为每个分片写恢复索引 `manhua-template-learn/prepared-media/v1/<seriesKey>/<sha256(身份)>.json`，身份 = seriesKey + sourceDigest + 集号 + 片长 + 分片起止秒（与模型/温度/提示词无关）。旧卡另有 `native-frame-sources/<sha>.json` 旧索引，`readPreparedMedia` 会核验后迁移。
- **代码层留存规则：** 有恢复索引的分片标 `reusable`，runner 的 finally 清理只删 `!reusable` 的临时片（`manhuaNativeDeepReadRunner.ts` 批次 finally、备料失败清理两处）；截图补截链（`manhuaNativeDeepReadExecution` collect）也依赖这些分片。仓库内没有其他删除 `tmp/native-deep-read/` 的代码。读取时用 generation + 字节数双校验，对象被换/被删即视为不存在（返回 null，不回源、不重读模型）。
- **风险点（未验证）：** 路径在 `tmp/` 前缀下，桶级生命周期规则（如有）不在仓库里，本次按规矩**没有**用本机凭证查线上桶。所以：**代码层面分片是长期保留的，可用于切片段；线上是否被桶生命周期清掉需站长在 Fly 侧核实**。实现上按段懒查：找得到就切，找不到返回「源分片已不在，只保留重点时刻截图」，不失败、不回源、不花钱。
- 切出的片段存 `manhua-template-learn/lapian-derived/v1/...`（不在 `tmp/`），条件创建不覆盖；签名 15 分钟。

## 4. 实现

| 层 | 文件 | 说明 |
|---|---|---|
| 纯函数（前后端共用） | `shared/manhuaTemplateLapianView.ts` | 镜头构造表、分段计划、段证据包、视觉频次统计、模型输出 schema、提示词时间窗校验、证据摘要输入 |
| 服务 | `server/services/manhuaTemplateLapianService.ts` | 读卡、三跳文字模型（`CREATIVE_LLM_HOPS`：GLM 5.3 FlashX@EvoLink → @OpenRouter → DeepSeek V4.1 Flash）、写坏带原因重写一次再切跳、request/raw/parsed/rejected/error 逐发永久落 GCS、结果缓存、片段裁切签名 |
| 路由 | `server/routers/manhuaTemplateLapian.ts`（注册为 `manhuaTemplateLapian`：`segmentPrompt` / `genes` / `segmentClip`，均走鉴权 Fly 长连接） | 三个接口全部 `assertSiteOwner`（与 `renderEpisodeReport` 等模板学习接口同一判定：`OWNER_OPEN_ID`），不扣费 |
| 前台 | `client/src/components/ManhuaTemplateLapianPanel.tsx`，挂在 `ManhuaApprovedTemplateOwnerDrawer`（站长专属正式模板详情） | 「镜头构造」「复刻提示词」「视觉基因」三个区块，一键复制；没改 PlatformPage |

### 分段规则（确定性，`tpl_lapian_v1`）
- 先按学习分片 `segmentSpans` 切（片段裁切因此不会跨源分片）；无 spans 的旧卡退化为一段全片。
- 片内按镜头边界贪心累积，满 60 秒或满 40 镜（拉片 `timeline` 上限 40）收段；尾段不足 20 秒且合并后不超 40 镜则并入上一段。段与段首尾相接，覆盖分片全长。
- 每镜按 `atSec` 归属唯一一段：**证据条数进 = 呈现条数出**（测试断言）。

### 派生产物存放（不写回学习卡）
`manhua-template-learn/lapian-derived/v1/<templateId>/<evidenceDigest前16位>/`
- `genes/result.json`、`segments/seg###/result.json`：被接受的解析结果（条件创建）。
- `genes/runs/<runId>/hop<n>-<model>-try<k>-{request,raw,error,parsed,rejected}.json`：每一发的原始与解析回执分对象永久保存；失败、拒收、重试都不删。
- `clips/seg###.mp4` + `clips/seg###.json`（来源分片 gsUri、裁切模式、秒位）。
- evidenceDigest = sha256(派生版本 + 全部 beatGrid + audioTrack + evidenceFrames 说明 + segmentSpans + 片长)。卡被优化修订后摘要变化，自然生成新派生，不污染旧的。

### 计费
管理员/站长 0 扣费：派生接口不调用任何扣费函数，不新增对外计价项。文字模型成本只落回执（raw 里的 usage）。

## 5. 未验证 / 需站长拍板

1. 线上 `tmp/native-deep-read/` 是否有桶生命周期规则（决定旧集能否出片段）。若有，建议把有恢复索引的分片迁出 `tmp/` 或给前缀加例外——这是删除/存储策略，需站长决定。
2. 片段裁切固定输出 30fps（`videoSegmentCutRate` 只接受 24–60）；如果源是 25fps 会有帧率转换，需要的话改成先 ffprobe 读源帧率。
3. 真实学习卡与真实模型输出质量未验证（本次不发任何真实模型请求）；首次上线建议站长挑一集点一段看提示词质量。
4. 前端组件只做了 esbuild 语法检查，未跑全量 tsc / vite build（共用机器内存限制）；服务端与 shared 新文件已用定向 tsc 检查通过。合并前请在 CI 跑一次全量类型检查。
5. 视觉基因一次调用的输入是全片逐镜视觉字段（41 分钟 527 镜约十几万字），在 GLM 上下文内，但成本约为单段的数十倍；如嫌贵可改为按学习分片各汇一次再合并（需要拍板）。

## 6. 拉片可以再向模板学习学什么（只列不做）

1. **逐镜表演证据**：模板学习每个重点镜有身体动作 / 肢体道具 / 微表情 / 视线呼吸 / 关系反应五栏，拉片镜头表只有景别·摄影机·调度三栏，复刻人物戏时缺表演指令。
2. **转场记录**：模板学习逐镜记 `transitionInZh`（硬切/闪白/叠化），拉片没有，复刻剪辑节奏会丢。
3. **证据与广告区分**：模板学习有 `evidenceRole=non_story_ad` 和 `excludedAdRanges`，拉片对含贴片广告的片子会把广告也拆进段里。
4. **原始 JSON 与解析 JSON 分对象永久保存 + 条数对账**：拉片目前只存最终结果与通道回执，没有镜头/音轨条数对账门禁。
5. **覆盖率门禁**：模板学习对镜头与音轨覆盖率低于 90% 判不合格，拉片只校验段首尾相接，不校验段内镜头是否连续覆盖。
6. **声音逐段秒位表**：模板学习每段音轨有情绪弧/语气/音效/配乐/气氛/留白六栏 + cue 点事件，拉片 `sound` 只有全片四句。
7. **字幕时间轴（仅内部证据）**：模板学习保留 OCR 字幕 `subtitleTrack` 用于对齐重点时刻，拉片没有，重点时刻说明只能靠模型复述。
8. **五维分类标签**：模板学习的情绪/叙事特色/表演/视听/观众体验五维标签可直接用于检索与归档，拉片的 `styleTags` 是一维平铺。
