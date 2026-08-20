/**
 * 后期工坊 envelope 分派测试:三个 action 各自落到对应服务函数,
 * 未知 action 必须抛错(不许静默成功——0819 空转事故口径)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const concatClips = vi.fn(async (..._args: unknown[]) => ({ kind: "concat" }));
const mountBgm = vi.fn(async (..._args: unknown[]) => ({ kind: "bgm" }));
const loudnessCheck = vi.fn(async (..._args: unknown[]) => ({ kind: "loudness" }));

vi.mock("../services/postProduction", () => ({
  concatClips: (a: unknown, b: unknown) => concatClips(a, b),
  mountBgm: (a: unknown, b: unknown) => mountBgm(a, b),
  loudnessCheck: (a: unknown) => loudnessCheck(a),
}));

import { processPostProdJob } from "./postProdJob";

describe("processPostProdJob 分派", () => {
  beforeEach(() => {
    concatClips.mockClear();
    mountBgm.mockClear();
    loudnessCheck.mockClear();
  });

  it("concat → concatClips(params, userId)", async () => {
    const res = await processPostProdJob({ action: "concat", params: { a: 1 } }, "u1");
    expect(concatClips).toHaveBeenCalledWith({ a: 1 }, "u1");
    expect(res).toEqual({ output: { kind: "concat" }, provider: "ffmpeg-post-prod" });
  });

  it("bgm_mount → mountBgm(params, userId)", async () => {
    const res = await processPostProdJob({ action: "bgm_mount", params: {} }, "u2");
    expect(mountBgm).toHaveBeenCalledWith({}, "u2");
    expect(res.provider).toBe("ffmpeg-post-prod");
  });

  it("loudness_check → loudnessCheck(params),不带 userId", async () => {
    await processPostProdJob({ action: "loudness_check", params: { url: "gs://x" } }, "u3");
    expect(loudnessCheck).toHaveBeenCalledWith({ url: "gs://x" });
  });

  it("未知 action 抛错,不静默", async () => {
    await expect(processPostProdJob({ action: "nope" }, "u4")).rejects.toThrow(
      /Unsupported post_prod action/,
    );
    expect(concatClips).not.toHaveBeenCalled();
  });

  it("params 缺省时以空对象兜底,不是 undefined 崩", async () => {
    await processPostProdJob({ action: "concat" }, "u5");
    expect(concatClips).toHaveBeenCalledWith({}, "u5");
  });
});
