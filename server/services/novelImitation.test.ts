import { describe, it, expect, vi } from "vitest";
vi.mock("./manhuaViralTemplateStore", () => ({
  listMergedApprovedManhuaViralTemplatesGrouped: vi.fn(),
  resolveViralTemplateForExpand: vi.fn(),
}));
vi.mock("./manhuaNovelAdaptationRun", () => ({ callNovelStage: vi.fn() }));
import {
  buildNovelTestPrompt,
  executeNovelTest,
  novelImitationCraftBlock,
  novelImitationSkeletonFailureMessage,
} from "./novelWorkspaceTest";
import { NovelImitationSkeletonError } from "./novelImitationSkeleton";
import {
  formatNovelImitationOutline,
  novelTestInputSchema,
  validateNovelStageOutput,
} from "../../shared/novelWorkspace";
import { novelWorkspaceStateSchema } from "../../shared/novelWorkspaceState";
import { getNovelCraftCards } from "../../shared/novelCraftCards";
import {
  NOVEL_IMITATION_CRAFT_CARD_ID,
  NOVEL_IMITATION_UI,
  NOVEL_IMITATION_BASE_MAX_CHARS,
  novelImitationSubmitBlock,
} from "../../shared/novelImitationPrompt";
import {
  NOVEL_IMITATION_EPISODE_CREDITS,
  NOVEL_IMITATION_SKELETON_CREDITS,
} from "../../shared/novelImitation";
import { findNovelNameOverlaps, findNovelSentenceOverlaps } from "../../shared/novelOriginalityCheck";
import { buildNovelCraftTaskBrief } from "./novelCraftRetrieval";
import { buildNovelCatalogShortlistPrompt } from "./novelCatalogShortlist";

const skeleton = [
  { index: 1, name: "开局受压", function: "钩子", position: "第1章", roles: ["主角", "对手"], summary: "主角当众失去应得之物" },
  { index: 2, name: "首次反击", function: "爽点", position: "约10%", roles: ["主角", "助力"], summary: "主角借对手忽视的细节扳回一局" },
];
const imitation = {
  genre: "都市职场逆袭",
  synopsis: "实习生林晚被抢功后，靠账本里的漏洞一步步翻盘。",
  skeleton,
  avoidNames: ["萧玄", "天机阁"],
};
const base = {
  requestId: "11111111-1111-4111-8111-111111111111",
  roundId: "22222222-2222-4222-8222-222222222222",
  topic: "账本",
  direction: "小人物翻身，步步反击",
  templates: [{ publicId: "mt_a", role: "主骨架", weight: 100 }],
  episodeCount: 2,
};
const outlineInput = novelTestInputSchema.parse({ ...base, stage: "outline", imitation });
const chapterInput = novelTestInputSchema.parse({
  ...base,
  stage: "chapter",
  imitation,
  outline: "第1集：开局\n剧情：……",
  chapterIndex: 1,
});
const plan = {
  structure: [
    { beat: "开局受压", function: "钩子", role: "主角当众失去本该属于自己的东西" },
    { beat: "首次反击", function: "爽点", role: "用对手忽视的细节扳回一局" },
  ],
  premise: "被抢功的实习生要拿回署名",
  characters: "林晚：想转正；组长：怕暴露旧账",
  episodes: [
    {
      index: 1,
      title: "署名",
      events: "林晚的方案被组长署名",
      hook: "账本少了一页",
      payoff: "林晚找到第一处漏洞",
      beats: [{ beat: "开局受压", function: "钩子", content: "例会上方案署名被换" }],
    },
    {
      index: 2,
      title: "第一页",
      events: "林晚用漏洞让组长当众改口",
      hook: "总监注意到她",
      payoff: "署名回到她手里",
      beats: [{ beat: "首次反击", function: "爽点", content: "林晚当场核对数字" }],
    },
  ],
};

