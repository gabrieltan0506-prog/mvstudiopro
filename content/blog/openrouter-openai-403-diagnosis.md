---
title: OpenRouter 把我们的 OpenAI 系全封了，排查与止血的完整过程
description: 同一把 key，Kimi 和 Qwen 正常，所有 OpenAI 模型一律 403 TOS，连强制走 Azure 也拒。记录如何在两小时内定位出这是账号级封禁而非配置问题，以及一个把余额不足误报成「内容审核」的坑。
date: 2026-08-05
keywords: OpenRouter,403 Terms of Service,API 故障排查,LLM 网关,供应商容灾,AI 基础设施
---

# OpenRouter 把我们的 OpenAI 系全封了，排查与止血的完整过程

> 2026-08-05 的真实故障。所有请求与响应都是当天实测记录。

早上用户报了个奇怪的现象：文案功能正常，出图偶尔失败，而失败时的提示是「该选题文案触发了内容审核，请调整文案后再试」。他改了三遍文案，没用。

最后查出来的根因跟文案一点关系都没有。过程里踩到的每个坑都挺典型，记录下来。

## 第一层：不是内容审核，是两条腿都断了

先看服务端日志：

```
[GPT-IMAGE-2·OpenAI] 异常 · 钥=OPENAI_IMAGE_API_KEY_ASSET · fetch failed
[GPT-IMAGE-2·OpenAI] 换钥重试 → OPENAI_IMAGE_API_KEY
[GPT-IMAGE-2·OpenAI] 异常 · 钥=OPENAI_IMAGE_API_KEY · HTTP 429: You have no credits remaining
[单帧·OpenRouter] GPT-IMAGE-2 · OpenAI失败后回落
[GPT-IMAGE-2·OpenRouter] 异常 · HTTP 403: The request is prohibited due to a violation of provider Terms Of Service
[单帧] OpenAI/OpenRouter GPT-IMAGE-2 均无图 · 本条失败
```

三件事叠在一起：主钥遇到瞬时网络失败，换到备用钥发现余额耗尽，回落 OpenRouter 吃 403。

**而「内容审核」这个提示是我们自己代码里的 bug。** 判定函数里有这么一条：

```js
m.includes("violat")   // 本意是抓 content policy violation
```

OpenRouter 的 403 原文写的是 `prohibited due to a **violat**ion of provider Terms Of Service`，正好命中。于是余额耗尽和账号封禁两个基础设施故障，被包装成了「你的文案有问题」。更糟的是它还触发了「命中审核就快速失败」的短路，把剩下那次重试也跳过了。

**报错把用户引向错误的方向，比不报错更伤。** 这是当天最值得记的一条。

## 第二层：403 到底是什么级别的封禁

先确认 key 本身有没有问题：

```bash
curl -H "Authorization: Bearer $KEY" https://openrouter.ai/api/v1/key
# 200，limit 100，剩余 80，非免费层
```

key 有效、有钱。那就逐个模型试，全都 403，响应完全一致：

```json
{"error":{"message":"The request is prohibited due to a violation of provider Terms Of Service.",
"code":403,"metadata":{"provider_name":null,
"previous_errors":[{"code":403,"message":"..."}]}}}
```

注意 `metadata.provider_name` 是 **null**。这个细节很关键——说明拒绝发生在 OpenRouter 选定 provider **之前**，不是某一家 provider 返回的响应。

继续缩小范围：

| 测试 | 结果 |
|---|---|
| `openai/gpt-5.6-sol` | 403 |
| `openai/gpt-5.6-terra` | 403 |
| `openai/gpt-4o-mini`（老模型） | 403 |
| `openai/gpt-image-2`（images 端点） | 403 |
| 强制 `provider: {"only":["Azure"]}` | **仍然 403** |
| `moonshotai/kimi-k3` | 200 正常 |
| `qwen/qwen3.8-max` | 200 正常 |

结论很清楚：**整个 OpenAI 系（含 Azure 托管）对这个账号全禁，与模型、与端点、与请求内容无关**——我发的提示词只有 `say ok` 两个词。

这不是能靠改代码、换 key、充值解决的问题，只能走人工申诉。

