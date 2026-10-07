import { expect, it } from "vitest";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { renderManhuaTransitions } from "./manhuaTransitions";

it.each(["rotation", "missing-video"])("archives every probe field before %s rejection", async failure => {
  const probe = {
    streams: [
      ...(failure === "rotation" ? [{ codec_type: "video", width: 320, height: 240, duration: "2", avg_frame_rate: "24/1", tags: { rotate: "90" } }] : []),
      { codec_type: "audio", codec_name: "aac", channels: 2, tags: { language: "zho" } },
      { codec_type: "audio", codec_name: "aac", channels: 1, tags: { language: "eng" } },
    ],
    format: { duration: "2", tags: { comment: "retain full evidence" } },
  };
  const archived = new Map<string, string>(); let renders = 0, outputs = 0;
  await expect(renderManhuaTransitions({ clips: ["gs://offline/a.mp4", "gs://offline/b.mp4"], width: 320, height: 240, fps: 24, transition: { kind: "fade", durationSec: .5 } }, "7", {}, {
    fetch: async (_uri, target) => { await writeFile(target, "offline"); return 7; },
    run: async command => { if (command === "ffmpeg") renders++; return { stdout: JSON.stringify(probe), stderr: "" }; },
    upload: async ({ objectName, buffer }) => { archived.set(path.basename(objectName), buffer.toString()); return { bucket: "offline", objectName, gcsUri: `gs://offline/${objectName}` }; },
    result: async () => { outputs++; throw new Error("must not publish"); },
  })).rejects.toThrow();
  expect(renders).toBe(0); expect(outputs).toBe(0);
  expect(JSON.parse(archived.get("source-0.raw.json")!)).toEqual(probe);
  expect(JSON.parse(archived.get("source-0.parsed.json")!)).toEqual(probe);
  expect(Array.from(archived.keys()).indexOf("source-0.raw.json")).toBeLessThan(Array.from(archived.keys()).indexOf("source-0.parsed.json"));
});
