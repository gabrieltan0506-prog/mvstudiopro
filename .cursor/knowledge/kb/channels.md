# channels · 上游通道血泪事实

> **0901现行冻结口径（覆盖本页后续历史实验值）**：PR #1328 已合并；Gemini 3.1 Pro 固定 `0.7→0.65→0.6`、`thinkingLevel=MEDIUM`、不发 thinkingBudget/mediaResolution，prompt 与基础/动态 Schema 一并由契约 SHA 锁定；只有每次任务明确给出的分片时长与 fps 可变。只有门禁失败降档；503/429/资源耗尽等待 60 秒后同温重跑，每个当前温度档最多资源重试3次。三档完成后固定交 Qwen 3.8 Max 三选一，无论 schema 是否通过都必须选出一份，按全方位可用性而非审美或单项分数判断；只把被选原稿交整集 GLM。分片模型并发上限 5，尾片无特例。GLM-5.3 整形固定 `temperature=0.8`、`reasoningEffort=high`、131072 输出上限。真源：`AGENTS.md`、`shared/manhuaNativeDeepReadJob.ts`、`server/services/manhuaNativeDeepReadRunner.ts`；下文 0825–0831 候选参数只作事故/实验史，不得恢复。

> **0901 Growth 恢复冻结规则**：把 GitHub 冷备下载到 Fly `/tmp` 做 manifest、字节数、SHA、tar 路径与 JSON 解析验真，不会写活动数据，可在抓取运行时只读执行；凡是把冷备写回、覆盖、合并或切换到 `/data/growth`，必须先冻结全部平台抓取并取得同一 collection lease，保存恢复前快照，再做原子切换/合并与前后计数验真。当前两条冷备 workflow 只上传和验真，自动源删除已关闭；后续空间释放只允许处理 B站，并须用户显式授权。不得用 GitHub 上传成功代替恢复成功，也不得要求用户从本机中转恢复数据。

## 生图（GPT-image-2，三通道）
- 价格基准序：**EvoLink $0.027/1K < OpenAI $0.030/1K < OpenRouter（官方价+加成，最贵）**。牌价真源 `shared/gptImage2ProviderPricing.ts`。
- 按 lane 路由：平台线已接「便宜优先」调度器；**资产线（lane=asset）曾直连 OpenAI 烧贵价**（P0 在案，修复以 #1196 部署为准）。点批量前 `fly logs` 看 `slot=` 实证走哪家（work-rules 22）。
- `GPT_IMAGE2_PRIMARY_TIMEOUT_MS=90s` 对异步 EvoLink 过短 → 主路径全滑 OpenAI 同槽。服务端修超时优先于一切新出图功能。
- EvoLink edits 场景曾连发「Image processing failed」——失败率高就对 edits 回钉官方通道。

## 听音（Gemini 音频理解）
- **Gemini 听音只有两条可用通道（用户 2026-11-09 更正）**：Gemini@Vertex → Gemini@EvoLink；**OpenRouter 不能用**，不得接入听音 fallback。
- MV 本段歌词识别（`server/gemini-audio.ts` `geminiAudioJsonWithFallback`）按这两跳走：超时 / 断线 / HTTP 错 / 空回 / 写坏（JSON 解析或逐句时间校验不过）都切下一跳；每跳 request/raw/decoded/parsed/rejected 永久落 GCS。
- GLM / DeepSeek 不能听音频，不能作为听音任务的 fallback。

## Gemini 模型配置（1110 起不写死）
- 真源 `shared/geminiModelConfig.ts` `resolveGeminiModel(domain)`：领域 env → `GEMINI_DEFAULT_MODEL` → `gemini-3.8-flash`；trim，空白回落；非 `gemini-` 合法标识回落并告警；名称含 pro 记 console.warn（不阻断）。
- 领域表（真源 `GEMINI_MODEL_DOMAIN_ENVS` / `GEMINI_MODEL_DOMAIN_DEFAULTS`，1110 快照；env 按列出顺序取第一个有效值）。缺省标「全局」= 领域 env 未设时走 `GEMINI_DEFAULT_MODEL` → `gemini-3.8-flash`；标「领域」= 领域缺省优先于 `GEMINI_DEFAULT_MODEL`，改全局缺省不会换掉它。改 Fly env 重启即生效，已入队任务按保存的模型恢复。模板学习精读续学：系列进度已落盘（已入库 / 在途）的系列按系列键写明的模型续学（如 `-g4a`），不看当前配置；是否已入库由服务端核实（`resolveStoredManhuaNativeResumeSeriesKey`），新系列只用配置模型，无后缀的旧 Pro 车道不重启。

