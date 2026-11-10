import { beforeEach, expect, it, vi } from "vitest";
import { writeFile } from "node:fs/promises";
const h = vi.hoisted(() => ({ calls: [] as string[][], uploads: [] as string[], yavg: [] as number[] }));
vi.mock("./gcs.js", () => ({
  signGsUriV4ReadUrl: () => "https://example.test/source.mp4",
  uploadStreamToGcs: async ({ objectName, stream }: any) => {
    await new Response(stream).arrayBuffer();
    return { bucket: "test", objectName, gcsUri: `gs://test/${objectName}` };
  },
  uploadBufferToGcs: async ({ objectName }: any) => {
    h.uploads.push(objectName);
    return { bucket: "test", objectName, gcsUri: `gs://test/${objectName}` };
  },
}));
vi.mock("./runChildUntilClosed", () => ({
  runChildUntilClosed: async (command: string, args: string[]) => {
    if (command === "ffprobe")
      return { stdout: JSON.stringify({ format: { duration: "2" }, streams: [{ codec_type: "video", width: 320, height: 480 }, { codec_type: "audio" }] }), stderr: "" };
    h.calls.push(args);
    if (args.includes("signalstats,metadata=mode=print")) {
      const y = h.yavg.shift() ?? 120;
      return { stdout: "", stderr: `lavfi.signalstats.YAVG=${y}\nlavfi.signalstats.UAVG=128\nlavfi.signalstats.VAVG=128\nlavfi.signalstats.SATAVG=20\n` };
    }
    await writeFile(args.at(-1)!, Buffer.from("test-output-media"));
    return { stdout: "", stderr: "" };
  },
}));
import { concatClips } from "./postProduction";

const base = { clips: ["gs://test/a.mp4", "gs://test/a.mp4"], trims: [{ startSec: 0, endSec: 1.5 }, { startSec: 0.5, endSec: 2 }], width: 320, height: 480, fps: 30 };
const graph = (args: string[]) => args[args.indexOf("-filter_complex") + 1];
beforeEach(() => { h.calls.length = 0; h.uploads.length = 0; h.yavg.length = 0; vi.stubGlobal("fetch", async () => new Response(new Uint8Array([1, 2, 3]))); });

it("autoMatch：应用→复测→再匹配，达标即停，每轮留档在 round-N 下，成片按最后一轮参数", async () => {
  h.yavg.push(120, 80, 120, 118); // 初测差 -40 → 第 1 轮后差 -2 达标
  const out = await concatClips({ ...base, grade: { referenceClipIndex: 0, autoMatch: true } }, "7");
  const renders = h.calls.filter(a => a.includes("-filter_complex"));
  expect(renders).toHaveLength(2);
  expect(graph(renders[0])).not.toContain("curves");
  expect(graph(renders[1])).toContain("[1:v]trim=start=0.5:end=2");
  expect(graph(renders[1])).toMatch(/fps=30,curves=master='0\/0 [\d.]+\/0.5 1\/1',format=yuv420p/);
  expect(out.gradeCheck?.pass).toBe(true);
  expect(out.gradeCheck?.rounds?.map(r => r.round)).toEqual([0, 1]);
  expect(out.gradeCheck?.appliedClips?.[1]?.exposure).toBe(1);
  expect(h.uploads.filter(n => n.includes("/round-0/"))).toHaveLength(4);
  expect(h.uploads.filter(n => n.includes("/round-1/"))).toHaveLength(4);
});

it("autoMatch 不达标时最多 3 轮匹配（共 4 次测量）后停止", async () => {
  h.yavg.push(...Array.from({ length: 4 }, () => [120, 60]).flat());
  const out = await concatClips({ ...base, grade: { referenceClipIndex: 0, autoMatch: true } }, "7");
  expect(out.gradeCheck?.rounds).toHaveLength(4);
  expect(out.gradeCheck?.pass).toBe(false);
  expect(h.uploads).toHaveLength(16);
});
