import { describe, expect, it } from "vitest";
import { assertCanvasDialogueInputControls, compileCanvasDialogueInput, CANVAS_DIALOGUE_CONTROL_GROUPS, CANVAS_DIALOGUE_EMOTION_LABELS, CANVAS_DIALOGUE_EMOTION_TAGS, toggleCanvasDialogueControl } from "./canvasDialogueControls";
describe("单句语气控制编译", () => {
  it("中文选项一一覆盖既有19种控制，不另造不支持的气势参数", () => {
    const options = CANVAS_DIALOGUE_CONTROL_GROUPS.flatMap(group => [...group.tags]);
    expect(options).toHaveLength(19);
    expect(new Set(options)).toEqual(new Set(CANVAS_DIALOGUE_EMOTION_TAGS));
    for (const tag of options) {
      expect(CANVAS_DIALOGUE_EMOTION_LABELS[tag]).toMatch(/[\u4e00-\u9fff]/);
      expect(compileCanvasDialogueInput("别怕，站我身后。", toggleCanvasDialogueControl("", tag))).toBe(`[${tag}]别怕，站我身后。`);
    }
  });
  it("组合反选只改目标项，旧顺序、未知值不静默丢失", () => {
    expect(toggleCanvasDialogueControl("[empathetic]", "serious")).toBe("[empathetic][serious]");
    expect(toggleCanvasDialogueControl("[empathetic][serious][serious]", "serious")).toBe("[empathetic]");
    const preserved = toggleCanvasDialogueControl("[unknown]", "serious");
    expect(preserved).toBe("[unknown][serious]");
    expect(() => compileCanvasDialogueInput("别怕。", preserved)).toThrow();
  });
  it("原台词与合法标签编译，不添加阶段名", () => {
    expect(compileCanvasDialogueInput("别怕，站我身后。", "[serious][empathetic]")).toBe("[serious][empathetic]别怕，站我身后。");
    expect(compileCanvasDialogueInput("先走。", "")).toBe("先走。");
  });
  it.each(["变得很有气势", "[serious]压低声音", "[unknown]", "[serious"])("拒绝未知或自然语言语气 %s", emotion => {
    expect(() => compileCanvasDialogueInput("别怕。", emotion)).toThrow();
  });
  it("服务端相同校验，禁止未知标签或只有标签没有台词", () => {
    expect(() => assertCanvasDialogueInputControls("[invented]别怕。")).toThrow();
    expect(() => assertCanvasDialogueInputControls("[serious]")).toThrow();
    expect(() => assertCanvasDialogueInputControls("[serious]别怕。")).not.toThrow();
  });
});
