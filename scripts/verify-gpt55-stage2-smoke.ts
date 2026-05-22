/**
 * Stage 2 冒烟：验证 GPT‑5.5（buildPlatformContent 同路径）能否返回非空 JSON。
 * 运行: npx tsx scripts/verify-gpt55-stage2-smoke.ts
 */
import { getPlatformStage2OpenAiModel } from "../server/config/platformSwitches";
import { invokeLLM } from "../server/_core/llm";

function extractFirstChoicePlainText(
  r: Awaited<ReturnType<typeof invokeLLM>>,
): string {
  const c = r?.choices?.[0]?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((x) => (typeof x === "string" ? x : (x as { text?: string })?.text ?? ""))
      .join("");
  }
  return String(c ?? "");
}

async function main() {
  const model = getPlatformStage2OpenAiModel();
  console.log(`[verify-gpt55] model=${model} · OPENAI_API_KEY=${process.env.OPENAI_API_KEY ? "set" : "MISSING"}`);

  const userPayload = {
    ok: true,
    modelProbe: "gpt55-stage2-smoke",
    contentBlueprints: [
      {
        title: "Test topic",
        format: "graphic",
        hook: "Short hook for GPT 5.5 JSON smoke test",
        copywriting: "x".repeat(120),
        suitablePlatforms: ["xiaohongshu"],
        actionableSteps: ["step1", "step2", "step3"],
        detailedScript: "[cover] test",
        publishingAdvice: "test publish",
        executionDetails: {
          environmentAndWardrobe: "test env",
          lightingAndCamera: "test light",
          stepByStepScript: ["[00:00] test"],
        },
        highlightKeywords: ["[highlight:test]"],
      },
    ],
    monetizationLanes: [
      {
        title: "monetize test",
        fitReason: "test",
        offerShape: "test",
        revenueModes: ["test"],
        firstValidation: "test",
      },
    ],
  };

  const t0 = Date.now();
  const r = await invokeLLM({
    provider: "openai",
    modelName: model,
    max_tokens: 8192,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a platform content strategist. Return valid JSON with contentBlueprints (>=1) and monetizationLanes.",
      },
      {
        role: "user",
        content: `Expand and return JSON:\n${JSON.stringify(userPayload)}`,
      },
    ],
  });

  const text = extractFirstChoicePlainText(r).trim();
  console.log(`[verify-gpt55] elapsed=${Date.now() - t0}ms · response.model=${r.model ?? "n/a"}`);
  console.log(`[verify-gpt55] finish_reason=${r.choices?.[0]?.finish_reason ?? "n/a"}`);
  console.log(`[verify-gpt55] usage=${JSON.stringify(r.usage ?? null)}`);
  console.log(`[verify-gpt55] text.length=${text.length}`);
  console.log(`[verify-gpt55] head=${text.slice(0, 240).replace(/\s+/g, " ")}`);

  if (!text) {
    console.error("[verify-gpt55] FAIL: 空正文");
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    console.error("[verify-gpt55] FAIL: JSON.parse", e instanceof Error ? e.message : e);
    process.exit(1);
  }

  const o = parsed as { contentBlueprints?: unknown[] };
  const n = Array.isArray(o.contentBlueprints) ? o.contentBlueprints.length : 0;
  if (n < 1) {
    console.error("[verify-gpt55] FAIL: contentBlueprints 为空");
    process.exit(1);
  }

  console.log(`[verify-gpt55] PASS · contentBlueprints=${n}`);
}

main().catch((e) => {
  console.error("[verify-gpt55] ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
