import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MANHUA_VIRAL_TEMPLATE_BANK,
  formatManhuaViralTemplateWriterAddon,
  formatManhuaViralTemplateWriterSkillFromCard,
  getManhuaViralTemplate,
  isNativeVideoLearnedTemplate,
  listApprovedManhuaViralTemplates,
  listApprovedManhuaViralTemplatesGrouped,
  mergeManhuaViralTemplateBanks,
  parseManhuaViralTemplateCard,
  recommendApprovedManhuaViralTemplate,
  recommendPublicManhuaViralTemplate,
  toPublicManhuaViralTemplateCard,
  type ManhuaViralTemplateCard,
} from "./manhuaViralTemplateBank";
import { buildManhuaWriterExpandPrompt } from "./manhuaWriterRoom";

/** 学成模板 fixture（种子已下架，动态库条目全走 extras 注入） */
function learnedCard(overrides?: Partial<ManhuaViralTemplateCard>): ManhuaViralTemplateCard {
  return {
    id: "tpl_series_fixture01",
    nameZh: "学成模板样例",
    laneZh: "古言种田",
    classification: {
      emotionTagsZh: ["压迫渐强"],
      narrativeFeatureTagsZh: ["边关经营"],
      performanceTagsZh: ["克制反击"],
      audiovisualTagsZh: ["冷暖对撞"],
      audienceExperienceTagsZh: ["持续紧张"],
    },
    storyStructure: {
      corePromiseZh: "主角每集解决一层生存难题，同时逼近真正目标。",
      conflictEngineZh: "眼前资源短缺与长期权力封锁持续互相放大。",
      relationshipEngineZh: "互不信任的同盟在共同代价中逐步形成。",
      episodeProgressionZh: ["先获得局部行动空间", "再暴露更深层约束"],
      variationRulesZh: ["连续两集不得使用相同胜法", "关系推进必须伴随新代价"],
    },
    summaryZh: "绝境开局→可见升级→片尾钩子。",
    hook3sZh: "开场即绝境，主角先落一个不服输的可见动作。",
    beatGrid: Array.from({ length: 12 }, (_, i) => ({
      atSec: i * 15,
      conflictZh: `冲突${i + 1}`,
      visualZh: `可拍动作${i + 1}`,
    })),
    scenePoolHints: ["边塞", "关隘", "军营"],
    castShape: { leadDesireZh: "活下去并翻盘", pressureZh: "环境压迫+小人盯梢" },
    densityHints: { minBodyChars: 280, minDialogueLines: 8, minLocationHits: 2 },
    sourceRefs: [{ url: "https://example.com/learned", fetchedAt: "2026-08-10" }],
    status: "approved",
    approvedAt: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("manhuaViralTemplateBank", () => {
  it("出厂种子已清空：不带 extras 时产品列表为空", () => {
    expect(MANHUA_VIRAL_TEMPLATE_BANK).toHaveLength(0);
    expect(listApprovedManhuaViralTemplates()).toHaveLength(0);
    expect(listApprovedManhuaViralTemplatesGrouped()).toHaveLength(0);
    expect(getManhuaViralTemplate("tpl_border_farm_revenge")).toBeNull();
  });

  it("merges extras over prior entries by id", () => {
    const base = learnedCard();
    const override = learnedCard({ nameZh: "动态覆盖名" });
    const merged = mergeManhuaViralTemplateBanks([base], [override]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.nameZh).toBe("动态覆盖名");
    expect(
      listApprovedManhuaViralTemplates([override]).some((t) => t.nameZh === "动态覆盖名"),
    ).toBe(true);
  });

  it("lists only approved cards in product API", () => {
    const approved = listApprovedManhuaViralTemplates([
      learnedCard(),
      learnedCard({ id: "tpl_series_fixture02", status: "proposed" }),
      learnedCard({ id: "tpl_series_fixture03", status: "rejected" }),
    ]);
    expect(approved.map((t) => t.id)).toEqual(["tpl_series_fixture01"]);
    expect(approved.every((t) => t.status === "approved")).toBe(true);
  });

  it("严格保留合法优化修订元数据，缺少变更原因时 fail closed 丢弃 revision", () => {
    const revision = {
      parentTemplateId: "tpl_series_fixture01",
      requestId: "request_owner_1234",
      model: "deepseek_v4_0813_high",
      modelName: "deepseek/deepseek-v4-pro-0813",
      reasoningEffort: "high",
      promptZh: "强化前三秒。",
      changedFields: ["hook3sZh"],
      reasons: [{ field: "hook3sZh", reasonZh: "强化悬念。" }],
      createdByUserId: 7,
      createdAt: "2026-08-17T00:00:00.000Z",
    } as const;
    expect(parseManhuaViralTemplateCard({ ...learnedCard(), status: "proposed", revision })?.revision)
      .toMatchObject({ parentTemplateId: "tpl_series_fixture01", changedFields: ["hook3sZh"] });
    expect(parseManhuaViralTemplateCard({
      ...learnedCard(),
      status: "proposed",
      revision: { ...revision, reasons: [] },
    })).toBeNull();
  });

  it("按模型多维标签重复归组，不再使用旧题材赛道", () => {
    const groups = listApprovedManhuaViralTemplatesGrouped([
      learnedCard(),
      learnedCard({
        id: "tpl_series_fixture04",
        classification: {
          emotionTagsZh: ["压迫渐强"],
          narrativeFeatureTagsZh: ["身份揭穿"],
          performanceTagsZh: ["克制反击"],
          audiovisualTagsZh: ["强弱声场切换"],
          audienceExperienceTagsZh: ["持续紧张"],
        },
      }),
    ]);
    expect(groups.map((g) => g.laneZh)).toContain("压迫渐强");
    expect(groups.find((g) => g.laneZh === "压迫渐强")?.items).toHaveLength(2);
    for (const g of groups) {
      expect(g.items.length).toBeGreaterThan(0);
      expect(g.items.every((t) => JSON.stringify(t.classification).includes(g.laneZh))).toBe(true);
    }
  });

  it("无新分类字段的旧 approved 卡仍按 laneZh 可见并可推荐", () => {
    const legacy = learnedCard({ classification: undefined, laneZh: "悬疑权谋" });
    const groups = listApprovedManhuaViralTemplatesGrouped([legacy]);
    expect(groups).toEqual([{ laneZh: "悬疑权谋", items: [legacy] }]);
    expect(recommendApprovedManhuaViralTemplate([legacy], "需要悬疑权谋能力")).toMatchObject({
      id: legacy.id,
    });
    const publicCard = toPublicManhuaViralTemplateCard({ ...legacy, publicCode: "A7F2" });
    expect(publicCard?.classificationTagsZh).toEqual(["悬疑权谋"]);
    expect(recommendPublicManhuaViralTemplate(
      publicCard ? [publicCard] : [],
      "需要悬疑权谋能力",
    )).toMatchObject({ publicId: "mt_a7f2" });
  });

  it("formats writer addon for approved id only", () => {
    const extras = [learnedCard(), learnedCard({ id: "tpl_series_fixture05", status: "proposed" })];
    const addon = formatManhuaViralTemplateWriterAddon("tpl_series_fixture01", extras);
    expect(addon).toMatch(/节奏模板/);
    expect(addon).toMatch(/学成模板样例/);
    expect(addon).toMatch(/节拍格/);
    expect(addon).toMatch(/核心故事承诺：主角每集解决一层生存难题/);
    expect(addon).toMatch(/关系变化引擎：互不信任的同盟/);
    expect(addon).toMatch(/避免重复规则：连续两集不得使用相同胜法/);
    expect(formatManhuaViralTemplateWriterAddon("tpl_series_fixture05", extras)).toBe("");
    expect(formatManhuaViralTemplateWriterAddon("tpl_does_not_exist", extras)).toBe("");
  });

  it("proposal stub json is parseable but not listed as approved", () => {
    const raw = JSON.parse(
      readFileSync(
        join(process.cwd(), "docs/manhua-template-lab/proposals/tpl_proposal_example_stub.json"),
        "utf8",
      ),
    );
    const card = parseManhuaViralTemplateCard(raw);
    expect(card?.id).toBe("tpl_proposal_example_stub");
    expect(card?.status).toBe("rejected");
    expect(getManhuaViralTemplate("tpl_proposal_example_stub")).toBeNull();
    expect(listApprovedManhuaViralTemplates().some((t) => t.id === card!.id)).toBe(false);
  });

  it("formatManhuaViralTemplateWriterAddon still compiles a card standalone", () => {
    const addon = formatManhuaViralTemplateWriterAddon("tpl_series_fixture01", [learnedCard()], "short");
    expect(addon).toMatch(/【节奏模板·骨架建议】/);
    expect(addon).toMatch(/密度建议/);
    expect(addon).toMatch(/边塞/);
  });

  it("只在话题明确命中多维特征时推荐 approved Skill", () => {
    const cards = [learnedCard(), learnedCard({
      id: "tpl_series_fixture06",
      classification: {
        emotionTagsZh: ["轻松暧昧"],
        narrativeFeatureTagsZh: ["关系试探"],
        performanceTagsZh: ["欲言又止"],
        audiovisualTagsZh: ["暖色近景"],
        audienceExperienceTagsZh: ["甜感期待"],
      },
    })];
    expect(recommendApprovedManhuaViralTemplate(cards, "边关经营与克制反击")).toMatchObject({
      id: "tpl_series_fixture01",
    });
    expect(recommendApprovedManhuaViralTemplate(cards, "关系试探带来甜感期待")).toMatchObject({
      id: "tpl_series_fixture06",
    });
    expect(recommendApprovedManhuaViralTemplate(cards, "没有明确类型的故事")).toBeNull();
  });

  it("writer Skill exposes only category and intro, not rigid beat/density details", () => {
    const skill = formatManhuaViralTemplateWriterSkillFromCard(learnedCard());
    expect(skill).toMatch(/多维特征：压迫渐强/);
    expect(skill).not.toMatch(/分类：古言种田/);
    expect(skill).toMatch(/能力简介：绝境开局/);
    expect(skill).toMatch(/核心故事承诺：主角每集解决一层生存难题/);
    expect(skill).toMatch(/持续冲突引擎：眼前资源短缺/);
    expect(skill).toMatch(/跨集推进规律：先获得局部行动空间/);
    expect(skill).toMatch(/避免重复规则：连续两集不得使用相同胜法/);
    expect(skill).not.toMatch(/节拍格|密度建议|正文≥|人设槽|场景池/);
  });

  it("buildManhuaWriterExpandPrompt injects the server-compiled Skill as a soft strategy", () => {
    const addon = formatManhuaViralTemplateWriterSkillFromCard(learnedCard());
    const prompt = buildManhuaWriterExpandPrompt({
      topic: "边关开荒翻盘连载",
      brief: "女主被发配",
      episodeCount: 3,
      viralTemplateId: "tpl_series_fixture01",
      viralTemplateAddon: addon,
    });
    expect(prompt).toMatch(/【可调用的创作 Skill】/);
    expect(prompt).toMatch(/增强策略，不是固定公式/);
    expect(prompt).toMatch(/与本剧冲突的节拍直接舍弃/);
    expect(prompt).not.toMatch(/节拍格|密度建议|正文≥|人设槽|场景池/);
  });
});

describe("PublicManhuaViralTemplateCard 匿名化边界（2026-08-15 审查必须修）", () => {
  const secretCard = {
    id: "tpl_series_deadbeef0001",
    nameZh: "某爆款剧真名节奏",
    laneZh: "爽文逆袭",
    summaryZh: "内部摘要SECRET_SUMMARY",
    hook3sZh: "内部钩子SECRET_HOOK",
    beatGrid: [
      { atSec: 0, conflictZh: "冲突SECRET_BEAT", visualZh: "画面SECRET_VISUAL" },
      { atSec: 3, conflictZh: "冲突2", visualZh: "画面2" },
    ],
    scenePoolHints: ["场景SECRET_SCENE"],
    castShape: { leadDesireZh: "欲望SECRET", pressureZh: "压力SECRET" },
    densityHints: { minBodyChars: 280, minDialogueLines: 12, minLocationHits: 2 },
    sourceRefs: [{ url: "https://douyin.example/SECRET_URL", fetchedAt: "2026-08-01" }],
    status: "approved",
    publicCode: "A7F2",
    provenance: { proposalPolish: { provider: "SECRET_PROVIDER", model: "m", attempted: true, success: true } },
    privateFutureField: "SECRET_FUTURE",
  } as unknown as ManhuaViralTemplateCard;

  it("公开卡不含任何内部字段与自由文本（含未来新增字段）", () => {
    const pub = toPublicManhuaViralTemplateCard(secretCard, { featureZh: "特色A", introZh: "简介B" });
    expect(pub).not.toBeNull();
    const wire = JSON.stringify(pub);
    for (const leak of [
      "tpl_series", "真名", "SECRET_SUMMARY", "SECRET_HOOK", "SECRET_BEAT", "SECRET_VISUAL",
      "SECRET_SCENE", "SECRET_URL", "SECRET_PROVIDER", "SECRET_FUTURE", "sourceRefs", "provenance",
    ]) {
      expect(wire).not.toContain(leak);
    }
    expect(Object.keys(pub!).sort()).toEqual(
      ["beatCount", "classificationTagsZh", "densityLevel", "featureZh", "introZh", "laneZh", "nameZh", "publicId"].sort(),
    );
  });

  it("句柄/名称/密度档正确派生", () => {
    const pub = toPublicManhuaViralTemplateCard(secretCard, null)!;
    expect(pub.publicId).toBe("mt_a7f2");
    expect(pub.publicId).toMatch(/^mt_[a-z0-9]{4,8}$/);
    expect(pub.nameZh).toBe("爽文逆袭·创作模板 A7F2");
    expect(pub.beatCount).toBe(2);
    expect(pub.densityLevel).toBe("dense");
  });

  it("无 publicCode 的卡拒绝公开（返回 null，不回退内部 id）", () => {
    const noCode = { ...secretCard, publicCode: undefined } as ManhuaViralTemplateCard;
    expect(toPublicManhuaViralTemplateCard(noCode, null)).toBeNull();
  });

  it("parse 白名单接受合法 publicCode、拒绝畸形值", () => {
    const ok = parseManhuaViralTemplateCard({ ...secretCard });
    expect(ok?.publicCode).toBe("A7F2");
    const bad = parseManhuaViralTemplateCard({ ...secretCard, publicCode: "tpl_series_x" });
    expect(bad?.publicCode).toBeUndefined();
  });
});

describe("原生视频精读产出入库（0824）", () => {
  it("逐镜六栏与两个新字段能解析落库；抽帧旧卡不带这些字段仍然有效", () => {
    const native = parseManhuaViralTemplateCard({
      ...learnedCard(),
      beatGrid: [
        {
          atSec: 0,
          endSec: 3,
          conflictZh: "开场压制",
          visualZh: "老者指着镜头怒骂",
          shotSizeZh: "中近景",
          angleZh: "平视",
          cameraMoveZh: "约2秒内从中景匀速推至面部近景",
          lightingZh: "顶光，背景暗，人物面部受光",
          transitionInZh: "硬切",
        },
      ],
      reusableZh: "用机位稳定性区分攻守：沉稳方给固定正面特写，浮躁方给手势多动的特写。",
      genPromptHintZh: "体积雾 · 逆光轮廓光 · 低饱和冷灰蓝加暖金点缀 · 浅景深",
    });
    expect(native).not.toBeNull();
    const beat = native!.beatGrid[0]!;
    expect(beat.shotSizeZh).toBe("中近景");
    expect(beat.cameraMoveZh).toContain("推至面部近景");
    expect(beat.endSec).toBe(3);
    expect(native!.reusableZh).toContain("机位稳定性");
    expect(native!.genPromptHintZh).toContain("体积雾");

    // 向后兼容：抽帧链路产出没有六栏，解析后应为 undefined 而不是空串
    const legacy = parseManhuaViralTemplateCard(learnedCard());
    expect(legacy).not.toBeNull();
    expect(legacy!.beatGrid[0]!.shotSizeZh).toBeUndefined();
    expect(legacy!.reusableZh).toBeUndefined();
  });

  it("beatGrid 上限放到 128：精读逐镜实测 262 秒出 95 镜，卡在 24 会静默截断", () => {
    const many = parseManhuaViralTemplateCard({
      ...learnedCard(),
      beatGrid: Array.from({ length: 95 }, (_, i) => ({
        atSec: i * 2,
        conflictZh: `镜${i + 1}`,
        visualZh: `动作${i + 1}`,
        shotSizeZh: "特写",
      })),
    });
    expect(many!.beatGrid).toHaveLength(95);
  });

  it("isNativeVideoLearnedTemplate 认得出新旧形态", () => {
    expect(isNativeVideoLearnedTemplate(learnedCard())).toBe(false);
    expect(
      isNativeVideoLearnedTemplate({ ...learnedCard(), reusableZh: "通用手法一句" }),
    ).toBe(true);
    expect(
      isNativeVideoLearnedTemplate({
        ...learnedCard(),
        beatGrid: [{ atSec: 0, conflictZh: "c", visualZh: "v", cameraMoveZh: "固定机位" }],
      }),
    ).toBe(true);
  });
});
