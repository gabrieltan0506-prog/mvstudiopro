/**
 * AI Studio 双引擎调研系统测试
 * 验证：GEMINI_API_KEY → Gemma 4 (Stage 1) → Gemini 2.5 Pro (Stage 2) → 策略输出
 * 运行: npx tsx scripts/test-ai-studio.ts
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

import { runResearch } from "../server/services/researchService";

async function runTest() {
  console.log("🚀 启动 AI Studio 双引擎竞品调研测试...\n");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ 缺少 GEMINI_API_KEY，请检查 .env.local");
    process.exit(1);
  }
  console.log("✅ GEMINI_API_KEY 已加载\n");

  const dummyContent = [
    "账号：@健康博士张医生",
    "内容：《普通人不知道的3个胃癌早筛信号》",
    "数据：点赞32万，收藏18万，评论4200",
    "标签：#健康科普 #胃癌预防 #医生说 #早筛",
    "封面：白大褂+红色警示文本，强对比高饱和度",
    "开场：「你以为胃癌离你很远？这3个信号你可能每天都有」",
  ].join("\n");

  try {
    console.log("⏳ 执行小红书竞品调研（含平台数据库注入）...\n");
    const result = await runResearch("test-user-001", "xiaohongshu", dummyContent);

    console.log("✅ 调研成功！输出字段：", Object.keys(result).join(", "));
    console.log("─".repeat(50));

    if (result.positioning) {
      console.log("\n🎯 差异化定位：");
      console.log(typeof result.positioning === "string" ? result.positioning.slice(0, 200) : JSON.stringify(result.positioning).slice(0, 200));
    }
    if (Array.isArray(result.scripts) && result.scripts.length > 0) {
      console.log(`\n📝 执行脚本（${result.scripts.length}条）：`);
      result.scripts.slice(0, 2).forEach((s, i) => console.log(`  ${i + 1}. ${s.title}`));
    }
    if (result.growthPlan30Days) {
      console.log("\n📈 30天增长路径预览：");
      console.log(String(result.growthPlan30Days).slice(0, 150) + "...");
    }
    console.log("\n✅ [Test AI Studio] 全部通过！");
  } catch (err: any) {
    console.error("❌ 测试失败：", err?.message || err);
    process.exit(1);
  }
}

runTest();
