/**
 * 有效人声量测的**真 ffmpeg 回归**。
 *
 * 只测纯函数 gate 是不够的 —— 上一版的 bug 恰恰在量测那一层：
 * silencedetect 的输出在 `ffmpeg -f null -` **成功那次**的 stderr 里，
 * 而代码只在 catch 里读，于是 voicedSec 恒等于 totalSec，硬闸完全失效。
 * 这类错误纯函数测试永远抓不到，必须造真音频跑一遍。
 */
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { measureDialogueVoiced, sumSilenceDuration } from "./bailianDialogueTts";
import { checkManhuaDialogueVoice } from "../../shared/manhuaDialogueVoiceGate";

const execFileAsync = promisify(execFile);

let ffmpegOk = false;
try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
  ffmpegOk = true;
} catch {
  ffmpegOk = false;
}

describe("silence_duration 汇总", () => {
  it("把多段静音加起来", () => {
    const log = [
      "[Parsed_silencedetect_0] silence_end: 1.000068 | silence_duration: 1.000068",
      "[Parsed_silencedetect_0] silence_end: 3 | silence_duration: 1",
    ].join("\n");
    expect(sumSilenceDuration(log)).toBeCloseTo(2.0, 2);
  });

  it("没有静音段时为 0", () => {
    expect(sumSilenceDuration("nothing here")).toBe(0);
  });
});

describe.runIf(ffmpegOk)("真 ffmpeg：3 秒容器里只有 1 秒人声", () => {
  let dir = "";
  let file = "";

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "mv-voiced-"));
    file = path.join(dir, "probe.mp3");
    // 1s 静音 + 1s 音调 + 1s 静音
    await execFileAsync("ffmpeg", [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=1",
      "-f", "lavfi", "-i", "sine=f=440:r=44100:d=1",
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=1",
      "-filter_complex", "[0:a][1:a][2:a]concat=n=3:v=0:a=1",
      file,
    ]);
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("voicedSec 约 1 秒，不是容器的 3 秒", async () => {
    const m = await measureDialogueVoiced(file);
    expect(m.totalSec).toBeGreaterThan(2.8);
    expect(m.totalSec).toBeLessThan(3.3);
    // 上一版这里会返回 3 —— 静音完全没被扣掉
    expect(m.voicedSec).toBeGreaterThan(0.6);
    expect(m.voicedSec).toBeLessThan(1.5);
  });

  it("接上门禁后判为不合格 —— 1 秒人声不许进视频模型", async () => {
    const m = await measureDialogueVoiced(file);
    const gate = checkManhuaDialogueVoice(m);
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.reasonZh).toMatch(/低于 2\.5s|补了静音/);
  });

  it("量不到时长直接抛，不返回可疑数字", async () => {
    await expect(measureDialogueVoiced(path.join(dir, "nope.mp3"))).rejects.toThrow();
  });
});
