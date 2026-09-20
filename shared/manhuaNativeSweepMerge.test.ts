import { describe, expect, it } from "vitest";
import { mergeManhuaNativeSweepCandidates } from "./manhuaNativeSweepMerge.js";
import { nativeDeepReadSegmentSchema } from "./manhuaNativeDeepRead.js";

/**
 * 🔴 fixture **按 zod 真源造，不按实现造**（0920 那轮 8 条测试全绿却漏掉 kindZh，
 * 根因正是照着自己的实现写 `{atSec, noteZh}`）。下面这条先让 zod 确认形状。
 */
const GEMINI = [
  { atSec: 12.4, kindZh: "切镜", noteZh: "硬切进特写，情绪一刀到位" },
  { atSec: 88.0, kindZh: "情绪", noteZh: "沉默三秒后爆发" },
];
const STORY = [{ startSec: 0, endSec: 300 }];

it("fixture 形状与 zod 真源一致（keyMoments 必有 kindZh）", () => {
  const parsed = nativeDeepReadSegmentSchema.safeParse({
    shots: [], subtitles: [], audioResolution: [],
    keyMoments: GEMINI, beatStructureZh: "x", moodArcZh: "y",
  });
  expect(parsed.success).toBe(true);
  expect(parsed.success && parsed.data.keyMoments?.[0]?.kindZh).toBe("切镜");
});

describe("整形前补扫合并", () => {
  it("只增不减：Gemini 条目逐条原样保留", () => {
    const out = mergeManhuaNativeSweepCandidates({
      geminiKeyMoments: GEMINI, storyRanges: STORY,
      candidates: [{ atSec: 150, kindZh: "灯光", noteZh: "顶光压下来，脸一半没进光里" }],
    });
    for (const g of GEMINI) {
      expect(out.keyMoments).toContainEqual(expect.objectContaining({
        atSec: g.atSec, kindZh: g.kindZh, noteZh: g.noteZh,
      }));
    }
    expect(out.keyMoments.length).toBe(GEMINI.length + 1);
    expect(out.addedCount).toBe(1);
  });

  it("补进来的条目必须写得出 kindZh（否则下游抽帧会静默丢掉）", () => {
    const out = mergeManhuaNativeSweepCandidates({
      geminiKeyMoments: [], storyRanges: STORY,
      candidates: [{ atSec: 10, kindZh: "剧情", noteZh: "反转落点" }],
    });
    expect(out.keyMoments[0]!.kindZh).toBe("剧情");
    expect(String(out.keyMoments[0]!.kindZh || "").trim()).not.toBe("");
  });

  it("kindZh 不在五类白名单内 → 不收", () => {
    const out = mergeManhuaNativeSweepCandidates({
      geminiKeyMoments: [], storyRanges: STORY,
      candidates: [{ atSec: 10, kindZh: "构图", noteZh: "对角线构图" }],
    });
    expect(out.addedCount).toBe(0);
    expect(out.dropped[0]!.reason).toBe("kind_not_allowed");
  });

  it("音轨类不收（用户：音频 GLM Flash 读不了）", () => {
    const out = mergeManhuaNativeSweepCandidates({
      geminiKeyMoments: [], storyRanges: STORY,
      candidates: [{ atSec: 10, kindZh: "音轨", noteZh: "低频轰鸣压上来" }],
    });
    expect(out.addedCount).toBe(0);
    expect(out.dropped[0]!.reason).toBe("kind_audio_not_readable");
  });

  it("说不出「精彩在哪」→ 不收", () => {
    const out = mergeManhuaNativeSweepCandidates({
      geminiKeyMoments: [], storyRanges: STORY,
      candidates: [{ atSec: 10, kindZh: "切镜", noteZh: "   " }],
    });
    expect(out.dropped[0]!.reason).toBe("note_missing");
  });

  it("Gemini 已列入的秒位不重复补", () => {
    const out = mergeManhuaNativeSweepCandidates({
      geminiKeyMoments: GEMINI, storyRanges: STORY,
      candidates: [{ atSec: 12.4, kindZh: "灯光", noteZh: "同一秒换个类别也不补" }],
    });
    expect(out.addedCount).toBe(0);
    expect(out.dropped[0]!.reason).toBe("already_in_gemini");
  });

  it("广告 / 商品宣传两道闸：落在广告区间的、以及判词命中的，都不收", () => {
    const byRange = mergeManhuaNativeSweepCandidates({
      geminiKeyMoments: [], storyRanges: [{ startSec: 0, endSec: 300 }],
      excludedAdRanges: [{ startSec: 0, endSec: 20 }],
      candidates: [{ atSec: 10, kindZh: "剧情", noteZh: "这一刀很漂亮" }],
    });
    expect(byRange.dropped[0]!.reason).toBe("ad_or_promo");
    const byWord = mergeManhuaNativeSweepCandidates({
      geminiKeyMoments: [], storyRanges: STORY,
      candidates: [{ atSec: 150, kindZh: "剧情", noteZh: "主角举起商品对镜头介绍" }],
    });
    expect(byWord.dropped[0]!.reason).toBe("ad_or_promo");
    const bySubtitle = mergeManhuaNativeSweepCandidates({
      geminiKeyMoments: [], storyRanges: STORY,
      candidates: [{ atSec: 150, kindZh: "剧情", noteZh: "情绪爆点", subtitleZh: "点击下单立享折扣" }],
    });
    expect(bySubtitle.dropped[0]!.reason).toBe("ad_or_promo");
  });

  it("必须与剧情相关：落在 story 镜区间之外 → 不收", () => {
    const out = mergeManhuaNativeSweepCandidates({
      geminiKeyMoments: [], storyRanges: [{ startSec: 100, endSec: 200 }],
      candidates: [{ atSec: 50, kindZh: "剧情", noteZh: "片头版权卡后的一刀" }],
    });
    expect(out.addedCount).toBe(0);
    expect(out.dropped[0]!.reason).toBe("not_story_related");
  });

  it("字幕原文随条目带下去（用户：只能读视频字幕并截图）", () => {
    const out = mergeManhuaNativeSweepCandidates({
      geminiKeyMoments: [], storyRanges: STORY,
      candidates: [{ atSec: 150, kindZh: "剧情", noteZh: "摊牌", subtitleZh: "我等这一天很久了" }],
    });
    expect(out.keyMoments[0]!.subtitleZh).toBe("我等这一天很久了");
    expect(out.keyMoments[0]!.fromSweep).toBe(true);
  });

  it("候选一条都进不来时，产出与 Gemini 原稿完全相同（不许顺手改动原稿）", () => {
    const out = mergeManhuaNativeSweepCandidates({
      geminiKeyMoments: GEMINI, storyRanges: STORY,
      candidates: [{ atSec: 9999, kindZh: "剧情", noteZh: "越界" }],
    });
    expect(out.keyMoments).toEqual([...GEMINI].sort((a, b) => a.atSec - b.atSec));
  });
});
