import { expect, it } from "vitest";
import { parseAskJson } from "./platformSkillQa";
it("已严格校验的剪辑方案保留完整长字幕，普通字幕咨询仍沿用容量门禁", () => {
  const answer = JSON.stringify({ sourceSrt: "原片完整对白。".repeat(2500), plans: [{ title: "短版" }] });
  const raw = JSON.stringify({ answer });
  expect(parseAskJson(raw, true, true).answer).toBe(answer);
  expect(() => parseAskJson(raw, true)).toThrow("完整处理范围");
});
