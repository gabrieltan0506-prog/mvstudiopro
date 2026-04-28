/**
 * AI 输出后处理：在 Deep Research Max / 合成阶段强制 Markdown 结构化，
 * 便于容器内 Puppeteer + marked 稳定渲染 PDF（无第三方 PDF API）。
 */

export const PDF_FORMATTING_PROMPT_SUFFIX = `
【格式强制规范 · PDF 排版契约 — 必须遵守】：
1. 严格使用 Markdown 纯文本输出正文，禁止输出 HTML 标签（不得出现 <div>、<span>、<br/> 等）。
2. 标题规范：全文仅允许 **一个** H1（# ）作为报告主标题；章节统一用 H2（## ）；小节用 H3（### ）；禁止滥用 # 级数。
3. 数据规范：凡涉及多维度对比、定价、市场份额、法规差异、接受度量化等，**必须**使用标准 Markdown 管道表格（首行表头 + 第二行 |---|---| + 数据行）。
4. 禁止在 Markdown 中嵌入 Mermaid、HTML、内联样式或脚本。
5. 代码块仅用于必要时展示原始数据引用，不得用大段代码块代替正文分析。`.trim();
