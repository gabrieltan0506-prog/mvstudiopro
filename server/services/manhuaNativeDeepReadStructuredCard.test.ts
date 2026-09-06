import { describe, expect, it, vi } from "vitest";
import { writeNativeStructuredCard } from "./manhuaNativeDeepReadStructuredCard.js";
describe("最终消费证据永久保存", () => {
  it("同内容同名，持久化后逐字对账，不清理原稿", async () => {
    let stored: Buffer = Buffer.alloc(0);
    const deps = {
      getBucket: () => "test-bucket",
      upload: vi.fn(async (input: { buffer: Buffer }) => {
        stored = input.buffer;
      }),
      download: vi.fn(async () => ({ buffer: stored, generation: "1" })),
    };
    const input = {
      schemaVersion: 1 as const,
      sourceDigest: "a".repeat(64),
      seriesKey: "test",
      episodeIndex: 1,
      segmentEvidenceObjectNames: ["test-segment"],
      raw: { shots: [{ hintZh: "男子推门" }] },
    };
    const name = await writeNativeStructuredCard(input, deps as never);
    expect(await writeNativeStructuredCard(input, deps as never)).toBe(name);
    expect(JSON.parse(stored.toString()).raw.shots[0].hintZh).toBe("男子推门");
    deps.download.mockImplementation(async () => ({
      buffer: Buffer.from("{}"),
      generation: "1",
    }));
    await expect(
      writeNativeStructuredCard(input, deps as never)
    ).rejects.toThrow("对账不符");
    await expect(
      writeNativeStructuredCard({ ...input, raw: { shots: [] } }, deps as never)
    ).rejects.toThrow("为空");
  });
});
