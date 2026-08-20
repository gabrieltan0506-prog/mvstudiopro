/**
 * 后期素材来源核对测试(授权铁律):
 * - 未登记素材不放行(不创建任务);
 * - 只收系统桶;HTTPS 只收系统生成地址;
 * - post-prod/<uid>/ 产物、登记簿图片、jobs 表证据三类放行;
 * - 三种 action 的素材字段走同一个解析函数。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: async () => null }));

import {
  parseGsUri,
  postProdOutputPrefix,
  resolvePostProdInputSources,
  resolveRegisteredPostProdMediaSource,
  type PostProdMediaDeps,
} from "./postProdMediaSource";

function deps(overrides?: Partial<PostProdMediaDeps>): PostProdMediaDeps {
  return {
    getBucket: () => "sys-bucket",
    verifyOwnership: vi.fn(async () => false),
    hasJobOutputEvidence: vi.fn(async () => false),
    signObjectUrl: vi.fn(
      (bucket: string, objectName: string) => `https://signed/${bucket}/${objectName}`,
    ),
    ...overrides,
  };
}

describe("resolveRegisteredPostProdMediaSource", () => {
  it("未登记的 gs:// 素材拒绝", async () => {
    await expect(
      resolveRegisteredPostProdMediaSource(
        { userId: "7", source: "gs://sys-bucket/random/thing.mp4" },
        deps(),
      ),
    ).rejects.toThrow(/尚未登记/);
  });

  it("非系统桶的 gs:// 拒绝", async () => {
    await expect(
      resolveRegisteredPostProdMediaSource(
        { userId: "7", source: "gs://attacker-bucket/post-prod/7/x.mp4" },
        deps(),
      ),
    ).rejects.toThrow(/存储范围/);
  });

  it("本人 post-prod 产物前缀放行", async () => {
    const src = "gs://sys-bucket/post-prod/7/20260821/concat-1.mp4";
    await expect(
      resolveRegisteredPostProdMediaSource({ userId: "7", source: src }, deps()),
    ).resolves.toBe(src);
  });

  it("他人 post-prod 前缀不放行(除非有任务证据)", async () => {
    await expect(
      resolveRegisteredPostProdMediaSource(
        { userId: "7", source: "gs://sys-bucket/post-prod/8/x.mp4" },
        deps(),
      ),
    ).rejects.toThrow(/尚未登记/);
  });

  it("登记簿图片:verifyOwnership 通过才放行", async () => {
    const d = deps({ verifyOwnership: vi.fn(async () => true) });
    const src = "gs://sys-bucket/generated/7/abc.png";
    await expect(
      resolveRegisteredPostProdMediaSource({ userId: "7", source: src }, d),
    ).resolves.toBe(src);
    expect(d.verifyOwnership).toHaveBeenCalledWith(7, "generated/7/abc.png");
  });

  it("jobs 表证据放行系统桶视频对象", async () => {
    const d = deps({ hasJobOutputEvidence: vi.fn(async () => true) });
    const src = "gs://sys-bucket/canvas-video/seedance-123.mp4";
    await expect(
      resolveRegisteredPostProdMediaSource({ userId: "7", source: src }, d),
    ).resolves.toBe(src);
    expect(d.hasJobOutputEvidence).toHaveBeenCalledWith("7", "canvas-video/seedance-123.mp4");
  });

  it("站内 /api/canvas-media/ 链验主后重签", async () => {
    const d = deps({ verifyOwnership: vi.fn(async () => true) });
    await expect(
      resolveRegisteredPostProdMediaSource(
        { userId: "7", source: "https://www.mvstudiopro.com/api/canvas-media/generated/7/a.png" },
        d,
      ),
    ).resolves.toBe("https://signed/sys-bucket/generated/7/a.png");
  });

  it("系统桶 storage.googleapis.com 签名链:有证据则重签,无证据拒", async () => {
    const ok = deps({ hasJobOutputEvidence: vi.fn(async () => true) });
    await expect(
      resolveRegisteredPostProdMediaSource(
        {
          userId: "7",
          source: "https://storage.googleapis.com/sys-bucket/canvas-video/x.mp4?X-Goog-Signature=1",
        },
        ok,
      ),
    ).resolves.toBe("https://signed/sys-bucket/canvas-video/x.mp4");
    await expect(
      resolveRegisteredPostProdMediaSource(
        {
          userId: "7",
          source: "https://storage.googleapis.com/other-bucket/canvas-video/x.mp4",
        },
        deps(),
      ),
    ).rejects.toThrow(/存储范围/);
  });

  it("外部 HTTPS 一律拒绝(仅系统生成地址)", async () => {
    await expect(
      resolveRegisteredPostProdMediaSource(
        { userId: "7", source: "https://evolink.ai/files/out.mp4" },
        deps(),
      ),
    ).rejects.toThrow(/尚未登记/);
  });
});

describe("resolvePostProdInputSources:三种 action 同一把尺", () => {
  const pass = deps({ hasJobOutputEvidence: vi.fn(async () => true) });

  it("concat 每段 clips 都解析", async () => {
    const out = await resolvePostProdInputSources(
      {
        userId: "7",
        input: {
          action: "concat",
          params: {
            clips: ["gs://sys-bucket/a.mp4", "gs://sys-bucket/b.mp4"],
            width: 1280,
            height: 720,
            fps: 30,
          },
        },
      },
      pass,
    );
    if (out.action !== "concat") throw new Error("action 不应改变");
    expect(out.params.clips).toHaveLength(2);
  });

  it("bgm_mount 的 videoUri 与 bgmUri 都解析;一个未登记整体拒", async () => {
    const half = deps({
      hasJobOutputEvidence: vi.fn(async (_u: string, obj: string) => obj.includes("v.mp4")),
    });
    await expect(
      resolvePostProdInputSources(
        {
          userId: "7",
          input: {
            action: "bgm_mount",
            params: {
              videoUri: "gs://sys-bucket/v.mp4",
              bgmUri: "gs://sys-bucket/unregistered.mp3",
              bgmVolume: 0.48,
              entrySec: 0,
              fadeInSec: 0.5,
              fadeOutSec: 1,
            },
          },
        },
        half,
      ),
    ).rejects.toThrow(/尚未登记/);
  });

  it("loudness_check 的 videoUri 解析", async () => {
    const out = await resolvePostProdInputSources(
      {
        userId: "7",
        input: {
          action: "loudness_check",
          params: { videoUri: "gs://sys-bucket/v.mp4", windows: [] },
        },
      },
      pass,
    );
    if (out.action !== "loudness_check") throw new Error("action 不应改变");
    expect(out.params.videoUri).toBe("gs://sys-bucket/v.mp4");
  });
});

describe("辅助函数", () => {
  it("parseGsUri 拒绝路径穿越", () => {
    expect(parseGsUri("gs://b/a/../b.mp4")).toBeNull();
    expect(parseGsUri("gs://b/ok/a.mp4")).toEqual({ bucket: "b", objectName: "ok/a.mp4" });
  });
  it("postProdOutputPrefix 清洗 userId", () => {
    expect(postProdOutputPrefix("7/../x")).toBe("post-prod/7x/");
  });
});
