import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  manhuaDirectionBlocksLeakInternalNames,
  manhuaDirectionCardIsProductionReady,
  normalizeManhuaDirectionCanon,
  resolveDirectorStyleBlocks,
  type ManhuaDirectionCanon,
  type ManhuaDirectionCard,
} from "./manhuaDirectionCanon";
import { parseManhuaDirectionSkillMarkdown } from "./manhuaDirectionSkillParse";
import { buildManhuaProjectBible, parseManhuaProjectBible, serializeManhuaProjectBible, summarizeManhuaProjectBible } from "./manhuaProjectBible";

const NOLAN_MD = `---
name: christopher-nolan
---
# Christopher Nolan · 决策模型与手法卡

- 卡片 ID：parallel_action_editing
- 蒸馏档位：标准档

## 第一层：决策模型

#### CN-DM-01｜类型结构接入情感概念【单片观察，非正式规律】
- 这是单片观察，不进 resolver。

#### CN-DM-02｜把观众的信息位置做成可控变量
- **规律一句**：把观众相对角色的信息位置当作可控变量，按线索决定观众领先、同步还是落后。
- **为什么**：信息位置决定悬念形态。
- **预测**：并行线里观众信息位置会随线切换。
- **失效条件**：单线线性叙事、观众全程与主角同步。
- **内部溯源**：01-A、02-B

#### CN-DM-06｜用并行动作创造剪辑变量，不靠无差别覆盖
- **规律一句**：先设计并行动作线，让剪辑点来自各线的决定性行动与结果，不靠多机位无差别覆盖。
- **为什么**：覆盖越多剪辑越平。
- **失效条件**：单一空间单一动作。
- **内部溯源**：03-A

#### CN-DM-04｜按演员所需调整工作过程
- **规律一句**：按演员需要调整排练与沟通方式，不套统一流程。
- **失效条件**：无表演任务。

## 第二层：手法卡

- **构图语法｜CN-PT-01**：并行线各自保留至少一个可辨的目标、威胁、时间或视点线索；不投影固定空间造型。内部依据：CN-DM-02。
- **景别与机位语法｜CN-PT-02**：【待深蒸】没有通过四门槛的正式规律可支持固定景别。
- **运镜与剪辑节奏｜CN-PT-03**：围绕各线的决定性行动、关系与结果安排跨线切换，保留必要连续表演；不规定硬切、固定快慢或固定运镜。内部依据：CN-DM-06。

### 6. 明确反对的拍法
- 用多机位无差别覆盖代替并行动作设计。内部溯源：03-A
- 模仿 Inception 的旋转走廊外观。

## 待深蒸清单
- CN-TD-08
`;

const WOO_MD = `# 吴宇森 · 决策模型与手法卡

卡片 ID：\`relational_action_rhythm\`  
蒸馏档位：标准档  

## 决策模型

**JWAR-001｜动作必须改变人物关系或道德处境。**  
规律：每场动作戏结束时，至少一对人物的关系或道德处境与开场不同。  
为什么：动作若不改变关系就是杂耍。  
预测句：动作戏结尾会出现关系宣告或立场表态。  
失效条件：纯竞技或纯逃生场景。  
证据编号：JW-01；JW-04  

**JWAR-004｜演员能力—动作复杂度【待深蒸，不进入 resolver】。**  
规律：动作复杂度跟演员能力走。  

**JWAR-002｜按情绪节点伸缩时间，而非给整场贴慢动作。**  
规律：只在关系转折的情绪节点拉伸时间，其余按实时节奏剪辑。  
失效条件：没有情绪节点的过场。  
证据编号：JW-02  
`;

function canonOf(cards: ManhuaDirectionCard[], mainCardId: string, extra?: Partial<ManhuaDirectionCanon>): ManhuaDirectionCanon {
  return { version: 1, mainCardId, cards, authorizedCardIds: cards.map((c) => c.id), ...extra };
}

