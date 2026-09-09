import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { normalizeOpenAiImageLane } from "../../shared/openaiImageLane";
import { normalizeOpenAiImageVariant } from "../../shared/openaiImageVariant";
import { manhuaAssetStandardizeCredits } from "../../shared/manhuaAssetStandardize";
import { canvasImageCredits } from "../../shared/canvasGenerationPricing";

// 执行真实 worker 的整个图片分支，只替换存储、扣费和上游边界，禁止联网。
const source = ts.createSourceFile(
  "runner.ts",
  readFileSync(new URL("./runner.ts", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true
);
let branch = "";
function visit(node: ts.Node) {
  if (
    ts.isIfStatement(node) &&
    node.expression.getText(source) ===
      'input.action === "canvas_gpt_image2"' &&
    node.thenStatement
      .getText(source)
      .includes("generateGptImage2FromRawEnglishPrompt")
  )
    branch = node.thenStatement.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
if (!branch) throw new Error("未找到真实图片 worker 分支");
const code = ts
  .transpileModule(
    `async function run(input, jobUserId, jobId) { const params = input.params; ${branch} }`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }
  )
  .outputText.replace(/\bimport\(/g, "importModule(");

function setup() {
  const events: string[] = [];
  const renew = vi.fn(async () => {
    events.push("renew");
    return "https://fresh.example/source.png";
  });
  const deduct = vi.fn(async () => {
    events.push("deduct");
    return { cost: 3 };
  });
  const generate = vi.fn(async () => {
    events.push("generate");
    return "https://result.example/new.png";
  });
  const refund = vi.fn(async () => {});
  const register = vi.fn(async () => {});
  const modules: Record<string, unknown> = {
    "../services/canvasAssetEditReference.js": {
      refreshCanvasAssetEditReference: renew,
    },
    "../../shared/canvasGenerationPricing.js": { canvasImageCredits },
    "../../shared/manhuaAssetStandardize.js": { manhuaAssetStandardizeCredits },
    "../services/paidJobLedger.js": {
      registerActiveJob: register,
      refundCreditsOnFailure: refund,
    },
    "../services/proxyImageService.js": {
      generateGptImage2FromRawEnglishPrompt: generate,
    },
    "../services/canvasMediaOwnership.js": {
      registerCanvasImageDeliveryOrThrow: vi.fn(async () => {}),
    },
  };
  const importModule = async (name: string) => {
    if (!(name in modules)) throw new Error(`禁止真实依赖：${name}`);
    return modules[name];
  };
  const run = new Function(
    "importModule",
    "normalizeOpenAiImageLane",
    "normalizeOpenAiImageVariant",
    "deductCreditsAmount",
    `${code}\nreturn run;`
  )(importModule, normalizeOpenAiImageLane, normalizeOpenAiImageVariant, deduct);
  const input = {
    action: "canvas_gpt_image2",
    params: {
      prompt: "保留黑翼",
      aspectRatio: "16:9",
      referenceImageUrls: ["https://expired.example/source.png"],
      assetStandardizeQuality: "medium",
      assetRefId: "original",
      generalImageEdit: true,
      imageLane: "asset",
    },
  };
  return { events, renew, deduct, generate, refund, register, run, input };
}

describe("真实 worker 原图续签、收费、供应商消费和退款", () => {
  it("续签在扣费之前，非空新链接和横版进入真实上游调用点", async () => {
    const s = setup();
    const output = await s.run(s.input, "1", "test-job");
    expect(s.events).toEqual(["renew", "deduct", "generate"]);
    expect(s.renew).toHaveBeenCalledWith(
      "https://expired.example/source.png",
      "1"
    );
    expect(s.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        aspectRatio: "16:9",
        referenceImageUrls: ["https://fresh.example/source.png"],
        englishPrompt: "保留黑翼",
        qualityOverride: "medium",
      })
    );
    expect(s.deduct).toHaveBeenCalledWith(
      1,
      3,
      "manhuaAssetStandardize",
      expect.any(String),
      { chargeKey: "manhuaAssetStandardize/test-job" }
    );
    expect(output.output.imageUrls).toEqual(["https://result.example/new.png"]);
    expect(s.input.params.referenceImageUrls).toEqual([
      "https://expired.example/source.png",
    ]);
  });
  it("续签失败零扣费、零上游；生成失败沿原任务退款且不重提", async () => {
    const s = setup();
    s.renew.mockRejectedValue(new Error("无法续签"));
    await expect(s.run(s.input, "1", "test-job")).rejects.toThrow("无法续签");
    expect(s.deduct).not.toHaveBeenCalled();
    expect(s.generate).not.toHaveBeenCalled();
    const failed = setup();
    failed.generate.mockRejectedValue(new Error("生成失败"));
    await expect(failed.run(failed.input, "1", "test-job")).rejects.toThrow(
      "生成失败"
    );
    expect(failed.generate).toHaveBeenCalledOnce();
    expect(failed.refund).toHaveBeenCalledWith(
      "test-job",
      "manhuaAssetStandardize",
      "external_api_error",
      expect.any(String)
    );
  });
});
