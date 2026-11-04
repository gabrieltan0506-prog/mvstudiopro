import { expect, it, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
const h = vi.hoisted(() => ({ calls: [] as string[][], subtitle: "" }));
vi.mock("./gcs.js", () => ({
  signGsUriV4ReadUrl: () => "https://example.test/source.mp4",
  uploadStreamToGcs: async ({ objectName, stream }: any) => {
    await new Response(stream).arrayBuffer();
    return { bucket: "test", objectName, gcsUri: `gs://test/${objectName}` };
  },
}));
vi.mock("./runChildUntilClosed", () => ({
  runChildUntilClosed: async (command: string, args: string[]) => {
    if (command === "ffprobe")
      return {
        stdout: JSON.stringify({
          format: { duration: "2" },
          streams: [
            { codec_type: "video", width: 320, height: 480 },
            { codec_type: "audio" },
          ],
        }),
        stderr: "",
      };
    h.calls.push(args);
    const graph = args[args.indexOf("-filter_complex") + 1];
    const srt = graph.match(/subtitles=filename='([^']+)'/)?.[1];
    if (srt) h.subtitle = await readFile(srt, "utf8");
    await writeFile(args.at(-1)!, Buffer.from("test-output-media"));
    return { stdout: "", stderr: "" };
  },
}));
import { concatClips } from "./postProduction";
it("字幕落盘接concat最终视频滤镜，音轨沿同一输出，不另建上传任务", async () => {
  vi.stubGlobal("fetch", async () => new Response(new Uint8Array([1, 2, 3])));
  try {
    const out = await concatClips(
      {
        clips: ["gs://test/source.mp4"],
        trims: [{ startSec: 0, endSec: 2 }],
        subtitleSrt: "1\n00:00:00,100 --> 00:00:01,000\n原文\n",
        width: 320,
        height: 480,
        fps: 30,
      },
      "7"
    );
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0][h.calls[0].indexOf("-filter_complex") + 1]).toContain(
      "concat=n=1:v=1:a=1[vraw][ao];[vraw]subtitles="
    );
    expect(h.calls[0]).toContain("[vo]");
    expect(h.calls[0]).toContain("[ao]");
    expect(h.subtitle).toContain("00:00:00,100 --> 00:00:01,000");
    expect(out.gcsUri).toContain("post-prod/7/");
  } finally {
    vi.unstubAllGlobals();
  }
});
