import { describe, expect, it } from "vitest";
import { diffLines, diffManhuaWriterPacks } from "./manhuaWriterPackDiff.js";
import type { ManhuaWriterPack } from "./manhuaWriterRoom.js";

function pack(episodes: Array<{ index: number; title: string; body: string; endHook?: string }>): ManhuaWriterPack {
  return {
    seriesTitle: "测试剧",
    logline: "",
    charactersMd: "",
    propsMd: "",
    locationsMd: "",
    rawMarkdown: "",
    episodeCount: episodes.length,
    episodes: episodes.map((e) => ({ ...e, endHook: e.endHook ?? "" })),
  };
}

describe("diffLines", () => {
  it("aligns same lines and marks add/del", () => {
    const out = diffLines(["a", "b", "c"], ["a", "x", "c"]);
    expect(out).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "x" },
      { kind: "same", text: "c" },
    ]);
  });
});

describe("diffManhuaWriterPacks", () => {
  it("classifies added/removed/changed/unchanged episodes", () => {
    const prev = pack([
      { index: 1, title: "一", body: "开场\n冲突" },
      { index: 2, title: "二", body: "旧内容" },
      { index: 3, title: "三", body: "保留" },
    ]);
    const next = pack([
      { index: 1, title: "一", body: "开场\n冲突" },
      { index: 2, title: "二", body: "新内容" },
      { index: 4, title: "四", body: "全新一集" },
    ]);
    const diff = diffManhuaWriterPacks(prev, next);
    const byIndex = new Map(diff.episodes.map((e) => [e.episodeIndex, e]));
    expect(byIndex.get(1)?.status).toBe("unchanged");
    expect(byIndex.get(2)?.status).toBe("changed");
    expect(byIndex.get(2)?.addedLineCount).toBe(1);
    expect(byIndex.get(2)?.removedLineCount).toBe(1);
    expect(byIndex.get(3)?.status).toBe("removed");
    expect(byIndex.get(4)?.status).toBe("added");
    expect(diff.summaryZh).toContain("改写 1 集");
    expect(diff.summaryZh).toContain("新增 1 集");
  });

  it("reports identical packs in plain words", () => {
    const p = pack([{ index: 1, title: "一", body: "同" }]);
    const diff = diffManhuaWriterPacks(p, pack([{ index: 1, title: "一", body: "同" }]));
    expect(diff.changedCount).toBe(0);
    expect(diff.summaryZh).toContain("完全一致");
  });

  it("skips line diff for oversized episodes but still flags changed", () => {
    const bigA = Array.from({ length: 500 }, (_, i) => `行${i}`).join("\n");
    const bigB = `${bigA}\n加一行`;
    const diff = diffManhuaWriterPacks(
      pack([{ index: 1, title: "一", body: bigA }]),
      pack([{ index: 1, title: "一", body: bigB }]),
    );
    expect(diff.episodes[0]?.status).toBe("changed");
    expect(diff.episodes[0]?.tooLargeForLineDiff).toBe(true);
    expect(diff.episodes[0]?.lines).toEqual([]);
  });
});
