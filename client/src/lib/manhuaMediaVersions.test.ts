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

  it("keeps more than 12 paid video versions without silently truncating history", () => {
    const versions = Array.from(
      { length: 14 },
      (_, index) => `https://cdn.example/version-${index + 1}.mp4`,
    );

    expect(mergeManhuaMediaVersions([versions[13]], versions)).toEqual([
      versions[13],
      ...versions.slice(0, 13),
    ]);
  });

  it("moves a selected older version to the front without dropping any version", () => {
    const versions = Array.from(
      { length: 13 },
      (_, index) => `https://cdn.example/version-${index + 1}.mp4`,
    );
    const selectedOlderVersion = versions[11];

    const selected = mergeManhuaMediaVersions([selectedOlderVersion], versions);

    expect(selected).toHaveLength(13);
    expect(selected[0]).toBe(selectedOlderVersion);
    expect(new Set(selected)).toEqual(new Set(versions));
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
