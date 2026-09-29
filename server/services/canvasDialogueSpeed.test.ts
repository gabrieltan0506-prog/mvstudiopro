import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { speedCanvasDialogueTake, stretchCanvasDialogueAudio } from "./canvasDialogueSpeed";

const deps = () => ({
  bucket: () => "b",
  download: vi.fn(async () => Buffer.from("wav")),
  stretch: vi.fn(async (_audio: Buffer, speed: number) => ({ buffer: Buffer.alloc(1000), durationSec: 5.568 / speed })),
  upload: vi.fn(async (_objectName: string, _buffer: Buffer, _signal: AbortSignal) => undefined),
});

describe("对白候选变速 0.5–2 倍", () => {
  it("本人对白原件按倍速派生，放回同目录，对象名带倍速", async () => {
    const d = deps();
    const r = await speedCanvasDialogueTake(1, { gcsUri: "gs://b/post-prod/1/dialogue/dlg_a5ed.wav", speed: 1.137 }, d);
    expect(r).toMatchObject({ gcsUri: "gs://b/post-prod/1/dialogue/dlg_a5ed-x1p14.wav", speed: 1.14, bytes: 1000 });
    expect(d.stretch.mock.calls[0]![1]).toBe(1.14);
    expect(d.upload.mock.calls[0]![0]).toBe("post-prod/1/dialogue/dlg_a5ed-x1p14.wav");
  });
  it("拒绝：别人的文件、别的桶、非对白目录、已变速件、区间外、1 倍", async () => {
    const d = deps();
    for (const gcsUri of ["gs://b/post-prod/2/dialogue/x.wav", "gs://other/post-prod/1/dialogue/x.wav", "gs://b/post-prod/1/bgm/x.wav",
      "gs://b/post-prod/1/dialogue/../2/x.wav", "gs://b/post-prod/1/dialogue/sub/x.wav", "gs://b/post-prod/1/dialogue/x.mp3",
      // 用户号前缀碰撞、双斜杠、大小写、编码绕行（gcs.ts 会把 % 与空格规整成「-」，校验名与读写名须一致）
      "gs://b/post-prod/10/dialogue/x.wav", "gs://b/post-prod//1/dialogue/x.wav", "gs://b/post-prod/1/dialogue//x.wav", "gs://b/Post-Prod/1/dialogue/x.wav",
      "GS://b/post-prod/1/dialogue/x.wav", "gs://b/post-prod/1/dialogue/%2E%2E%2F2%2Fx.wav", "gs://b/post-prod/1/dialogue/a b.wav"]) {
      await expect(speedCanvasDialogueTake(1, { gcsUri, speed: 1.2 }, d)).rejects.toThrow("本人");
    }
    await expect(speedCanvasDialogueTake(1, { gcsUri: "gs://b/post-prod/1/dialogue/x-x1p20.wav", speed: 1.1 }, d)).rejects.toThrow("原始候选");
    await expect(speedCanvasDialogueTake(1, { gcsUri: "gs://b/post-prod/1/dialogue/x.wav", speed: 0.49 }, d)).rejects.toThrow("0.5–2");
    await expect(speedCanvasDialogueTake(1, { gcsUri: "gs://b/post-prod/1/dialogue/x.wav", speed: 2.01 }, d)).rejects.toThrow("0.5–2");
    await expect(speedCanvasDialogueTake(1, { gcsUri: "gs://b/post-prod/1/dialogue/x.wav", speed: 1 }, d)).rejects.toThrow("无需");
    expect(d.download).not.toHaveBeenCalled();
    expect(d.upload).not.toHaveBeenCalled();
  });
  it("读写或 ffmpeg 失败：报可重试，不落到「配音操作未能确认…勿重复生成」兜底", async () => {
    const d = { ...deps(), download: vi.fn(async () => { throw new Error("gcs_download_failed:404:"); }) };
    await expect(speedCanvasDialogueTake(1, { gcsUri: "gs://b/post-prod/1/dialogue/dlg_a.wav", speed: 1.2 }, d)).rejects.toMatchObject({ kind: "unavailable", message: expect.stringContaining("可稍后重试") });
    expect(d.upload).not.toHaveBeenCalled();
  });
  it("真实 ffmpeg：2 倍时长减半、0.5 倍时长加倍，输出 48k 双声道", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "speed-test-"));
    try {
      const src = path.join(dir, "tone.wav");
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-ar", "24000", "-ac", "1", src]);
      const audio = readFileSync(src);
      const fast = await stretchCanvasDialogueAudio(audio, 2, AbortSignal.timeout(30_000));
      const slow = await stretchCanvasDialogueAudio(audio, 0.5, AbortSignal.timeout(30_000));
      expect(fast.durationSec).toBeGreaterThan(1.45);
      expect(fast.durationSec).toBeLessThan(1.55);
      expect(slow.durationSec).toBeGreaterThan(5.9);
      expect(slow.durationSec).toBeLessThan(6.1);
      expect(fast.buffer.readUInt32LE(24)).toBe(48000);
      expect(fast.buffer.readUInt16LE(22)).toBe(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
