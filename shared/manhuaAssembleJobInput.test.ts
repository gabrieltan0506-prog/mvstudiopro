import { describe, expect, it } from "vitest";
import { buildManhuaAssembleJobInput } from "./manhuaAssembleJobInput";

describe("buildManhuaAssembleJobInput", () => {
  it("wraps clips for video job worker", () => {
    const input = buildManhuaAssembleJobInput({
      clips: [{ episodeIndex: 1, clipUrl: "https://example.com/a.mp4" }],
      topic: "测试",
      musicDuration: 240,
    });
    expect(input.action).toBe("manhua_assemble_final");
    expect(input.params.transition).toBe("fade");
    expect(input.params.resolution).toBe("9:16");
    expect(input.params.clips).toHaveLength(1);
    expect(input.params.musicDuration).toBe(240);
  });
});