| 领域 | 用途 | env（按优先顺序） | 缺省 | 缺省是否 Pro |
| --- | --- | --- | --- | --- |
| `manhuaDeepRead` | 模板学习精读首读 | `MANHUA_DEEP_READ_MODEL` | `gemini-3.8-flash`（全局） | 否 |
| `manhuaDeepReadEscalation` | 精读五发不过后的升级重读（缺省同首读 = 不升级） | `MANHUA_DEEP_READ_ESCALATION_MODEL` → `MANHUA_DEEP_READ_MODEL` | `gemini-3.8-flash`（全局） | 否 |
| `audioTwoHop` | 听音两跳缺省 | `GEMINI_AUDIO_TWO_HOP_MODEL` | `gemini-3.8-flash`（全局） | 否 |
| `mvSongHearing` | MV 独立听歌 | `MV_SONG_HEARING_MODEL` | `gemini-3.8-flash`（全局） | 否 |
| `montageGradeAdvice` | 成片调色建议 | `MONTAGE_GRADE_ADVICE_MODEL` | `gemini-3.8-flash`（全局） | 否 |
| `canvasVision` | 画布看图 / 视频反推帧 | `CANVAS_VISION_MODEL` | `gemini-3.8-flash`（全局） | 否 |
| `clipQualityReview` | 漫剧成片质检 | `MANHUA_CLIP_QUALITY_MODEL` | `gemini-3.8-flash`（全局） | 否 |
| `manhuaAdvisorWatch` | 漫剧顾问·看片 | `MANHUA_ADVISOR_WATCH_MODEL` | `gemini-3.8-flash`（全局） | 否 |
| `manhuaAdvisorBgm` | 漫剧顾问·配乐 | `MANHUA_ADVISOR_BGM_MODEL` | `gemini-3.8-flash`（全局） | 否 |
| `manhuaAdvisorSubtitle` | 漫剧顾问·字幕 | `MANHUA_ADVISOR_SUBTITLE_MODEL` | `gemini-3.8-flash`（全局） | 否 |
| `codeMotionSemantic` | 代码动画·原图语义预检 | `CODE_MOTION_SEMANTIC_MODEL` | `gemini-3.8-flash`（全局） | 否 |
| `codeMotionTiming` | 代码动画·词拍听音 | `CODE_MOTION_TIMING_MODEL` | `gemini-3.8-flash`（全局） | 否 |
| `platformSkillQa` | 创作顾问问答·联网检索摘要 | `PLATFORM_SKILL_QA_GEMINI_MODEL` | `gemini-3.8-flash`（全局） | 否 |
| `llmProTier` | invokeLLM pro 档缺省 | `LLM_GEMINI_PRO_TIER_MODEL` → `VERTEX_GEMINI_MODEL` | `gemini-3.1-pro-preview`（领域） | **是** |
| `llmFlashTier` | invokeLLM flash / 未指定档缺省 | `LLM_GEMINI_FLASH_TIER_MODEL` → `VERTEX_GEMINI_MODEL` | `gemini-2.5-flash`（领域） | 否 |
| `platformStage2` | Stage2 专属文案兜底 | `PLATFORM_STAGE2_GEMINI_MODEL` | `gemini-3.1-pro-preview`（领域） | **是** |
| `flashCopywriting` | Flash 文案 / 生图英文化 | `GEMINI_35_FLASH_MODEL` → `GROWTH_CAMP_EXTRACTOR_MODEL` → `GEMINI_FLASH_TRANSLATION_MODEL` → `VERTEX_GEMINI_FLASH_TRANSLATION_MODEL` → `VERTEX_GEMINI_COVER_TRANSLATION_MODEL` | `gemini-3-flash-preview`（领域） | 否 |
| `compositeFlashTranslation` | 平台 composite 英文化 | `VERTEX_GEMINI_FLASH_TRANSLATION_MODEL` → 其余同 Flash 文案链 | `gemini-3-flash-preview`（领域） | 否 |
| `coverTranslation` | 选题竖封英文化 | `VERTEX_GEMINI_COVER_TRANSLATION_MODEL` → 其余同 Flash 文案链 | `gemini-3-flash-preview`（领域） | 否 |
| `strategicCoverDirector` | 战略封面 / 扉页 / 抠图双语编导 | `STRATEGIC_COVER_DIRECTOR_GEMINI_MODEL` → `VERTEX_GEMINI_31_PRO_MODEL` → `VERTEX_GEMINI_MODEL` | `gemini-3.1-pro-preview`（领域） | **是** |
| `deepResearchAssist` | 战略智库辅助生成 | `DEEP_RESEARCH_ASSIST_GEMINI_MODEL` | `gemini-3.1-pro`（领域） | **是** |
| `growthCampExtractor` | 成长营 Phase 1 音频 / 关键帧粗筛 | `GROWTH_CAMP_EXTRACTOR_MODEL` | `gemini-3.5-flash`（领域） | 否 |
| `geminiCarbon` | Carbon 共用调用层缺省（1111） | `GEMINI_CARBON_MODEL` | `gemini-4-carbon`（领域） | 否；**缺省非 Flash，属贵档，只在用户主动选择时调用** |
| `manhuaDeepReadUpgrade` | 模板学习·整集精读升级档（替换 Argon，车道 `-g4c`） | `MANHUA_DEEP_READ_UPGRADE_MODEL` → `GEMINI_CARBON_MODEL` | `gemini-4-carbon`（领域） | 否；贵档，只在用户主动选择时调用 |
| `musicMvDeepCompose` | MV 顾问·深度编排（整片 compose + 逐窗节拍） | `MV_DEEP_COMPOSE_MODEL` → `GEMINI_CARBON_MODEL` | `gemini-4-carbon`（领域） | 否；贵档，只在用户主动选择时调用 |
| `novelWriterCarbon` | 小说改编 / 连载扩写「线路三」 | `NOVEL_WRITER_CARBON_MODEL` → `GEMINI_CARBON_MODEL` | `gemini-4-carbon`（领域） | 否；贵档，只在用户主动选择时调用 |

