import { describe, expect, it } from "vitest";
import {
  applyManhuaVideoEditInstruction,
  clearManhuaVideoEditOperation,
  compileManhuaVideoEditPrompt,
  mergeManhuaMediaVersions,
} from "./manhuaMediaVersions";

describe("mergeManhuaMediaVersions", () => {
  it("keeps the new result first and preserves older versions", () => {
    expect(
      mergeManhuaMediaVersions(
        ["https://cdn.example/new.mp4"],
        ["https://cdn.example/old.mp4"]
      )
    ).toEqual(["https://cdn.example/new.mp4", "https://cdn.example/old.mp4"]);
  });

  it("deduplicates and rejects non-http temporary values", () => {
    expect(
      mergeManhuaMediaVersions(
        ["https://cdn.example/a.mp4", "https://cdn.example/a.mp4"],
        ["local://draft", "", "https://cdn.example/b.mp4"]
      )
    ).toEqual(["https://cdn.example/a.mp4", "https://cdn.example/b.mp4"]);
  });

  it("keeps more than 12 paid video versions without silently truncating history", () => {
    const versions = Array.from(
      { length: 14 },
      (_, index) => `https://cdn.example/version-${index + 1}.mp4`
    );

    expect(mergeManhuaMediaVersions([versions[13]], versions)).toEqual([
      versions[13],
      ...versions.slice(0, 13),
    ]);
  });

  it("moves a selected older version to the front without dropping any version", () => {
    const versions = Array.from(
      { length: 13 },
      (_, index) => `https://cdn.example/version-${index + 1}.mp4`
    );
    const selectedOlderVersion = versions[11];

    const selected = mergeManhuaMediaVersions([selectedOlderVersion], versions);

    expect(selected).toHaveLength(13);
    expect(selected[0]).toBe(selectedOlderVersion);
    expect(new Set(selected)).toEqual(new Set(versions));
  });

  it("replaces rather than accumulates the bounded video edit instruction", () => {
    const once = applyManhuaVideoEditInstruction(
      "【镜头】固定机位",
      "移除路人"
    );
    const twice = applyManhuaVideoEditInstruction(
      once,
      "  保持主体，减弱背景闪烁  "
    );
    expect(twice).toContain("【镜头】固定机位");
    expect(twice).toContain("【视频编辑指令】保持主体，减弱背景闪烁");
    expect(twice).not.toContain("移除路人");
    expect(twice.match(/【视频编辑指令】/g)).toHaveLength(1);
    expect(compileManhuaVideoEditPrompt(twice)).toContain(
      "保持主体，减弱背景闪烁"
    );
    expect(compileManhuaVideoEditPrompt(twice)).not.toContain("固定机位");
  });

  it("切回重拍清除一次性编辑模式，但不删除原稿与视频历史", () => {
    const block = {
      id: "clip-e01-g02",
      kind: "video",
      videoModel: "seedance-2.5",
      seedance25WorkMode: "video_edit",
      refVideoUrl: "https://test.invalid/original.mp4",
      seedance25RefVideoUrls: ["https://test.invalid/original.mp4"],
      prompt: applyManhuaVideoEditInstruction("原生成稿", "移除路人"),
      outputUrl: "https://test.invalid/edited.mp4",
      outputUrls: [
        "https://test.invalid/edited.mp4",
        "https://test.invalid/original.mp4",
      ],
    };
    const next = clearManhuaVideoEditOperation(block);
    expect(next.prompt).toBe("原生成稿");
    expect(next.seedance25WorkMode).toBeUndefined();
    expect(next.refVideoUrl).toBeUndefined();
    expect(next.seedance25RefVideoUrls).toEqual([]);
    expect(next.outputUrl).toBe(block.outputUrl);
    expect(next.outputUrls).toEqual(block.outputUrls);
    expect(block.seedance25WorkMode).toBe("video_edit");
    const generation = { ...block, seedance25WorkMode: "reference_to_video" };
    expect(clearManhuaVideoEditOperation(generation)).toBe(generation);
  });
});
