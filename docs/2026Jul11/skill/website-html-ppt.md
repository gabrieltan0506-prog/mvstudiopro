---
id: website-html-ppt
name: 动效PPT生成演示
description: 多风格 16:9 横向翻页 HTML 动效 PPT；仓内 CSS 预设扩容；导出单文件 HTML
version: 2026-07-18-hb
defaultEnabled: false
---

# 动效PPT生成演示 Skill

## 用途
在 `/platform`「动效PPT生成演示」：主题 → 选风格 → **GPT-5.6 Sol 生成页面清单+图表数据（方案 A，25 积分）** → 前端 SVG 多色动效渲染 → 导出单文件 HTML。  
也可用免费「模板骨架」预览版式（无 LLM）。

实现：`shared/htmlPptMaker.ts`（渲染）+ `shared/htmlPptOutlinePrompt.ts` / `server/services/platformHtmlPptOutline.ts`（Sol 大纲）。**不用 Image-2。**

## 模板怎么扩？
- **默认：代码自生成**——在 `HTML_PPT_STYLES` / `STYLE_CSS` 加风格即可，**不需要**上传 `.pptx`。
- **本地风格包**：`~/Downloads/2026Jul18/template/{styleId}/style.json` + `preview.jpg` + 可选 `bg.png`；站内副本 `client/public/html-ppt-templates/`。
- **选用前预览**：平台设定页展示缩略图 + 当前选中大图预览，再点「用此风格生成页面清单」。
- 暂不解析任意 Office PPTX。

## 风格预设（可继续加）
暗黑数据 / 黑橙路演 / 蓝白时间线 / 青绿董事会 / 黑金晚宴 / 玫瑰杂志 / 石板咨询 / 象牙学术 / 海风简报

## 硬约束
1. 每页固定 16:9，横向翻页，禁止长页面博客滚动。  
2. 每页一个主判断（大标题 + 关键数字或主列表），并带可视化：环形图 / 条形 / 柱状 / 步骤轨 / 指标卡（SVG+CSS，翻页重播）。  
3. 含页码；←→/空格/点击翻页。  
4. 导出 `.html` 单文件可投屏（图表内嵌，不依赖外部 JS CDN）。  
5. 质量复查用 `HTML_PPT_QUALITY_CHECKLIST_ZH`。
