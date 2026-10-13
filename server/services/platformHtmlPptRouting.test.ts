import { afterEach, expect, it, vi } from "vitest";
vi.mock("../_core/llm", () => ({ invokeLLM: vi.fn(), extractFirstChoicePlainText: (r: { text: string }) => r.text }));
import { invokeLLM } from "../_core/llm";
import { generateHtmlPptOutline, suggestHtmlPptThemes, patchHtmlPptPage } from "./platformHtmlPptOutline";
import { MANHUA_ADVISOR_HOPS } from "./openrouterDeepSeekV41Flash";
import { SseContentSafetyError } from "./sseChatStream";
afterEach(() => vi.resetAllMocks());
const themes = { title: "数据汇报", userThemes: ["目标", "数据", "结论"] };
it("主题无效JSON也走同一有界四跳，第四跳返回真实模型", async () => {
  vi.mocked(invokeLLM).mockRejectedValueOnce(new Error("断流")).mockResolvedValueOnce({text:"{}"} as never).mockRejectedValueOnce(new Error("空结果")).mockResolvedValueOnce({text: JSON.stringify({ suggestedThemes:[{title:"目标"},{title:"数据"},{title:"结论"}] })} as never);
  const result=await suggestHtmlPptThemes(themes);
  expect(vi.mocked(invokeLLM).mock.calls.map(([p]) => [p.modelName,p.openAiGateway])).toEqual(MANHUA_ADVISOR_HOPS.map(p=>[p.modelName,p.gateway]));
  expect(result.model).toBe(MANHUA_ADVISOR_HOPS[3].modelName);
});
it("大纲只发GLM low，保留10页真实数据", async () => {
  const pages=Array.from({length:10},(_,i)=>({title:`第${i+1}页`,series:[{label:"原价",value:0.37}]}));
  vi.mocked(invokeLLM).mockResolvedValue({text: JSON.stringify({deckTitle:"数据汇报",pages})} as never);
  const result=await generateHtmlPptOutline({title:"数据汇报",pageCount:10,styleId:"dark_research"});
  expect(result.pages).toHaveLength(10);expect(result.pages[0].series?.[0].value).toBe(0.37);
  expect(invokeLLM).toHaveBeenCalledWith(expect.objectContaining({modelName:"z-ai/glm-5.3-flashx",reasoningEffort:"low"}));
});
it("单页修改失败至多四次", async () => {
  vi.mocked(invokeLLM).mockRejectedValue(new Error("无响应"));
  await expect(patchHtmlPptPage({title:"数据汇报",styleId:"dark_research",page:{title:"原页"},pageIndex:0,totalPages:10,patchNote:"保留数值"})).rejects.toThrow();expect(invokeLLM).toHaveBeenCalledTimes(4);
});
it("内容拒绝不换模型重试", async () => {
  vi.mocked(invokeLLM).mockRejectedValue(new SseContentSafetyError());
  await expect(suggestHtmlPptThemes(themes)).rejects.toThrow();expect(invokeLLM).toHaveBeenCalledTimes(1);
});

it("只填一个主题即可由LLM生成六条完整大纲，不要求已有三条", async () => {
  vi.mocked(invokeLLM).mockResolvedValue({ text: JSON.stringify({ polishedTitle: "新人会议表达", suggestedThemes: ["场景", "问题", "结论", "事实", "下一步", "清单"].map((title, i) => ({ id: `t${i}`, title })) }) } as never);
  const result = await suggestHtmlPptThemes({ title: "新人会议表达", userThemes: [] });
  expect(result.suggestedThemes).toHaveLength(6);
  expect(JSON.stringify(vi.mocked(invokeLLM).mock.calls[0])).toContain("只依据主题生成4–6条完整大纲");
});
