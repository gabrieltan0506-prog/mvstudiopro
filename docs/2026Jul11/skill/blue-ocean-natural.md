---
id: blue-ocean-natural
name: 蓝海词自然嵌入
description: 同批共享词表；每平台1–3个不同子集；禁标签墙；优先进钩子与发布建议
version: 2026-07-11
defaultEnabled: true
---

# 蓝海词自然嵌入 Skill

## 用途
把 blueOceanLexicon / tagCandidates 用成「人话里的词」，不是 hashtag 墙。

## 硬约束
1. 同批选题**共享**一份词表来源；每条 `highlightKeywords` 2–6 个。
2. `platformVariants[].blueOceanKeywords`：**每平台 1–3 个**，从共享词表选**不同子集**；禁止三平台同一串标签。
3. 优先嵌入位置：钩子一句、发布建议、口播自然句；正文最多点到为止。
4. **禁止**：文末 `#a #b #c #d #e` 标签墙；禁止把蓝海词当标题全部堆上。
5. 小红书短视频若复用主文案：差异主要落在 tags / blueOceanKeywords（可偏女性向生活词），仍须自然、可搜。

## 自检
- [ ] 三平台蓝海子集是否至少有差异？
- [ ] 钩子里是否至少自然出现过 0–1 个词（不强行）？
- [ ] 有没有标签墙？
