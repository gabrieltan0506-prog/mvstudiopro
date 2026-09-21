import { expect, it } from "vitest";
import { formatEvolinkReferencePrompt } from "./evolinkReferencePrompt";
it("同一镜头转不同供应商写法，保留对白和身份标签", () => {
  const original = '@角色2沿@图片12构图，以@video2动作为参考，按@音频3说“娘，抓紧我”。';
  expect(formatEvolinkReferencePrompt(original, "seedance")).toBe('@角色2沿@image12构图，以@video2动作为参考，按@audio3说“娘，抓紧我”。');
  for (const model of ["wan", "h3"] as const) {
    const result = formatEvolinkReferencePrompt(original, model);
    expect(result).toBe('@角色2沿Image 12构图，以Video 2动作为参考，按Audio 3说“娘，抓紧我”。');
    expect(formatEvolinkReferencePrompt(result, model)).toBe(result);
  }
});
