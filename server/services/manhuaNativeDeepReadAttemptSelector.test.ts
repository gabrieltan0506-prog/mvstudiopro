import { describe, expect, it, vi } from "vitest";
import {
  NATIVE_DEEP_READ_ATTEMPT_SELECTOR_MODEL,
  buildNativeDeepReadAttemptSelectionPrompt,
  selectNativeDeepReadAttemptWithQwen,
  type NativeDeepReadAttemptSelectionCandidate,
} from "./manhuaNativeDeepReadAttemptSelector";

const candidates: NativeDeepReadAttemptSelectionCandidate[] = ([0.7, 0.65, 0.6] as const)
  .map((temperature, index) => ({
    attemptNumber: (index + 1) as 1 | 2 | 3,
    temperature,
    passedGate: false,
    gateReasonZh: `第${index + 1}份门禁拒因`,
    raw: { shots: [{ startSec: 0, endSec: 10, hintZh: `候选${index + 1}` }] },
  }));

function makeInput() {
  return {
    seriesKey: "test_series",
    sourceDigest: "a".repeat(64),
    episodeIndex: 1,
    segmentIndex: 4,
    batchRequestId: "batch-test",
    candidates,
  };
}

describe("Qwen 3.8 Max 分片三选一", () => {
  it("只走 Qwen 通道，持久化请求、原文和选择终态", async () => {
    const stored = new Map<string, Buffer>();
    const upload = vi.fn(async (input: { objectName: string; buffer: Buffer }) => {
      if (stored.has(input.objectName)) return { created: false, generation: "1" };
      stored.set(input.objectName, Buffer.from(input.buffer));
      return { created: true, generation: String(stored.size) };
    });
    const invoke = vi.fn(async (params: Record<string, any>) => {
      const content = JSON.stringify({ selectedAttemptNumber: 2, reasonZh: "时间轴与视听证据最完整" });
      await params.onRawResponse({
        gateway: "plan_sg_qwen",
        model: NATIVE_DEEP_READ_ATTEMPT_SELECTOR_MODEL,
        httpStatus: 200,
        contentType: "application/json",
        bodyText: content,
        bodyComplete: true,
        receivedBytes: Buffer.byteLength(content),
      });
      params.validateContent(content);
      return {
        gateway: "plan_sg_qwen",
        model: NATIVE_DEEP_READ_ATTEMPT_SELECTOR_MODEL,
        provider: "Alibaba",
        requestId: "qwen-request-1",
        choices: [{ message: { content }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          completion_tokens_details: { reasoning_tokens: 5 },
          cost: 0.01,
        },
        gatewayTrace: [{ gateway: "plan_sg_qwen", model: NATIVE_DEEP_READ_ATTEMPT_SELECTOR_MODEL, outcome: "ok" }],
      };
    });
    const beforePaid = vi.fn(async () => undefined);
    const result = await selectNativeDeepReadAttemptWithQwen({ ...makeInput(), onBeforePaidCall: beforePaid }, {
      invoke: invoke as never,
      upload: upload as never,
      download: vi.fn(async () => { throw new Error("gcs_download_failed:404"); }) as never,
      getBucket: () => "mv-studio-pro-vertex-video-temp",
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]![0]).toMatchObject({
      gatewayPolicy: "qwen_only",
      temperature: 0.2,
      maxTokens: 8_192,
      requireFinishReasonStop: true,
    });
    expect(beforePaid).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ selectedAttemptNumber: 2, gateway: "plan_sg_qwen", model: "qwen3.8-max" });
    expect(result.evidence.rawObjectNames).toHaveLength(1);
    expect(Array.from(stored.keys()).sort()).toEqual(expect.arrayContaining([
      expect.stringMatching(/\/request\.json$/),
      expect.stringMatching(/\/raw-1\.json$/),
      expect.stringMatching(/\/parsed\.json$/),
    ]));
  });

  it("提示词锁定只能三选一，不允许改写或合并", () => {
    const prompt = buildNativeDeepReadAttemptSelectionPrompt({ episodeIndex: 1, segmentIndex: 4, candidates });
    expect(prompt.system).toContain("必须且只能选一份");
    expect(prompt.system).toContain("不是审美选美");
    expect(prompt.system).toContain("不改写、不合并");
    expect(prompt.user).toContain("第 1 集第 5 片");
  });
});
