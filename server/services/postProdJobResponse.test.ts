/** 后期任务响应构建:gcsUri 优先现签、坏形状兜底、无产物原样返回 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./gcs.js", () => ({ signGsUriV4ReadUrl: () => "https://real-signer/unused" }));

import { buildPostProdJobResponse } from "./postProdJobResponse";

const baseJob = {
  id: "pp-1",
  status: "succeeded",
  input: { action: "concat", params: {} },
  output: null as unknown,
  error: null,
  provider: "ffmpeg-post-prod",
  createdAt: new Date("2026-08-21T00:00:00Z"),
  updatedAt: new Date("2026-08-21T00:01:00Z"),
};

describe("buildPostProdJobResponse", () => {
  it("gcsUri 优先:每次查询按 gcsUri 现签新读链,覆盖旧 url", () => {
    const sign = vi.fn(() => "https://signed.example/fresh");
    const res = buildPostProdJobResponse(
      {
        ...baseJob,
        output: { gcsUri: "gs://bucket-a/post-prod/7/out.mp4", url: "https://stale.example/old" },
      },
      sign,
    );
    expect(sign).toHaveBeenCalledWith("gs://bucket-a/post-prod/7/out.mp4", 7 * 24 * 3600);
    expect((res?.output as { url?: string }).url).toBe("https://signed.example/fresh");
    expect(res?.action).toBe("concat");
  });

  it("无 gcsUri(响度报告)原样返回,不签链", () => {
    const sign = vi.fn();
    const res = buildPostProdJobResponse(
      { ...baseJob, input: { action: "loudness_check" }, output: { status: "ok", integratedLufs: -14.2 } },
      sign,
    );
    expect(sign).not.toHaveBeenCalled();
    expect((res?.output as { integratedLufs?: number }).integratedLufs).toBe(-14.2);
  });

  it("null 任务与坏形状 input/output 兜底", () => {
    expect(buildPostProdJobResponse(null)).toBeNull();
    const res = buildPostProdJobResponse({ ...baseJob, input: "raw-string", output: [1, 2] });
    expect(res?.action).toBeUndefined();
    expect(res?.output).toBeNull();
  });
});
