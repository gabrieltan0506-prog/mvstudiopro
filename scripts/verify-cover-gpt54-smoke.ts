/**
 * 封面英文化冒烟：验证 translatePlatformTopicCoverToEnglish（GPT 5.4 · strict）。
 * 运行: npx tsx scripts/verify-cover-gpt54-smoke.ts
 */
import {
  coverTranslationEngineDebugLabel,
  translatePlatformTopicCoverToEnglish,
} from "../server/services/geminiPlatformCompositeTranslation.js";
import { isPlatformImageOpenAiAllowed } from "../server/config/platformSwitches.js";

async function main() {
  const allow = isPlatformImageOpenAiAllowed();
  console.log(`[verify-cover-gpt54] PLATFORM_IMAGE_ALLOW_OPENAI=${process.env.PLATFORM_IMAGE_ALLOW_OPENAI ?? "(unset)"} · allowed=${allow}`);
  console.log(`[verify-cover-gpt54] engine=${coverTranslationEngineDebugLabel("gpt54")}`);

  if (!allow) {
    console.error("[verify-cover-gpt54] FAIL: OpenAI 生图链未启用");
    process.exit(1);
  }

  const flowLog: string[] = [];
  const task = [
    "【选题竖封 9:16】",
    "Hook：心脏科医生在博物馆里，用一块古铜镜对照现代支架——古人说的「心主神明」到底准不准？",
    "主标题（简中大字）：古人早把答案写在铜镜里",
    "副标：3 个被误读千年的养心误区",
    "要求：高端 editorial 封面；2～4 个线稿小图标 + 短简中辅标；场景须在博物馆侧光位，不要书房沙发。",
  ].join("\n");

  const t0 = Date.now();
  const english = await translatePlatformTopicCoverToEnglish(task, flowLog, "gpt54");
  const ms = Date.now() - t0;

  console.log(`[verify-cover-gpt54] PASS · elapsed=${ms}ms · english.length=${english.length}`);
  console.log(`[verify-cover-gpt54] head=${english.replace(/\s+/g, " ").slice(0, 280)}…`);
  console.log("[verify-cover-gpt54] flowLog tail:");
  for (const line of flowLog.slice(-8)) console.log(`  ${line}`);

  if (english.length < 80) {
    console.error("[verify-cover-gpt54] FAIL: 英文 prompt 过短");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[verify-cover-gpt54] ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