- 缺省为 Pro 的 4 个领域（`llmProTier` / `platformStage2` / `strategicCoverDirector` / `deepResearchAssist`）是搬表前就写死的旧值，行为未变；是否降到 3.8 Flash 待用户拍板（删领域缺省条目或设该领域 env）。
- 1110 行为变化：创作顾问联网摘要原走 Flash 文案链（缺省 `gemini-3-flash-preview`），改为 `platformSkillQa` 领域后缺省 `gemini-3.8-flash`，不再读 Flash 文案旧 env 链。
- 精读历史身份不变：`MANHUA_NATIVE_DEEP_READ_MODEL`（3.1 Pro）只作旧任务缺省 / 段缓存指纹缺省身份 / 计划码；3.1 Pro、3.8 Flash 段缓存指纹不写模型，Argon 与配置新模型写入模型；配置新模型车道系列后缀 `-gm-<去前缀、点换下划线>`。精读成本表外模型按表内最高单价估算（不按 0 元）。

## Gemini 4 Carbon（1111 接入，贵档）
- 只走 EvoLink、Gemini API、Vertex，**不接 OpenRouter**。模型标识 `gemini-4-carbon`（`-preview` 三通道 404）。1111 09:00Z 实测：EvoLink 200/2.2s，Gemini API 200/8.3s（先花思考 token，输出上限小会 MAX_TOKENS 空正文），Vertex global 90 秒无回应。
- 价格：首发到 11-30 输入 $2 / 输出 $10 每百万 token，12-01 起 $4 / $20；输出含思考 token；上下文约 105 万。常量真源 `shared/geminiCarbon.ts`。
- 共用调用层 `server/services/geminiCarbonCall.ts`：通道顺序 `GEMINI_CARBON_CHANNEL_ORDER`（缺省 `evolink,gemini_api,vertex`），单通道文字类缺省超时 5 分钟、输出上限 65536；超时 / 断线 / HTTP / 错误包 / 空回 / MAX_TOKENS / 拦截 / 写坏（同通道带原因修复一次）都切下一通道；429 同通道退避 2s/5s/10s（同 `GEMINI_TWO_HOP_RATE_LIMIT_BACKOFF_MS`）；每发 request/raw/decoded/parsed/rejected 永久证据，用量（输入/输出/思考）入证据与日志。带媒体请求不走 Gemini API（需 Files API，不做）。
- 模板学习 Carbon 车道读原生视频：`MANHUA_DEEP_READ_CARBON_ROUTES`（缺省 `evolink,vertex`，不含 Gemini API）；Vertex 复测通过可设 `vertex,evolink`。升级重读缺省不改（同首读模型）；要让五发不过的分片升级到 Carbon，设 `MANHUA_DEEP_READ_ESCALATION_MODEL=gemini-4-carbon`（所有失败段都会走贵档）。
- 用户入口（全部默认不选）：模板学习面板「整集精读升级档」、MV 顾问「深度编排」（全部通道失败回落原三跳并标注）、小说改编 / 连载扩写「线路三」（失败不换线、不扣点）。

