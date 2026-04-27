/**
 * 第一关：Gemma 4 31B IT 连通性测试
 * 验证 Vertex AI us-central1 JWT 与端点是否畅通
 * 运行: npx tsx scripts/test-1-gemma.ts
 */
import { callGemma4 } from "../server/services/gemma4";

async function testGemma() {
  console.log("⏳ [Test 1] 测试 Gemma 4 31B IT 独立连通性...");
  try {
    const res = await callGemma4("请用一句话形容哈佛医学院的严谨。");
    if (!res || res.trim().length === 0) throw new Error("回传为空");
    console.log("✅ [Test 1] 成功！回传内容:", res.slice(0, 100), "...");
    console.log(`   字符数: ${res.length}`);
  } catch (err: any) {
    console.error("❌ [Test 1] 失败:", err?.message || err);
    process.exit(1);
  }
}

testGemma();
