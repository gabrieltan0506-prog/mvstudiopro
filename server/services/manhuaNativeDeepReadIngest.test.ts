import { describe, expect, it } from "vitest";
import {
  NATIVE_DEEP_READ_MIN_SHOTS,
  buildNativeDeepReadProposalCard,
  checkNativeDeepReadIngestable,
  nativeDeepReadProposalId,
  nativeDeepReadProposalObjectName,
  parseNativeDeepReadEpisodeIndex,
  type NativeDeepReadIngestSource,
} from "./manhuaNativeDeepReadIngest";
import { describeManhuaTemplateLearnSourceZh } from "../../shared/manhuaViralTemplateBank";
import { noAudioManhuaNativeAnalysis } from "../../shared/manhuaNativeAudioAnalysis";

function makeResult(over: Partial<NativeDeepReadIngestSource> = {}): NativeDeepReadIngestSource {
  const beatGrid = Array.from({ length: 12 }, (_, i) => ({
    atSec: i,
    endSec: i + 1,
    conflictZh: "0-2秒憋住，17秒闪白爆点",
    visualZh: `第${i}镜可拍动作`,
    shotSizeZh: i === 0 ? "特写" : "中景",
    cameraMoveZh: "固定机位",
    lightingZh: "暗调暖橙背光",
    transitionInZh: "硬切",
  }));
  return {
    beatGrid,
    subtitleTrack: [],
    resolvedAudioChunks: [],
    classification: {
      emotionTagsZh: ["压迫渐强"],
      narrativeFeatureTagsZh: ["信息递进"],
      performanceTagsZh: ["克制爆发"],
      audiovisualTagsZh: ["冷暖对撞"],
      audienceExperienceTagsZh: ["持续紧张"],
    },
    audioAnalysis: noAudioManhuaNativeAnalysis(1080),
    reusableZh: "力量不拍光效拍环境反应",
    genPromptHintZh: "写明光位、氛围粒子、景别序列",
    moodArcZh: "起点紧张→17秒炽热→31秒回落",
    beatStructureZh: "憋6秒，17秒爆，爆后硬切收",
    segmentCount: 6,
    shotCount: beatGrid.length,
    failedSegmentCount: 0,
    droppedCount: 0,
    truncated: false,
    model: "qwen3.8-max",
    attemptedSegments: 6,
    usingPlanQuota: true,
    usage: { costCny: 1.5 },
    ...over,
  };
}

const baseInput = {
  seriesKey: "abc123",
  episodeIndex: 3,
  sourceUrl: "https://example.com/v/1",
  durationSec: 1080,
  laneHintZh: "逆袭 打脸",
};

describe("入库对象名与 id", () => {
  it("id 与对象名同源，集号补零到三位", () => {
    expect(nativeDeepReadProposalId("abc123", 3)).toBe("tpl_native_abc123_ep003");
    expect(nativeDeepReadProposalObjectName("abc123", 3)).toBe(
      "manhua-template-learn/proposals/tpl_native_abc123_ep003.json",
    );
  });

  it("非法 seriesKey 与非 1-based 集号直接拒绝，不静默改写成别的卡", () => {
    // 剥非法字符会让 "a/b" 与 "ab" 落到同一张卡，后写的覆盖先写的且不报错
    expect(() => nativeDeepReadProposalId("a/b?c#1", 1)).toThrow("seriesKey");
    expect(() => nativeDeepReadProposalId("abc123", 0)).toThrow("episodeIndex");
    expect(() => nativeDeepReadProposalId("abc123", 1000)).toThrow("episodeIndex");
  });

  it("对象名能反解回集号——断点续跑靠它，写入与查询必须对得上", () => {
    const name = nativeDeepReadProposalObjectName("abc123", 17);
    expect(parseNativeDeepReadEpisodeIndex(name, "abc123")).toBe(17);
  });

  it("别的合集或别的来源的卡不会被误认成本合集已完成", () => {
    const other = nativeDeepReadProposalObjectName("zzz999", 4);
    expect(parseNativeDeepReadEpisodeIndex(other, "abc123")).toBeNull();
    expect(
      parseNativeDeepReadEpisodeIndex("manhua-template-learn/proposals/tpl_series_abc123.json", "abc123"),
    ).toBeNull();
  });
});

