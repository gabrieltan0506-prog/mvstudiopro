import { it, expect } from "vitest";
import {
  templateGuidance,
  suggestedTemplateRole,
  CRAFT_USAGE,
} from "./manhuaTemplateGuidance";
import { TEMPLATE_CRAFT_RULES } from "./manhuaTemplateCraft";
it("only explains indexed methods, never infers skills from genre or invents missing profiles", () => {
  expect(templateGuidance()).toEqual([]);
  expect(suggestedTemplateRole()).toBe("");
  const profile = {
    version: 1 as const,
    features: [
      {
        id: "verbal-tactics" as const,
        dimension: "dialogue" as const,
        label: "对白试探与攻防",
      },
    ],
  };
  expect(templateGuidance(profile)).toHaveLength(1);
  expect(templateGuidance(profile)[0].usage).toContain("交换条件");
  expect(suggestedTemplateRole(profile)).toBe("负责对白试探与攻防");
  for (const r of TEMPLATE_CRAFT_RULES)
    expect(CRAFT_USAGE[r.id].length).toBeGreaterThan(15);
});