describe("爆款仿写：请求与草稿", () => {
  it("请求带新题材、纲要、底稿骨架与避用名称；大纲阶段必须带骨架；旧请求不带此字段照常解析", () => {
    expect(outlineInput.imitation).toEqual(imitation);
    expect(() =>
      novelTestInputSchema.parse({ ...base, stage: "outline", imitation: { genre: "a", synopsis: "b" } })
    ).toThrow("请先拆解底稿结构");
    const old = novelTestInputSchema.parse({ ...base, stage: "outline" });
    expect(old.imitation).toBeUndefined();
  });
  it("旧草稿（无仿写字段、mode=source/original）照常读取；新草稿可存 imitation 模式与题材纲要", () => {
    const draft = {
      roundId: base.roundId,
      topic: "旧作",
      direction: "旧方向",
      mode: "original",
      source: null,
      templates: [],
      episodeCount: 3,
      outline: "",
      outlineApproved: "",
      chapters: [],
      novelApproved: "",
      runs: [],
    };
    const old = novelWorkspaceStateSchema.parse(draft);
    expect(old.mode).toBe("original");
    expect(old.imitationGenre).toBeUndefined();
    expect(novelWorkspaceStateSchema.parse({ ...draft, mode: "source" }).mode).toBe("source");
    const next = novelWorkspaceStateSchema.parse({
      ...draft,
      mode: "imitation",
      imitationGenre: imitation.genre,
      imitationSynopsis: imitation.synopsis,
      runs: [
        {
          input: outlineInput,
          result: {
            requestId: base.requestId,
            stage: "outline",
            text: "{}",
            templateIds: ["mt_a"],
            inputSha256: "a",
            resultSha256: "b",
          },
        },
      ],
    });
    expect(next.imitationSynopsis).toBe(imitation.synopsis);
    const withSkeleton = novelWorkspaceStateSchema.parse({
      ...draft,
      mode: "imitation",
      imitationSkeleton: { baseSha256: "x", savedAt: "2026-11-12", skeleton: { beats: skeleton, properNouns: ["萧玄"] } },
    });
    expect(withSkeleton.imitationSkeleton?.skeleton.beats).toHaveLength(2);
  });
  it("参考价：底稿拆解30积分/次，仿写正文15积分/集，界面文案带出两项", () => {
    expect(NOVEL_IMITATION_SKELETON_CREDITS).toBe(30);
    expect(NOVEL_IMITATION_EPISODE_CREDITS).toBe(15);
    expect(NOVEL_IMITATION_UI.priceNote(30, 15)).toContain("30 积分");
    expect(NOVEL_IMITATION_UI.priceNote(30, 15)).toContain("15 积分");
  });
  it("未导入底稿时拦住提交；底稿过长、缺题材纲要、未拆骨架、未选模板分别提示", () => {
    const ok = { stage: "outline" as const, baseText: "原文".repeat(100), genre: "g", synopsis: "s", templateCount: 1, skeletonReady: true };
    expect(novelImitationSubmitBlock(ok)).toBeNull();
    expect(novelImitationSubmitBlock({ ...ok, baseText: "" })).toBe("请先导入要仿写的原文。");
    expect(novelImitationSubmitBlock({ ...ok, stage: "advice", baseText: "  " })).toBe("请先导入要仿写的原文。");
    expect(novelImitationSubmitBlock({ ...ok, baseText: "字".repeat(NOVEL_IMITATION_BASE_MAX_CHARS + 1) })).toBe(NOVEL_IMITATION_UI.baseTooLong);
    expect(novelImitationSubmitBlock({ ...ok, genre: "" })).toBe(NOVEL_IMITATION_UI.missingGenre);
    expect(novelImitationSubmitBlock({ ...ok, synopsis: " " })).toBe(NOVEL_IMITATION_UI.missingSynopsis);
    expect(novelImitationSubmitBlock({ ...ok, skeletonReady: false })).toBe(NOVEL_IMITATION_UI.missingSkeleton);
    expect(novelImitationSubmitBlock({ ...ok, stage: "advice", skeletonReady: false, templateCount: 0 })).toBeNull();
    expect(novelImitationSubmitBlock({ ...ok, templateCount: 0 })).toBe(NOVEL_IMITATION_UI.missingTemplates);
  });
});

