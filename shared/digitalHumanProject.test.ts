import { describe, it, expect } from "vitest";
import {
  digitalHumanDraftSchema,
  newDigitalHumanDraft,
  loadDigitalHumanDraft,
} from "./digitalHumanStudio";
import {
  addDigitalHumanSegment,
  switchDigitalHumanSegment,
  updateDigitalHumanSegment,
  digitalHumanProjectSegments,
} from "./digitalHumanProject";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
describe("多段数字人项目隔离与恢复", () => {
  it("旧稿不丢内容，17段不截断，每段台词场景与导演独立保存", () => {
    let d = newDigitalHumanDraft("7", id(1));
    d.script = "第一段原稿";
    d.scene = { source: "gs://test-only/first", name: "书房" };
    d.direction = "接弹后变装";
    for (let n = 2; n <= 17; n++) {
      d = addDigitalHumanSegment(d, id(n));
      expect(d.script).toBe("");
      expect(d.scene).toBeUndefined();
      d.script = `第${n}段`;
      d.direction = `动作${n}`;
    }
    d = loadDigitalHumanDraft(JSON.stringify(d), "7")!;
    expect(digitalHumanProjectSegments(d)).toHaveLength(17);
    d = switchDigitalHumanSegment(d, id(1));
    expect(d.script).toBe("第一段原稿");
    expect(d.scene?.source).toBe("gs://test-only/first");
    expect(d.direction).toBe("接弹后变装");
    d = switchDigitalHumanSegment(d, id(9));
    expect(d.script).toBe("第9段");
    expect(d.direction).toBe("动作9");
  });
  it("切段后旧异步回执只回写原段，并保持新段和项目排序", () => {
    let d = addDigitalHumanSegment(newDigitalHumanDraft("7", id(1)), id(2));
    d.script = "当前第二段";
    d = updateDigitalHumanSegment(d, id(1), old => ({
      ...old,
      script: "第一段回执",
      advisorStorage: { answer: "完整答复" },
    }));
    expect(d.id).toBe(id(2));
    expect(d.script).toBe("当前第二段");
    expect(switchDigitalHumanSegment(d, id(1)).advisorStorage.answer).toBe(
      "完整答复"
    );
    expect(d.project!.segments.map(s => s.id)).toEqual([id(1), id(2)]);
    expect(() => updateDigitalHumanSegment(d, id(99), old => old)).toThrow(
      "不存在"
    );
  });
  it("拒绝重复ID、缺失快照和跨账号嵌入草稿，不用strip吞掉错误", () => {
    const d = addDigitalHumanSegment(newDigitalHumanDraft("7", id(1)), id(2));
    expect(() => addDigitalHumanSegment(d, id(1))).toThrow("已存在");
    const bad = structuredClone(d);
    bad.project!.segments[0].draft!.owner = "8";
    expect(digitalHumanDraftSchema.safeParse(bad).success).toBe(false);
    const missing = structuredClone(d);
    missing.project!.segments[0].draft = undefined;
    expect(digitalHumanDraftSchema.safeParse(missing).success).toBe(false);
    const repeat = structuredClone(d);
    repeat.project!.segments.push(repeat.project!.segments[0]);
    expect(digitalHumanDraftSchema.safeParse(repeat).success).toBe(false);
  });
});
