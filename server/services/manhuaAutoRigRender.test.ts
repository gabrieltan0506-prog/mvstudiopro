import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AUTO_RIG_JOINTS,
  type AutoRigRequest,
} from "../../shared/manhuaAutoRig";
import {
  autoRigSha,
  renderManhuaAutoRig,
  type AutoRigRenderDeps,
} from "./manhuaAutoRigRender";
const request: AutoRigRequest = {
  stage: "inspect",
  requestId: "11111111-1111-4111-8111-111111111111",
  assetRef: "human-1",
  sourceJobId: "m3d_test_original",
  settings: { pose: "T", forwardAxis: "+X", targetHeight: 1.7 },
};
function fixture(fail = false) {
  const source = Buffer.alloc(100, 7),
    objects = new Map<string, Buffer>([["source.glb", source]]),
    order: string[] = [];
  let runs = 0;
  const d: AutoRigRenderDeps = {
    blender: "test-blender",
    useXvfb: false,
    bucket: () => "test",
    source: async () =>
      ({
        taskId: request.sourceJobId,
        assetRef: request.assetRef,
        bytes: source.length,
        sha256: autoRigSha(source),
        gcsUri: "gs://test/source.glb",
      }) as any,
    inspect: async p => {
      p.signal?.throwIfAborted();
      const name = p.gcsUri.replace("gs://test/", ""),
        b = objects.get(name);
      if (!b || b.length > p.maxBytes) throw Error("离线对象不存在或超限");
      p.onChunk?.(b);
      return {
        bucket: "test",
        objectName: name,
        byteLength: b.length,
        sha256: autoRigSha(b),
        header: b.subarray(0, 12),
      };
    },
    upload: async p => {
      p.signal?.throwIfAborted();
      order.push(p.objectName);
      if (objects.has(p.objectName)) return { created: false };
      objects.set(p.objectName, Buffer.from(p.buffer));
      return { created: true };
    },
    run: async (command, args) => {
      runs++;
      expect(command).toBe("test-blender");
      expect(args).toContain("--disable-autoexec");
      const out = args.at(-1)!;
      await mkdir(out);
      await writeFile(
        path.join(out, "nested.json"),
        JSON.stringify({ raw: "原始数据保留" })
      );
      if (fail) {
        await writeFile(
          path.join(out, "failure.json"),
          JSON.stringify({ type: "ValueError", message: "人物网格有开口" })
        );
        throw Error("离线求解失败");
      }
      const report = {
        version: 1,
        stage: "inspect",
        sourceDigest: "a".repeat(64),
        sourceSha256: autoRigSha(source),
        vertices: 500,
        bounds: [
          [-0.3, -1, 0],
          [0.3, 1, 1.7],
        ],
        settings: request.settings,
        joints: Object.fromEntries(AUTO_RIG_JOINTS.map(k => [k, [0, 0, 1]])),
        limitations: ["测试夹具，不是用户质量验收"],
      };
      await writeFile(path.join(out, "report.json"), JSON.stringify(report));
      await writeFile(path.join(out, "model.glb"), Buffer.alloc(100, 8));
      const png = Buffer.alloc(256);
      Buffer.from("89504e470d0a1a0a", "hex").copy(png);
      for (let i = 0; i < 2; i++)
        await writeFile(path.join(out, `preview-${i}.png`), png);
      return "离线模拟进程";
    },
  };
  return { d, objects, order, runs: () => runs };
}
it("永久保留输入和全部JSON，完整结果最后发布且原源不变", async () => {
  const f = fixture(),
    before = Buffer.from(f.objects.get("source.glb")!);
  const result = await renderManhuaAutoRig(
    request,
    "1",
    { signal: AbortSignal.timeout(10000) },
    f.d
  );
  expect(result.inspection?.vertices).toBe(500);
  expect(f.objects.get("source.glb")).toEqual(before);
  expect(f.order[0]).toMatch(/request.json$/);
  expect(f.order.at(-1)).toMatch(/result.json$/);
  expect(f.order.some(x => x.endsWith("/raw/output/nested.json"))).toBe(true);
  expect(result.previews).toHaveLength(2);
  expect(result.qualityAccepted).toBe(false);
  expect(f.runs()).toBe(1);
});
it("求解失败仍先归档原始失败回执，不发布成功结果", async () => {
  const f = fixture(true);
  await expect(
    renderManhuaAutoRig(
      request,
      "1",
      { signal: AbortSignal.timeout(10000) },
      f.d
    )
  ).rejects.toThrow("人物网格有开口");
  expect(f.order.some(x => x.endsWith("/raw/output/failure.json"))).toBe(true);
  expect(f.order.some(x => x.endsWith("/result.json"))).toBe(false);
  expect(f.runs()).toBe(1);
});
it("同请求不同永久内容拒绝覆盖且不启动求解", async () => {
  const f = fixture();
  f.objects.set(
    `post-prod/1/auto-rig/${request.requestId}/request.json`,
    Buffer.from("不同请求")
  );
  await expect(
    renderManhuaAutoRig(
      request,
      "1",
      { signal: AbortSignal.timeout(10000) },
      f.d
    )
  ).rejects.toThrow("禁止覆盖");
  expect(f.runs()).toBe(0);
});
it("来源下载SHA不一致时不求解", async () => {
  const f = fixture();
  f.objects.set("source.glb", Buffer.alloc(100, 9));
  await expect(
    renderManhuaAutoRig(
      request,
      "1",
      { signal: AbortSignal.timeout(10000) },
      f.d
    )
  ).rejects.toThrow("已登记版本");
  expect(f.runs()).toBe(0);
});


describe("0917 Blender 降优先级", () => {
  it("生产（lowPriority）用 nice -n 10 包住 blender / xvfb-run；本机不包", async () => {
    const { blenderLaunchCommand } = await import("./manhuaAutoRigRender");
    const args = ["--background", "--python", "x.py"];
    expect(blenderLaunchCommand({ blender: "blender", useXvfb: false, lowPriority: true }, args))
      .toEqual({ command: "nice", args: ["-n", "10", "blender", ...args] });
    expect(blenderLaunchCommand({ blender: "blender", useXvfb: true, lowPriority: true }, args))
      .toEqual({ command: "nice", args: ["-n", "10", "xvfb-run", "-a", "blender", ...args] });
    expect(blenderLaunchCommand({ blender: "test-blender", useXvfb: false, lowPriority: false }, args))
      .toEqual({ command: "test-blender", args });
    expect(blenderLaunchCommand({ blender: "b", useXvfb: true }, args))
      .toEqual({ command: "xvfb-run", args: ["-a", "b", ...args] });
  });
});
