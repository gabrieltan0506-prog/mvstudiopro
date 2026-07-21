import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatManhuaViralTemplateWriterAddon,
  getManhuaViralTemplate,
  listApprovedManhuaViralTemplates,
  listApprovedManhuaViralTemplatesGrouped,
  parseManhuaViralTemplateCard,
} from "./manhuaViralTemplateBank";
import { buildManhuaWriterExpandPrompt } from "./manhuaWriterRoom";

describe("manhuaViralTemplateBank", () => {
  it("lists only approved cards in product API", () => {
    const approved = listApprovedManhuaViralTemplates();
    expect(approved.length).toBeGreaterThanOrEqual(3);
    expect(approved.every((t) => t.status === "approved")).toBe(true);
    expect(approved.some((t) => t.id === "tpl_proposal_example_stub")).toBe(false);
  });

  it("groups by lane order without empty lanes", () => {
    const groups = listApprovedManhuaViralTemplatesGrouped();
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g.items.length).toBeGreaterThan(0);
      expect(g.items.every((t) => t.laneZh === g.laneZh)).toBe(true);
    }
  });

  it("formats writer addon for approved id only", () => {
    const addon = formatManhuaViralTemplateWriterAddon("tpl_border_farm_revenge");
    expect(addon).toMatch(/节奏模板/);
    expect(addon).toMatch(/边关开荒翻盘/);
    expect(addon).toMatch(/节拍格/);
    expect(addon).not.toMatch(/发配边关/);
    expect(formatManhuaViralTemplateWriterAddon("tpl_does_not_exist")).toBe("");
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

  it("injects viral template into expand prompt", () => {
    const prompt = buildManhuaWriterExpandPrompt({
      topic: "边关开荒翻盘连载",
      brief: "女主被发配",
      episodeCount: 3,
      viralTemplateId: "tpl_border_farm_revenge",
    });
    expect(prompt).toMatch(/【节奏模板·骨架建议】/);
    expect(prompt).toMatch(/密度建议/);
    expect(prompt).toMatch(/边塞/);
  });
});
