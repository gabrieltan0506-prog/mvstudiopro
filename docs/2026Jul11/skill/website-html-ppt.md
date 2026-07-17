---
id: website-html-ppt
name: 网站式 HTML PPT
description: 三风格网站式 16:9 横向翻页 HTML PPT（暗黑数据/黑橙路演/蓝白Figma）；导出单文件 HTML
version: 2026-07-17-hb
defaultEnabled: false
---

# 网站式 HTML PPT Skill

## 用途
在 `/platform`「HTML PPT」工作台：主题 → 选风格 → 出页面清单 → 生成可横向翻页的单文件 HTML。

实现见 `shared/htmlPptMaker.ts`。视觉对齐黄白 `website-ppt-style-skill-refs`（原版 Marvis zip 未开源，站内重建）。

## 三套风格
1. **暗黑数据研究报告**：AI/资本/行业趋势  
2. **黑橙路演官网**：创业路演/产品介绍  
3. **蓝白 Figma 信息图时间线**：计划/复盘/路线图  

## 硬约束
1. 每页固定 16:9，横向翻页，禁止长页面博客滚动。  
2. 每页一个主判断（大标题 + 关键数字或主列表）。  
3. 含页码；←→/空格翻页；动效克制。  
4. 导出 `.html` 本地可开即可用。  
5. 质量复查用 `HTML_PPT_QUALITY_CHECKLIST_ZH`。