## 视频
- **Seedance 2.5 三通道路由拍板（用户 2026-08-13 口径）**：
  - BytePlus = 官方 API 最便宜，但**挡真人脸**；OpenRouter 同样挡脸——这两家只能出 CG。
  - **仿真人剧一律 EvoLink**（不挡脸，贵；content_filter 放宽 +10%）。
  - **CG 内容走便宜通道（BytePlus/OpenRouter），但生成中途因「太像真人」被退回时 → EvoLink 接手**，这是标准 fallback，不算事故。
  - 唯一例外：积分不够时才允许 BytePlus/OpenRouter 二选一硬扛（放弃 EvoLink 兜底）。
- **Seedance 审核词面误判（2026-08-27 实锤）**：`子弹时间`本意是环场慢动作摄影术语，但通道审核会只命中“子弹”并按暴力词拒绝。出站提示词统一改写为“高速环绕定格慢动作 / 环场时空凝滞运镜”，不得靠换供应商规避。BytePlus 会把 3D 仿真人脸判作疑似真人；EvoLink 放宽审核后可通过但用户实付约贵 30%；两边对暴力词都可能拦截。
- Seedance 硬事实：2K 全系不存在；2.5 上限 720p；4K 只有 2.0（EvoLink $1.0126/s）。成本按像素线性（tokens=宽×高×秒×24/1024，$7/M）。
- **mode 枚举用下划线**（`image_to_video`）——连字符字符串会被 `input.mode || inferSeedanceMode(...)` 静默放行并打断模型解析，产出文生视频冒充图生视频（P0-6 实锤）。
- **MiniMax H3（2026-08-13 实测口径更新）**：
  - **不挡真人脸——用户亲测实锤**（老照片动画线在用；博文 old-photo-restoration 有真账单：仿真人母子照 → 2144×1440、5.17s、$0.65 = $0.13/s 分毫不差）。
  - 通道三选：**EvoLink（推荐主通道）768p 默认 + 2K 双档**，模型名 `minimax-h3-text/image/reference-to-video`，参考上限图 9/视 3/音 3，**参考音频时长不计费**、参考视频计费；OpenRouter 只剩 2K（768p 已下架）$0.13/s + 参考图第 6 张起 $0.04/张；直连官方（api.minimax.io）768P|2K——**Fly 上没有 MINIMAX_API_KEY**，走 EvoLink/OpenRouter 用现有 key 即可。
  - 时长 4–15 整数秒（产品成片档固定 15s 出售，探针短测不改商业规则）；「2K」实际输出 2144×1440 非标准分辨率——超分/成片链一直在消化非标尺寸（1176×784、560×752 都过过），**768p 超分无碍**。
  - **仿真人剧预算档推荐**：H3 走 EvoLink，768p 出草稿、选中的镜头 WaveSpeed 超分 2K（≈$0.09/s），品质镜头原生 2K（$0.13/s）；对比 Seedance 2.0 720p $0.151/s 全面占优，Seedance 2.0 只剩 480p 探针岗。要 edit/extend/多模态花活才上 Seedance 2.5。
  - EvoLink 768p 单价（44.2 credits/4s）的美元换算**待第一单真实账单校准**。旧口径「EvoLink 与 H3 任务均不可取消」维持。
