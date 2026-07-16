---
id: platform-native
name: 平台母语差异（B站·小红书·视频号）
description: 一套主文案 + 三平台差异；全案至少3条图文测小红书；B站与视频号默认短视频
version: 2026-07-12
defaultEnabled: true
---

# 平台母语差异 Skill

## 用途
同一选题先写**一套主文案**（title / hook / copywriting / detailedScript），再输出 `platformVariants`：**小红书、B站、视频号**各一块。只差钩子、封面主句、标签与蓝海子集；不要复制三份完整正文（除非小红书选图文且需封面+内页大纲）。

## 图文配额（近期测流）
全案 **6 条**中 **至少 3 条**主 `format=图文`，方便近几天发 2–3 条小红书笔记看流量。痛点 / 人设 / 长尾维度**优先图文**；图文脚本用 `[封面]`/`[图N]`，不要口播时间轴。

## 目标平台（本批默认）
1. **xiaohongshu（小红书）**：主 format=图文时，`platformVariants.xiaohongshu.format` **必须=图文**，`reuseMainCopy=false`；封面主句偏清单/情绪大字；标签可偏女性用户兴趣与生活审美。主 format=短视频时小红书可短视频且 `reuseMainCopy=true`。
2. **bilibili（B站）**：默认 `format=短视频`；钩子偏知识反差/信息缺口；封面主句可略长但仍 ≤14 字。
3. **weixin_channels（视频号）**：默认 `format=短视频`；钩子偏生活一句人话、私域转发感；封面主句口语、温暖、易转发。
   - **热度参照**：以抖音近 3–5 天高互动样本的钩子结构与节奏为参照（禁止抄标题）。

## 每平台差异块（必须输出）
对上述三平台各输出：
- `platform`：`xiaohongshu` | `bilibili` | `weixin_channels`
- `format`：短视频 / 图文（遵守上方默认与配额）
- `hook`：该平台停滑句（勿三平台同句）
- `coverHeadline`：竖版封面主句 **约 10–18 字**（高点击短钩：反差/反常识/数字拧巴）
- `coverSubline`：可选，**≤18 字一行**；可空
- `tags`：3–8 个平台标签
- `blueOceanKeywords`：从本批共享词表选 **1–3 个**，三平台子集尽量不雷同
- `reuseMainCopy`：小红书短视频时为 true；图文为 false

## 硬约束
- 禁止只写 `suitablePlatforms` 却不给 `platformVariants`。
- 禁止三平台钩子/封面主句/标签完全相同。
- 抖音/快手本批**不作为默认变体**（除非用户人设强绑定且仍须保留三默认平台）。
