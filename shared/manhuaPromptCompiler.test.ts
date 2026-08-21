/**
 * 防废片编译器测试(终审十一条):IR 不因引擎改写/拆镜抛错/双方言字段保全/
 * H3 三类参考与上限/TTS 起止秒位/Wan 预留不产伪实现。
 */
import { describe, expect, it } from "vitest";
import {
  COMPILER_IR_MAX_SHOT_SEC,
  isReadyCompilerEngineId,
  normalizeCompilerEngineId,
  packShotsIntoSegments,
  type EpisodeIR,
  type ShotIR,
  type ShotMediaRef,
} from "./manhuaShotIR";
import { validateSegmentMediaRefs } from "./promptFormatLayer";
import { buildTtsCueSheet, compileEpisode } from "./manhuaPromptCompiler";

const shot = (index: number, sec: number, over: Partial<ShotIR> = {}): ShotIR => ({
  index,
  durationSec: sec,
  sceneZh: "军械库",
  actionZh: `第${index}镜动作`,
  ...over,
});

const IR: EpisodeIR = {
  episodeIndex: 1,
  genreZh: "古风武侠",
  styleZh: "雨夜冷青色调,烛光侧光,竖屏电影感",
  shots: [
    shot(1, 5, {
      cameraZh: "侧向跟拍",
      microExpressionZh: "瞳孔骤缩",
      dialogue: { speakerZh: "谢明彰", textZh: "放你可以,向警方自首", emotionZh: "压着怒意" },
      mediaRefs: [
        { kind: "image", n: 1, roleZh: "谢明彰锁脸" },
        { kind: "audio", n: 1, roleZh: "谢明彰声线" },
      ],
    }),
    shot(2, 4, { sfxZh: "雨打伞棚", mediaRefs: [{ kind: "video", n: 1, roleZh: "动作轨迹" }] }),
    shot(3, 6, { dialogue: { speakerZh: "库吏", textZh: "我认罪" } }),
    shot(4, 5),
    shot(5, 5),
    shot(6, 5),
  ],
};

describe("IR 不因引擎切换被改写", () => {
  it("15s/30s 引擎:镜数/镜号/时长/场景/动作全等,只许段边界变化", () => {
    const seg30 = packShotsIntoSegments(IR.shots, 30);
    const seg15 = packShotsIntoSegments(IR.shots, 15);
    expect(seg30).toHaveLength(1);
    expect(seg15).toHaveLength(2);
    const flat30 = seg30.flatMap((s) => s.shots);
    const flat15 = seg15.flatMap((s) => s.shots);
    expect(flat15.map((s) => [s.index, s.durationSec, s.sceneZh, s.actionZh])).toEqual(
      flat30.map((s) => [s.index, s.durationSec, s.sceneZh, s.actionZh]),
    );
  });

  it("单镜超过 IR 上限 15s:抛错要求拆镜,不静默钳制", () => {
    expect(() => packShotsIntoSegments([shot(1, COMPILER_IR_MAX_SHOT_SEC + 5)], 30)).toThrow(
      /请先拆镜/,
    );
  });

  it("非法时长/无效箱上限抛错", () => {
    expect(() => packShotsIntoSegments([shot(1, 0)], 15)).toThrow(/正数/);
    expect(() => packShotsIntoSegments(IR.shots, 1)).toThrow(/无效的单段时长上限/);
  });
});

describe("双方言字段保全", () => {
  it("Seedance:场景/动作/运镜/表演/{}对白/<>音效/@图@音频职责全在", () => {
    const p = compileEpisode(IR, "seedance-2.5").segmentPrompts[0];
    for (const part of [
      "场景:军械库", "动作:第1镜动作", "运镜:侧向跟拍", "表演:瞳孔骤缩",
      "{放你可以,向警方自首}", "<雨打伞棚>",
      "@图1 定义谢明彰锁脸", "@音频1 定义谢明彰声线", "@视频1 定义动作轨迹",
      "【第01段·30s】",
    ]) {
      expect(p).toContain(part);
    }
  });

  it("H3:同字段自然语言保全;Image/Video/Audio N;无 @标记与 {}<>【】()", () => {
    const out = compileEpisode(IR, "minimax-hailuo-3");
    expect(out.segments).toHaveLength(2);
    const all = out.segmentPrompts.join("\n");
    for (const part of [
      "场景为军械库", "人物动作是第1镜动作", "镜头侧向跟拍", "瞳孔骤缩",
      "“放你可以,向警方自首”", "环境声为雨打伞棚",
      "Image 1 仅用于谢明彰锁脸", "Audio 1 仅用于谢明彰声线", "Video 1 仅用于动作轨迹",
    ]) {
      expect(all).toContain(part);
    }
    expect(all).not.toMatch(/@图|@视频|@音频/);
    expect(all).not.toMatch(/[{}<>【】()（）]/);
  });
});

