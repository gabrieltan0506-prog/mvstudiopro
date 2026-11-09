import { describe, expect, it, vi } from "vitest";
import { parseRecognizedLyricLines, recognizeMusicMvLyricTable } from "./musicMvLyricTable";

vi.mock("./gcs", () => ({
  getGcsBucketName: () => "test-bucket",
  uploadBufferToGcsIfAbsent: vi.fn(async () => ({ created: true })),
  downloadGcsObject: vi.fn(),
}));
vi.mock("./heavyMediaProcess", () => ({
  execHeavyMedia: vi.fn(async (_cmd: string, args: string[]) => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(args[args.length - 1]!, Buffer.from("mp3"));
    return { stdout: "", stderr: "" };
  }),
}));

describe("本段歌词识别（待确认版）", () => {
  it("片段内秒转歌曲绝对秒；越界、重叠、顺序颠倒都算写坏", () => {
    const range = { startSec: 140, endSec: 185 };
    expect(parseRecognizedLyricLines({ lines: [{ text: "别爱我", startSec: 1.234, endSec: 3.5 }] }, range)).toEqual([{ text: "别爱我", startSec: 141.23, endSec: 143.5 }]);
    expect(() => parseRecognizedLyricLines({ lines: [{ text: "a", startSec: 1, endSec: 50 }] }, range)).toThrow(/超出片段/);
    expect(() => parseRecognizedLyricLines({ lines: [{ text: "a", startSec: 3, endSec: 5 }, { text: "b", startSec: 4, endSec: 6 }] }, range)).toThrow(/重叠/);
    expect(() => parseRecognizedLyricLines({ nope: [] }, range)).toThrow(/lines/);
  });

  it("交两跳听音（Vertex → EvoLink）后返回待确认版，记录实际通道", async () => {
    const listen = vi.fn(async (input: any) => ({ value: input.validate({ lines: [{ text: "又不想说", startSec: 2, endSec: 4.5 }] }), channel: "EvoLink" as const, model: "gemini-3.6-flash", failuresZh: ["Vertex（请求超时）"] }));
    const table = await recognizeMusicMvLyricTable(7, { requestId: "11111111-1111-4111-8111-111111111111", audio: { id: "a", url: "https://x/a.mp3" }, range: { startSec: 140, endSec: 185 } }, { readSong: async () => Buffer.from("song"), listen: listen as any });
    expect(table.status).toBe("pending");
    expect(table.lines).toEqual([{ text: "又不想说", startSec: 142, endSec: 144.5, kind: "lyric" }]);
    expect(table.recognizedBy).toEqual({ channel: "EvoLink", model: "gemini-3.6-flash" });
    expect(listen.mock.calls[0]![0].prompt).toContain("片段内 0 秒＝歌曲 140 秒");
  });
});

import { planLyricChunks, mergeLyricLines } from "./musicMvLyricTable";
describe("整首分块听写", () => {
  it("≤45 秒分块、3 秒重叠，核心区首尾相接覆盖整首", () => {
    const chunks = planLyricChunks({ startSec: 0, endSec: 208.68 });
    expect(chunks.length).toBe(5);
    expect(chunks[0]!.startSec).toBe(0);
    expect(chunks.at(-1)!.endSec).toBe(208.68);
    for (const c of chunks) expect(c.endSec - c.startSec).toBeLessThanOrEqual(45.01);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i]!.coreStartSec).toBeCloseTo(chunks[i - 1]!.coreEndSec, 2);
  });
  it("合并去重叠", () => {
    expect(mergeLyricLines([{ text: "b", startSec: 5, endSec: 8 }, { text: "a", startSec: 1, endSec: 5.5 }, { text: "c", startSec: 7.9, endSec: 8.05 }])).toEqual([
      { text: "a", startSec: 1, endSec: 5.5 }, { text: "b", startSec: 5.5, endSec: 8 },
    ]);
  });
});
