import { describe, expect, it } from "vitest";
import { buildManhuaReusableTechniqueDigest } from "./manhuaNativeDeepReadReusableDigest";

const shot = (over: Record<string, unknown>) => ({
  actionZh: "", lightingZh: "", microExpressionZh: "",
  gazeBreathZh: "", relationshipReactionZh: "", ...over,
});

describe("可复用手法蒸馏：四面向、零模型调用", () => {
  it("四个面向齐备且顺序固定（剧情/灯光/音轨/表演）", () => {
    const facets = buildManhuaReusableTechniqueDigest({ shots: [], audioAnalyses: [] });
    expect(facets.map((f) => f.keyZh)).toEqual(["story", "lighting", "audio", "acting"]);
    expect(facets.every((f) => f.sampleCount === 0 && !f.items.length)).toBe(true);
  });

  it("短字段整值统计，只出现一次的不算手法", () => {
    const facets = buildManhuaReusableTechniqueDigest({
      shots: [
        shot({ lightingZh: "暖黄逆光" }),
        shot({ lightingZh: "暖黄逆光" }),
        shot({ lightingZh: "暖黄逆光" }),
        shot({ lightingZh: "冷蓝顶光" }),
        shot({ lightingZh: "冷蓝顶光" }),
        shot({ lightingZh: "只出现一次的光" }),
      ],
      audioAnalyses: [],
    });
    const lighting = facets.find((f) => f.keyZh === "lighting")!;
    expect(lighting.sampleCount).toBe(6);
    expect(lighting.items.map((i) => [i.textZh, i.count])).toEqual([
      ["暖黄逆光", 3], ["冷蓝顶光", 2],
    ]);
    // 一次性描写不是手法，不得混进来淹没真正的套路。
    expect(lighting.items.some((i) => i.textZh === "只出现一次的光")).toBe(false);
    expect(lighting.items[0]!.ratio).toBe(0.5);
  });

  it("长文本切子句后统计，整句不重复也能看出套路", () => {
    const facets = buildManhuaReusableTechniqueDigest({
      shots: [
        shot({ actionZh: "少女推开房门，快步走进屋内" }),
        shot({ actionZh: "少年缓缓抬起头，快步走进屋内" }),
        shot({ actionZh: "老者站在门外，远远望着" }),
      ],
      audioAnalyses: [],
    });
    const story = facets.find((f) => f.keyZh === "story")!;
    const texts = story.items.map((i) => i.textZh);
    // 三条 actionZh 逐字都不同，整值统计一条都抓不到；子句级才看得出
    // 「快步走进屋内」是这部片反复用的调度。
    expect(texts).toContain("快步走进屋内");
    expect(story.items.find((i) => i.textZh === "快步走进屋内")!.count).toBe(2);
    // 整句各不相同，不该被当成手法列出来。
    expect(texts).not.toContain("少女推开房门，快步走进屋内");
  });

  it("同一镜内多字段复述只算一次，不得自我刷量", () => {
    const facets = buildManhuaReusableTechniqueDigest({
      shots: [
        shot({ microExpressionZh: "表情自然", gazeBreathZh: "表情自然", relationshipReactionZh: "表情自然" }),
        shot({ microExpressionZh: "表情自然" }),
      ],
      audioAnalyses: [],
    });
    const acting = facets.find((f) => f.keyZh === "acting")!;
    // 三个字段写同一句，只算 1 镜；两镜共计 2，不是 4。
    expect(acting.items[0]).toMatchObject({ textZh: "表情自然", count: 2 });
  });

  it("音轨面向统计分轨写法，并原样透出模型自己写的三栏", () => {
    const facets = buildManhuaReusableTechniqueDigest({
      shots: [],
      audioAnalyses: [
        {
          audioTrack: [
            { emotionArcZh: "由紧到松", bgmZh: "低频鼓点" },
            { emotionArcZh: "由紧到松", bgmZh: "弦乐铺底" },
          ],
          reusableAudioZh: "危险场景插入淡定台词形成反差",
          mixNotesZh: "人声压过鼓点",
        },
        // 去重：同一段总结在多段重复出现时只透出一次。
        { audioTrack: [], reusableAudioZh: "危险场景插入淡定台词形成反差" },
      ],
    });
    const audio = facets.find((f) => f.keyZh === "audio")!;
    expect(audio.items.map((i) => [i.textZh, i.count])).toEqual([["由紧到松", 2]]);
    expect(audio.modelTextsZh).toEqual([
      "危险场景插入淡定台词形成反差", "人声压过鼓点",
    ]);
  });

  it("灌水产出会被这块板当场暴露：高频项全是通用词且占比接近 1", () => {
    // 0831 实测那次退化：12/15 镜逐字相同，字段全填通用词。
    const filler = shot({
      actionZh: "剧情推进", lightingZh: "自然光影",
      microExpressionZh: "表情自然", gazeBreathZh: "视线平视",
      relationshipReactionZh: "多人互动",
    });
    const facets = buildManhuaReusableTechniqueDigest({
      shots: Array.from({ length: 12 }, () => ({ ...filler })),
      audioAnalyses: [],
    });
    const story = facets.find((f) => f.keyZh === "story")!;
    expect(story.items[0]).toMatchObject({ textZh: "剧情推进", count: 12, ratio: 1 });
    const lighting = facets.find((f) => f.keyZh === "lighting")!;
    expect(lighting.items[0]!.ratio).toBe(1);
  });
});
