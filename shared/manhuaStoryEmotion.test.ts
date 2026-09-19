import { describe, expect, it } from "vitest";
import {
  MANHUA_STORY_EMOTION_FORMAT,
  checkManhuaStoryEmotion,
  manhuaBreathSegments,
  manhuaEmotionOfSegment,
  manhuaStoryBeatsOfSegment,
  manhuaStoryEmotionIsStale,
  normalizeManhuaStoryEmotion,
  projectManhuaStoryEmotionForBgm,
  projectManhuaStoryEmotionForSegment,
  summarizeManhuaStoryEmotion,
  type ManhuaStoryEmotion,
} from "./manhuaStoryEmotion";
import { buildManhuaProjectBible, parseManhuaProjectBible } from "./manhuaProjectBible";

const beat = (over: Record<string, unknown> = {}) => ({
  id: "beat-1",
  episode: 1,
  segmentIndex: 2,
  characterZh: "阿菁",
  wantZh: "拿回娘的药",
  obstacleZh: "坐堂先生不肯赊",
  fromStateZh: "求人",
  triggerZh: "先生把药收回柜里",
  choiceZh: "把娘留的银镯押上",
  toStateZh: "拿到药但失去信物",
  sourceZh: "第1集第2段",
  ...over,
});

const analysis = (over: Partial<ManhuaStoryEmotion> = {}): unknown => ({
  format: MANHUA_STORY_EMOTION_FORMAT,
  scriptVersionKey: "script-v1",
  beats: [beat()],
  curve: [
    { episode: 1, segmentIndex: 2, intensity: 7, kind: "turn", reasonZh: "押上信物＝代价可见" },
    { episode: 1, segmentIndex: 3, intensity: 2, kind: "breath", reasonZh: "回家路上收情绪" },
  ],
  foreshadows: [
    {
      id: "fs-1",
      labelZh: "银镯上的刻字",
      plantedEpisode: 1,
      plantedSegmentIndex: 2,
      knownByZh: ["阿菁"],
      audienceKnows: false,
      revealEpisode: 3,
      status: "planted",
    },
  ],
  unreviewedZh: ["第 4 集之后未读"],
  ...over,
});