- WaveSpeed 超分：`runWavespeedVideoUpscale({videoUrl, target})` 2K $0.0144/s、4K $0.0288/s，音轨保留，结果镜像回 GCS。
- 视频探针一律 Seedance 2.0-mini 480p（work-rules 7）；HappyHorse 1.1 = 首页照片动画引擎（720p/1080p）。

- **Seedance 2.5 r2v 720p 实单（1109）**：9:16、30s、`content_filter:false`、图 5–6 张 + 参考视频 4–6s，每单 `usage.credits_reserved`=终态 `cost.credits`=**807.534 credits/30s**（≈26.9 credits/s，按 1 credit≈$0.0147 折约 $11.9/单），约 6.5 分钟出片，实出 30.08s、720×1280、24fps、带声。

### EvoLink Seedance 2.5 五模型（2026-08-13 读官方文档实录）
- 统一端点 `POST /v1/videos/generations`，模型名：`seedance-2.5-text-to-video / -image-to-video / -reference-to-video / -video-edit / -video-extend`。输出只有 480p/720p，按输出秒计费；`content_filter:false`（放宽真人限制）一律 **+10%**；「AIGC 写实人物素材」官方支持。
- **video-edit**：删物/删人、按参考图换主体、局部重绘、换背景音；`duration` 只认 `-1`（等长原片）；成片有穿帮用它做局部手术，别整段重烧。
- **video-extend**：prompt 指定正续/倒续，单次出 4–30s，链式续片每请求独立；**参考视频的输入时长也计费**。
- **reference-to-video**：图 ≤30 / 视频 ≤10 / 音频 ≤10（比小云雀白名单 9/3/3 宽得多）。
- 源片约束：mp4/mov、单条 2–30s 且合计 ≤30s、≤200MB、300–6000px、24–60FPS、**禁 base64**；prompt 用 `@video1/@image1` 点名素材。
- **产物链接只活 24h——出片后立即镜像回 GCS**。用户 1110 确认：EvoLink 2.5 任务提交即不可取消（回执 `can_cancel:true` 不可信；1109 两单 r2v 720p 实单回执为 `task_info.can_cancel:false`）；因此一切付费视频提交前必须取得用户明确批准。
- 小云雀（Pippit）路由是另一套封装（video_part/nest，见 `.cursor/knowledge/xyq-seedance25-handbook-gaps.md`），与本节 EvoLink 参数不可混用。

## 生图 edit：实拍照放入人物重绘（1109）
- 现成通道即 `canvas_gpt_image2` 任务的 edit 模式（`referenceImageUrls` 非空 → 官方 `images/edits`），无需新接口；本功能固定 `gpt-image-2.6-sunburst`、官方资产线、high，经 `params.stockPhotoPersonEdit` 由 runner 复核载荷（`server/services/stockPhotoPersonEdit.ts`），按画布出图单价扣费。
- 参考顺序硬约定：image 1 = 实拍底图（透视/材质/光源以它为准），image 2.. = 人物（真人身份照只锁脸、定妆帧锁脸与服装）；先评估底图适配度，适配才 edit，不适配纯生成。
- 实测 1024×1536 edit：3 张参考 input image tokens 4608、2 张 3072，output 1372，单张 ≈$0.06–0.08（按 image 2 牌价估）；约 60–80s/张。

## LLM 双引擎（扩写/提炼类）
- 稳定档 Kimi K3：OpenRouter `moonshotai/kimi-k3`（$3/$15 per M）reasoningEffort high、max_tokens 32k；EvoLink 备胎 reasoning 只认 "max"。
- 轻快档 Qwen 3.8 Max：EvoLink 主（$1.765/$5.295）enable_thinking + reasoning_effort xhigh + max_completion_tokens 65536；OpenRouter `qwen/qwen3.8-max`（$2/$6）备胎。
- 编排：attempts 数组（主×2 + 备胎×1），全空回 → failedPicks 退款。
- 「开到最大」类指令 = 枚举**每一个**可调参数逐一拉满（漏掉 reasoning 档位吃过 P0）。

