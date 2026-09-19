import { describe, expect, it } from "vitest";
import {
  MANHUA_STORY_EMOTION_FORMAT,
  manhuaStoryEmotionIsStale,
  normalizeManhuaStoryEmotion,
  projectManhuaStoryEmotionForSegment,
  type ManhuaStoryEmotion,
} from "@shared/manhuaStoryEmotion";
import { buildManhuaProjectBible, parseManhuaProjectBible } from "@shared/manhuaProjectBible";

/**
 * 生产者入口的行为契约（不依赖浏览器）：
 * 面板每次改动都过 normalize 再写回 Bible；Bible 再随 writerSession 存稿。
 * 这里验的是那条链上"面板 → Bible → 存稿往返 → 下游投影"的数据行为。
 */
const bibleBase = {
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

/** 面板里的提交动作：脏值不许流进存稿 */
const commitFromPanel = (draft: unknown, scriptVersionKey: string) =>
  normalizeManhuaStoryEmotion({ ...(draft as object), scriptVersionKey });

describe("剧情与情绪生产者入口（面板 → Bible → 存稿 → 下游）", () => {
  const draft = {
    format: MANHUA_STORY_EMOTION_FORMAT,
    scriptVersionKey: "will-be-overwritten",
    beats: [
      {
        id: "b1",
        episode: 1,
        segmentIndex: 2,
        characterZh: "阿菁",
        wantZh: "拿回娘的药",
        obstacleZh: "先生不肯赊",
        fromStateZh: "求人",
        triggerZh: "药被收回柜里",
        choiceZh: "押上银镯",
        toStateZh: "拿到药但失去信物",
        sourceZh: "第1集第2段",
      },
    ],
    curve: [{ episode: 1, segmentIndex: 2, intensity: 99, kind: "转折", reasonZh: "押上信物" }],
    foreshadows: [],
    unreviewedZh: [],
  };

  it("面板提交时盖上当前剧本版本，并把脏值夹回合法范围", () => {
    const committed = commitFromPanel(draft, "script-A")!;
    expect(committed.scriptVersionKey).toBe("script-A");
    // 强度 99 夹到 10；未知 kind「转折」（中文）退回 rise —— 面板下拉给的是英文值，
    // 手改存稿或旧数据混进来时不许原样落库
    expect(committed.curve[0].intensity).toBe(10);
    expect(committed.curve[0].kind).toBe("rise");
  });

  it("写回 Bible 后序列化再解析，逐字段还在（等价于刷新与云草稿回灌）", () => {
    const committed = commitFromPanel(draft, "script-A");
    const bible = buildManhuaProjectBible({ ...bibleBase, storyEmotion: committed as never });
    const round = parseManhuaProjectBible(JSON.parse(JSON.stringify(bible)))!;
    expect(round.storyEmotion?.beats[0].choiceZh).toBe("押上银镯");
    expect(round.storyEmotion?.scriptVersionKey).toBe("script-A");
  });

  it("换剧本后同一份分析被判失效，面板据此提示，下游不再采用", () => {
    const committed = commitFromPanel(draft, "script-A")!;
    expect(manhuaStoryEmotionIsStale(committed, "script-A")).toBe(false);
    expect(manhuaStoryEmotionIsStale(committed, "script-B")).toBe(true);
  });

  it("面板产出的东西真的能被下游读成一行戏核", () => {
    const committed = commitFromPanel(draft, "script-A");
    const line = projectManhuaStoryEmotionForSegment(committed as ManhuaStoryEmotion, 1, 2);
    expect(line).toContain("阿菁");
    expect(line).toContain("选择押上银镯");
    // 反例对照：别的段没有节拍与情绪点，就不该凭空产出戏核
    expect(projectManhuaStoryEmotionForSegment(committed as ManhuaStoryEmotion, 1, 5)).toBe("");
  });

  it("把最后一条节拍与情绪点都删掉＝这份分析作废，不留空壳在 Bible 里", () => {
    const emptied = commitFromPanel({ ...draft, beats: [], curve: [], foreshadows: [] }, "script-A");
    expect(emptied).toBeUndefined();
    const bible = buildManhuaProjectBible({ ...bibleBase, storyEmotion: emptied as never });
    expect(bible.storyEmotion).toBeUndefined();
  });
});

/**
 * 0919 探针实锤的两条缺陷的回归：
 * ① 版本标识必须抓到同长度中段改字（原先「长度+前24字」抓不到）
 * ② 清空必填字段只让这条暂不保存，不许把已填的其它字段抹掉
 */
describe("剧本版本标识与草稿保护（0919 探针回归）", () => {
  /** 与 OmniCanvas.tsx 的 storyEmotionScriptVersionKey 同口径 */
  const versionKey = (episodes: Array<{ index: number; body: string }>) => {
    const fingerprint = (bodyZh: string) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < bodyZh.length; i += 1) {
        h ^= bodyZh.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h.toString(36);
    };
    return episodes
      .map((e) => `${e.index}:${e.body.length}:${fingerprint(e.body)}`)
      .join("|");
  };

  it("同长度中段改字必须换 key，旧分析随即失效", () => {
    const before = "阿菁推门进医馆时天已经黑透，屋里只剩一盏油灯。先摸到的是那只银镯。";
    const after = before.replace("银镯", "玉佩");
    expect(after.length).toBe(before.length);
    expect(before.slice(0, 24)).toBe(after.slice(0, 24)); // 旧口径看不出差别
    const keyBefore = versionKey([{ index: 1, body: before }]);
    const keyAfter = versionKey([{ index: 1, body: after }]);
    expect(keyAfter).not.toBe(keyBefore);
    const analysis = normalizeManhuaStoryEmotion({
      format: MANHUA_STORY_EMOTION_FORMAT,
      scriptVersionKey: keyBefore,
      beats: [
        {
          id: "b1",
          episode: 1,
          segmentIndex: 1,
          characterZh: "阿菁",
          wantZh: "拿回银镯",
          obstacleZh: "",
          fromStateZh: "",
          triggerZh: "",
          choiceZh: "",
          toStateZh: "",
          sourceZh: "",
        },
      ],
      curve: [],
      foreshadows: [],
      unreviewedZh: [],
    });
    expect(manhuaStoryEmotionIsStale(analysis, keyAfter)).toBe(true);
    // 反例对照：一个字都没改时不许误判失效
    expect(manhuaStoryEmotionIsStale(analysis, keyBefore)).toBe(false);
  });

  it("清空「人物」后存稿及刷新仍保留其它字段", () => {
    const key = "k1";
    const filled = {
      id: "b1",
      episode: 1,
      segmentIndex: 2,
      characterZh: "阿菁",
      wantZh: "拿回银镯",
      obstacleZh: "医馆老板",
      fromStateZh: "忍",
      triggerZh: "老板摔了镯子",
      choiceZh: "动手",
      toStateZh: "翻脸",
      sourceZh: "第2段",
    };
    // 面板草稿：清空人物后仍然完整保留六个已填字段
    const draft = { ...filled, characterZh: "" };
    expect(draft.triggerZh).toBe("老板摔了镯子");
    expect(draft.choiceZh).toBe("动手");
    // 未填完的草稿必须持久化，执行消费端另设完整性门禁
    const emitted = normalizeManhuaStoryEmotion({
      format: MANHUA_STORY_EMOTION_FORMAT,
      scriptVersionKey: key,
      beats: [draft],
      curve: [],
      foreshadows: [],
      unreviewedZh: [],
    });
    expect(JSON.parse(JSON.stringify(emitted)).beats[0]).toEqual(draft);
    // 名字打回去，六个字段原样回到存稿（这是旧实现做不到的：那时字段已被抹掉）
    const restored = normalizeManhuaStoryEmotion({
      format: MANHUA_STORY_EMOTION_FORMAT,
      scriptVersionKey: key,
      beats: [{ ...draft, characterZh: "阿菁" }],
      curve: [],
      foreshadows: [],
      unreviewedZh: [],
    });
    expect(restored?.beats[0]).toEqual(filled);
  });
});