describe("剧情与情绪结构（存稿真源）", () => {
  it("正常分析能解析，字段一个不丢", () => {
    const a = normalizeManhuaStoryEmotion(analysis())!;
    expect(a.scriptVersionKey).toBe("script-v1");
    expect(a.beats[0].choiceZh).toBe("把娘留的银镯押上");
    expect(a.curve.map(p => p.kind)).toEqual(["turn", "breath"]);
    expect(a.foreshadows[0].status).toBe("planted");
    expect(a.unreviewedZh).toEqual(["第 4 集之后未读"]);
  });

  it("半份脏数据宁可整份不要：格式不符、缺剧本版本、三类全空都返回 undefined", () => {
    expect(normalizeManhuaStoryEmotion(null)).toBeUndefined();
    expect(normalizeManhuaStoryEmotion({ ...(analysis() as object), format: "别的" })).toBeUndefined();
    expect(normalizeManhuaStoryEmotion({ ...(analysis() as object), scriptVersionKey: "" })).toBeUndefined();
    expect(
      normalizeManhuaStoryEmotion({ ...(analysis() as object), beats: [], curve: [], foreshadows: [] }),
    ).toBeUndefined();
  });

  it("脏字段被夹住而不是整份丢：强度越界夹到 0–10，未知 kind 退回 rise，缺人物的节拍保存为待补草稿", () => {
    const a = normalizeManhuaStoryEmotion(
      analysis({
        curve: [
          { episode: 1, segmentIndex: 1, intensity: 99, kind: "爆", reasonZh: "x" },
          { episode: 1, segmentIndex: 2, intensity: -5, kind: "fall", reasonZh: "y" },
        ],
        beats: [beat(), beat({ characterZh: "" })],
      } as Partial<ManhuaStoryEmotion>),
    )!;
    expect(a.curve[0]).toMatchObject({ intensity: 10, kind: "rise" });
    expect(a.curve[1].intensity).toBe(0);
    expect(a.beats).toHaveLength(2);
    expect(checkManhuaStoryEmotion(a).some(i => i.messageZh.includes("人物"))).toBe(true);
  });

  it("换了剧本旧分析失效：判据是版本标识不等，不是时间戳新旧", () => {
    const a = normalizeManhuaStoryEmotion(analysis())!;
    expect(manhuaStoryEmotionIsStale(a, "script-v1")).toBe(false);
    expect(manhuaStoryEmotionIsStale(a, "script-v2")).toBe(true);
    // 反例对照：没有分析时不能报失效，否则 UI 会对着空数据喊"过期"
    expect(manhuaStoryEmotionIsStale(undefined, "script-v2")).toBe(false);
  });

  it("下游按段取到的是同一份身份：段号对上才给，不跨段串味", () => {
    const a = normalizeManhuaStoryEmotion(analysis())!;
    expect(manhuaStoryBeatsOfSegment(a, 1, 2).map(b => b.characterZh)).toEqual(["阿菁"]);
    expect(manhuaStoryBeatsOfSegment(a, 1, 3)).toEqual([]);
    expect(manhuaStoryBeatsOfSegment(a, 2, 2)).toEqual([]);
    expect(manhuaEmotionOfSegment(a, 1, 2)?.intensity).toBe(7);
    expect(manhuaEmotionOfSegment(a, 1, 9)).toBeNull();
  });

  it("同段多个情绪点取强度最高的当主目的", () => {
    const a = normalizeManhuaStoryEmotion(
      analysis({
        curve: [
          { episode: 1, segmentIndex: 2, intensity: 3, kind: "rise", reasonZh: "a" },
          { episode: 1, segmentIndex: 2, intensity: 8, kind: "turn", reasonZh: "b" },
        ],
      } as Partial<ManhuaStoryEmotion>),
    )!;
    expect(manhuaEmotionOfSegment(a, 1, 2)).toMatchObject({ intensity: 8, kind: "turn" });
  });

  it("留白段报给配乐，不替它决定用什么曲子", () => {
    const a = normalizeManhuaStoryEmotion(analysis())!;
    expect(manhuaBreathSegments(a, 1)).toEqual([3]);
    expect(manhuaBreathSegments(a, 2)).toEqual([]);
  });

  it("体检只报数据能判的：缺四段是阻断，首尾同状态与无出处是提醒", () => {
    const a = normalizeManhuaStoryEmotion(
      analysis({
        beats: [
          beat({ id: "b1", choiceZh: "" }),
          beat({ id: "b2", segmentIndex: 3, toStateZh: "求人", fromStateZh: "求人" }),
          beat({ id: "b3", segmentIndex: 4, sourceZh: "" }),
        ],
      } as Partial<ManhuaStoryEmotion>),
    )!;
    const issues = checkManhuaStoryEmotion(a);
    expect(issues.filter(i => i.level === "block").map(i => i.messageZh)).toEqual([
      expect.stringContaining("缺选择"),
    ]);
    expect(issues.some(i => i.level === "warn" && i.messageZh.includes("开始与结束状态相同"))).toBe(true);
    expect(issues.some(i => i.level === "warn" && i.messageZh.includes("没写原文位置"))).toBe(true);
    // 反例对照：完整节拍一条都不许报
    expect(checkManhuaStoryEmotion(normalizeManhuaStoryEmotion(analysis())!)).toEqual([]);
  });

  it("伏笔自相矛盾要报：标已兑现却没写兑现位置、揭示集早于埋设集", () => {
    const a = normalizeManhuaStoryEmotion(
      analysis({
        foreshadows: [
          { id: "f1", labelZh: "刻字", plantedEpisode: 2, plantedSegmentIndex: 1, knownByZh: [], audienceKnows: false, revealEpisode: 1, status: "paid_off" },
        ],
      } as Partial<ManhuaStoryEmotion>),
    )!;
    const msgs = checkManhuaStoryEmotion(a).map(i => i.messageZh);
    expect(msgs.some(m => m.includes("没写兑现位置"))).toBe(true);
    expect(msgs.some(m => m.includes("揭示集早于埋设集"))).toBe(true);
  });

  it("摘要不打印内部 id", () => {
    const a = normalizeManhuaStoryEmotion(analysis())!;
    const line = summarizeManhuaStoryEmotion(a);
    expect(line).toContain("1 条节拍");
    expect(line).toContain("1 条伏笔未兑现");
    expect(line).not.toContain("beat-1");
    expect(line).not.toContain("fs-1");
    expect(summarizeManhuaStoryEmotion(undefined)).toBe("未做剧情与情绪分析");
  });
});

describe("挂进 Bible：保存与刷新恢复（真源往返）", () => {
  const base = {
    topic: "墨菁传",
    pack: {
      seriesTitle: "墨菁传",
      logline: "少女为娘求药",
      charactersMd: "阿菁",
      propsMd: "银镯",
      locationsMd: "长明医馆",
      episodeCount: 1,
      episodes: [{ index: 1, title: "求药", body: "", endHook: "镯子被收走" }],
    },
    cast: {
      lane: "ancient" as const,
      characterIds: [],
      ancientArchetypeIds: [],
      artStyleId: "",
      propIds: [],
      wardrobePropContinuityIds: [],
      boundEpisodeIndexes: [],
    },
  };

  it("确认编剧时冻结，序列化再解析后逐字段还在（刷新/云草稿回灌的等价路径）", () => {
    const bible = buildManhuaProjectBible({ ...base, storyEmotion: analysis() as never });
    expect(bible.storyEmotion?.beats[0].choiceZh).toBe("把娘留的银镯押上");
    const round = parseManhuaProjectBible(JSON.parse(JSON.stringify(bible)));
    expect(round?.storyEmotion?.scriptVersionKey).toBe("script-v1");
    expect(round?.storyEmotion?.beats[0].toStateZh).toBe("拿到药但失去信物");
    expect(round?.storyEmotion?.curve).toHaveLength(2);
    expect(round?.storyEmotion?.foreshadows[0].labelZh).toBe("银镯上的刻字");
  });

  it("没做分析的旧存稿照常解析，不因为新字段炸掉（向后兼容）", () => {
    const bible = buildManhuaProjectBible(base);
    expect(bible.storyEmotion).toBeUndefined();
    const round = parseManhuaProjectBible(JSON.parse(JSON.stringify(bible)));
    expect(round).not.toBeNull();
    expect(round?.storyEmotion).toBeUndefined();
  });

  it("存稿里的脏分析不会带毒进 Bible", () => {
    const bible = buildManhuaProjectBible({ ...base, storyEmotion: { format: "别的格式" } as never });
    expect(bible.storyEmotion).toBeUndefined();
  });
});

