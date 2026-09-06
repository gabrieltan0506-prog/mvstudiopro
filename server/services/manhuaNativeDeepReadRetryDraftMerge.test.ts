import { describe, expect, it } from "vitest";
import { mergeNativeDeepReadRetryDrafts } from "./manhuaNativeDeepReadRetryDraftMerge";

const shot = (startSec: number, endSec: number, hintZh: string) => ({ startSec, endSec, evidenceRole: "story", hintZh, actionZh: `动作${startSec}` });
const km = (atSec: number, kindZh = "转折") => ({ atSec, kindZh, whyZh: `为何${atSec}` });
const sub = (atSec: number, textZh: string) => ({ atSec, textZh });
const audio = (tracks: Array<{ fromSec: number; toSec: number; cues: Array<{ atSec: number; kind: string; detailZh: string }> }>) =>
  [{ chunkIndex: 0, analysis: { audioTrack: tracks.map((t) => ({ ...t, emotionArcZh: "x", toneZh: "y" })) } }];

describe("0906 · 重试稿合并（底稿一字不改，其他稿只补缺）", () => {
  it("过门禁稿为底：补入不重叠镜头/不重复重点时刻/字幕/声音事件，撞位置的丢弃，底稿行原样", () => {
    const base = {
      shots: [shot(0, 10, "甲"), shot(20, 30, "乙")],
      keyMoments: [km(5)],
      subtitles: [sub(3, "你好")],
      audioResolution: audio([{ fromSec: 0, toSec: 30, cues: [{ atSec: 4, kind: "sfx", detailZh: "门响" }] }]),
      beatStructureZh: "", moodArcZh: "底稿情绪", reusableZh: "底稿手法", genPromptHintZh: "底稿要素",
    };
    const other = {
      shots: [shot(0, 10, "甲改写"), shot(10, 20, "丙"), shot(25, 35, "撞乙")],
      keyMoments: [km(6), km(15)],
      subtitles: [sub(3.5, "你好"), sub(12, "再见")],
      audioResolution: audio([{ fromSec: 0, toSec: 30, cues: [{ atSec: 4.5, kind: "sfx", detailZh: "门响重复" }, { atSec: 18, kind: "bgm", detailZh: "鼓点" }] }]),
      beatStructureZh: "他稿节奏", moodArcZh: "他稿情绪",
      gateMarked: true, gateMarkedZh: "被拒",
    };
    const merged = mergeNativeDeepReadRetryDrafts({
      segmentIndex: 0, startSec: 0, endSec: 30,
      drafts: [{ attemptNumber: 1, raw: other, passedGate: false }, { attemptNumber: 2, raw: base, passedGate: true }],
    });
    expect(merged.stats.baseAttemptNumber).toBe(2);
    expect(merged.stats.mergedFromAttempts).toEqual([1]);
    // 镜头：丙补入；「甲改写」与「撞乙」撞位置丢弃（撞乙还越界）
    expect((merged.raw.shots as Array<{ hintZh: string }>).map((s) => s.hintZh)).toEqual(["甲", "丙", "乙"]);
    expect(merged.stats.addedShots).toBe(1);
    // 重点时刻：6 秒与 5 秒同类在 ±2 秒内丢弃；15 秒补入
    expect((merged.raw.keyMoments as Array<{ atSec: number }>).map((r) => r.atSec)).toEqual([5, 15]);
    // 字幕：3.5「你好」重复丢弃；12「再见」补入
    expect((merged.raw.subtitles as Array<{ atSec: number }>).map((r) => r.atSec)).toEqual([3, 12]);
    // 声音事件：4.5 sfx 重复丢弃；18 bgm 补进底稿音轨段
    const cues = (merged.raw.audioResolution as Array<{ analysis: { audioTrack: Array<{ cues: Array<{ atSec: number }> }> } }>)[0]!.analysis.audioTrack[0]!.cues;
    expect(cues.map((c) => c.atSec)).toEqual([4, 18]);
    expect(merged.stats.addedAudioCues).toBe(1);
    // 总结：底稿空的 beatStructureZh 用他稿补；moodArcZh 底稿有则不动
    expect(merged.raw.beatStructureZh).toBe("他稿节奏");
    expect(merged.raw.moodArcZh).toBe("底稿情绪");
    expect(merged.stats.filledProseFields).toEqual(["beatStructureZh"]);
    expect(merged.raw.gateMarked).toBeUndefined();
    expect(merged.summaryZh).toContain("以第2稿为底");
    expect(merged.stats.droppedRecords).toBe(5);
  });

  it("三稿都没过：调用方指定底稿；少于两稿报错", () => {
    const a = { shots: [shot(0, 5, "a")] }; const b = { shots: [shot(5, 10, "b")] }; const c = { shots: [shot(10, 15, "c")] };
    const merged = mergeNativeDeepReadRetryDrafts({ segmentIndex: 2, startSec: 0, endSec: 15, baseAttemptNumber: 3,
      drafts: [{ attemptNumber: 1, raw: a, passedGate: false }, { attemptNumber: 2, raw: b, passedGate: false }, { attemptNumber: 3, raw: c, passedGate: false }] });
    expect(merged.stats.baseAttemptNumber).toBe(3);
    expect((merged.raw.shots as Array<{ hintZh: string }>).map((s) => s.hintZh)).toEqual(["a", "b", "c"]);
    expect(() => mergeNativeDeepReadRetryDrafts({ segmentIndex: 0, startSec: 0, endSec: 1, drafts: [{ attemptNumber: 1, raw: a, passedGate: true }] })).toThrow("至少需要两份稿");
  });
});