## 第三层：顺带发现视频模型也不能用，但原因不同

排查过程中试了下视频模型，全部 404：

```json
{"error":{"message":"No endpoints available matching your guardrail restrictions
and data policy. Configure: https://openrouter.ai/settings/privacy","code":404}}
```

这条错误信息比上一个友好得多，直接指出了原因和位置。

去后台一看，账号的 **Allowed Providers 是白名单模式**（Exclusively enable these providers），当时只放了六家：Azure、OpenAI、Alibaba Cloud Intl、Fireworks、Moonshot AI、Amazon Bedrock。

而这些视频模型各自只有一家 provider：

| 模型 | Provider | 在白名单里? |
|---|---|---|
| `minimax/hailuo-3` | Minimax | 否 → 404 |
| `bytedance/seedance-2.0` | Seed | 否 → 404 |
| `moonshotai/kimi-k3` | 六家可选（含 Fireworks） | 是 → 正常 |

**单一 provider 的模型一旦被白名单排除就彻底不可用；多 provider 的模型能侥幸活下来。** Kimi 能用纯粹因为它有六家可挑。

试过在请求里加 `provider: {"data_collection":"allow"}` 想绕过，无效——账号级 guardrail 是上限，请求参数只能更严不能更宽。把 Minimax 和 Seed 加进白名单后立刻恢复，实测出片正常。

## 止血：三处改动

**一、把死掉的备胎换成活的。**

出图原来的链路是「OpenAI 官方 → OpenRouter」。OpenRouter 那条已经是 403 死的，等于官方一挂就整条断。我们把 EvoLink 接回中间（这条通道一直都在，只是之前从链里摘掉了），链路变成 **OpenAI 官方 → EvoLink**，OpenRouter 暂时完全摘出。

顺带发现同规格（high 1024×1536）EvoLink 还比官方便宜约两成：$0.148 对 $0.187。

摘除做成了环境变量开关，对方解封后设一个变量就恢复，不用改代码。

**二、钥池不再回落到通用钥。**

看一眼 secrets 的摘要就发现问题：

```
OPENAI_API_KEY              e11c392e4c0d6c58
OPENAI_IMAGE_API_KEY        e11c392e4c0d6c58   ← 同一把
OPENAI_IMAGE_API_KEY_ASSET  677021c46ad6c378   ← 出图专钥
```

出图钥池的设计是「本道专钥 → 共用钥 → 另一道专钥」，而所谓共用钥就是文本调用在用的那把通用钥，余额早就耗尽了。主钥一抖就必然去撞那个 429，白等一轮还给出误导性错误。混用另有副作用：出图会去烧文本账户的额度。

改成**配了专钥就只在专钥之间倒**，一把都没配才退回共用钥。

**三、错误分类先排除账号级故障。**

在判内容审核之前先挡掉余额、配额、计费、TOS 封禁、429 这几类。它们都不是用户能通过改文案解决的问题，也不该触发「快速失败」的短路。

## 几条可复用的经验

**同一把 key，不同库的表现可能不一样。** 排查时我一度以为 key 失效——Python 的 `urllib` 全部 403，而 `curl` 是 200。差别只是 User-Agent：Pexels 那类前面挂了 Cloudflare 的服务，会把默认 UA 直接拒掉。发请求记得带 UA，否则会误判成鉴权问题白折腾半天。

**`provider_name: null` 是个强信号。** 网关类服务如果在选定上游前就拒绝，说明是账号级策略而非上游响应，这时候换模型、换参数、重建 key 都没用。

**多 provider 的模型天然更抗风险。** 同样的白名单策略，Kimi 活了、Seedance 和 H3 全死。选型时把「有几家 provider 可挑」当成一个可用性指标。

**备胎要定期验活。** 我们的 OpenRouter 回落腿已经死了不知道多久，没人发现，因为主链一直没挂。直到主链偶发抖动那一次，才暴露出根本没有备胎。**没被触发过的容灾路径等于不存在。**

---

*本文所有请求与响应为 2026-08-05 实测记录。申诉尚在进行中，若后续解封会补充结果。*
