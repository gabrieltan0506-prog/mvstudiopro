import { describe, expect, it } from "vitest";
import {
  applyManhuaVideoEditInstruction,
  mergeManhuaMediaVersions,
} from "./manhuaMediaVersions";

describe("mergeManhuaMediaVersions", () => {
  it("keeps the new result first and preserves older versions", () => {
    expect(
      mergeManhuaMediaVersions(
        ["https://cdn.example/new.mp4"],
        ["https://cdn.example/old.mp4"],
      ),
    ).toEqual([
      "https://cdn.example/new.mp4",
      "https://cdn.example/old.mp4",
    ]);
  });

  it("deduplicates and rejects non-http temporary values", () => {
    expect(
      mergeManhuaMediaVersions(
        ["https://cdn.example/a.mp4", "https://cdn.example/a.mp4"],
        ["local://draft", "", "https://cdn.example/b.mp4"],
      ),
    ).toEqual([
      "https://cdn.example/a.mp4",
      "https://cdn.example/b.mp4",
    ]);
  });

  it("replaces rather than accumulates the bounded video edit instruction", () => {
    const once = applyManhuaVideoEditInstruction("【镜头】固定机位", "移除路人");
    const twice = applyManhuaVideoEditInstruction(once, "  保持主体，减弱背景闪烁  ");
    expect(twice).toContain("【镜头】固定机位");
    expect(twice).toContain("【视频编辑指令】保持主体，减弱背景闪烁");
    expect(twice).not.toContain("移除路人");
    expect(twice.match(/【视频编辑指令】/g)).toHaveLength(1);
  });
});