describe("manhuaDirectionSkillParse", () => {
  it("解析 Nolan 格式：正式规律进生产，带标记的降为 research_only，手法卡与反对拍法都读到", () => {
    const { card, skipped } = parseManhuaDirectionSkillMarkdown(NOLAN_MD, { slug: "christopher-nolan" });
    expect(card.id).toBe("parallel_action_editing");
    expect(card.internal?.personName).toBe("Christopher Nolan");
    const byId = Object.fromEntries(card.rules.map((r) => [r.id, r]));
    expect(byId["CN-DM-02"].status).toBe("verified");
    expect(byId["CN-DM-02"].ruleZh).toContain("信息位置");
    expect(byId["CN-DM-02"].failZh).toContain("单线");
    expect(byId["CN-DM-02"].sourceIds).toEqual(["01-A", "02-B"]);
    expect(byId["CN-DM-02"].stages).toEqual(["story", "storyboard"]);
    expect(byId["CN-DM-01"].status).toBe("research_only");
    expect(byId["CN-DM-01"].titleZh).not.toContain("【");
    expect(byId["CN-DM-06"].stages).toEqual(["storyboard", "clip"]);
    expect(byId["CN-PT-01"].status).toBe("conditional");
    expect(byId["CN-PT-01"].stages).toEqual(["storyboard", "keyframe"]);
    expect(byId["CN-PT-01"].sourceIds).toEqual(["CN-DM-02"]);
    expect(byId["CN-PT-02"].status).toBe("research_only");
    expect(byId["CN-PT-03"].stages).toEqual(["clip"]);
    expect(card.avoidZh).toHaveLength(2);
    expect(card.avoidZh?.[0]).not.toContain("内部溯源");
    expect(skipped).toEqual([]);
    expect(manhuaDirectionCardIsProductionReady(card)).toBe(true);
  });

  it("解析吴宇森格式：**ID｜标题。** + 规律：/失效条件：/证据编号：", () => {
    const { card } = parseManhuaDirectionSkillMarkdown(WOO_MD, { slug: "john-woo" });
    expect(card.id).toBe("relational_action_rhythm");
    expect(card.internal?.personName).toBe("吴宇森");
    const byId = Object.fromEntries(card.rules.map((r) => [r.id, r]));
    expect(byId["JWAR-001"].status).toBe("verified");
    expect(byId["JWAR-001"].ruleZh).toContain("关系或道德处境");
    expect(byId["JWAR-001"].predictZh).toContain("关系宣告");
    expect(byId["JWAR-001"].sourceIds).toEqual(["JW-01", "JW-04"]);
    expect(byId["JWAR-004"].status).toBe("research_only");
    expect(byId["JWAR-002"].status).toBe("verified");
    expect(byId["JWAR-002"].stages).toEqual(["storyboard", "clip"]);
  });

  it("真实蒸馏产物（若在本机）：六张卡 ≥2 条独立正式规律；mystery_reveal / world_space_previsualization 只有 1 条正式规律 → 卡级 research_only 不进生产", () => {
    const root = "/Users/tangenjie/Downloads/2026Sep04/directors";
    const ready = ["christopher-nolan", "john-woo", "james-cameron", "justin-lin", "steven-spielberg", "guillermo-del-toro"];
    const read = (slug: string) => {
      try {
        return readFileSync(`${root}/${slug}/SKILL.md`, "utf8");
      } catch {
        return ""; // CI 上没有蒸馏目录，跳过
      }
    };
    for (const slug of ready) {
      const md = read(slug);
      if (!md) return;
      const { card } = parseManhuaDirectionSkillMarkdown(md, { slug });
      expect(card.id, slug).toMatch(/^[a-z0-9_]+$/);
      expect(manhuaDirectionCardIsProductionReady(card), `${slug} 正式规律不足`).toBe(true);
    }
    for (const [slug, id] of [["jj-abrams", "mystery_reveal"], ["ridley-scott", "world_space_previsualization"]]) {
      const md = read(slug);
      if (!md) return;
      const { card } = parseManhuaDirectionSkillMarkdown(md, { slug });
      expect(card.id).toBe(id);
      expect(manhuaDirectionCardIsProductionReady(card), `${slug} 只有 1 条正式规律`).toBe(false);
    }
  });
});

