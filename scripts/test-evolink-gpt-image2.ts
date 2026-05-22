/**
 * EvoLink GPT-Image-2 连通性测试（封面同款参数：1024×1536 · quality=medium）。
 * 运行: EVOLINK_API_KEY=sk-... npx tsx scripts/test-evolink-gpt-image2.ts
 */
import { isEvolinkGptImage2Configured, postEvolinkGptImage2AndUpload } from "../server/services/evolinkGptImage2.js";

async function main() {
  console.log("⏳ [EvoLink GPT-Image-2] 连通性测试…\n");
  if (!isEvolinkGptImage2Configured()) {
    console.error("❌ 未设置 EVOLINK_API_KEY。请在 https://evolink.ai/dashboard/keys 创建密钥后：");
    console.error("   fly secrets set EVOLINK_API_KEY=\"你的密钥\" -a mvstudiopro");
    process.exit(1);
  }

  const flowLog: string[] = [];
  const url = await postEvolinkGptImage2AndUpload(
    "Editorial magazine cover photo, vertical 9:16, warm golden hour light, no text, no watermark, masterpiece.",
    "evolink_smoke_test",
    { aspectRatio: "9:16", flowLog },
  );

  console.log("\n--- flow log ---");
  for (const line of flowLog) console.log(line);

  if (!url) {
    console.error("\n❌ EvoLink 生图失败（见上方 flow log）");
    process.exit(1);
  }
  console.log("\n✅ 成功 · 图片 URL:\n", url);
}

main().catch((e) => {
  console.error("❌ 未捕获异常:", e instanceof Error ? e.message : e);
  process.exit(1);
});
