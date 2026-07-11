/**
 * 分镜 / 图文笔记：简体中文屏内字防糊、防乱码（英文 meta 外壳，模型解析更稳）。
 * 与知识卡片 {@link SINGLE_PAGE_KNOWLEDGE_CARD_TEXT_RENDER_WRAPPER_EN} 同思路，专用于分镜四栏表。
 */

/** 拼在中文分镜主体之后、英文像素锁之前 */
export const STORYBOARD_TEXT_RENDER_WRAPPER_EN = `TEXT RENDERING (CRITICAL — STORYBOARD): All on-image text is **Simplified Chinese**. Every glyph must be **crisp, print-clear, correctly-formed** — no blur, no soft focus on text, no duplicated/missing strokes, no invented characters. Prefer **larger font size** over packing more words: each panel title ≤14 Chinese chars; each table cell (景别/运镜/画面内容/台词与音效) ≤18 Chinese chars — put long spoken lines in the script context, NOT as tiny dense table text. Table band: light paper-tint or soft mid-tone panel behind text (avoid harsh pure-black bar + tiny white glyphs). High resolution, sharp edges on Chinese strokes.`;

/** 中文主体内追加的短约束（与英文外壳双保险） */
export const STORYBOARD_ON_IMAGE_TEXT_ZH = `【屏内字清晰度·强制】分镜主题与四栏表文字须**大字号、印刷清晰、不模糊、不粘连**；每格主题≤14字，四栏每格≤18字；长口播留在脚本字段，勿塞进表内小字。表底用浅色/纸感底，忌纯黑底小白字。`;