describe("resolveDirectorStyleBlocks", () => {
  const nolan = parseManhuaDirectionSkillMarkdown(NOLAN_MD, { slug: "christopher-nolan" }).card;
  const woo = parseManhuaDirectionSkillMarkdown(WOO_MD, { slug: "john-woo" }).card;

  it("没有法典 → 五块全空，不注入默认风格", () => {
    const b = resolveDirectorStyleBlocks(undefined);
    expect([b.story, b.storyboard, b.keyframe, b.clip, b.review].every((x) => x === "")).toBe(true);
    expect(b.audit.ruleIds).toEqual([]);
  });

  it("主卡编译：五块按阶段投影，research_only 不出现，关键帧不写运镜，视频块单行", () => {
    const b = resolveDirectorStyleBlocks(canonOf([nolan], "parallel_action_editing"));
    expect(b.story).toContain("信息位置");
    expect(b.story).toContain("【导演法典·v1·parallel_action_editing·standard-1】");
    expect(b.storyboard).toContain("并行动作线");
    expect(b.keyframe).toContain("可辨的目标");
    expect(b.keyframe).not.toContain("切换");
    expect(b.clip).not.toContain("\n");
    expect(b.clip).toContain("跨线切换");
    expect(b.review).toContain("失效条件——单线");
    expect(b.review).toContain("明确不用：用多机位无差别覆盖");
    const all = [b.story, b.storyboard, b.keyframe, b.clip, b.review].join("\n");
    expect(all).not.toContain("类型结构接入情感概念");
    expect(all).not.toContain("待深蒸");
    expect(all).not.toContain("01-A");
    expect(b.audit.ruleIds).toContain("CN-DM-02");
    expect(b.usedCardLabelZh).toBe(nolan.labelZh);
  });

  it("去名硬判：导演名与作品名不进任何一块", () => {
    const card: ManhuaDirectionCard = { ...nolan, internal: { personName: "Christopher Nolan", workNames: ["Inception"] } };
    const canon = canonOf([card], card.id);
    const b = resolveDirectorStyleBlocks(canon);
    expect(manhuaDirectionBlocksLeakInternalNames(b, canon)).toEqual([]);
    expect(b.review).not.toContain("Inception");
    expect(b.review).toContain("明确不用：用多机位");
  });

  it("场次副卡只覆盖声明的阶段，其余仍走主卡", () => {
    const canon = canonOf([nolan, woo], "parallel_action_editing", {
      sceneOverrides: { action: { cardId: "relational_action_rhythm", stages: ["clip"] } },
    });
    const action = resolveDirectorStyleBlocks(canon, "action");
    expect(action.clip).toContain("relational_action_rhythm");
    expect(action.clip).toContain("情绪节点");
    expect(action.story).toContain("parallel_action_editing");
    const dialogue = resolveDirectorStyleBlocks(canon, "dialogue");
    expect(dialogue.clip).toContain("parallel_action_editing");
  });

  it("未授权或未达卡级准入 → 全空", () => {
    const unauthorized = { ...canonOf([nolan], nolan.id), authorizedCardIds: [] };
    expect(resolveDirectorStyleBlocks(unauthorized).story).toBe("");
    const thin: ManhuaDirectionCard = { ...nolan, rules: nolan.rules.filter((r) => r.id === "CN-DM-02") };
    expect(manhuaDirectionCardIsProductionReady(thin)).toBe(false);
    expect(resolveDirectorStyleBlocks(canonOf([thin], thin.id)).story).toBe("");
  });

  it("normalize：主卡不在卡组或卡组为空 → undefined；阶段非法值被剔除", () => {
    expect(normalizeManhuaDirectionCanon({ version: 1, mainCardId: "x", cards: [] })).toBeUndefined();
    expect(normalizeManhuaDirectionCanon({ version: 1, mainCardId: "nope", cards: [nolan] })).toBeUndefined();
    const ok = normalizeManhuaDirectionCanon({
      version: 1,
      mainCardId: "c",
      authorizedCardIds: ["c"],
      cards: [{ id: "c", rules: [{ id: "R1", ruleZh: "a", stages: ["story", "bogus"], status: "weird" }, { id: "R2", ruleZh: "b", stages: ["clip"], status: "verified" }] }],
      sceneOverrides: { action: { cardId: "missing" }, reveal: { cardId: "c", stages: ["clip"] } },
    });
    expect(ok?.cards[0].rules[0]).toMatchObject({ stages: ["story"], status: "research_only" });
    expect(ok?.sceneOverrides).toEqual({ reveal: { cardId: "c", stages: ["clip"] } });
  });
});

describe("ManhuaProjectBible.directionCanon", () => {
  const nolan = parseManhuaDirectionSkillMarkdown(NOLAN_MD, { slug: "christopher-nolan" }).card;
  const baseInput = {
    pack: { episodeCount: 2, seriesTitle: "测", topic: "测", episodes: [], cast: {} } as never,
    cast: { lane: "modern", characterIds: [], ancientArchetypeIds: [], propIds: [], wardrobePropContinuityIds: [], artStyleId: "" } as never,
  };

  it("不传 → undefined；传 → 序列化往返保持；摘要带导演包名", () => {
    const none = buildManhuaProjectBible(baseInput as never);
    expect(none.directionCanon).toBeUndefined();
    expect(summarizeManhuaProjectBible(none)).not.toContain("导演包");
    const withCanon = buildManhuaProjectBible({ ...baseInput, directionCanon: canonOf([nolan], nolan.id) } as never);
    expect(withCanon.directionCanon?.mainCardId).toBe("parallel_action_editing");
    const back = parseManhuaProjectBible(JSON.parse(serializeManhuaProjectBible(withCanon)));
    expect(back?.directionCanon?.cards[0].rules.length).toBe(nolan.rules.length);
    expect(summarizeManhuaProjectBible(back)).toContain(`导演包 ${nolan.labelZh}`);
  });
});

