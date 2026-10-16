import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  exec: vi.fn(), write: vi.fn(), copy: vi.fn(), mkdir: vi.fn(), download: vi.fn(),
  burnArgs: vi.fn((paths: { videoPath: string; srtPath: string; outPath: string }) => ["-i", paths.videoPath, "-vf", `subtitles=${paths.srtPath}`, "-c:a", "copy", paths.outPath]),
}));
vi.mock("node:fs", () => ({ promises: { writeFile: mocks.write, copyFile: mocks.copy, mkdir: mocks.mkdir } }));
vi.mock("../services/heavyMediaProcess", () => ({ execHeavyMedia: mocks.exec }));
vi.mock("../jobs/heavyMediaContext", () => ({ heavyMediaSignal: { getStore: () => undefined } }));
vi.mock("./renderUtils.js", () => ({ downloadFileToPath: mocks.download, parseDurationSeconds: () => 3 }));
vi.mock("../services/postProduction.js", () => ({ buildBurnSubtitleArgs: mocks.burnArgs }));
import { renderSourceAudioFinal } from "./renderSourceAudio";
const alignedLyrics = { requestId: "33333333-3333-4333-8333-333333333333", sourceId: "song", durationSec: 3, words: [{ text: "回家", startSec: 1, endSec: 2 }], srt: "1\n00:00:01,000 --> 00:00:02,000\n回家\n" };
const input = { sceneVideos: [{ url: "https://example.test/video", duration: 3 }], musicOnly: true, musicUrl: "https://example.test/song", alignedLyrics };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.exec.mockImplementation(async () => ({ stdout: JSON.stringify({ streams: [{ codec_type: "video", duration: "3" }, { codec_type: "audio", duration: "3" }], format: { duration: "3" } }) }));
});
describe("真实MV renderer歌词烧录接线（不运行媒体工具）", () => {
  it("混音后使用现有字幕烧录参数与真实SRT，保留音轨并返回烧字产物", async () => {
    const result = await renderSourceAudioFinal(input, { width: 1280, height: 720 }, "/tmp/song-test");
    expect(result).toBe("/tmp/song-test/aligned-lyrics-final.mp4");
    expect(mocks.write).toHaveBeenCalledWith("/tmp/song-test/aligned-lyrics.srt", expect.stringContaining("00:00:01,000 --> 00:00:02,000\n回家"), { encoding: "utf8", flag: "wx" });
    expect(mocks.burnArgs).toHaveBeenCalledWith({ videoPath: "/tmp/song-test/source-audio-final.mp4", srtPath: "/tmp/song-test/aligned-lyrics.srt", outPath: result, fontsDir: "/tmp/song-test/lyrics-fonts" }, { fontName: "Noto Sans CJK SC" });
    expect(mocks.exec.mock.calls.filter(call => call[0] === "ffmpeg").at(-1)?.[1]).toContain("copy");
    expect(mocks.copy).toHaveBeenCalledWith(expect.stringContaining("NotoSansCJKsc-Regular.otf"), "/tmp/song-test/lyrics-fonts/NotoSansCJKsc-Regular.otf");
  });
  it("实际输出短于歌词秒位则拒绝烧录，不移动或截断字幕", async () => {
    mocks.exec.mockImplementation(async () => ({ stdout: JSON.stringify({ streams: [{ codec_type: "video", duration: "1.5" }, { codec_type: "audio" }] }) }));
    await expect(renderSourceAudioFinal(input, { width: 1280, height: 720 }, "/tmp/song-test")).rejects.toThrow("超出");
    expect(mocks.burnArgs).not.toHaveBeenCalled();
  });
  it("裁切配乐会改变对齐零点，在渲染前拒绝", async () => {
    await expect(renderSourceAudioFinal({ ...input, musicStartSec: 1 }, { width: 1280, height: 720 }, "/tmp/song-test")).rejects.toThrow("时间轴");
    expect(mocks.exec).not.toHaveBeenCalled();
  });
  it("未选择对齐字幕的旧MV不执行字幕烧录", async () => {
    const result = await renderSourceAudioFinal({ ...input, alignedLyrics: undefined }, { width: 1280, height: 720 }, "/tmp/song-test");
    expect(result).toBe("/tmp/song-test/source-audio-final.mp4");
    expect(mocks.burnArgs).not.toHaveBeenCalled();
  });
});
