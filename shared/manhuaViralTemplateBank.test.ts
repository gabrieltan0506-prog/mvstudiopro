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
