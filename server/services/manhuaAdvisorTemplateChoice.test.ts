import { expect, it, vi } from "vitest";
const { resolve } = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("./manhuaAdvisorKnowledge", () => ({ resolveManhuaAdvisorKnowledgeTemplate: resolve }));
import { buildAdvisorTemplateChoiceReference } from "./manhuaAdvisorTemplateChoice";
import { attachLearnedMethodBrief } from "./manhuaTemplateMethodBrief";
import type { ManhuaViralTemplateCard } from "../../shared/manhuaViralTemplateBank";
it("选择只使用已批准模板真实亮点，保留推荐顺序，不让用户输入编号", async () => {
  resolve.mockImplementation(async id => ({ appliedTemplate: { publicId: id, nameZh: "匿名模板" }, card: attachLearnedMethodBrief({ id: "private", status: "approved", publicCode: id.slice(3), summaryZh: "中性能力", reusableZh: "先留问题再揭晓", beatGrid: [], laneZh: "悬疑权谋" } as unknown as ManhuaViralTemplateCard, { title: "先让观众产生疑问", highlights: ["开头给一条不完整的线索", "让对话慢慢揭开答案"], useWhen: "主角正在寻找真相" }) }));
  const result = await buildAdvisorTemplateChoiceReference(["mt_c789", "mt_a123"]);
  expect(result.cards.map(c => c.publicId)).toEqual(["mt_c789", "mt_a123"]);
  expect(result.text).toContain("brief:0:开头给一条不完整的线索");
  expect(result.text).toContain("不要求用户记忆");
  expect(result.text).not.toContain('"private"');
  resolve.mockResolvedValue({ error: "refresh_required" });
  await expect(buildAdvisorTemplateChoiceReference(["mt_a123"])).rejects.toThrow("已经变化");
});
