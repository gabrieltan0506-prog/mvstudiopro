import { describe, expect, it } from "vitest";
import type { AdvisorFilmReview } from "@shared/manhuaAdvisorFilmReview";
import {
  buildFilmReviewTimeline,
  filmTimelineWarnings,
} from "./filmReviewTimeline";

const report = (analysis: Record<string, unknown>): AdvisorFilmReview => ({
  kind: "film_review_v1",
  summary: "原片审阅",
  findings: [],
  limitations: "待核对",
  nativeEvidence: { analysis, sourceGeneration: "7", audioTokens: 100 },
});
describe("原生音画证据的只读投影", () => {
  it("保留各音轨块的绝对秒位、镜头细节与所有重点，不改写原始记录", () => {
    const r = report({
      shots: [
        {
          startSec: 4.1,
          endSec: 12.2,
          hintZh: "举起望远镜",
          lightingZh: "冷暖反差",
          gazeBreathZh: "警觉屏息",
        },
      ],
      audioResolution: [
        {
          chunkIndex: 0,
          analysis: {
            mixNotesZh: "音效前置",
            audioTrack: [
              {
                fromSec: 0,
                toSec: 12,
                bgmZh: "弦乐",
                cues: [{ atSec: 9, kind: "sfx", detailZh: "声压突增" }],
              },
            ],
          },
        },
        {
          chunkIndex: 1,
          analysis: {
            audioTrack: [
              {
                fromSec: 12,
                toSec: 25,
                silenceZh: "短暂停顿",
                cues: [{ atSec: 19, detailZh: "倒吸气" }],
              },
            ],
          },
        },
      ],
      keyMoments: [{ atSec: 12.5, kindZh: "剧情", noteZh: "发现古船" }],
      subtitles: [{ atSec: 14, textZh: "等等" }],
      beatStructureZh: "发现→行动",
    });
    const before = JSON.stringify(r),
      t = buildFilmReviewTimeline(r);
    expect(t.shots[0].fields).toContainEqual({
      label: "眼神与呼吸",
      text: "警觉屏息",
    });
    expect(t.audio.map(v => [v.startSec, v.endSec])).toEqual([
      [0, 12],
      [12, 25],
    ]);
    expect(t.cues.map(v => v.atSec)).toEqual([9, 12.5, 14, 19]);
    expect(t.beat).toBe("发现→行动");
    expect(t.cues[0].title).toBe("音效");
    expect(t.audioNotes).toContainEqual({
      label: "混音观察",
      text: "音效前置",
    });
    expect(t.warnings).toEqual([]);
    expect(JSON.stringify(r)).toBe(before);
  });
  it("异常时间明确告警，不补造镜头、不把字符数字冒充秒位", () => {
    const t = buildFilmReviewTimeline(
      report({
        shots: [
          null,
          { startSec: "0", endSec: 2 },
          { startSec: 3, endSec: 2 },
          { startSec: 4, endSec: 6 },
        ],
        audioResolution: [
          null,
          {
            analysis: {
              audioTrack: [{ fromSec: 2, toSec: 2, cues: [{ atSec: -1 }] }],
            },
          },
        ],
        keyMoments: [{ atSec: Number.NaN }],
      })
    );
    expect(t.shots).toHaveLength(1);
    expect(t.shots[0].fields).toEqual([]);
    expect(t.audio).toEqual([]);
    expect(t.cues).toEqual([]);
    expect(t.warnings).toHaveLength(6);
  });
  it("越界保持原秒位、合并重叠区间算缺口，不能以覆盖证明内容准确", () => {
    const t = buildFilmReviewTimeline(
      report({
        shots: [
          { startSec: 0, endSec: 10 },
          { startSec: 8, endSec: 12 },
          { startSec: 14, endSec: 60 },
        ],
      })
    );
    const warnings = filmTimelineWarnings(t.shots, 59.68, "画面");
    expect(warnings).toHaveLength(2);
    expect(warnings.join(" ")).toContain("12.0–14.0");
    expect(warnings.join(" ")).toContain("59.68");
    expect(t.shots[2].endSec).toBe(60);
    expect(filmTimelineWarnings([], 5, "声音")[0]).toContain("缺少记录");
  });
  it("兼容旧审片结果；原生结果缺失时不冒用另一套观察来补齐", () => {
    const legacy: AdvisorFilmReview = {
      kind: "film_review_v1",
      summary: "旧版",
      findings: [],
      limitations: "待核对",
      observerEvidence: {
        analysis: {
          summaryZh: "旧版",
          shots: [{ startSec: 0, endSec: 4, descriptionZh: "旧镜头" }],
          audioSegments: [{ startSec: 0, endSec: 4, descriptionZh: "旧音轨" }],
          subtitles: [],
          findings: [],
        },
        validation: {
          audioIntervalCoverage: { ratio: 1 },
          visualIntervalCoverage: { ratio: 1 },
          warnings: [],
        },
        sourceGeneration: "2",
        audioTokens: null,
      },
    };
    expect(buildFilmReviewTimeline(legacy).audio[0].fields[0].text).toBe(
      "旧音轨"
    );
    expect(
      buildFilmReviewTimeline({
        ...legacy,
        nativeEvidence: report({}).nativeEvidence,
      }).shots
    ).toEqual([]);
    expect(
      buildFilmReviewTimeline({
        kind: "film_review_v1",
        summary: "无证据",
        findings: [],
        limitations: "未提供",
      }).shots
    ).toEqual([]);
  });
});