### Qwen 3.8 Max 原生视频精读：新加坡套餐直读 GCS（2026-08-25 实测）
- **套餐密钥与端点必须成对**：新加坡 Token Plan 使用 Fly secret `DASHSCOPE_SG_PLAN_KEY`，OpenAI 兼容地址固定为 `https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`。不得把这把套餐密钥配到普通新加坡业务空间地址 `{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com`；实测会返回 `401 InvalidApiKey`，输入/输出 token 均为 0。
- 普通新加坡业务空间地址只搭配该业务空间所属的普通 API Key，属于另一计费通道；它与 Token Plan 套餐地址、密钥不可混用。
- **GCS 视频实链已通**：Fly 生成 4 秒红→蓝测试视频，上传 GCS 后以 V4 签名 URL 送入新加坡套餐 `qwen3.8-max`；GCS Range GET `206`，模型 HTTP `200`、`finish_reason=stop`、输入 372 / 输出 90 tokens，结果准确返回 `red → blue / changed=true`。测试对象与本地探针文件均已删除。
- 新加坡套餐多模态请求走 OpenAI Chat Completions，视频项使用 `type=video_url`、`video_url.url=<GCS V4 signed URL>`；不要沿用北京 DashScope 原生请求体的 `{video, fps}` 形状。
- **抖音 CDN 直读实链已通**：用户提供的搜索页 `modal_id=7633315305602780435` 先归一为标准 `/video/` 单集页，前置解析取得 151 秒、4 个可用 CDN 候选；新加坡 Token Plan 的 `qwen3.8-max` 直接读取最小 `bytevc1_540p` CDN，HTTP `200`、`finish_reason=stop`、输入 10,122 / 输出 2,340 tokens，并准确复述开头、中段、结尾。没有经过 OSS 或 GCS。
- **分片决策只按时间，不按文件大小**：正式精读每片最长 300 秒；90 秒短片为 10fps，长片为 5fps。约 1080 秒一集固定拆 4 片，每片独立上传 GCS、独立调用 Gemini；禁止把整集各片体积相加后套 64MB 预算或预转码。H.264/H.265 会让同内容体积相差数倍，体积不能决定分片数。
- **历史口径勿混用**：0823 的 46 分钟 `fps=0.5` 粗读、`fps=2 × 2000帧 = 1000s` 过渡方案与 360 秒三片的**发车规格**都已退役。当前发车真值是 `time-300s-v5-gemini-direct-gcs`：每段一次调用，段过门禁即写 `segment-cache`，失败重跑只补未完成段。此前按原生视频精读产出且已通过门禁的 360 秒结构仍是有效新模板成果，不因分片规格换代作废。视觉首轮 `temperature=0.75`；门禁重试只补充拒因，最低温度固定 `0.65`，禁止归零。
- **当前生产通道**：原生精读统一由 Vertex `gemini-3.1-pro-preview` 以 `fileData.fileUri=gs://...` 读取 GCS 分片，并用 `videoMetadata.fps` 控制采样；新加坡 Qwen `video_url` 仅保留为历史探针结论，不是当前生产发车链。部署后的真实面板学习仍需另行验收，不能用静态全绿代替。
- **原生精读证据完整性（2026-08-28 硬规则）**：每个成功分片的原始模型 JSON、usage、来源摘要与参数指纹永久写入 `manhua-template-learn/segment-evidence/tpl_native_<series>_epNNN/<sourceDigest>/seg<index>-<fingerprint>.json`；`segment-cache` 只负责零费续跑，集卡入库后可清，不能替代永久证据。视觉节拍、字幕、声音轨/事件、场景提示、分类标签、来源引用从解析、缓存、入库、同集滚动合并、优化、系列聚合直到消费端均不得按固定数量抽样、合并或截断。有多少条证据就保留多少条；下游承载不了时必须显式失败或切换已有 fallback，不得压缩后冒充成功。

