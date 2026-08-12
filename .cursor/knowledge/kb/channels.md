# channels · 上游通道血泪事实

## 生图（GPT-image-2，三通道）
- 价格基准序：**EvoLink $0.027/1K < OpenAI $0.030/1K < OpenRouter（官方价+加成，最贵）**。牌价真源 `shared/gptImage2ProviderPricing.ts`。
- 按 lane 路由：平台线已接「便宜优先」调度器；**资产线（lane=asset）曾直连 OpenAI 烧贵价**（P0 在案，修复以 #1196 部署为准）。点批量前 `fly logs` 看 `slot=` 实证走哪家（work-rules 22）。
- `GPT_IMAGE2_PRIMARY_TIMEOUT_MS=90s` 对异步 EvoLink 过短 → 主路径全滑 OpenAI 同槽。服务端修超时优先于一切新出图功能。
- EvoLink edits 场景曾连发「Image processing failed」——失败率高就对 edits 回钉官方通道。

## 视频
- **真人图生视频只能走 EvoLink**（BytePlus/OpenRouter 挡人脸；EvoLink 贵 25% 但不挡）。
- Seedance 硬事实：2K 全系不存在；2.5 上限 720p；4K 只有 2.0（EvoLink $1.0126/s）。成本按像素线性（tokens=宽×高×秒×24/1024，$7/M）。
- **mode 枚举用下划线**（`image_to_video`）——连字符字符串会被 `input.mode || inferSeedanceMode(...)` 静默放行并打断模型解析，产出文生视频冒充图生视频（P0-6 实锤）。
- H3：默认 2K（$0.13/s，比 Seedance 720p 便宜），时长 5/10/15 档。EvoLink 与 H3 任务均**不可取消**。
- WaveSpeed 超分：`runWavespeedVideoUpscale({videoUrl, target})` 2K $0.0144/s、4K $0.0288/s，音轨保留，结果镜像回 GCS。
- 视频探针一律 Seedance 2.0-mini 480p（work-rules 7）；HappyHorse 1.1 = 首页照片动画引擎（720p/1080p）。

## LLM 双引擎（扩写/提炼类）
- 稳定档 Kimi K3：OpenRouter `moonshotai/kimi-k3`（$3/$15 per M）reasoningEffort high、max_tokens 32k；EvoLink 备胎 reasoning 只认 "max"。
- 轻快档 Qwen 3.8 Max：EvoLink 主（$1.765/$5.295）enable_thinking + reasoning_effort xhigh + max_completion_tokens 65536；OpenRouter `qwen/qwen3.8-max`（$2/$6）备胎。
- 编排：attempts 数组（主×2 + 备胎×1），全空回 → failedPicks 退款。
- 「开到最大」类指令 = 枚举**每一个**可调参数逐一拉满（漏掉 reasoning 档位吃过 P0）。

## 铁律
- 媒体进系统标准通道 = **GCS/Fly 签名 URL**，不走 base64 传媒体；base64 只允许作脚本/剪贴板兜底传输，用即说明（P0-7）。
- 前台零技术泄漏：模型名/供应商名/部署平台一律不出现在用户可见文案。
