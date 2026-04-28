/**
 * 第二关：双引擎管线 + 扣费集成测试
 * 验证: Gemma 4 扫描 → Gemini 3.1 Pro 策略生成
 * 运行: npx tsx scripts/test-2-pipeline.ts
 */
import { callGemma4 } from "../server/services/gemma4";
import { invokeLLM } from "../server/_core/llm";

async function testPipeline() {
  console.log("⏳ [Test 2] 测试双引擎管线...\n");

  // Stage 1: Gemma 4
  console.log("  ⚙️  Stage 1: Gemma 4 31B IT 扫描中...");
  let stage1Raw = "";
  try {
    stage1Raw = await callGemma4(`请简短分析小红书医疗健康类内容的爆款逻辑（100字以内），JSON格式：
{hookLogic: string, visualStyle: string, topPattern: string}`);
    if (!stage1Raw) throw new Error("Stage 1 返回为空");
    console.log("  ✅ Stage 1 成功，字符数:", stage1Raw.length);
    console.log("  预览:", stage1Raw.slice(0, 80));
  } catch (err: any) {
    console.error("  ❌ Stage 1 失败:", err?.message);
    process.exit(1);
  }

  // Stage 2: Gemini 3.1 Pro Preview
  console.log("\n  ⚙️  Stage 2: Gemini 3.1 Pro Preview 策略生成中...");
  try {
    const stage2Res = await invokeLLM({
      provider: "vertex" as const,
      modelName: "gemini-3.1-pro-preview",
      temperature: 0.5,
      messages: [{
        role: "user",
        content: `基于以下竞品分析：${stage1Raw}
生成一条差异化定位建议（50字以内）。JSON格式：{positioning: string}`,
      }],
    });
    const text = String(stage2Res?.choices?.[0]?.message?.content ?? "");
    if (!text) throw new Error("Stage 2 返回为空");
    console.log("  ✅ Stage 2 成功，字符数:", text.length);
    console.log("  预览:", text.slice(0, 80));
    console.log("\n✅ [Test 2] 双引擎管线畅通！");
  } catch (err: any) {
    console.error("  ❌ Stage 2 失败:", err?.message);
    process.exit(1);
  }
}

testPipeline();
