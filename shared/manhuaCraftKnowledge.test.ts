import { expect, it } from "vitest";
import { MANHUA_CRAFT_CATEGORIES, MANHUA_CRAFT_LESSONS, buildManhuaCraftReference } from "./manhuaCraftKnowledge";
import { MANHUA_CRAFT_SOURCES } from "./manhuaCraftSources";
it("27份真实来源都有分类与应用边界，覆盖六类工作流知识", () => {
  expect(MANHUA_CRAFT_SOURCES).toHaveLength(27);
  const ids = new Set(MANHUA_CRAFT_SOURCES.map(s => s.id));
  const used = new Set(MANHUA_CRAFT_LESSONS.flatMap(c => c.sourceIds));
  expect(used).toEqual(ids);
  expect(new Set(MANHUA_CRAFT_LESSONS.map(c => c.category)).size).toBe(MANHUA_CRAFT_CATEGORIES.length);
  expect(MANHUA_CRAFT_LESSONS.every(c => c.method && c.boundary && c.sourceIds.every(id => ids.has(id as any)))).toBe(true);
  expect(MANHUA_CRAFT_SOURCES.every(s => /^[a-f0-9]{64}$/.test(s.sha256))).toBe(true);
});
it("用户用自然语言即可选读，摄影与固定镜长的纠偏进入参考", () => {
  expect(buildManhuaCraftReference("白平衡色温")).toContain("调相机还是描述光源");
  expect(buildManhuaCraftReference("镜长台词怎么安排")).toContain("不是通用规则");
  expect(buildManhuaCraftReference("天气预报")).toBe("");
});
