import { describe, expect, it } from "vitest";
import { MANHUA_SWEEP_SOURCE_ZH, mergeManhuaNativeSweepAdditions } from "./manhuaNativeSweepMerge";

const base = {
  baseKeyMoments: [{ atSec: 10, noteZh: "墨屠拔刀" }, { atSec: 30, noteZh: "阿菁回头" }],
  baseSubtitles: [{ atSec: 11, textZh: "别怕" }, { atSec: 31, textZh: "站我身后" }],
};

describe("整形前补扫：只增不减", () => {
  it("读片稿的每一条都原样保留，一条不许丢；补扫条目打来源标记", () => {
    const out = mergeManhuaNativeSweepAdditions({
      ...base,
      sweepKeyMoments: [{ atSec: 20, noteZh: "灯笼碎成漫天火星，构图罕见", evidenceRole: "story" }],
      sweepSubtitles: [{ atSec: 21, textZh: "谁准你动手" }],
    });
    expect(out.keyMoments.map((k) => k.atSec)).toEqual([10, 20, 30]);
    expect(out.keyMoments.find((k) => k.atSec === 10)!.sourceZh).toBeUndefined();
    expect(out.keyMoments.find((k) => k.atSec === 20)!.sourceZh).toBe(MANHUA_SWEEP_SOURCE_ZH);
    expect(out.subtitles.map((s) => s.textZh)).toEqual(["别怕", "谁准你动手", "站我身后"]);
    expect(out.addedKeyMoments).toBe(1);
    expect(out.summaryZh).toContain("一条未动");
  });

  it("补扫撞上读片稿已有位置：丢补扫那条，读片稿优先（绝不覆盖）", () => {
    const out = mergeManhuaNativeSweepAdditions({
      ...base,
      sweepKeyMoments: [{ atSec: 10.5, noteZh: "补扫说这里是别的", evidenceRole: "story" }, { atSec: 31, noteZh: "也撞上", evidenceRole: "story" }],
      sweepSubtitles: [{ atSec: 11.4, textZh: "覆盖不了我" }],
    });
    expect(out.keyMoments.find((k) => k.atSec === 10)!.noteZh).toBe("墨屠拔刀");
    expect(out.keyMoments).toHaveLength(2);
    expect(out.droppedKeyMoments).toBe(2);
    expect(out.subtitles.find((s) => s.atSec === 11)!.textZh).toBe("别怕");
    expect(out.droppedSubtitles).toBe(1);
  });

  it("补扫为空时输出与读片稿等价，不会凭空改动", () => {
    const out = mergeManhuaNativeSweepAdditions({ ...base, sweepKeyMoments: [], sweepSubtitles: [] });
    expect(out.keyMoments).toEqual([{ atSec: 10, noteZh: "墨屠拔刀" }, { atSec: 30, noteZh: "阿菁回头" }]);
    expect(out.subtitles).toEqual([{ atSec: 11, textZh: "别怕" }, { atSec: 31, textZh: "站我身后" }]);
    expect(out.summaryZh).toContain("没有发现");
  });

  it("脏补扫数据全丢：秒位非法、字幕空文本都不许进去", () => {
    const out = mergeManhuaNativeSweepAdditions({
      ...base,
      sweepKeyMoments: [{ atSec: "abc" }, { atSec: -5 }, {}],
      sweepSubtitles: [{ atSec: 50, textZh: "   " }, { atSec: null, textZh: "有字没秒位" }],
    });
    expect(out.addedKeyMoments).toBe(0);
    expect(out.addedSubtitles).toBe(0);
    expect(out.droppedKeyMoments).toBe(3);
    expect(out.droppedSubtitles).toBe(2);
    // 反例对照：干净且写得出理由的补扫条目照样收得进来
    const clean = mergeManhuaNativeSweepAdditions({
      ...base, sweepKeyMoments: [{ atSec: 50, noteZh: "刀光劈开雨幕，全片唯一一次逆光", evidenceRole: "story" }], sweepSubtitles: [],
    });
    expect(clean.addedKeyMoments).toBe(1);
  });

  it("补扫条数有上限，不许把读片稿淹掉", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ atSec: 100 + i * 5, noteZh: `特写${i}`, evidenceRole: "story" }));
    const out = mergeManhuaNativeSweepAdditions({ ...base, sweepKeyMoments: many, sweepSubtitles: [], maxAdded: 5 });
    expect(out.addedKeyMoments).toBe(5);
    expect(out.droppedKeyMoments).toBe(45);
    // 读片稿那两条仍在
    expect(out.keyMoments.filter((k) => !k.sourceZh)).toHaveLength(2);
  });

  it("只补「精彩、有特色」的画面：说不出理由的一条都不收（0920 用户精确口径）", () => {
    const out = mergeManhuaNativeSweepAdditions({
      ...base,
      sweepKeyMoments: [{ atSec: 50, evidenceRole: "story" }, { atSec: 55, noteZh: "  ", evidenceRole: "story" }, { atSec: 60, noteZh: "雨中拔刀，全片唯一逆光", evidenceRole: "story" }],
      sweepSubtitles: [],
    });
    expect(out.addedKeyMoments).toBe(1);
    expect(out.keyMoments.find((k) => k.atSec === 60)!.noteZh).toContain("逆光");
    expect(out.droppedKeyMoments).toBe(2);
  });

  it("🚫 补进来的画面禁止是广告或商品宣传：落在广告区间、自标广告、推销文案三道都拦", () => {
    const out = mergeManhuaNativeSweepAdditions({
      ...base,
      excludedAdRanges: [{ startSec: 100, endSec: 120 }],
      sweepKeyMoments: [
        { atSec: 110, noteZh: "构图讲究的一帧", evidenceRole: "story" },   // 落在广告区间
        { atSec: 140, noteZh: "商品特写", evidenceRole: "non_story_ad" }, // 自标广告
        { atSec: 160, noteZh: "扫码下单享优惠", evidenceRole: "story" },   // 推销文案
        { atSec: 180, noteZh: "雨幕中刀光逆着灯笼，全片唯一", evidenceRole: "story" }, // 正常：该收
      ],
      sweepSubtitles: [
        { atSec: 105, textZh: "本集由某某赞助播出" },
        { atSec: 200, textZh: "你终究还是来了" },
      ],
    });
    expect(out.keyMoments.filter((k) => k.sourceZh).map((k) => k.atSec)).toEqual([180]);
    expect(out.droppedKeyMoments).toBe(3);
    expect(out.subtitles.filter((s) => s.sourceZh).map((s) => s.atSec)).toEqual([200]);
    expect(out.droppedSubtitles).toBe(1);
    // 读片稿原有条目一条没动
    expect(out.keyMoments.filter((k) => !k.sourceZh)).toHaveLength(2);
  });

  it("✅ 必须跟剧情相关：没标成剧情证据的一律不收（空镜、片头字卡也不是广告，但同样不收）", () => {
    const out = mergeManhuaNativeSweepAdditions({
      ...base,
      sweepKeyMoments: [
        { atSec: 70, noteZh: "很漂亮的空镜" },                               // 没标
        { atSec: 80, noteZh: "片头字卡设计独特", evidenceRole: "title_card" }, // 标成别的
        { atSec: 90, noteZh: "墨屠回头那一眼交代了动机", evidenceRole: "story" },
      ],
      sweepSubtitles: [],
    });
    expect(out.keyMoments.filter((k) => k.sourceZh).map((k) => k.atSec)).toEqual([90]);
    expect(out.droppedKeyMoments).toBe(2);
  });
});
