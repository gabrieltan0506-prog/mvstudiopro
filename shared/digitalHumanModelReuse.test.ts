import { describe, expect, it } from "vitest";
import { adoptDigitalHumanModel, digitalHumanReusableModels } from "./digitalHumanModelReuse";
import { addDigitalHumanSegment, switchDigitalHumanSegment } from "./digitalHumanProject";
import { loadDigitalHumanDraft, newDigitalHumanDraft, type DigitalHumanDraft } from "./digitalHumanStudio";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const model = (name: string): NonNullable<DigitalHumanDraft["mainModel"]> => ({
  taskId: `test-only-${name}`, assetRef: "test-original-person", status: "succeeded", sourceVersion: `gs://test-only/${name}.png`,
  sourceImageUrl: `https://example.invalid/${name}.png`, glbGcsUri: `gs://test-only/${name}.glb`, updatedAt: 1,
});
describe("已有造型跨段回填", () => {
  it("A/B/C使用原任务号，各自人物场景台词保存后恢复，历史不丢", () => {
    let d = newDigitalHumanDraft("7", id(1));
    d.modelHistory = ["A", "A黑衣", "B", "C"].map(name => ({ assetRef: `dh-person-${d.id}`, model: model(name) }));
    for (const [index, name] of Array.from(["A", "B", "C"].entries())) {
      if (index) d = addDigitalHumanSegment(d, id(index + 1));
      const candidate = digitalHumanReusableModels(d).find(row => row.model.taskId === model(name).taskId)!;
      expect(candidate).toBeDefined();
      d = adoptDigitalHumanModel(d, candidate.model, model(name));
      d.script = `${name}独立台词`; d.scene = { source: `gs://test-only/${name}-scene.png`, name };
      d.worldTaskId = `test-only-world-${name}`;
    }
    d = loadDigitalHumanDraft(JSON.stringify(d), "7")!;
    for (const [index, name] of Array.from(["A", "B", "C"].entries())) {
      d = switchDigitalHumanSegment(d, id(index + 1));
      expect(d.mainModel?.taskId).toBe(`test-only-${name}`);
      expect(d.mainModel?.assetRef).toBe("test-original-person");
      expect(d.portrait?.source).toBe(model(name).sourceVersion);
      expect(d.script).toBe(`${name}独立台词`);
      expect(d.scene?.source).toBe(`gs://test-only/${name}-scene.png`);
      expect(d.worldTaskId).toBe(`test-only-world-${name}`);
    }
    expect(digitalHumanReusableModels(d).some(row => row.model.taskId === "test-only-A黑衣")).toBe(true);
  });
  it("拒绝源身份变化、未成功、空产物与非持久图片，不修改原稿", () => {
    const d = newDigitalHumanDraft("7", id(1)), before = JSON.stringify(d), m = model("A");
    for (const bad of [{ ...m, sourceVersion: model("B").sourceVersion }, { ...m, taskId: "other" },
      { ...m, status: "failed" as const }, { ...m, glbGcsUri: undefined, glbUrl: undefined }]) {
      expect(() => adoptDigitalHumanModel(d, m, bad)).toThrow();
    }
    const temporary = { ...m, sourceVersion: "https://example.invalid/temporary.png" };
    expect(() => adoptDigitalHumanModel(d, m, { ...m, assetRef: undefined })).toThrow("资产编号");
    expect(() => adoptDigitalHumanModel(d, m, { ...m, assetRef: "wrong-person" })).toThrow("资产编号");
    expect(() => adoptDigitalHumanModel(d, temporary, temporary)).toThrow("持久");
    expect(JSON.stringify(d)).toBe(before);
  });
  it("换造型保留原模型并使旧预演失效，不改变其他段落", () => {
    let d = newDigitalHumanDraft("7", id(1)); d.mainModel = model("A"); d.portrait = { source: model("A").sourceVersion, name: "A" };
    d = addDigitalHumanSegment(d, id(2)); const previous = JSON.stringify(d.project!.segments[0]);
    d.mainModel = model("B"); d = adoptDigitalHumanModel(d, model("C"), model("C"));
    expect(d.previsSpatialInvalidated).toBe(true);
    expect(d.modelHistory.map(h => h.model.taskId)).toEqual(["test-only-B", "test-only-C"]);
    expect(JSON.stringify(d.project!.segments[0])).toBe(previous);
  });
});
