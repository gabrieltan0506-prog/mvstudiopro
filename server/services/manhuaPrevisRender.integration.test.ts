import { describe, it, expect } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createManhuaPrevisStudio } from "../../shared/manhuaPrevis";
import { renderManhuaPrevis, runPrevisProcess } from "./manhuaPrevisRender";

// 显式 opt-in，只跑本机渲染；存储替身写临时验收目录，不访问任何生产凭证。
describe.skipIf(!process.env.PREVIS_BLENDER_TEST)("白模真实渲染", () => {
  it("受控配置真实产出关节、48帧、可解码视频和证据", async () => {
    const spec = createManhuaPrevisStudio(
      2,
      "11111111-1111-4111-8111-111111111111"
    ).spec;
    spec.actors[0].end = [-0.4, 0];
    spec.actors[0].actions = [{ kind: "strike", startSec: 0, endSec: 2 }];
    const out =
      process.env.PREVIS_TEST_OUTPUT ||
      "/private/tmp/manhua-previs-integration-0911";
    await mkdir(out, { recursive: true });
    const stored: string[] = [];
    const result = await renderManhuaPrevis(
      {
        requestId: "22222222-2222-4222-8222-222222222222",
        scopeId: "11111111-1111-4111-8111-111111111111",
        clipId: "clip-test",
        spec,
      },
      "7",
      { signal: AbortSignal.timeout(120_000) },
      {
        blender: process.env.PREVIS_BLENDER_TEST!,
        useXvfb: process.platform === "linux",
        run: runPrevisProcess,
        upload: async ({ objectName, buffer }) => {
          stored.push(objectName);
          await writeFile(path.join(out, path.basename(objectName)), buffer);
          return {
            bucket: "test-bucket",
            objectName,
            gcsUri: `gs://test-bucket/${objectName}`,
          };
        },
      }
    );
    expect(result.report.frames).toBe(48);
    expect(result.report.actors[0].bones).toBe(16);
    expect(result.report.actors[0].stanceDrift).toBeLessThan(0.005);
    expect(result.bytes).toBeGreaterThan(1000);
    expect(stored.map(x => path.basename(x))).toEqual([
      "request.json",
      "report.json",
      "evidence.json",
      "scene.blend",
      "preview.mp4",
    ]);
    await writeFile(
      path.join(out, "验收结果.json"),
      JSON.stringify(result, null, 2)
    );
    console.log(
      "PREVIS_REAL_RENDER",
      JSON.stringify({
        frames: result.report.frames,
        bytes: result.bytes,
        sha256: result.sha256,
        actors: result.report.actors,
        out,
      })
    );
  }, 150_000);
});
