# channels · 上游通道血泪事实

## 生图（GPT-image-2，三通道）
- 价格基准序：**EvoLink $0.027/1K < OpenAI $0.030/1K < OpenRouter（官方价+加成，最贵）**。牌价真源 `shared/gptImage2ProviderPricing.ts`。
- 按 lane 路由：平台线已接「便宜优先」调度器；**资产线（lane=asset）曾直连 OpenAI 烧贵价**（P0 在案，修复以 #1196 部署为准）。点批量前 `fly logs` 看 `slot=` 实证走哪家（work-rules 22）。
- `GPT_IMAGE2_PRIMARY_TIMEOUT_MS=90s` 对异步 EvoLink 过短 → 主路径全滑 OpenAI 同槽。服务端修超时优先于一切新出图功能。
- EvoLink edits 场景曾连发「Image processing failed」——失败率高就对 edits 回钉官方通道。

## 视频
- **Seedance 2.5 三通道路由拍板（用户 2026-08-13 口径）**：
  - BytePlus = 官方 API 最便宜，但**挡真人脸**；OpenRouter 同样挡脸——这两家只能出 CG。
  - **仿真人剧一律 EvoLink**（不挡脸，贵；content_filter 放宽 +10%）。
  - **CG 内容走便宜通道（BytePlus/OpenRouter），但生成中途因「太像真人」被退回时 → EvoLink 接手**，这是标准 fallback，不算事故。
  - 唯一例外：积分不够时才允许 BytePlus/OpenRouter 二选一硬扛（放弃 EvoLink 兜底）。
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

### EvoLink Seedance 2.5 五模型（2026-08-13 读官方文档实录）
- 统一端点 `POST /v1/videos/generations`，模型名：`seedance-2.5-text-to-video / -image-to-video / -reference-to-video / -video-edit / -video-extend`。输出只有 480p/720p，按输出秒计费；`content_filter:false`（放宽真人限制）一律 **+10%**；「AIGC 写实人物素材」官方支持。
- **video-edit**：删物/删人、按参考图换主体、局部重绘、换背景音；`duration` 只认 `-1`（等长原片）；成片有穿帮用它做局部手术，别整段重烧。
- **video-extend**：prompt 指定正续/倒续，单次出 4–30s，链式续片每请求独立；**参考视频的输入时长也计费**。
- **reference-to-video**：图 ≤30 / 视频 ≤10 / 音频 ≤10（比小云雀白名单 9/3/3 宽得多）。
- 源片约束：mp4/mov、单条 2–30s 且合计 ≤30s、≤200MB、300–6000px、24–60FPS、**禁 base64**；prompt 用 `@video1/@image1` 点名素材。
- **产物链接只活 24h——出片后立即镜像回 GCS**。回执含 `can_cancel:true`，与旧口径「EvoLink 任务不可取消」冲突，未实测前按不可取消处理。
- 小云雀（Pippit）路由是另一套封装（video_part/nest，见 `.cursor/knowledge/xyq-seedance25-handbook-gaps.md`），与本节 EvoLink 参数不可混用。

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
- **本项目存储决策**：原生精读输入改为 `Fly 切片 → GCS 临时对象 → 新加坡套餐读取 → finally 删除 GCS/Fly 临时文件`，取消 OSS 中转及其外网读取计费。结构化待审卡、批准模板与最终结果继续落 GCS。此处是本项目账单口径，不外推为所有 GCS 账户的通用价格结论。
- 截至本次记录，线上执行器仍是「北京套餐 + OSS」旧实现；上述探针只证明替代链路可行，尚未证明生产代码已经切换。

## 铁律
- 媒体进系统标准通道 = **GCS/Fly 签名 URL**，不走 base64 传媒体；base64 只允许作脚本/剪贴板兜底传输，用即说明（P0-7）。
- 前台零技术泄漏：模型名/供应商名/部署平台一律不出现在用户可见文案。
