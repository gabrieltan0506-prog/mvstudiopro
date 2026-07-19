/**
 * 本地调用 Responses Pro，产出 /platform 主次 UI IA 简报 → ~/Downloads/2026Jul19/platform-ia-brief.md
 *
 *   pnpm exec tsx scripts/fetch-platform-ia-brief.mts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { invokeGpt56ResponsesText } from "../server/services/gpt56ResponsesClient.ts";

const OUT = path.join(os.homedir(), "Downloads", "2026Jul19", "platform-ia-brief.md");

async function main() {
  console.log("→ Responses Pro · platform IA brief");
  const markdown = await invokeGpt56ResponsesText({
    reasoningMode: "pro",
    reasoningEffort: "medium",
    store: false,
    timeoutMs: 180_000,
    instructions: `你是产品信息架构顾问。只输出 Markdown，不要代码围栏。面向中文创作者，语气干脆、可落地。`,
    input: `产品：mvstudiopro /platform 页。问题：Skill 墙太大、挡住主功能；动效PPT Tab 与内容之间被 Skill 打断；选题扩写字太小；全案强迫用户自己勾选一堆 Skill。

目标信息架构（必须遵守）：
主功能（大字）：1) 平台趋势分析 2) 全案创作分析（背景→智能推荐 Skill 摘要→开始）3) 选题初选/选题扩写 4) 动效PPT（Tab 后直接进面板，中间不穿插 Skill）
陪衬（中小号）：Skill 折叠区、创作顾问、上传 Skill、博主自称
Skill 规则：核心默认开；分类默认折叠；未主动勾选只开核心；全案按人物背景智能推荐非核心，可一键采纳

请输出：
1. 两区线框说明（A 全案区 / B 自定义+动效PPT 区）：从上到下模块顺序
2. 主 CTA 文案与字阶建议（大/中/小）
3. 「智能推荐 Skill」一行摘要示例文案
4. 动效PPT 不被打断的布局原则（3 条）
5. 附录：ASCII 线框（等宽）各一

约束：不拆路由；文案短可直接贴 UI。`,
  });
  if (!markdown || markdown.length < 80) throw new Error("brief too short");
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const header = `# /platform 主次 UI · IA 简报\n\n> GPT-5.6 Sol Responses Pro · ${new Date().toISOString()}\n\n`;
  fs.writeFileSync(OUT, `${header}${markdown.trim()}\n`);
  console.log(`ok → ${OUT} (${markdown.length} chars)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