describe("爆款仿写：提示词", () => {
  it("大纲阶段为结构锁定：先拆骨架节拍，再逐拍写本作内容，并带示例作品的命名与情节约束", () => {
    const prompt = buildNovelTestPrompt(outlineInput, "模板手法", []);
    for (const value of [
      "结构锁定",
      "以imitationBrief.skeleton的底稿节拍为准",
      "参考已选模板加固",
      "逐节拍写出用户新故事在这一拍发生什么",
      '"structure"',
      '"beats"',
      "钩子",
      "卷末悬念",
      "不得沿用底稿或模板示例作品的人名",
      "天机阁",
      "首次反击",
      "金手指",
      "具体桥段与原句",
      imitation.synopsis,
    ])
      expect(prompt).toContain(value);
    expect(prompt).not.toContain("只生成 2 集的可编辑提案，不生成小说或剧本。\n\n组合模板");
  });
  it("提示词里的自写规则措辞保持中性", () => {
    const own = buildNovelTestPrompt(outlineInput, "", []).replace(
      novelImitationCraftBlock(outlineInput).join("\n\n"),
      ""
    );
    for (const word of ["侵权", "抄袭", "洗稿", "查重"]) expect(own).not.toContain(word);
  });
  it("大纲与正文阶段必带站长仿写卡；顾问与剧本阶段、非仿写请求不注入", () => {
    const card = getNovelCraftCards([NOVEL_IMITATION_CRAFT_CARD_ID])[0]!;
    expect(buildNovelTestPrompt(outlineInput, "", [])).toContain(card.body);
    expect(buildNovelTestPrompt(chapterInput, "", [])).toContain(card.body);
    expect(buildNovelTestPrompt(chapterInput, "", [])).toContain("仿写正文");
    const advice = novelTestInputSchema.parse({ ...base, stage: "advice", imitation });
    expect(novelImitationCraftBlock(advice)).toEqual([]);
    expect(buildNovelTestPrompt(advice, "", [])).toContain("加固底稿骨架");
    const plain = novelTestInputSchema.parse({ ...base, stage: "outline" });
    expect(buildNovelTestPrompt(plain, "", [])).not.toContain(card.body);
    expect(buildNovelTestPrompt(plain, "", [])).not.toContain("结构锁定");
  });
  it("技法检索与目录初选在没有底本时使用题材与纲要", () => {
    expect(buildNovelCraftTaskBrief(outlineInput)).toContain(imitation.synopsis);
    expect(
      buildNovelCatalogShortlistPrompt({ ...outlineInput, stage: "advice" }, [])
    ).toContain(imitation.synopsis);
  });
});

describe("爆款仿写：结构对照大纲", () => {
  it("校验带节拍的大纲；格式化后每集保留「第N集：」与结构节拍行", () => {
    const value = validateNovelStageOutput(outlineInput, plan, []);
    expect(value).toEqual(plan);
    const text = formatNovelImitationOutline(plan);
    expect(text).toContain("结构骨架（模板节拍）");
    expect(text).toContain("第1集：署名");
    expect(text).toContain("结构节拍：开局受压【钩子】例会上方案署名被换");
    expect(() =>
      validateNovelStageOutput(outlineInput, { ...plan, episodes: plan.episodes.map(({ beats: _, ...e }) => e) }, [])
    ).toThrow();
  });
  it("executeNovelTest 走同一条保存与校验流程", async () => {
    const saveRaw = vi.fn(async () => {});
    const out = await executeNovelTest(
      outlineInput,
      "",
      [],
      async () => ({ text: JSON.stringify(plan), model: "test" }),
      saveRaw
    );
    expect(saveRaw).toHaveBeenCalled();
    expect(out).toEqual(plan);
  });
});

describe("爆款仿写：原创度自查接线（纯代码比对）", () => {
  const baseText = "萧玄推开天机阁的大门，冷风灌进来，他低声说今夜必须把账算清楚。";
  it("重名：命中与不命中", () => {
    expect(findNovelNameOverlaps("林晚走进天机阁", ["萧玄", "天机阁"])).toEqual(["天机阁"]);
    expect(findNovelNameOverlaps("林晚走进档案室", ["萧玄", "天机阁"])).toEqual([]);
    expect(NOVEL_IMITATION_UI.originalityNames(["天机阁"])).toBe("以下名称与底稿重名，建议换成你自己的命名：天机阁");
  });
  it("句子重合：命中与不命中", () => {
    expect(findNovelSentenceOverlaps("她回头，冷风灌进来，他低声说今夜必须把账算清楚。", baseText).length).toBe(1);
    expect(findNovelSentenceOverlaps("林晚把报表摊开，一行行核对昨晚的数字。", baseText)).toEqual([]);
  });
  it("拆解失败带回中性的可重试提示（含片号），不吞错", () => {
    const shard = new NovelImitationSkeletonError("NOVEL_IMITATION_SKELETON_SHARD_FAILED", "x", [{ shard: 3, reason: "not_json" }], 5);
    expect(novelImitationSkeletonFailureMessage(shard)).toBe("底稿结构整理未完成：第3片未成功，可重新提交，已完成部分不会重做。");
    expect(novelImitationSkeletonFailureMessage(new NovelImitationSkeletonError("NOVEL_IMITATION_SKELETON_MERGE_FAILED", "x"))).toContain("汇总");
    expect(novelImitationSkeletonFailureMessage(new Error("boom"))).toContain("可稍后重新提交");
  });
  it("前台文案不含定性用语", () => {
    const all = JSON.stringify(
      Object.values(NOVEL_IMITATION_UI).map(v =>
        typeof v === "function" ? (v as (...a: unknown[]) => string)(["甲"], 1) : v
      )
    );
    for (const word of ["侵权", "抄袭", "洗稿", "触线", "违规", "相似度", "查重", "版权", "闸门"])
      expect(all).not.toContain(word);
  });
});