describe("classifyManhuaDirectionSceneType", () => {
  it("按动词判场景；判不出走 default", async () => {
    const { classifyManhuaDirectionSceneType } = await import("./manhuaDirectionCanon");
    expect(classifyManhuaDirectionSceneType("家丁拔刀砍来，墨屠挥拳击退")).toBe("action");
    expect(classifyManhuaDirectionSceneType("阿菁低声问「你是谁」，墨屠答道「护你的人」")).toBe("dialogue");
    expect(classifyManhuaDirectionSceneType("面具落地，原来他就是失踪的兄长，众人认出了真面目")).toBe("reveal");
    expect(classifyManhuaDirectionSceneType("她哽咽着抱住他，泪水落下")).toBe("emotion");
    expect(classifyManhuaDirectionSceneType("次日清晨，二人赶路")).toBe("transition");
    expect(classifyManhuaDirectionSceneType("墨屠护住阿菁")).toBe("default");
    // 反例：单字动词不算
    expect(classifyManhuaDirectionSceneType("阿菁拔腿就往巷口跑")).toBe("default");
    expect(classifyManhuaDirectionSceneType("墨屠冲泡一壶茶，递给她")).toBe("default");
    expect(classifyManhuaDirectionSceneType("她追问他为何撒谎，他沉默不语")).toBe("default");
    expect(classifyManhuaDirectionSceneType("她发现钥匙不见了")).toBe("default");
    // 常见武打写法（审查第三轮给的三句）
    expect(classifyManhuaDirectionSceneType("踹开大门，长剑直刺咽喉，侧身躲过，反手一掌拍向胸口")).toBe("action");
    expect(classifyManhuaDirectionSceneType("屋顶追逐，飞身跃过瓦檐，回身甩出飞镖")).toBe("action");
    expect(classifyManhuaDirectionSceneType("刀光一闪，手臂被划开，鲜血喷出，趁势夺刀")).toBe("action");
    // 日常高频词两个同现不算打戏
    expect(classifyManhuaDirectionSceneType("他侧身让路，反手关上门")).toBe("default");
    expect(classifyManhuaDirectionSceneType("她翻身下床，一脚踢开被子，鲜血渗出，「疼」她说道")).not.toBe("action");
    // 打戏夹一句台词：引号按成对计，仍是动作场
    expect(classifyManhuaDirectionSceneType("家丁拔刀砍来，墨屠挥拳击退，阿菁问道「你没事吧」")).toBe("action");
    expect(classifyManhuaDirectionSceneType("")).toBe("default");
    // 审查 P2-1：引申义/灯光词/争吵动作不算打戏；「露出真诚」不算揭露；「次日清晨」只算一次
    expect(classifyManhuaDirectionSceneType("他一掌拍向桌面，「够了！」")).not.toBe("action");
    expect(classifyManhuaDirectionSceneType("月光射出一道冷光，他的目光射向远处")).toBe("default");
    expect(classifyManhuaDirectionSceneType("这句话击中了她，她反击道「你才是骗子」")).not.toBe("action");
    expect(classifyManhuaDirectionSceneType("她露出真诚的笑容，揭开锅盖")).toBe("default");
    expect(classifyManhuaDirectionSceneType("次日清晨，他推门进来。「你来了。」")).not.toBe("transition");
    expect(classifyManhuaDirectionSceneType("近身侍女端茶进来，一脚踹开门")).toBe("default");
    // 剧本体对白、ASCII 双引号、『』 都能判成对白戏
    expect(classifyManhuaDirectionSceneType("阿菁：你来了 墨屠：嗯，来了")).toBe("dialogue");
    expect(classifyManhuaDirectionSceneType('她说 "你走吧"，他答 "我不走"')).toBe("dialogue");
    expect(classifyManhuaDirectionSceneType("『你是谁』『护你的人』")).toBe("dialogue");
    // 审查 P2-2：场头/技术标签不是对白
    expect(classifyManhuaDirectionSceneType("场景：客栈内 时间：夜")).toBe("default");
    expect(classifyManhuaDirectionSceneType("地点：客栈 时间：次日清晨 人物：阿菁、墨屠")).toBe("default");
    expect(classifyManhuaDirectionSceneType("镜头：仰拍 光线：逆光 情绪：压抑")).toBe("default");
    expect(classifyManhuaDirectionSceneType("特写：阿菁的手指在发抖 全景：雨夜街口")).toBe("default");
    expect(classifyManhuaDirectionSceneType("注：此处不要出现刀。 备注：换成夜景")).toBe("default");
    expect(classifyManhuaDirectionSceneType("字幕「三年后」 镜头「仰拍」")).toBe("default");
    expect(classifyManhuaDirectionSceneType("时间：夜 地点：城门 家丁拔刀砍来，墨屠挥拳击退")).toBe("action");
  });

  it("剥离：闭合哨兵定边界，块后面的用户正文不被吞（审查 P2-1）", async () => {
    const lib = await import("./manhuaDirectionCanonLibrary");
    const { resolveDirectorStyleBlocks } = await import("./manhuaDirectionCanon");
    const canon = lib.buildManhuaDirectionCanonFromSelection({ mainCardId: "parallel_action_editing" })!;
    const blocks = resolveDirectorStyleBlocks(canon);
    expect(blocks.storyboard.endsWith("【/导演法典】")).toBe(true);
    const multi = `前文 A\n\n${blocks.storyboard}\n\n用户手写：第三镜要慢。`;
    expect(lib.stripManhuaDirectionStyleBlocks(multi)).toBe("前文 A\n\n用户手写：第三镜要慢。");
    const single = `前文 A ${blocks.storyboard.replace(/\s+/g, " ")} 用户手写：第三镜要慢。`;
    expect(lib.stripManhuaDirectionStyleBlocks(single)).toBe("前文 A 用户手写：第三镜要慢。");
    const clipLine = `镜头说明 ${blocks.clip} 用户备注`;
    expect(lib.stripManhuaDirectionStyleBlocks(clipLine)).toBe("镜头说明 用户备注");
  });
});

