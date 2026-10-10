import { expect, it } from "vitest";
import { requestsTemplateRecommendations, validateAdvisorTemplateChoice } from "./manhuaAdvisorTemplateChoice";
import type { PublicManhuaViralTemplateCard } from "./manhuaViralTemplateBank";
const cards = ["mt_a123", "mt_b456", "mt_c789", "mt_d012"].map((publicId, i) => ({ publicId, methodBrief: { title: `思路${i}`, highlights: ["开头留下疑问", "让两人的对话更有来回"] } })) as PublicManhuaViralTemplateCard[];
it("自然表达触发推荐，单选与跨模板亮点组合都合法；错配和重复拒绝", () => {
  expect(requestsTemplateRecommendations("再给我看看其他三种思路")).toBe(true);
  expect(requestsTemplateRecommendations("推荐一段音乐")).toBe(false);
  const raw = { kind: "template-choice", explanation: "开头先留疑问，对话中逐步揭开，还没改稿。", choices: [{ publicId: "mt_a123", features: ["brief:0:开头留下疑问"] }] };
  expect(validateAdvisorTemplateChoice(raw, cards, cards.map(c => c.publicId)).choices).toHaveLength(1);
  raw.choices.push({ publicId: "mt_c789", features: ["brief:1:让两人的对话更有来回"] });
  expect(validateAdvisorTemplateChoice(raw, cards, cards.map(c => c.publicId)).choices).toHaveLength(2);
  expect(() => validateAdvisorTemplateChoice(raw, cards, ["mt_a123"])).toThrow("已更新");
  expect(() => validateAdvisorTemplateChoice({ ...raw, choices: [raw.choices[0], raw.choices[0]] }, cards, cards.map(c => c.publicId))).toThrow("重复");
  expect(() => validateAdvisorTemplateChoice({ ...raw, choices: [{ publicId: "mt_a123", features: ["凭空添加的特色"] }] }, cards, cards.map(c => c.publicId))).toThrow("已更新");
});
