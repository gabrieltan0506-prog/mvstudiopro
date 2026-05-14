/**
 * 測試：Deep Research Pro **兩條**各一次（或失敗條再試）→ 定界後各調一趟 **GPT‑5.4** 英文化（腳本內獨立演示）。
 * 線上封面管線若有副選題，則 {@link runCoverDeepResearchBriefPreferDual} 要求**兩條簡報皆有效**才注入 DR，否則整段不啟用 DR。
 *
 * 運行（專案根目錄）:
 *   pnpm exec tsx scripts/test-dr-pro-dual-gpt54.ts
 *
 * 依賴：`GEMINI_API_KEY`；英文化另需 OpenAI / 平台翻譯相關 env（與線上 `callGemini31ProForImagePrompt` 相同）。
 */
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local") });

import type { CoverTaskInput } from "../server/services/agenticCoverWorkflow.js";
import { runCoverDeepResearchDualBatchBrief } from "../server/services/coverDeepResearchProBrief.js";
import {
  buildPlatformTopicReferenceGeminiTask,
  callGemini31ProForImagePrompt,
} from "../server/services/geminiPlatformCompositeTranslation.js";
import { requireGeminiApiKey } from "../server/services/googleDeepResearchInteractions.js";

const taskA: CoverTaskInput = {
  topicTitle: "减脂期外卖怎么点才不踩雷",
  format: "短视频",
  tenantProfile: {
    industry: "健康生活",
    advantage: "註冊營養師背景，擅長把熱量講成人話。",
    flagship: "高飽足、低負罪感視覺：清爽配色、真實餐盒質感。",
  },
  baseCopywriting: [
    "開場：你以為沙拉就安全？有些『健康碗』熱量比漢堡還高。",
    "核心：看醬料、看主食基底、看蛋白質來源；三個外賣篩選口令。",
    "收尾：記住『减脂期外卖怎么点才不踩雷』這條，收藏給自己。",
  ].join("\n"),
};

const taskB: CoverTaskInput = {
  topicTitle: "小白第一次买基金要看哪三个坑",
  format: "图文",
  tenantProfile: {
    industry: "理財科普",
    advantage: "用故事化解讀產品說明書式術語。",
    flagship: "信任感金融科技风：留白、細線圖標、溫和藍綠。",
  },
  baseCopywriting: [
    "很多人第一次点进去就被排行榜帶偏，追高杀跌還覺得自己在投資。",
    "三個坑：只看短期收益、忽略申購費與回撤、把直播帶貨當研報。",
    "記得錨定話題：小白第一次买基金要看哪三个坑，別講成股票打板。",
  ].join("\n"),
};

async function main() {
  try {
    requireGeminiApiKey();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  const flowLog: string[] = [];
  console.log("── DR-Pro 双条 batch（腳本仍逐條試 GPT‑5.4；線上 PreferDual 須雙條皆成功才注 DR）──\n");

  const { results, mode } = await runCoverDeepResearchDualBatchBrief([taskA, taskB], flowLog, {
    logPrefix: "測試·DR-Pro·双条",
  });

  console.log(`mode: ${mode}`);
  console.log(`batch A zh: ${results[0]?.length ?? 0} chars`);
  console.log(`batch B zh: ${results[1]?.length ?? 0} chars\n`);

  for (let i = 0; i < 2; i++) {
    const zh = results[i];
    const task = i === 0 ? taskA : taskB;
    if (!zh?.trim()) {
      console.log(`── batch ${i + 1}：無简体简报，跳過 GPT‑5.4 ──`);
      continue;
    }
    console.log(`── batch ${i + 1} → GPT‑5.4（topic: ${task.topicTitle.slice(0, 24)}…）──`);
    const geminiTask = buildPlatformTopicReferenceGeminiTask({
      topicHook: task.topicTitle,
      context: zh.slice(0, 6500),
      variant: task.format === "图文" ? "graphic" : "video",
    });
    try {
      const en = await callGemini31ProForImagePrompt(geminiTask, {
        translator: "gpt54",
        flowLog,
        pipelineStatCtx: { pipeline: "test_dr_dual" },
      });
      console.log(`英文 prompt ${en.length} chars · 預覽:\n${en.slice(0, 420)}…\n`);
    } catch (e) {
      console.error(`batch ${i + 1} GPT‑5.4 失敗:`, e instanceof Error ? e.message : e);
    }
  }

  console.log("── flowLog（最後 12 行）──");
  for (const line of flowLog.slice(-12)) console.log(line);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