describe("manhuaDirectionCanonLibrary（内置卡库 + 标记往返）", () => {
  it("卡库只含过准入的卡，且不含任何导演名/作品名", async () => {
    const lib = await import("./manhuaDirectionCanonLibrary");
    const cards = lib.listManhuaDirectionCards();
    expect(cards.map((c) => c.id).sort()).toEqual(
      ["audience_aligned_discovery", "embodied_fable_system", "human_scale_causal_staging", "kinetic_ensemble", "parallel_action_editing", "relational_action_rhythm"],
    );
    const text = JSON.stringify(cards);
    for (const banned of ["Nolan", "诺兰", "吴宇森", "Woo", "Cameron", "卡梅隆", "Spielberg", "斯皮尔伯格", "del Toro", "托罗", "Justin Lin", "林诣彬", "Inception", "Pinocchio", "Avatar", "Titanic"]) {
      expect(text, banned).not.toContain(banned);
    }
    for (const c of cards) expect(c.rules.every((r) => r.status !== "research_only")).toBe(true);
  });
  it("选卡 → 法典 → 标记 → 回读，一致；未知卡不猜", async () => {
    const lib = await import("./manhuaDirectionCanonLibrary");
    const canon = lib.buildManhuaDirectionCanonFromSelection({
      mainCardId: "parallel_action_editing",
      sceneOverrides: { action: { cardId: "relational_action_rhythm", stages: ["clip"] }, reveal: { cardId: "nope" } },
    });
    expect(canon?.cards.map((c) => c.id)).toEqual(["parallel_action_editing", "relational_action_rhythm"]);
    expect(canon?.sceneOverrides).toEqual({ action: { cardId: "relational_action_rhythm", stages: ["clip"] } });
    const marker = lib.formatManhuaDirectionSelectionMarker(canon!);
    expect(marker).toBe("【导演法典选卡·v1·parallel_action_editing·action=relational_action_rhythm:clip】");
    const back = lib.readManhuaDirectionCanonFromPrompt(`剧本正文\n\n${marker}\n\n更多`);
    expect(back).toEqual(canon);
    expect(lib.buildManhuaDirectionCanonFromSelection({ mainCardId: "mystery_reveal" })).toBeNull();
    expect(lib.readManhuaDirectionCanonFromPrompt("没有标记")).toBeNull();
    const blocks = resolveDirectorStyleBlocks(canon!, "action");
    expect(blocks.clip).toContain("relational_action_rhythm");
    const stripped = lib.stripManhuaDirectionStyleBlocks(`前文\n\n${blocks.story}\n\n${marker}\n\n后文`);
    expect(stripped).toBe("前文\n\n后文");
  });
});
