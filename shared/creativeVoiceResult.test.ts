import { expect, it } from "vitest";
import { creativeVoiceInputSchema, formatVoiceToolResult } from "./creativeVoice";
it("长工具回执仍为完整JSON并明确不可据截断摘要判定结果，不重复下单", () => {
  const receipt = JSON.stringify({tasks:[{taskId:"existing-job",status:"running",text:'"\\'.repeat(12000)}]});
  const result = formatVoiceToolResult(receipt);
  expect(creativeVoiceInputSchema.safeParse({type:"toolResult",id:"call-1",text:result}).success).toBe(true);
  const parsed=JSON.parse(result);
  expect(parsed.incomplete).toBe(true);
  expect(parsed.originalCharacters).toBe(receipt.length);
  expect(parsed.instruction).toContain("不要重复提交付费任务");
  expect(parsed.excerpt).toContain("existing-job");
  expect(creativeVoiceInputSchema.safeParse({type:"toolResult",id:"escaped",text:formatVoiceToolResult("\u0000".repeat(17000))}).success).toBe(true);
  const short=JSON.stringify({taskId:"original",status:"succeeded"});
  expect(formatVoiceToolResult(short)).toBe(short);
});
