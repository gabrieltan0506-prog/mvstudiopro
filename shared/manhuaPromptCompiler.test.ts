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
import {
  formatPromptForEngine,
  hasBlockingFormatIssues,
  validateSegmentMediaRefs,
} from "./promptFormatLayer";
import { buildTtsCueSheet, compileEpisode, compileSegmentPrompt } from "./manhuaPromptCompiler";

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

describe("Wan 3.0 已上线(三入口完整放行)", () => {
  it("别名归一，且不再被判为非 ready", () => {
    expect(normalizeCompilerEngineId("wan30")).toBe("wan-3.0");
    expect(normalizeCompilerEngineId("minimax-h3")).toBe("minimax-hailuo-3");
    // 0824 转 ready：方言层已接线，不再是 reserved
    expect(isReadyCompilerEngineId("wan-3.0")).toBe(true);
  });

  it("三入口都能编译，且走 wan 方言（编号化引用 + 剥 Seedance 四标记）", () => {
    const out = compileEpisode(IR, "wan-3.0");
    expect(out.segments.length).toBeGreaterThan(0);

    const seg = packShotsIntoSegments([shot(1, 5)], 15)[0]!;
    expect(() => compileSegmentPrompt(seg, "wan-3.0")).not.toThrow();

    const fmt = formatPromptForEngine("@图1 人物特写，{我来了}", "wan-3.0");
    expect(fmt.text).toContain("Image 1");
    // {} 是 Seedance 方言，留着会被当正文念出来
    expect(fmt.text).toContain("“我来了”");
    expect(fmt.text).not.toContain("{");
  });

  it("单段上限 30s，与官方一致", () => {
    const long = packShotsIntoSegments([shot(1, 15), shot(2, 15)], 30)[0]!;
    expect(() => compileSegmentPrompt(long, "wan-3.0")).not.toThrow();
  });
});

describe("H3 输出时长正式契约(4-15s 整数)", () => {
  it("段 3s 低于最短 4s:抛错要求合并镜头", () => {
    const seg = packShotsIntoSegments([shot(1, 3)], 15)[0];
    expect(() => compileSegmentPrompt(seg, "minimax-hailuo-3")).toThrow(/最短/);
  });

  it("段 4.5s 小数:H3 抛错要求整数;Seedance 不受限", () => {
    const seg = packShotsIntoSegments([shot(1, 4.5)], 15)[0];
    expect(() => compileSegmentPrompt(seg, "minimax-hailuo-3")).toThrow(/整数/);
    expect(compileSegmentPrompt(seg, "seedance-2.5")).toContain("场景:军械库");
  });
});

describe("H3 模式按参考素材决定", () => {
  it("有参考=reference_to_video;无参考=text_to_video", () => {
    const out = compileEpisode(IR, "minimax-hailuo-3");
    expect(out.referencePlans[0].mode).toBe("h3_reference_to_video");
    expect(out.referencePlans[1].mode).toBe("h3_text_to_video");
    expect(out.referencePlans[1].bindings).toHaveLength(0);
  });
});

describe("参考编号与绑定校验", () => {
  it("同编号不同职责:出 reference_conflict,绑定保留第一项", () => {
    const conflicted: EpisodeIR = {
      ...IR,
      shots: [
        shot(1, 5, { mediaRefs: [{ kind: "image", n: 1, roleZh: "谢明彰锁脸" }] }),
        shot(2, 5, { mediaRefs: [{ kind: "image", n: 1, roleZh: "库吏锁脸" }] }),
      ],
    };
    const out = compileEpisode(conflicted, "minimax-hailuo-3");
    expect(out.formatIssues.some((i) => i.kind === "reference_conflict")).toBe(true);
    expect(out.referencePlans[0].bindings).toEqual([
      { kind: "image", n: 1, roleZh: "谢明彰锁脸" },
    ]);
  });

  it("编号断号出 reference_sequence;非正整数出 reference_index", () => {
    const gapped: EpisodeIR = {
      ...IR,
      shots: [shot(1, 5, { mediaRefs: [{ kind: "image", n: 2, roleZh: "谢明彰锁脸" }] })],
    };
    const gapOut = compileEpisode(gapped, "minimax-hailuo-3");
    expect(gapOut.formatIssues.some((i) => i.kind === "reference_sequence")).toBe(true);

    const invalid: EpisodeIR = {
      ...IR,
      shots: [shot(1, 5, { mediaRefs: [{ kind: "image", n: 0, roleZh: "谢明彰锁脸" }] })],
    };
    const invalidOut = compileEpisode(invalid, "minimax-hailuo-3");
    expect(invalidOut.formatIssues.some((i) => i.kind === "reference_index")).toBe(true);
  });
});