describe("入库门禁", () => {
  it("正常产出放行", () => {
    expect(checkNativeDeepReadIngestable(makeResult())).toEqual({ ok: true });
  });

  it("全段失败拒收——空卡比没有卡更浪费审批人时间", () => {
    const r = checkNativeDeepReadIngestable(
      makeResult({ segmentCount: 0, failedSegmentCount: 6, beatGrid: [] }),
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reasonZh).toContain("全部 6 段");
  });

  it("镜头数低于下限拒收", () => {
    const beatGrid = makeResult().beatGrid.slice(0, NATIVE_DEEP_READ_MIN_SHOTS - 1);
    const r = checkNativeDeepReadIngestable(makeResult({ beatGrid, shotCount: beatGrid.length }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reasonZh).toContain("没学到");
  });

  it("触顶抽稀不拦：学得多不该整集丢掉，卡面标出来即可", () => {
    expect(checkNativeDeepReadIngestable(makeResult({ truncated: true }))).toEqual({ ok: true });
  });

  it("六个空镜头不能靠数组长度绕过门禁——解析器会把它们全滤掉，落库变空卡", () => {
    const beatGrid = Array.from({ length: NATIVE_DEEP_READ_MIN_SHOTS }, (_, i) => ({
      atSec: i,
      conflictZh: "",
      visualZh: "",
    }));
    const r = checkNativeDeepReadIngestable(makeResult({ beatGrid, shotCount: beatGrid.length }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reasonZh).toContain("有效镜头");
  });

  it("来源计数互相矛盾时拒收，不写假账 provenance", () => {
    expect(checkNativeDeepReadIngestable(makeResult({ failedSegmentCount: 1 })).ok).toBe(false);
    expect(checkNativeDeepReadIngestable(makeResult({ shotCount: 99 })).ok).toBe(false);
    expect(checkNativeDeepReadIngestable(makeResult({ model: "" })).ok).toBe(false);
    expect(checkNativeDeepReadIngestable(makeResult({ attemptedSegments: 0 })).ok).toBe(false);
  });

  it("五维分类缺任一维都拒收，不让单维标签冒充完整收费模板", () => {
    const incomplete = makeResult().classification!;
    const result = checkNativeDeepReadIngestable(makeResult({
      classification: { ...incomplete, audiovisualTagsZh: [] },
    }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reasonZh).toContain("五维特征标签不完整");
  });

  it("一片成功即可形成可追溯的部分提案，剩余分片继续断点学习", () => {
    const partial = makeResult({
      segmentCount: 1,
      failedSegmentCount: 5,
      completedSegmentIndexes: [0],
      sourceDigest: "a".repeat(64),
      segmentSnapshotSha256: "b".repeat(64),
      assemblyComplete: false,
    });
    expect(checkNativeDeepReadIngestable(partial)).toEqual({ ok: true });
    const card = buildNativeDeepReadProposalCard({ ...baseInput, result: partial })!;
    expect(card.status).toBe("proposed");
    expect(card.summaryZh).toContain("1/6段已入库，余段待续");
    expect(card.provenance?.nativeVideoDeepRead).toMatchObject({
      successSegments: 1,
      attemptedSegments: 6,
      completedSegmentIndexes: [0],
      assemblyComplete: false,
      sourceDigest: "a".repeat(64),
      snapshotSha256: "b".repeat(64),
    });
  });

  it("部分提案只接受从第一片开始的连续断点，禁止用错位段冒充进度", () => {
    const result = checkNativeDeepReadIngestable(makeResult({
      segmentCount: 1,
      failedSegmentCount: 5,
      completedSegmentIndexes: [1],
      sourceDigest: "a".repeat(64),
      segmentSnapshotSha256: "b".repeat(64),
      assemblyComplete: false,
    }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reasonZh).toContain("不是从第1片开始");
  });
});

describe("装卡", () => {
  it("卡面每栏都来自精读产出，不是套话", () => {
    const card = buildNativeDeepReadProposalCard({ ...baseInput, result: makeResult() })!;
    expect(card).toBeTruthy();
    expect(card.id).toBe("tpl_native_abc123_ep003");
    expect(card.status).toBe("proposed");
    expect(card.beatGrid).toHaveLength(12);
    expect(card.reusableZh).toContain("力量不拍光效");
    expect(card.genPromptHintZh).toContain("光位");
    // 钩子取真实首 3 秒的镜头，不写「开场即冲突」这类通用话
    expect(card.hook3sZh).toContain("特写");
    expect(card.hook3sZh).toContain("第0镜可拍动作");
    // 摘要先摆事实，再接学到的情绪线
    expect(card.summaryZh).toContain("原生精读12镜");
    expect(card.summaryZh).toContain("6/6段");
    expect(card.summaryZh).toContain("18分钟");
    expect(card.summaryZh).toContain("17秒炽热");
  });

  it("nameZh 中性：只有赛道与集号，不带外部剧名", () => {
    const card = buildNativeDeepReadProposalCard({
      ...baseInput,
      laneHintZh: "某某外部剧名 逆袭",
      result: makeResult(),
    })!;
    expect(card.nameZh).toBe("多维标签·原生第3集节奏");
    expect(card.nameZh).not.toContain("某某外部剧名");
  });

  it("castShape 精读学不到，写「待补」而不是编一个", () => {
    const card = buildNativeDeepReadProposalCard({ ...baseInput, result: makeResult() })!;
    expect(card.castShape.leadDesireZh.startsWith("待补")).toBe(true);
    expect(card.castShape.pressureZh.startsWith("待补")).toBe(true);
  });

  it("provenance 必须活着落库——曾因空判据白名单漏字段被静默吞掉", () => {
    const card = buildNativeDeepReadProposalCard({
      ...baseInput,
      result: makeResult({ droppedCount: 3, truncated: true, usingPlanQuota: false }),
    })!;
    const p = card.provenance?.nativeVideoDeepRead;
    expect(p).toBeTruthy();
    expect(p!.model).toBe("qwen3.8-max");
    expect(p!.shotCount).toBe(12);
    expect(p!.successSegments).toBe(6);
    expect(p!.attemptedSegments).toBe(6);
    expect(p!.droppedCount).toBe(3);
    expect(p!.truncated).toBe(true);
    expect(p!.usingPlanQuota).toBe(false);
    expect(p!.costCny).toBeCloseTo(1.5);
  });

  it("来源摘要把丢镜与抽稀露出来，审批人不会盲批", () => {
    const card = buildNativeDeepReadProposalCard({
      ...baseInput,
      result: makeResult({ droppedCount: 3, truncated: true, usingPlanQuota: false }),
    })!;
    const zh = describeManhuaTemplateLearnSourceZh(card.provenance)!;
    expect(zh).toContain("原生精读");
    expect(zh).toContain("qwen3.8-max");
    expect(zh).toContain("丢弃3镜");
    expect(zh).toContain("触顶抽稀");
    expect(zh).toContain("按量付费");
  });

  it("来源摘要能分辨抽帧卡", () => {
    const zh = describeManhuaTemplateLearnSourceZh({
      frameVision: { provider: "openai", model: "gpt-5", attemptedChunks: 9, successChunks: 8 },
    })!;
    expect(zh).toContain("抽帧读图");
    expect(zh).toContain("8/9块");
    expect(zh).not.toContain("原生精读");
  });

  it("不合门禁返回 null，不产出半截卡", () => {
    expect(
      buildNativeDeepReadProposalCard({
        ...baseInput,
        result: makeResult({ segmentCount: 0, beatGrid: [] }),
      }),
    ).toBeNull();
  });

  it("来源地址为空时不装卡——说不清出处的卡不该进库", () => {
    expect(
      buildNativeDeepReadProposalCard({ ...baseInput, sourceUrl: "   ", result: makeResult() }),
    ).toBeNull();
  });

  it("来源地址进 sourceRefs 溯源，但不进任何提示词栏", () => {
    const card = buildNativeDeepReadProposalCard({ ...baseInput, result: makeResult() })!;
    expect(card.sourceRefs[0]!.url).toBe("https://example.com/v/1");
    expect(card.sourceRefs[0]!.noteZh).toContain("第3集");
    expect(`${card.reusableZh}${card.genPromptHintZh}${card.hook3sZh}${card.summaryZh}`)
      .not.toContain("example.com");
  });
});
