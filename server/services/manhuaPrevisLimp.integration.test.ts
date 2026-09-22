import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createManhuaPrevisStudio } from "../../shared/manhuaPrevis";
import { renderManhuaPrevis, runPrevisProcess } from "./manhuaPrevisRender";

describe.skipIf(!process.env.PREVIS_BLENDER_TEST)("跛行白模真实渲染", () => {
  it("伤腿逐帧卸载且形成可见抬落差", async () => {
    const spec = createManhuaPrevisStudio(2, "11111111-1111-4111-8111-111111111111").spec;
    spec.actors = [{
      ...spec.actors[0],
      shape: "horse",
      start: [0, 0],
      end: [.5, 0],
      moveStartSec: 0,
      moveEndSec: 2,
      actions: [{ kind: "limp_front_left", startSec: 0, endSec: 2 }],
    }];
    spec.cameras = [{ startSec: 0, endSec: 2, position: [3, -6, 2.4], target: [.2, 0, 1], lens: 48 }];
    const out = process.env.PREVIS_TEST_OUTPUT || "/private/tmp/manhua-previs-limp-0922";
    await mkdir(out, { recursive: true });
    const result = await renderManhuaPrevis(
      {
        requestId: "22222222-2222-4222-8222-222222222222",
        scopeId: "11111111-1111-4111-8111-111111111111",
        clipId: "limp-test",
        spec,
      },
      "7",
      { signal: AbortSignal.timeout(180_000) },
      {
        blender: process.env.PREVIS_BLENDER_TEST!,
        useXvfb: false,
        run: runPrevisProcess,
        upload: async ({ objectName, buffer }) => {
          await writeFile(path.join(out, path.basename(objectName)), buffer);
          return { bucket: "test-bucket", objectName, gcsUri: `gs://test-bucket/${objectName}` };
        },
      },
    );
    const samples = result.report.actors[0].limpSamples as Array<{
      leftFrontHeight: number;
      leftFrontForward: number;
      supportKeys: string[];
    }>;
    const heights = samples.map(sample => sample.leftFrontHeight);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThanOrEqual(.18);
    expect(Math.max(...samples.slice(1).map((sample, i) =>
      Math.abs(sample.leftFrontForward - samples[i].leftFrontForward)))).toBeLessThanOrEqual(.08);
    expect(samples.every(sample => !sample.supportKeys.includes("1"))).toBe(true);
    expect(result.bytes).toBeGreaterThan(1000);
  }, 210_000);
});
