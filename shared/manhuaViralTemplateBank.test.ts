import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MANHUA_VIRAL_TEMPLATE_BANK,
  formatManhuaViralTemplateWriterAddon,
  formatManhuaViralTemplateWriterSkillFromCard,
  getManhuaViralTemplate,
  listApprovedManhuaViralTemplates,
  listApprovedManhuaViralTemplatesGrouped,
  mergeManhuaViralTemplateBanks,
  parseManhuaViralTemplateCard,
  recommendApprovedManhuaViralTemplate,
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

  it("groups by lane order without empty lanes", () => {
    const groups = listApprovedManhuaViralTemplatesGrouped([
      learnedCard(),
      learnedCard({ id: "tpl_series_fixture04", laneZh: "系统觉醒" }),
    ]);
    expect(groups.map((g) => g.laneZh)).toEqual(["古言种田", "系统觉醒"]);
    for (const g of groups) {
      expect(g.items.length).toBeGreaterThan(0);
      expect(g.items.every((t) => t.laneZh === g.laneZh)).toBe(true);
    }
  });

  it("formats writer addon for approved id only", () => {
    const extras = [learnedCard(), learnedCard({ id: "tpl_series_fixture05", status: "proposed" })];
    const addon = formatManhuaViralTemplateWriterAddon("tpl_series_fixture01", extras);
    expect(addon).toMatch(/节奏模板/);
    expect(addon).toMatch(/学成模板样例/);
    expect(addon).toMatch(/节拍格/);
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

  it("recommends an approved Skill only when the topic lane clearly matches", () => {
    const cards = [learnedCard(), learnedCard({ id: "tpl_series_fixture06", laneZh: "甜宠" })];
    expect(recommendApprovedManhuaViralTemplate(cards, "边关古言种田翻盘")).toMatchObject({
      id: "tpl_series_fixture01",
    });
    expect(recommendApprovedManhuaViralTemplate(cards, "先婚后爱甜宠短剧")).toMatchObject({
      id: "tpl_series_fixture06",
    });
    expect(recommendApprovedManhuaViralTemplate(cards, "没有明确类型的故事")).toBeNull();
  });

  it("writer Skill exposes only category and intro, not rigid beat/density details", () => {
    const skill = formatManhuaViralTemplateWriterSkillFromCard(learnedCard());
    expect(skill).toMatch(/分类：古言种田/);
    expect(skill).toMatch(/能力简介：绝境开局/);
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
      ["beatCount", "densityLevel", "featureZh", "introZh", "laneZh", "nameZh", "publicId"].sort(),
    );
  });

  it("句柄/名称/密度档正确派生", () => {
    const pub = toPublicManhuaViralTemplateCard(secretCard, null)!;
    expect(pub.publicId).toBe("mt_a7f2");
    expect(pub.publicId).toMatch(/^mt_[a-z0-9]{4,8}$/);
    expect(pub.nameZh).toBe("爽文逆袭·爆款节奏 A7F2");
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
