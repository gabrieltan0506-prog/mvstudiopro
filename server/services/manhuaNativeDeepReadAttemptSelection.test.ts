import { describe, expect, it } from "vitest";
import {
  hasNativeAttemptSelection,
  nativeAttemptRawSha256,
  scoreNativeAttempt,
} from "./manhuaNativeDeepReadAttemptSelection.js";
const raw = {
  shots: [
    {
      startSec: 0,
      endSec: 10,
      hintZh: "男子推门进入",
      actionZh: "推门",
      evidenceRole: "story",
      detailLevel: "brief",
    },
  ],
  audioResolution: [
    { analysis: { audioTrack: [{ fromSec: 0, toSec: 10, cues: [] }] } },
  ],
};
describe("零调用候选排序及证据信封", () => {
  it("区间重复不增加覆盖，可选十八字段缺省不扣分", () => {
    const score = scoreNativeAttempt(raw, 0, 20, true)!;
    expect(score.slice(0, 3)).toEqual([0.5, 0.5, -0]);
    expect(
      scoreNativeAttempt(
        { ...raw, shots: [...raw.shots, ...raw.shots] },
        0,
        20,
        true
      )
    ).toEqual(score);
    expect(scoreNativeAttempt({ shots: [] }, 0, 20, false)).toBeNull();
  });
  it("同覆盖时音轨事件越界、长证据段和缺基础字段排名更低", () => {
    const good = scoreNativeAttempt(raw, 0, 20, true)!;
    const bad = scoreNativeAttempt(
      {
        ...raw,
        audioResolution: [
          {
            analysis: {
              audioTrack: [{ fromSec: 0, toSec: 10, cues: [{ atSec: 15 }] }],
            },
          },
        ],
      },
      0,
      20,
      true
    )!;
    expect(bad[2]).toBeLessThan(good[2]!);
  });
  it("只认服务器信封，摘要或来源变化拒绝恢复，旧缓存不改变身份", () => {
    const sourceDigest = "a".repeat(64);
    const attemptSelection = {
      status: "selected_for_structuring_after_three_attempts" as const,
      policyVersion: 1 as const,
      attemptedCount: 3 as const,
      selectedAttemptNumber: 2,
      sourceDigest,
      rawSha256: nativeAttemptRawSha256(raw),
      candidates: [
        { attemptNumber: 2, reasonZh: "覆盖未过", score: [0.5, 0.5, 0, 1] },
      ],
    };
    expect(
      hasNativeAttemptSelection({ raw, sourceDigest, attemptSelection })
    ).toBe(true);
    expect(
      hasNativeAttemptSelection({
        raw: { ...raw, attemptSelection },
        sourceDigest,
      })
    ).toBe(false);
    expect(() =>
      hasNativeAttemptSelection({
        raw: { ...raw, shots: [] },
        sourceDigest,
        attemptSelection,
      })
    ).toThrow("不一致");
    expect(() =>
      hasNativeAttemptSelection({
        raw,
        sourceDigest: "b".repeat(64),
        attemptSelection,
      })
    ).toThrow("不一致");
  });
});
