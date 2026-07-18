---
id: website-html-ppt
name: 动效PPT生成演示
description: 多风格 16:9 横向翻页 HTML 动效 PPT；可选插图动效；导出 HTML + 可编辑 PPTX
version: 2026-07-18-harden
defaultEnabled: false
---

# 动效PPT生成演示 Skill

## 用途
在 `/platform`「动效PPT生成演示」：主题 → 选风格 → 确认大纲主题 → **按页计费生成页面清单+图表数据** → 可选关键页插图 → 前端 SVG 分步动效渲染 → 导出单文件 HTML / 可编辑 PPTX。  
也可用免费「模板骨架」预览版式（无 LLM）。

实现：`shared/htmlPptMaker.ts`（HTML 渲染）+ `shared/htmlPptPptx.ts`（PPTX）+ `shared/htmlPptOutlinePrompt.ts` / `server/services/platformHtmlPptOutline.ts`（大纲）+ 插图服务（可选）。计费见 `platformHtmlPptOutlineCredits` / `platformHtmlPptPagePatchCredits`。

## 模板怎么扩？
- **默认：代码自生成**——在 `HTML_PPT_STYLES` / `STYLE_CSS` 加风格即可，**不需要**上传 `.pptx`。
- **本地风格包**：`~/Downloads/2026Jul18/template/{styleId}/style.json` + `preview.jpg` + 可选 `bg.png`；站内副本 `client/public/html-ppt-templates/`。
- **选用前预览**：平台设定页展示缩略图 + 当前选中大图预览，再点「用此风格生成页面清单」。
- 暂不解析任意 Office PPTX 作为输入模板。

## 风格预设（可继续加）
暗黑数据 / 黑橙路演 / 蓝白时间线 / 青绿董事会 / 黑金晚宴 / 玫瑰杂志 / 石板咨询 / 象牙学术 / 海风简报

## 页序约定
- `pages[0]`：封面（viz=cover）
- `pages[1]`：目录/议程（viz=steps 或 hub）
- 后续页按 confirmedThemes 展开；可见文案禁止泄漏 themeId

## 硬约束
1. 每页固定 16:9，横向翻页；竖屏为阅读模式（可滚、弱动效）。
2. 每页一个主判断（大标题 + 关键数字或主列表），并带可视化：环形 / 条形 / 柱状 / 对照 compare / 折线 / 步骤轨 / 指标卡 / table / hub 等（SVG+CSS）。series 可用绝对量级（亿元等），条宽按页内 max 归一。
3. **动效分步**：空格 / 点击 / ↓ = 下一步动效；←→ = 翻页（与动效分离，禁止进页一次播完全部）。
4. 插图为动效组件：默认 hero→dock；关键页可带 `imageMotion` 多拍。
5. 导出 `.html` 单文件可投屏；导出 `.pptx` 须嵌入插图（服务端解析签名图 URL）。
6. 质量复查用 `HTML_PPT_QUALITY_CHECKLIST_ZH`。