### Gemini 3.6 Flash 原生音轨 A/B（2026-08-25 实测）
- **三轨边界**：Qwen 3.8 Max 的同一次视频调用负责逐镜拍法与画面字幕原文；Gemini 3.6 Flash 另读音轨，只回答语气、情绪强度、音效、配乐、气氛、混音与静默。声音轨不得转录原台词，也不得替画面轨推断剧情。三轨统一用全片绝对秒，声音分段允许粗于镜头。
- **真实 A/B 条件**：同一支 151 秒抖音素材、同一 Gemini `gemini-3.6-flash`、同一 Vertex `global` 请求、同一 GCS 临时读取、同一 prompt 与结构 schema；仅改变 ffmpeg 音轨：A=`16kHz/mono/32kbps MP3`，B=`32kHz/stereo/64kbps MP3`。共发生 2 次真实模型调用。
- **回执**：A 文件 604,748 bytes，26.454s 返回，prompt 4,339 / 其中 AUDIO 3,775 / answer 1,585 / thoughts 1,154 tokens；B 文件 1,208,936 bytes，23.642s 返回，prompt 4,339 / 其中 AUDIO 3,775 / answer 1,355 / thoughts 899 tokens。两边 `finishReason=STOP`，均返回 6 段 `audioTrack`。按 2026 年优惠价输入 $0.75/M、输出与推理 $3.75/M、USD/CNY=7 粗估，本次两请求合计约 ¥0.177；最终以 Google 账单为准。
- **结构与质量差异**：两边顶层 5 字段、`audioTrack` 子项 8 字段及 6 段数量完全一致；具体切段和听觉判断明显不同。两边都出现「顶层时间段合法、文字内 MM:SS 与所属段不一致」，B 还写出超过 02:31 素材终点的 `02:44/02:45`。因此不能把 schema 合法当作内容可信，也不能依据单轮结果宣称 16k 必然优于 32k。
- **第二轮纠偏实测**：把时间收口为 `fromSec/toSec/cues[].atSec`，描述文本禁止再写第二份时间，并加 cue 所属区间门禁；相同素材与 A/B 规格再次各调用一次。A=5 段/13 cues、22.252s、prompt 4,536 / AUDIO 3,775 / answer 1,925 / thoughts 1,337；B=6 段/14 cues、36.184s、prompt 4,536 / AUDIO 3,775 / answer 2,018 / thoughts 2,408。两边全部 cue 均在所属段内并覆盖 0..151 秒，第二轮估算约 ¥0.249。
- **当前取舍**：生产默认选 A（16kHz 单声道），因为文件体积减半、两轮 AUDIO token 都与 B 完全相同，且第二轮没有观察到 A 的结构信息缺失。B 的分段略细、推理更多，但单素材单轮不能证明这是立体声带来的因果提升；`toneZh`、`silenceZh` 均保留为待更多真片验证字段。四次探针合计估算约 ¥0.426。
- **硬门禁**：有音轨时，Vertex `usageMetadata.promptTokensDetails` 中 AUDIO token 必须大于 0；否则无论报告写得多完整都判废。`audioTrack` 顶层秒位必须覆盖 0..lenSec、单调且不越界；所有文本字段里的 `MM:SS` 也要扫描，越过素材终点或落在所属段外即拒收。
- **清理验收**：两轮探针结束后均核对 GCS `manhua-template-learn/tmp/native-audio-probe/` 对象数为 0、Fly `/tmp/native-audio-ab-*.mp3` 文件数为 0，临时探针脚本已从线上容器移除。

### GLM-5.3 系列结构聚合（2026-08-25 实测）
- **职责边界**：分集视觉仍由新加坡套餐 `qwen3.8-max` 读取视频，双音轨仍由 Gemini 3.6 Flash 分析；同剧全部分集卡落为本地 JSON 快照后，最后的跨集故事骨架、五维多标签、变化规则与通用视听结构改走 OpenRouter `z-ai/glm-5.3`。不得回落北京 Qwen 3.8 Max，也不得把 GCS 媒体 URL 交给 GLM。
- **共享网关归属**：GLM 调用契约统一由 `server/services/bailianChat.ts` 管理；默认链为 OpenRouter GLM → 新加坡 Token Plan Qwen → EvoLink Qwen。原生系列聚合必须显式使用 `openrouter_only`，因此仍锁定 GLM，不接受 Qwen 兜底冒充系列聚合成功；历史百炼枚举只为旧账本反序列化保留。
- **固定参数**：`reasoning={effort:"max"}`、`response_format={type:"json_object"}`、`max_tokens=131072`、`provider={require_parameters:true}`；不发送 `temperature/top_p`。OpenRouter 公共模型目录确认上下文 1,048,576、最大输出 131,072。
- **真实单枪回执**：Fly 只读取 OpenRouter secret 并发出 1 次请求；HTTP 200，provider=`Z.AI`，`finish_reason=stop`，JSON 解析成功；input 105、reasoning 203、output 218 tokens，耗时 7.299 秒，OpenRouter 回执成本 `$0.0011062`。没有调用北京 Qwen；本次只证明路由与参数可用，不等于完整系列聚合链已线上验收。