describe("格式层问题进入总编译结果", () => {
  it("styleZh 撑到 7100 字符:H3 出 prompt_length;Seedance 无此限不报", () => {
    const longStyle: EpisodeIR = { ...IR, shots: [shot(1, 5)], styleZh: "云".repeat(7100) };
    const h3 = compileEpisode(longStyle, "minimax-hailuo-3");
    expect(h3.formatIssues.some((i) => i.kind === "prompt_length")).toBe(true);
    const seedance = compileEpisode(longStyle, "seedance-2.5");
    expect(seedance.formatIssues.some((i) => i.kind === "prompt_length")).toBe(false);
  });
});

describe("公开单段入口完整结构校验", () => {
  const validShot = shot(1, 5, { sceneZh: "升仙台", actionZh: "人物抬眼" });

  it("段时长 NaN 时拒绝编译", () => {
    expect(() =>
      compileSegmentPrompt(
        { index: 1, durationSec: Number.NaN, shots: [validShot] },
        "seedance-2.5",
      ),
    ).toThrow(/有限数字/);
  });

  it("镜头时长 NaN 时拒绝编译", () => {
    expect(() =>
      compileSegmentPrompt(
        { index: 1, durationSec: 5, shots: [{ ...validShot, durationSec: Number.NaN }] },
        "seedance-2.5",
      ),
    ).toThrow(/有限正数/);
  });

  it("段声明时长与镜头时长合计不一致时拒绝编译", () => {
    expect(() =>
      compileSegmentPrompt(
        { index: 1, durationSec: 5, shots: [validShot, { ...validShot, index: 2 }] },
        "seedance-2.5",
      ),
    ).toThrow(/时长.*不一致/);
  });

  it("空镜表拒绝编译", () => {
    expect(() =>
      compileSegmentPrompt({ index: 1, durationSec: 5, shots: [] }, "seedance-2.5"),
    ).toThrow(/至少需要一镜/);
  });

  it("镜号重复或倒序时拒绝编译", () => {
    expect(() =>
      compileSegmentPrompt(
        { index: 1, durationSec: 10, shots: [validShot, { ...validShot, index: 1 }] },
        "seedance-2.5",
      ),
    ).toThrow(/严格递增/);
  });

  it("缺场景或动作时拒绝编译", () => {
    expect(() =>
      compileSegmentPrompt(
        { index: 1, durationSec: 5, shots: [{ ...validShot, sceneZh: " " }] },
        "seedance-2.5",
      ),
    ).toThrow(/缺少场景或动作/);
  });
});

describe("空提示词与阻止提交判定", () => {
  it("空提示词产生 prompt_empty 并阻止提交", () => {
    const result = formatPromptForEngine("", "minimax-hailuo-3");
    expect(result).toEqual({
      text: "",
      issues: [{ kind: "prompt_empty", detailZh: "提示词不能为空" }],
    });
    expect(hasBlockingFormatIssues(result.issues)).toBe(true);
  });

  it("已经完成替换的 censor 记录不阻止提交", () => {
    const result = formatPromptForEngine("杀了他", "minimax-hailuo-3", { durationSec: 5 });
    expect(result.issues.some((issue) => issue.kind === "censor")).toBe(true);
    expect(hasBlockingFormatIssues(result.issues)).toBe(false);
  });

  it("格式、引用与时长问题均阻止提交", () => {
    for (const kind of [
      "prompt_length",
      "reference_conflict",
      "reference_sequence",
      "reference_index",
      "duration_min",
      "duration_max",
      "duration_integer",
    ]) {
      expect(hasBlockingFormatIssues([{ kind, detailZh: "测试问题" }])).toBe(true);
    }
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
