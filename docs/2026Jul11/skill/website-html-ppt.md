---
id: website-html-ppt
name: 动效PPT生成演示
description: 多风格 16:9 横向翻页 HTML 动效 PPT；仓内 CSS 预设扩容；导出单文件 HTML
version: 2026-07-18-hb
defaultEnabled: false
---

# 动效PPT生成演示 Skill

## 用途
在 `/platform`「动效PPT生成演示」：主题 → 选风格 → 出页面清单 → 生成可横向翻页的单文件 HTML。

实现见 `shared/htmlPptMaker.ts`。原版 Marvis html-ppt-maker 未开源；站内用 CSS+版式预设重建并扩容。

## 模板怎么扩？
- **默认：代码自生成**——在 `HTML_PPT_STYLES` / `STYLE_CSS` 加风格即可，**不需要**上传 `.pptx`。
- **以后若要外来模板**：优先风格 JSON（色板+字阶）+ 可选底图 JPG/PNG；暂不解析任意 Office PPTX。

## 风格预设（可继续加）
暗黑数据 / 黑橙路演 / 蓝白时间线 / 青绿董事会 / 黑金晚宴 / 玫瑰杂志 / 石板咨询 / 象牙学术 / 海风简报

## 硬约束
1. 每页固定 16:9，横向翻页，禁止长页面博客滚动。  
2. 每页一个主判断（大标题 + 关键数字或主列表）。  
3. 含页码；←→/空格翻页；入场动效克制。  
4. 导出 `.html` 本地可开即可用。  
5. 质量复查用 `HTML_PPT_QUALITY_CHECKLIST_ZH`。
