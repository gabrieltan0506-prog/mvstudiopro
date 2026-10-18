import { expect, it } from "vitest";
import { digitalHumanDraftExport, digitalHumanDraftReadError } from "./digitalHumanDraftRecovery";
import { loadDigitalHumanDraft, newDigitalHumanDraft } from "@shared/digitalHumanStudio";

it("超旧1500字的导演原稿完整恢复，失败导出不会替换为空稿", () => {
  const draft = newDigitalHumanDraft("7", "00000000-0000-4000-8000-000000000007");
  draft.direction = "导".repeat(19996) + "完整结尾";
  const raw = JSON.stringify(draft);
  expect(loadDigitalHumanDraft(raw, "7")?.direction).toBe(draft.direction);
  const invalid = raw.slice(0, -1);
  expect(digitalHumanDraftExport(invalid, { script: "" }, true)).toBe(invalid);
  expect(() => digitalHumanDraftExport(null, {}, true)).toThrow("未导出空稿");
});
it("旧限制错误转为恢复提示而非校验器JSON", () => {
  const text = digitalHumanDraftReadError({ issues: [{ path: ["direction"], code: "too_big", maximum: 1500 }] });
  expect(text).toContain("旧版"); expect(text).toContain("导出原始草稿");
  expect(text).not.toContain("too_big"); expect(text).not.toContain("direction");
  expect(digitalHumanDraftReadError(new SyntaxError("JSON"))).toContain("未覆盖云端");
});