describe("H3 多模态参考上限(validateSegmentMediaRefs)", () => {
  const H3_LIMITS = {
    image: 9, video: 3, audio: 3, total: 12,
    minVideoItemSec: 2, maxVideoItemSec: 15, maxVideoTotalSec: 15,
    minAudioItemSec: 2, maxAudioItemSec: 15, maxAudioTotalSec: 15,
  };
  const refs = (kind: "image" | "video" | "audio", count: number, durationSec?: number): ShotMediaRef[] =>
    Array.from({ length: count }, (_v, i) => ({ kind, n: i + 1, roleZh: `${kind}${i + 1}`, durationSec }));

  it("9图/3视频/3音频/合计12 全通过", () => {
    expect(
      validateSegmentMediaRefs([...refs("image", 9), ...refs("video", 2, 5), ...refs("audio", 1, 5)], H3_LIMITS),
    ).toEqual([]);
  });

  it("10图/4视频/4音频/合计13 各出对应 issue", () => {
    expect(validateSegmentMediaRefs(refs("image", 10), H3_LIMITS).map((i) => i.kind)).toContain("image_refs");
    expect(validateSegmentMediaRefs(refs("video", 4, 3), H3_LIMITS).map((i) => i.kind)).toContain("video_refs");
    expect(validateSegmentMediaRefs(refs("audio", 4, 3), H3_LIMITS).map((i) => i.kind)).toContain("audio_refs");
    const thirteen = [...refs("image", 8), ...refs("video", 3, 4), ...refs("audio", 2, 4)];
    expect(validateSegmentMediaRefs(thirteen, H3_LIMITS).map((i) => i.kind)).toContain("total_refs");
  });

  it("视频/音频合计超 15s 出 total_duration;单段短于 2s 出 duration", () => {
    expect(validateSegmentMediaRefs(refs("video", 3, 6), H3_LIMITS).map((i) => i.kind)).toContain(
      "video_total_duration",
    );
    expect(validateSegmentMediaRefs(refs("audio", 3, 6), H3_LIMITS).map((i) => i.kind)).toContain(
      "audio_total_duration",
    );
    expect(validateSegmentMediaRefs(refs("audio", 1, 1), H3_LIMITS).map((i) => i.kind)).toContain(
      "audio_duration",
    );
  });

  it("compileEpisode 把超限问题带 segmentIndex 上抛进 formatIssues,并出 referencePlans", () => {
    const bad: EpisodeIR = {
      ...IR,
      shots: [shot(1, 5, { mediaRefs: refs("video", 4, 3) })],
    };
    const out = compileEpisode(bad, "minimax-hailuo-3");
    expect(out.formatIssues.some((i) => i.kind === "video_refs" && i.segmentIndex === 1)).toBe(true);
    expect(out.referencePlans[0]).toMatchObject({ segmentIndex: 1, mode: "h3_reference_to_video" });
    expect(out.referencePlans[0].bindings).toHaveLength(4);
  });
});

describe("TTS 起止秒位", () => {
  it("每条含 startSec/endSec,end>start 且不超所在段时长", () => {
    const segs = packShotsIntoSegments(IR.shots, 30);
    const cues = buildTtsCueSheet(segs);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ startSec: 0, endSec: 5, speakerZh: "谢明彰" });
    expect(cues[1]).toMatchObject({ startSec: 9, endSec: 15, speakerZh: "库吏" });
    for (const c of cues) {
      const seg = segs.find((s) => s.index === c.segmentIndex)!;
      expect(c.endSec).toBeGreaterThan(c.startSec);
      expect(c.endSec).toBeLessThanOrEqual(seg.durationSec);
    }
  });
});

describe("Wan 3.0 预留边界", () => {
  it("别名归一/非 ready/编译明确拒绝,不产伪提示词", () => {
    expect(normalizeCompilerEngineId("wan30")).toBe("wan-3.0");
    expect(normalizeCompilerEngineId("minimax-h3")).toBe("minimax-hailuo-3");
    expect(isReadyCompilerEngineId("wan-3.0")).toBe(false);
    expect(() => compileEpisode(IR, "wan-3.0")).toThrow(/预留|尚未接线/);
  });
});

describe("IR 入口校验", () => {
  it("空镜表/镜号不连续/缺场景动作都抛错", () => {
    expect(() => compileEpisode({ ...IR, shots: [] }, "seedance-2.5")).toThrow(/至少需要一镜/);
    expect(() =>
      compileEpisode({ ...IR, shots: [shot(2, 5)] }, "seedance-2.5"),
    ).toThrow(/连续排列/);
    expect(() =>
      compileEpisode({ ...IR, shots: [shot(1, 5, { sceneZh: " " })] }, "seedance-2.5"),
    ).toThrow(/缺少场景或动作/);
  });
});
