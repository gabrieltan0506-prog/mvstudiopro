import { describe, expect, it } from "vitest";
import { compareTemplateText } from "./manhuaTemplatePhraseDiff";

describe("模板试写片段高亮", () => {
  it("只高亮插入的文字，不染公共文字和标点", () => {
    const diff = compareTemplateText("他推门而入。", "他猛地推门而入。");
    expect(diff.before.filter((part) => part.changed)).toEqual([]);
    expect(diff.after.filter((part) => part.changed).map((part) => part.text)).toEqual(["猛地"]);
    expect(diff.after.map((part) => part.text).join("")).toBe("他猛地推门而入。");
  });

  it("删除与替换只标变动片段", () => {
    const removed = compareTemplateText("他猛地推门而入。", "他推门而入。");
    expect(removed.before.filter((part) => part.changed).map((part) => part.text)).toEqual(["猛地"]);
    expect(removed.after.filter((part) => part.changed)).toEqual([]);
    const replaced = compareTemplateText("他悄悄推门。", "他猛地推门。");
    expect(replaced.before.filter((part) => part.changed).map((part) => part.text)).toEqual(["悄悄"]);
    expect(replaced.after.filter((part) => part.changed).map((part) => part.text)).toEqual(["猛地"]);
  });
});
