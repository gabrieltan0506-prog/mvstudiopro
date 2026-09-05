import { describe, expect, it } from "vitest";
import { buildManhuaAssembleJobInput, hasManhuaAssembleCapabilities } from "./manhuaAssembleJobInput";

describe("buildManhuaAssembleJobInput", () => {
  it("旧后端和仍自动配乐的协议不得放行提交", () => {
    expect(hasManhuaAssembleCapabilities({ ok: true, billingContractVersion: "manhua-assemble-v1", implicitMusic: false })).toBe(true);
    for (const raw of [null, {}, { ok: true }, { ok: true, billingContractVersion: "manhua-assemble-v1", implicitMusic: true }]) {
      expect(hasManhuaAssembleCapabilities(raw)).toBe(false);
    }
  });
  it("wraps clips for video job worker", () => {
    const input = buildManhuaAssembleJobInput({
      clips: [{ episodeIndex: 1, clipUrl: "https://example.com/a.mp4" }],
      expectedSegments: [{ episodeIndex: 1, segmentIndex: 1 }],
      topic: "测试",
      musicDuration: 240,
    });
    expect(input.action).toBe("manhua_assemble_final");
    expect(input.params.transition).toBe("fade");
    expect(input.params.resolution).toBe("9:16");
    expect(input.params.clips).toHaveLength(1);
    expect(input.params.musicDuration).toBe(240);
    expect(input.params.expectedSegments).toEqual([
      { episodeIndex: 1, segmentIndex: 1 },
    ]);
  });
});
