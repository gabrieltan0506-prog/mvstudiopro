import { describe, expect, it } from "vitest";
import { buildRoughCutClipsFromShots } from "./manhuaEditWorkflowBank";
import {
  normalizeManhuaTimelineOrder,
  restoreManhuaRoughShotOrder,
  stampManhuaTimelineOrder,
} from "./manhuaEditOrder";

describe("粗剪播放顺序", () => {
  it("旧列表不重复镜头、不吞掉改稿新增的镜头", () => {
    const clips = buildRoughCutClipsFromShots(
      [1, 2, 3].map(index => ({ index, durationSec: 4 })),
      { order: [2, 2, 99, 1] }
    );
    expect(clips.map(clip => [clip.shotIndex, clip.order])).toEqual([
      [2, 1],
      [1, 2],
      [3, 3],
    ]);
  });

  it("盖播放序号不改变源镜身份或裁切秒位，跨段恢复同序", () => {
    const pieces = [1, 2, 3, 4, 5, 6].map(shotIndex => ({
      shotIndex,
      trimInSec: ((shotIndex - 1) % 3) * 4,
      trimOutSec: (((shotIndex - 1) % 3) + 1) * 4,
    }));
    const order = [4, 1, 5, 2, 3, 6];
    const saved = stampManhuaTimelineOrder(pieces, order);
    expect(saved.map(piece => piece.timelineOrder)).toEqual([2, 4, 5, 1, 3, 6]);
    expect(saved.map(({ timelineOrder: _order, ...piece }) => piece)).toEqual(
      pieces
    );
    expect(
      restoreManhuaRoughShotOrder(
        saved,
        pieces.map(piece => piece.shotIndex)
      )
    ).toEqual(order);
    expect(
      restoreManhuaRoughShotOrder(saved.slice(1), [1, 2, 3, 4, 5, 6])
    ).toBeUndefined();
    expect(
      restoreManhuaRoughShotOrder(pieces, [1, 2, 3, 4, 5, 6])
    ).toBeUndefined();
  });

  it("缺镜或重复顺序不能写成一份看似合法的合同", () => {
    expect(() => stampManhuaTimelineOrder([{ shotIndex: 2 }], [1])).toThrow(
      "缺失"
    );
    expect(() => stampManhuaTimelineOrder([{ shotIndex: 1 }], [1, 1])).toThrow(
      "重复"
    );
  });

  it("非法新字段不会清掉后冒充无排序的旧稿", () => {
    expect(normalizeManhuaTimelineOrder(undefined)).toBeUndefined();
    expect(normalizeManhuaTimelineOrder(3)).toBe(3);
    for (const value of [null, 0, -1, 1.5, "2", Number.NaN, Infinity])
      expect(normalizeManhuaTimelineOrder(value)).toBe(0);
  });
});
