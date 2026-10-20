import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { normalizeCanvasImageAspectRatio } from "../../shared/canvasGptImage2JobInput";
import { normalizeOpenAiImageLane } from "../../shared/openaiImageLane";
import { normalizeOpenAiImageVariant } from "../../shared/openaiImageVariant";
const source = ts.createSourceFile(
  "runner.ts",
  readFileSync(new URL("./runner.ts", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true
);
let branch = "",
  disposition = "";
function visit(n: ts.Node) {
  if (
    ts.isIfStatement(n) &&
    n.expression.getText(source) === 'input.action === "canvas_gpt_image2"' &&
    n.thenStatement
      .getText(source)
      .includes("generateGptImage2FromRawEnglishPrompt")
  )
    branch = n.thenStatement.getText(source);
  if (
    ts.isFunctionDeclaration(n) &&
    n.name?.text === "resolveFailedJobDisposition"
  )
    disposition = n.getText(source).replace(/^export /, "");
  ts.forEachChild(n, visit);
}
visit(source);
const compile = (s: string) =>
  ts
    .transpileModule(s, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    })
    .outputText.replace(/\bimport\(/g, "importModule(");
function setup() {
  const generate = vi.fn(async () => "gs://test-bucket/graded.png"),
    refund = vi.fn(),
    reconcile = vi.fn(async () => true),
    deduct = vi.fn(async () => ({ cost: 49 })),
    policy = vi.fn(async () => ({ credits: 49 }));
  const modules: Record<string, unknown> = {
    "../services/coverWorkshop.js": {
      resolveCoverWorkerPolicy: policy,
      generateCoverImage: generate,
    },
    "../../shared/canvasGenerationPricing.js": { canvasImageCredits: () => 54 },
    "../../shared/manhuaAssetStandardize.js": {
      manhuaAssetStandardizeCredits: () => 3,
    },
    "../services/paidJobLedger.js": {
      registerActiveJob: vi.fn(),
      refundCreditsOnFailure: refund,
      markReconciliationPending: reconcile,
    },
    "../services/proxyImageService.js": {
      generateGptImage2FromRawEnglishPrompt: () => {
        throw Error("禁止回落普通图片链");
      },
    },
    "../services/canvasMediaOwnership.js": {
      registerCanvasImageDeliveryOrThrow: vi.fn(),
    },
  };
  const run = new Function(
    "importModule",
    "normalizeCanvasImageAspectRatio",
    "normalizeOpenAiImageLane",
    "normalizeOpenAiImageVariant",
    "deductCreditsAmount",
    compile(
      `async function run(input,jobUserId,jobId){const params=input.params;${branch}}`
    ) + ";return run;"
  )(
    async (name: string) => {
      if (!modules[name]) throw Error("禁止真实依赖" + name);
      return modules[name];
    },
    normalizeCanvasImageAspectRatio,
    normalizeOpenAiImageLane,
    normalizeOpenAiImageVariant,
    deduct
  );
  const input = {
    action: "canvas_gpt_image2",
    params: {
      prompt: "封面标题",
      aspectRatio: "9:16",
      coverWorkshop: { id: "test-id" },
    },
  };
  return { run, input, generate, refund, reconcile, deduct, policy };
}
it("真实worker完整图片分支用冻结费用，产物进入同一所有权和输出", async () => {
  const f = setup();
  const result = await f.run(f.input, "1", "cover_job");
  expect(f.policy).toHaveBeenCalledWith("1", "cover_job", f.input);
  expect(f.deduct).toHaveBeenCalledWith(
    1,
    49,
    "canvasGptImage2",
    expect.any(String),
    { chargeKey: "canvasGptImage2/cover_job" }
  );
  expect(result.output).toEqual({
    imageUrl: "gs://test-bucket/graded.png",
    imageUrls: ["gs://test-bucket/graded.png"],
  });
  expect(f.generate).toHaveBeenCalledTimes(1);
});
it("伪造凭据在扣费前拒绝；明确失败退款，未知结果只进对账", async () => {
  const f = setup();
  f.policy.mockRejectedValueOnce(Error("凭据错误"));
  await expect(f.run(f.input, "1", "cover_job")).rejects.toThrow("凭据");
  expect(f.deduct).not.toHaveBeenCalled();
  f.generate.mockRejectedValueOnce(Error("HTTP 400"));
  await expect(f.run(f.input, "1", "cover_job")).rejects.toThrow("400");
  expect(f.refund).toHaveBeenCalledTimes(1);
  f.generate.mockRejectedValueOnce(
    Object.assign(Error("unknown"), { kind: "unknown" })
  );
  await expect(f.run(f.input, "1", "cover_job")).rejects.toMatchObject({
    kind: "unknown",
  });
  expect(f.refund).toHaveBeenCalledTimes(1);
  expect(f.reconcile).toHaveBeenCalledWith("cover_job", "canvasGptImage2");
});
it("真实外层失败处置保持未知与墙钟超时对账，低像素明确失败退款，普通图不变", () => {
  const resolve = new Function(
    "isCanvasGptImage2Job",
    "paidImageLedgerTaskType",
    compile(disposition) + ";return resolveFailedJobDisposition;"
  )(
    (i: any) => i?.action === "canvas_gpt_image2",
    () => "canvasGptImage2"
  );
  const job = { type: "image", input: setup().input, attempts: 1 };
  expect(resolve(job, { kind: "unknown" })).toBe(
    "reconcile_and_fail_paid_image"
  );
  expect(resolve(job, Error("image job timed out after 600000ms"))).toBe(
    "reconcile_and_fail_paid_image"
  );
  expect(resolve(job, { kind: "invalid_output" })).toBe(
    "refund_and_fail_paid_image"
  );
  expect(
    resolve(
      { ...job, input: { action: "canvas_gpt_image2", params: {} } },
      Error("failed")
    )
  ).toBe("refund_and_fail_paid_image");
});
