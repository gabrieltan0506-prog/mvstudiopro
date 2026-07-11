/**
 * 分镜 / 图文笔记：简体中文屏内字防糊、防乱码（英文 meta 外壳，模型解析更稳）。
 * 与知识卡片 TEXT RENDERING 外壳同思路；表含灯光安排与情绪表达。
 */

/** 拼在中文分镜主体之后、英文像素锁之前 */
export const STORYBOARD_TEXT_RENDER_WRAPPER_EN = `TEXT RENDERING (HIGHLY RECOMMENDED — STORYBOARD): All on-image text is **Simplified Chinese**. Every glyph should be **crisp, print-clear, correctly-formed** — avoid blur, soft focus on text, duplicated/missing strokes, or invented characters. Prefer **larger font size** over packing more words: each panel title ≤12 Chinese chars; each table cell (景别/运镜/灯光安排/情绪表达/画面内容/台词与音效) ≤12–14 Chinese chars — put long spoken lines in the script context, NOT as tiny dense table text. Table band: light paper-tint or soft mid-tone panel behind text (avoid harsh pure-black bar + tiny white glyphs). Include short **灯光安排** and **情绪表达** cells. High resolution, sharp edges on Chinese strokes.`;

/** 中文主体内追加（软边界） */
export const STORYBOARD_ON_IMAGE_TEXT_ZH = `【屏内字清晰度·强烈建议】分镜主题与六栏表文字**高度需求**大字号、印刷清晰、不模糊、不粘连；每格主题建议≤12字，每栏建议≤12–14字；长口播留在脚本字段。表底用浅色/纸感底，少用纯黑底小白字。六栏含【灯光安排】【情绪表达】。`;
