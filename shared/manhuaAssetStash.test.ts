import { describe, expect, it } from "vitest";
import {
  MANHUA_ASSET_STASH_CAP,
  findManhuaAssetStashEntry,
  mergeManhuaAssetStash,
  parseManhuaAssetStash,
  removeManhuaAssetStashEntries,
} from "./manhuaAssetStash";

const url = (n: number) => `https://cdn.example.com/a${n}.png`;

describe("mergeManhuaAssetStash 暂存合并", () => {
  it("收带图块、按 imageUrl 去重、保新弃旧", () => {
    const a = mergeManhuaAssetStash(
      [],
      [
        { blockId: "charsheet-x", role: "character", imageUrl: url(1), stashedAt: 100 },
        { blockId: "sceneplate-y", role: "scene", imageUrl: url(2), stashedAt: 100 },
      ],
    );
    expect(a).toHaveLength(2);
    const b = mergeManhuaAssetStash(a, [
      { blockId: "charsheet-x", role: "character", imageUrl: url(1), stashedAt: 200 },
    ]);
    expect(b).toHaveLength(2);
    expect(b.find((e) => e.imageUrl === url(1))!.stashedAt).toBe(200);
  });

  it("无图/半成品(非 https)不进暂存", () => {
    const a = mergeManhuaAssetStash(
      [],
      [
        { blockId: "charsheet-z", role: "character", imageUrl: "", stashedAt: 1 },
        { blockId: "charsheet-w", role: "character", imageUrl: "blob:xxx", stashedAt: 1 },
      ],
    );
    expect(a).toHaveLength(0);
  });

  it("封顶保新弃旧", () => {
    const many = Array.from({ length: MANHUA_ASSET_STASH_CAP + 20 }, (_, i) => ({
      blockId: `charsheet-${i}`,
      role: "character" as const,
      imageUrl: url(i),
      stashedAt: i + 1,
    }));
    const a = mergeManhuaAssetStash([], many);
    expect(a).toHaveLength(MANHUA_ASSET_STASH_CAP);
    // 最新的 stashedAt 应保留（i+1 的最大值 = CAP+20）
    expect(a[0]!.stashedAt).toBe(MANHUA_ASSET_STASH_CAP + 20);
  });
});

describe("parseManhuaAssetStash 解析", () => {
  it("解析字符串、剔脏、按时间排序", () => {
    const raw = JSON.stringify([
      { blockId: "a", role: "scene", imageUrl: url(1), stashedAt: 5 },
      { blockId: "", role: "scene", imageUrl: url(2), stashedAt: 9 },
      { blockId: "b", role: "prop", imageUrl: url(3), stashedAt: 9 },
    ]);
    const p = parseManhuaAssetStash(raw);
    expect(p).toHaveLength(2);
    expect(p[0]!.stashedAt).toBe(9);
  });

  it("坏 JSON / 非数组 → 空", () => {
    expect(parseManhuaAssetStash("{bad")).toEqual([]);
    expect(parseManhuaAssetStash({})).toEqual([]);
  });
});

describe("find/remove", () => {
  const stash = mergeManhuaAssetStash(
    [],
    [
      { blockId: "charsheet-x", role: "character", imageUrl: url(1), stashedAt: 1 },
      { blockId: "sceneplate-y", role: "scene", imageUrl: url(2), stashedAt: 2 },
    ],
  );

  it("按 blockId 取回", () => {
    expect(findManhuaAssetStashEntry(stash, "sceneplate-y")!.imageUrl).toBe(url(2));
    expect(findManhuaAssetStashEntry(stash, "nope")).toBeNull();
  });

  it("按 imageUrl 移除", () => {
    const left = removeManhuaAssetStashEntries(stash, [url(1)]);
    expect(left).toHaveLength(1);
    expect(left[0]!.imageUrl).toBe(url(2));
  });
});
