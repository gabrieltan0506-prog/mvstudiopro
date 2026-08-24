/**
 * 素材登记约束测试:
 * - jobs 记录只读取明确产物字段,普通文本字段不计入;完整对象名全等比较;
 * - 只收系统桶;HTTPS 只收系统生成地址,核对后统一写回规范化 gs://;
 * - 每次请求只读取一次 jobs 记录;三种 action 同一把尺。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: async () => null }));

import {
  collectDeclaredMediaSources,
  extractSystemObjectName,
  normalizePostProdObjectName,
  parseGsUri,
  postProdOutputPrefix,
  resolvePostProdInputSources,
  resolveRegisteredPostProdMediaSource,
  type PostProdMediaDeps,
} from "./postProdMediaSource";

const BUCKET = "bucket-a";

function deps(overrides?: Partial<PostProdMediaDeps>): PostProdMediaDeps {
  return {
    getBucket: () => BUCKET,
    verifyOwnership: vi.fn(async () => false),
    loadSucceededJobOutputObjects: vi.fn(async () => new Set<string>()),
    ...overrides,
  };
}

function depsWithObjects(objects: string[]): PostProdMediaDeps {
  return deps({
    loadSucceededJobOutputObjects: vi.fn(async () => new Set(objects)),
  });
}

describe("collectDeclaredMediaSources:只读取明确产物字段", () => {
  it("videoUrl/gcsUri/outputUrls 等产物字段计入", () => {
    const sources = collectDeclaredMediaSources({
      videoUrl: `gs://${BUCKET}/canvas-video/a.mp4`,
      gcsUri: `gs://${BUCKET}/post-prod/7/b.mp4`,
      outputUrls: [`gs://${BUCKET}/canvas-video/c.mp4`],
    });
    expect(sources).toHaveLength(3);
  });

  it("outputText 普通文本字段出现地址不计入", () => {
    expect(
      collectDeclaredMediaSources({ outputText: `见 gs://${BUCKET}/canvas-video/a.mp4` }),
    ).toEqual([]);
  });

  it("prompt/message/raw 普通文本字段不计入", () => {
    expect(
      collectDeclaredMediaSources({
        prompt: `gs://${BUCKET}/x.mp4`,
        message: `gs://${BUCKET}/y.mp4`,
        raw: `gs://${BUCKET}/z.mp4`,
      }),
    ).toEqual([]);
  });

  it("字符串形态的 output 先解析 JSON 再取字段", () => {
    expect(
      collectDeclaredMediaSources(JSON.stringify({ url: `gs://${BUCKET}/canvas-video/a.mp4` })),
    ).toEqual([`gs://${BUCKET}/canvas-video/a.mp4`]);
  });
});

describe("extractSystemObjectName:解析成完整对象名", () => {
  it("gs:// 系统桶解析,其他存储桶返回 null", () => {
    expect(extractSystemObjectName(`gs://${BUCKET}/dir/a.mp4`, BUCKET)).toBe("dir/a.mp4");
    expect(extractSystemObjectName("gs://bucket-b/dir/a.mp4", BUCKET)).toBeNull();
  });

  it("storage.googleapis.com 与 /api/canvas-media/ 折回对象名", () => {
    expect(
      extractSystemObjectName(
        `https://storage.googleapis.com/${BUCKET}/canvas-video/a.mp4?sig=1`,
        BUCKET,
      ),
    ).toBe("canvas-video/a.mp4");
    expect(
      extractSystemObjectName("https://example.com/api/canvas-media/generated/7/a.png", BUCKET),
    ).toBe("generated/7/a.png");
  });
});

describe("resolveRegisteredPostProdMediaSource", () => {
  it("素材尚未登记的 gs:// 拒绝,不创建任务", async () => {
    await expect(
      resolveRegisteredPostProdMediaSource(
        { userId: "7", source: `gs://${BUCKET}/random/thing.mp4` },
        deps(),
      ),
    ).rejects.toThrow(/尚未登记/);
  });

  it("其他存储桶的 gs:// 拒绝", async () => {
    await expect(
      resolveRegisteredPostProdMediaSource(
        { userId: "7", source: "gs://bucket-b/post-prod/7/x.mp4" },
        deps(),
      ),
    ).rejects.toThrow(/存储范围/);
  });

  it("本人 post-prod 产物前缀放行并规范化", async () => {
    await expect(
      resolveRegisteredPostProdMediaSource(
        { userId: "7", source: `gs://${BUCKET}/post-prod/7/20260821/concat-1.mp4` },
        deps(),
      ),
    ).resolves.toBe(`gs://${BUCKET}/post-prod/7/20260821/concat-1.mp4`);
  });

  it("登记簿图片:verifyOwnership 通过才放行", async () => {
    const d = deps({ verifyOwnership: vi.fn(async () => true) });
    await expect(
      resolveRegisteredPostProdMediaSource(
        { userId: "7", source: `gs://${BUCKET}/generated/7/abc.png` },
        d,
      ),
    ).resolves.toBe(`gs://${BUCKET}/generated/7/abc.png`);
    expect(d.verifyOwnership).toHaveBeenCalledWith(7, "generated/7/abc.png");
  });

  it("videoUrl 精确对象名可以读取", async () => {
    const d = depsWithObjects(["canvas-video/seedance-123.mp4"]);
    await expect(
      resolveRegisteredPostProdMediaSource(
        { userId: "7", source: `gs://${BUCKET}/canvas-video/seedance-123.mp4` },
        d,
      ),
    ).resolves.toBe(`gs://${BUCKET}/canvas-video/seedance-123.mp4`);
  });

  it("相似对象名不形成精确匹配:abc.mp4 记录不放行 abc.mp4.backup", async () => {
    const d = depsWithObjects(["canvas-video/abc.mp4"]);
    await expect(
      resolveRegisteredPostProdMediaSource(
        { userId: "7", source: `gs://${BUCKET}/canvas-video/abc.mp4.backup` },
        d,
      ),
    ).rejects.toThrow(/尚未登记/);
  });

  it("HTTPS 站内链核对后写回规范化 gs://,不落有效期地址", async () => {
    const d = deps({ verifyOwnership: vi.fn(async () => true) });
    await expect(
      resolveRegisteredPostProdMediaSource(
        { userId: "7", source: "https://example.com/api/canvas-media/generated/7/a.png" },
        d,
      ),
    ).resolves.toBe(`gs://${BUCKET}/generated/7/a.png`);
  });

  it("storage.googleapis.com 链核对后同样写回 gs://;其他存储桶拒", async () => {
    const ok = depsWithObjects(["canvas-video/x.mp4"]);
    await expect(
      resolveRegisteredPostProdMediaSource(
        {
          userId: "7",
          source: `https://storage.googleapis.com/${BUCKET}/canvas-video/x.mp4?X-Goog-Signature=1`,
        },
        ok,
      ),
    ).resolves.toBe(`gs://${BUCKET}/canvas-video/x.mp4`);
    await expect(
      resolveRegisteredPostProdMediaSource(
        { userId: "7", source: "https://storage.googleapis.com/bucket-b/canvas-video/x.mp4" },
        deps(),
      ),
    ).rejects.toThrow(/存储范围/);
  });

  it("站外 HTTPS 一律按素材尚未登记拒绝", async () => {
    await expect(
      resolveRegisteredPostProdMediaSource(
        { userId: "7", source: "https://example.com/files/out.mp4" },
        deps(),
      ),
    ).rejects.toThrow(/尚未登记/);
  });
});

describe("resolvePostProdInputSources:三种 action 同一把尺", () => {
  it("concat 每段 clips 都解析;每次请求只读取一次 jobs 记录", async () => {
    const load = vi.fn(async () => new Set(["a.mp4", "b.mp4", "c.mp4"]));
    const d = deps({ loadSucceededJobOutputObjects: load });
    const out = await resolvePostProdInputSources(
      {
        userId: "7",
        input: {
          action: "concat",
          params: {
            clips: [`gs://${BUCKET}/a.mp4`, `gs://${BUCKET}/b.mp4`, `gs://${BUCKET}/c.mp4`],
            width: 1280,
            height: 720,
            fps: 30,
          },
        },
      },
      d,
    );
    if (out.action !== "concat") throw new Error("action 不应改变");
    expect(out.params.clips).toHaveLength(3);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("bgm_mount 双素材都解析;一个未登记整体拒", async () => {
    const d = depsWithObjects(["v.mp4"]);
    await expect(
      resolvePostProdInputSources(
        {
          userId: "7",
          input: {
            action: "bgm_mount",
            params: {
              videoUri: `gs://${BUCKET}/v.mp4`,
              bgmUri: `gs://${BUCKET}/unregistered.mp3`,
              bgmVolume: 0.48,
              entrySec: 0, bgmSeekSec: 0,
              fadeInSec: 0.5,
              fadeOutSec: 1,
            },
          },
        },
        d,
      ),
    ).rejects.toThrow(/尚未登记/);
  });

  it("loudness_check 的 videoUri 解析", async () => {
    const d = depsWithObjects(["v.mp4"]);
    const out = await resolvePostProdInputSources(
      {
        userId: "7",
        input: { action: "loudness_check", params: { videoUri: `gs://${BUCKET}/v.mp4`, windows: [] } },
      },
      d,
    );
    if (out.action !== "loudness_check") throw new Error("action 不应改变");
    expect(out.params.videoUri).toBe(`gs://${BUCKET}/v.mp4`);
  });
});

describe("辅助函数", () => {
  it("parseGsUri 拒绝路径越界", () => {
    expect(parseGsUri("gs://b/a/../b.mp4")).toBeNull();
    expect(parseGsUri("gs://b/ok/a.mp4")).toEqual({ bucket: "b", objectName: "ok/a.mp4" });
  });
  it("normalizePostProdObjectName 拒绝空段与反斜杠", () => {
    expect(normalizePostProdObjectName("a//b.mp4")).toBeNull();
    expect(normalizePostProdObjectName("a\\b.mp4")).toBeNull();
    expect(normalizePostProdObjectName("/lead/a.mp4")).toBe("lead/a.mp4");
  });
  it("postProdOutputPrefix 清洗 userId", () => {
    expect(postProdOutputPrefix("7/../x")).toBe("post-prod/7x/");
  });
});

describe("本人上传前缀(第四类放行)", () => {
  it("uploads/u<uid>/ 本人上传放行并规范化", async () => {
    const src = "gs://bucket-a/uploads/u7/abc-def-bgm.mp3";
    await expect(
      resolveRegisteredPostProdMediaSource({ userId: "7", source: src }, deps()),
    ).resolves.toBe(src);
  });

  it("他人上传前缀不放行(uid 全等,u77 不匹配 u7)", async () => {
    await expect(
      resolveRegisteredPostProdMediaSource(
        { userId: "7", source: "gs://bucket-a/uploads/u8/x.mp3" },
        deps(),
      ),
    ).rejects.toThrow(/尚未登记/);
    await expect(
      resolveRegisteredPostProdMediaSource(
        { userId: "77", source: "gs://bucket-a/uploads/u7/x.mp3" },
        deps(),
      ),
    ).rejects.toThrow(/尚未登记/);
  });
});
