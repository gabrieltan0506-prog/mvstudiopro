import { describe, expect, it } from "vitest";
import {
  canvasGptImage2RefundKey,
  CREATIVE_NANO_IMAGE_TIMEOUT_MS,
  isCanvasGptImage2Job,
  paidImageLedgerTaskType,
  resolveFailedJobDisposition,
  resolveJobTimeoutMs,
} from "./runner";
import { buildCreativeNanoImageJobInput } from "../../shared/creativeNanoImageJobInput";

const CANVAS_INPUT = { action: "canvas_gpt_image2", params: { prompt: "p" } };

describe("runner · canvas_gpt_image2 墙钟/重排/退款策略(七审 P0-2)", () => {
  it("超时:canvas 出图 ≥ 12 分钟(覆盖单供应商 6min fetch + 镜像/登记);其他 image 保持 12s", () => {
    expect(resolveJobTimeoutMs("image", CANVAS_INPUT)).toBeGreaterThanOrEqual(12 * 60_000);
    expect(resolveJobTimeoutMs("image", { action: "kling_image" })).toBe(12_000);
    expect(resolveJobTimeoutMs("audio", CANVAS_INPUT)).toBe(8 * 60_000);
  });

  it("失败处置:canvas 出图绝不重排(重排=第二次调付费上游),无论 attempts 几次", () => {
    expect(
      resolveFailedJobDisposition({ type: "image", input: CANVAS_INPUT, attempts: 0 }),
    ).toBe("refund_and_fail_paid_image");
    expect(
      resolveFailedJobDisposition({ type: "image", input: CANVAS_INPUT, attempts: 1 }),
    ).toBe("refund_and_fail_paid_image");
    // 其他任务维持旧策略:attempts<2 重排,否则失败
    expect(
      resolveFailedJobDisposition({ type: "image", input: { action: "kling_image" }, attempts: 1 }),
    ).toBe("requeue");
    expect(
      resolveFailedJobDisposition({ type: "video", input: {}, attempts: 2 }),
    ).toBe("fail");
  });

  it("退款幂等键:同 job 双路径(processImageJob 内部/runClaimedJob 外层)用同一把钥匙", () => {
    expect(canvasGptImage2RefundKey("job-9")).toBe("refund:canvasGptImage2/job-9");
    expect(canvasGptImage2RefundKey(undefined)).toBe("refund:canvasGptImage2/unknown");
  });

  it("八审 P1-6:超时墙钟 env 只能上调,设成低于 12 分钟被 Math.max 钉回下限", async () => {
    const { resolveJobTimeoutMs } = await import("./runner");
    const orig = process.env.CANVAS_GPT_IMAGE2_JOB_TIMEOUT_MS;
    process.env.CANVAS_GPT_IMAGE2_JOB_TIMEOUT_MS = "180000"; // 3 分钟,恶意/误配
    expect(resolveJobTimeoutMs("image", CANVAS_INPUT)).toBeGreaterThanOrEqual(12 * 60_000);
    process.env.CANVAS_GPT_IMAGE2_JOB_TIMEOUT_MS = "1800000"; // 30 分钟,允许上调
    expect(resolveJobTimeoutMs("image", CANVAS_INPUT)).toBe(1_800_000);
    if (orig === undefined) delete process.env.CANVAS_GPT_IMAGE2_JOB_TIMEOUT_MS;
    else process.env.CANVAS_GPT_IMAGE2_JOB_TIMEOUT_MS = orig;
  });

  it("任务判定:action 精确匹配,数组/空值/其他 action 不误伤", () => {
    expect(isCanvasGptImage2Job(CANVAS_INPUT)).toBe(true);
    expect(isCanvasGptImage2Job({ action: "manhua_template_learn" })).toBe(false);
    expect(isCanvasGptImage2Job(null)).toBe(false);
    expect(isCanvasGptImage2Job([CANVAS_INPUT])).toBe(false);
  });

  it("Creative Nano 固定 8 分钟墙钟、持久账本类型，失败绝不重排烧第二次上游", () => {
    const nano = buildCreativeNanoImageJobInput({ prompt: "p", aspectRatio: "16:9" });
    expect(resolveJobTimeoutMs("image", nano)).toBe(CREATIVE_NANO_IMAGE_TIMEOUT_MS);
    expect(paidImageLedgerTaskType(nano)).toBe("creativeNanoImage");
    expect(resolveFailedJobDisposition({ type: "image", input: nano, attempts: 0 }))
      .toBe("refund_and_fail_paid_image");
  });

  it("Canvas 标准图与资产标准化走各自账本目录", () => {
    expect(paidImageLedgerTaskType(CANVAS_INPUT)).toBe("canvasGptImage2");
    expect(paidImageLedgerTaskType({
      action: "canvas_gpt_image2",
      params: { assetStandardizeQuality: "high" },
    })).toBe("manhuaAssetStandardize");
    expect(paidImageLedgerTaskType({ action: "nano_image" })).toBeNull();
  });
});
