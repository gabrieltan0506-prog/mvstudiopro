---
id: platform-native
name: 平台母语差异（B站·小红书·视频号）
description: 一套主文案 + 三平台钩子/封面主句/标签差异；小红书可图文或视频；B站与视频号默认短视频
version: 2026-07-11
defaultEnabled: true
---

# 平台母语差异 Skill

## 用途
同一选题先写**一套主文案**（title / hook / copywriting / detailedScript），再输出 `platformVariants`：**小红书、B站、视频号**各一块。只差钩子、封面主句、标签与蓝海子集；不要复制三份完整正文（除非小红书选图文且需封面+内页大纲）。

## 目标平台（本批默认）
1. **xiaohongshu（小红书）**：`format` 可为「图文」或「短视频」。
   - 图文：封面主句偏清单/情绪大字；标签可偏女性用户兴趣与生活审美。
   - 短视频：**复用主文案**，不必另写长文案；在 tags / blueOceanKeywords 上多给女性向、生活向、种草向词。
2. **bilibili（B站）**：默认 `format=短视频`；钩子偏知识反差/ ethan.b@example.com 式信息缺口；封面主句可略长但仍 ≤14 字信息密度。
3. **weixin_channels（视频号）**：默认 `format=短视频`；钩子偏生活一句人话、私域转发感；封面主句口语、温暖、易转发。
   - **热度参照**：以抖音近 3–5 天高互动样本的钩子结构与节奏为参照（禁止抄标题）；UI 不标注「无视频号数据」。

## 每平台差异块（必须输出）
对上述三平台各输出：
- `platform`：`xiaohongshu` | `bilibili` | `weixin_channels`
- `format`：短视频 / 图文（遵守上方默认）
- `hook`：该平台停滑句（长度与语气按平台母语，勿三平台同句）
- `coverHeadline`：竖版封面主句 **8–14 字**，只说一个信息缺口
- `coverSubline`：可选，**≤18 字一行**；可空
- `tags`：3–8 个平台标签（勿六平台同一串）
- `blueOceanKeywords`：从本批共享词表选 **1–3 个**，三平台子集尽量不雷同
- `reuseMainCopy`：小红书短视频时为 true；其余可 false

## 硬约束
- 禁止只写 `suitablePlatforms: ["小红书","B站"]` 却不给 `platformVariants`。
- 禁止三平台钩子/封面主句/标签完全相同。
- 抖音/快手本批**不作为默认变体**（除非用户人设强绑定且仍须保留三默认平台）。
