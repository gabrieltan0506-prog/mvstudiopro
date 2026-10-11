import { describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import {
  inspectSpatialAsset,
  importCodeMotionSpatialAsset,
  assertCodeMotionSpatial,
  spatialPrefix,
  type spatialImportDeps,
} from "./codeMotionSpatial";
import {
  importCodeMotionExistingVideo,
  type videoImportDeps,
} from "./codeMotionVideoImport";
const projectId = "11111111-1111-4111-8111-111111111111";
function storage() {
  const files = new Map<string, Buffer>();
  return {
    files,
    read: vi.fn(async (n: string) =>
      files.has(n) ? { body: files.get(n)!, generation: "1" } : null
    ),
    write: vi.fn(async (n: string, b: Buffer) => {
      files.set(n, b);
      return "1";
    }),
    list: vi.fn(async (prefix: string) =>
      Array.from(files.keys()).filter(n => n.startsWith(prefix))
    ),
  };
}
function glb() {
  const json = Buffer.from(
    JSON.stringify({
      asset: { version: "2.0" },
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [] }],
    })
  );
  const result = Buffer.alloc(20 + json.length);
  result.write("glTF");
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(json.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  json.copy(result, 20);
  return result;
}
describe("三维参考归档", () => {
  it("拒绝空文件、伪GLB、空SPZ及外部资源，不用任意URL加载旁路素材", () => {
    expect(() => inspectSpatialAsset(Buffer.from("fake"), "glb")).toThrow();
    expect(() =>
      inspectSpatialAsset(gzipSync(Buffer.alloc(16)), "spz")
    ).toThrow();
    const base = glb();
    expect(() => inspectSpatialAsset(base, "glb")).not.toThrow();
    expect(() => spatialPrefix("../2", projectId)).toThrow();
  });
  it("校验归属后按真实字节归档；重复导入沿用身份，篡改元数据拒绝保存", async () => {
    const st = storage();
    const bytes = glb();
    const deps = {
      storage: st,
      resolve: vi.fn(async () => "gs://test/uploads/u1/source"),
      read: vi.fn(async () => bytes),
      archive: vi.fn(async (n: string) => `gs://test/${n}`),
    } as unknown as typeof spatialImportDeps;
    const asset = await importCodeMotionSpatialAsset(
      "1",
      {
        projectId,
        name: "人物.glb",
        kind: "glb",
        gcsUri: "gs://test/uploads/u1/source",
      },
      deps
    );
    expect(deps.resolve).toHaveBeenCalledWith({
      userId: "1",
      source: "gs://test/uploads/u1/source",
    });
    expect(asset.bytes).toBe(bytes.length);
    const again = await importCodeMotionSpatialAsset(
      "1",
      {
        projectId,
        name: "改名.glb",
        kind: "glb",
        gcsUri: "gs://test/uploads/u1/source",
      },
      deps
    );
    expect(again).toEqual(asset);
    expect(st.files.size).toBe(1);
    await expect(
      assertCodeMotionSpatial(
        "1",
        projectId,
        { assets: [asset], frames: [] },
        st
      )
    ).resolves.toBeUndefined();
    await expect(
      assertCodeMotionSpatial(
        "2",
        projectId,
        { assets: [asset], frames: [] },
        st
      )
    ).rejects.toThrow("不属于");
    await expect(
      assertCodeMotionSpatial(
        "1",
        projectId,
        { assets: [{ ...asset, bytes: 1 }], frames: [] },
        st
      )
    ).rejects.toThrow("改变");
  });
});
describe("既有模型视频导入", () => {
  function deps() {
    const st = storage();
    return {
      storage: st,
      load: vi.fn(async () => ({
        generation: "3",
        project: {
          id: projectId,
          plan: { scenes: [{ duration: 5 }, { duration: 5 }] },
        },
      })),
      resolve: vi.fn(async () => "gs://test/uploads/u1/movie"),
      read: vi.fn(async () => Buffer.from("same-existing-video")),
      archive: vi.fn(async (n: string) => `gs://test/${n}`),
      inspect: vi.fn(async () => ({ duration: 5 })),
    } as unknown as typeof videoImportDeps;
  }
  const input = {
    projectId,
    expectedGeneration: "3",
    sceneIndex: 1,
    gcsUri: "gs://test/uploads/u1/movie",
    name: "原片.mp4",
    sourceNote: "外部旧任务",
  };
  it("真实解码时长匹配后写入正式素材注册及独立导入回执；重试复用、不触发模型", async () => {
    const d = deps();
    const result = await importCodeMotionExistingVideo("1", input, d);
    expect(result.clip).toMatchObject({
      at: 5,
      duration: 5,
      sourceStartSec: 0,
    });
    expect(d.inspect).toHaveBeenCalledTimes(1);
    const receipt = await d.storage.read(
      `code-motion/u1/production/${projectId}/imported-video/${result.asset.id}.json`
    );
    expect(JSON.parse(receipt!.body.toString())).toMatchObject({
      provenance: "user_import",
      platformGenerationVerified: false,
      chargedCredits: 0,
      sourceNote: "外部旧任务",
    });
    expect(await importCodeMotionExistingVideo("1", input, d)).toEqual(result);
  });
  it("旧版本、跨账号来源、短片或解码失败均不归档/采用", async () => {
    const d = deps();
    await expect(
      importCodeMotionExistingVideo(
        "1",
        { ...input, expectedGeneration: "1" },
        d
      )
    ).rejects.toThrow("作品已变化");
    expect(d.resolve).not.toHaveBeenCalled();
    vi.mocked(d.resolve).mockRejectedValueOnce(Error("素材归属失败"));
    await expect(importCodeMotionExistingVideo("1", input, d)).rejects.toThrow(
      "归属失败"
    );
    vi.mocked(d.inspect).mockResolvedValueOnce({
      duration: 4.8,
      audio: undefined,
    });
    await expect(importCodeMotionExistingVideo("1", input, d)).rejects.toThrow(
      "短于"
    );
    vi.mocked(d.inspect).mockRejectedValueOnce(Error("decode failed"));
    await expect(importCodeMotionExistingVideo("1", input, d)).rejects.toThrow(
      "decode failed"
    );
    expect(d.archive).not.toHaveBeenCalled();
  });
});