### 图文手册审校链（2026-11-09 敦煌 48 张整册实测）
- **实际顺序由请求的 executionChannel/executionFamily 决定**：审校批次通道由 `publication.parallel.channels` 指定（工位 EvoLink 份额大、首发），新稿 `parallel.family=glm` → GLM-5.3 FlashX@EvoLink → @OpenRouter → DeepSeek V4.1 Flash 1017@EvoLink → @OpenRouter；旧稿（含 1109 敦煌/血脂）缺 family，沿用 DeepSeek 优先，因 executionFamily 参与 requestDigest，不能事后改。全局 `KNOWLEDGE_PUBLICATION_ROUTE_ORDER` 只是无通道指定时的兜底。
- **EvoLink 带图请求 BaseURL 已是 `https://api.evolink.ai/v1/chat/completions`**（多模态主力地址），不是 `direct.evolink.ai`。
- **OpenRouter DeepSeek 断流**：24 章 HTTP 200、流已开始后中途断，无 402/429/5xx；`max_tokens=393216` = OR DeepSeek 自营端点 `max_completion_tokens`（EvoLink 384000），非误配。出口：unknown 回执等迟到回执 ≤3 分钟 → 归档 `interrupted` → 切下一路补买一次（同章仅一次），`interrupted-repurchase.json` 永久记录；零调用恢复入口 `interruptionPolicy=hold` 不等不买。
- **EvoLink image_url 400「invalid or missing」**：54 次，全部是 4K PNG 13–18MB 的 GCS V4 签名 URL（即签即发，非过期），同一 URL 先 400 后 200 共 14 个 → EvoLink 上游 60 秒内拉不完境外鉴权大图。修法：审校前生成 `<原图目录>/review-thumbs/<原文件名>.jpg`（长边≤2048、JPEG q85，永久保留）签 URL 送模型，原图 URL 只作回退；不用 base64（用户明确不接受）。image_url 400 不计四次上限，同通道只补 1 次，再 400 才切通道。
- 两模型在 OpenRouter 模型表均 text+image；EvoLink DeepSeek 同样接受 image_url（22 章成功）。capabilities 表加 `vision` 标注，带图请求只在 vision 路由间切换，无 vision 路由时降级去图并标 `degraded=text-only`（当前四路均 vision，该分支未触发）。

### Wan 3.0 / HappyHorse 1.1 三通道（PR #1308，2026-08-25）
- **Wan 3.0**：顺序固定为 OpenRouter → EvoLink → WaveSpeed。带参考音频/视频时，OpenRouter 在真单证明字段确实被消费前默认无资格，实际从 EvoLink 开始；明确 4xx 才允许换下一家，网络断、5xx 或 2xx 缺任务号一律转人工对账，不退款、不自动重提。
- **HappyHorse 1.1**：照片动画顺序为 EvoLink → OpenRouter → WaveSpeed；单图保持 image-to-video 首帧契约。自由画布有效参考图不少于 2 张时切 reference-to-video，OpenRouter 因无多图参考契约而跳过，只走 EvoLink → WaveSpeed。百炼在途旧单只轮询收尾，不再新建。
- **恢复与防双烧**：实际通道写回引擎，崩溃恢复用 `pinChannel` 锁定；`auto+句柄` 先归位后轮询；立即成功后的镜像失败保持 running 等待重取；结果未知进入 `reconcile_manual`。下单闸按本单参考轨资格判断，避免先扣费再发现全链不可用。
- **验证边界**：#1308 合并前 TypeScript、2766 项全量测试与两类构建通过；Wan 的 OpenRouter/EvoLink 首单、HappyHorse 的 EvoLink/WaveSpeed 首单及多图 r2v 首单均未实弹，未做线上真跑。

## 铁律
- 媒体进系统标准通道 = **GCS/Fly 签名 URL**，不走 base64 传媒体；base64 只允许作脚本/剪贴板兜底传输，用即说明（P0-7）。
- 前台零技术泄漏：模型名/供应商名/部署平台一律不出现在用户可见文案。

- [音乐生成变体约定：默认两版与完整回执](./music-generation-variants.md)