describe("下游消费（同一身份、同一版本）", () => {
  const a = () =>
    normalizeManhuaStoryEmotion({
      format: MANHUA_STORY_EMOTION_FORMAT,
      scriptVersionKey: "script-v1",
      beats: [beat()],
      curve: [
        { episode: 1, segmentIndex: 1, intensity: 3, kind: "rise", reasonZh: "上门求药" },
        { episode: 1, segmentIndex: 2, intensity: 8, kind: "turn", reasonZh: "押上信物" },
        { episode: 1, segmentIndex: 3, intensity: 2, kind: "breath", reasonZh: "回家路上收情绪" },
        { episode: 2, segmentIndex: 1, intensity: 9, kind: "turn", reasonZh: "别集不许串味" },
      ],
      foreshadows: [],
      unreviewedZh: [],
    })!;

  it("投给配乐：曲线变 moods，留白变 [Break]，强度不参与", () => {
    const p = projectManhuaStoryEmotionForBgm(a(), 1);
    expect(p.moods).toEqual(["蓄力", "反转"]);
    expect(p.hasSilenceBreak).toBe(true);
    expect(p.breathSegmentIndexes).toEqual([3]);
    // 反例对照：换一集拿到的是那一集的曲线，不串味
    expect(projectManhuaStoryEmotionForBgm(a(), 2).moods).toEqual(["反转"]);
    // 反例对照：没分析就什么都不给，调用方保持原推导
    expect(projectManhuaStoryEmotionForBgm(undefined, 1)).toEqual({
      moods: [],
      hasSilenceBreak: false,
      breathSegmentIndexes: [],
    });
  });

  it("相邻同情绪合并，弧线不原地踏步", () => {
    const merged = normalizeManhuaStoryEmotion({
      format: MANHUA_STORY_EMOTION_FORMAT,
      scriptVersionKey: "v",
      beats: [],
      curve: [
        { episode: 1, segmentIndex: 1, intensity: 3, kind: "rise", reasonZh: "a" },
        { episode: 1, segmentIndex: 2, intensity: 4, kind: "rise", reasonZh: "b" },
        { episode: 1, segmentIndex: 3, intensity: 9, kind: "turn", reasonZh: "c" },
      ],
      foreshadows: [],
    })!;
    expect(projectManhuaStoryEmotionForBgm(merged, 1).moods).toEqual(["蓄力", "反转"]);
  });

  it("投给分镜段：说清这一段要达成什么；没分析就一个字都不注入", () => {
    const line = projectManhuaStoryEmotionForSegment(a(), 1, 2);
    expect(line).toContain("本段情绪目的：押上信物");
    expect(line).toContain("阿菁");
    expect(line).toContain("选择把娘留的银镯押上");
    // 留白段说的是"收情绪不加戏"，不是给个情绪词
    expect(projectManhuaStoryEmotionForSegment(a(), 1, 3)).toContain("呼吸区");
    // 反例对照：没分析 / 段号对不上 → 空字符串，调用方原样不注入
    expect(projectManhuaStoryEmotionForSegment(undefined, 1, 2)).toBe("");
    expect(projectManhuaStoryEmotionForSegment(a(), 1, 9)).toBe("");
    expect(projectManhuaStoryEmotionForSegment(a(), 9, 2)).toBe("");
  });
});

describe("剧情草稿恢复边界", () => {
  it("多集长版本键经过 Bible JSON 恢复仍一致", () => {
    const key = Array.from({ length: 80 }, (_, i) => `${i + 1}:9000:abcdefg`).join("|");
    const a = normalizeManhuaStoryEmotion(analysis({ scriptVersionKey: key }))!;
    expect(normalizeManhuaStoryEmotion(JSON.parse(JSON.stringify(a)))?.scriptVersionKey).toBe(key);
  });
  it("未填写人物的草稿保留其它字段但不投影给成片", () => {
    const a = normalizeManhuaStoryEmotion(analysis({ beats: [beat({ characterZh: "" })], curve: [] }))!;
    const restored = normalizeManhuaStoryEmotion(JSON.parse(JSON.stringify(a)))!;
    expect(restored.beats[0].choiceZh).toBe("把娘留的银镯押上");
    expect(projectManhuaStoryEmotionForSegment(restored, 1, 2)).toBe("");
  });
});
