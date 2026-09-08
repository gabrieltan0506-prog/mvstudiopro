import { describe, expect, it } from "vitest";
import { assertCanvasDialogueInputControls, compileCanvasDialogueInput } from "./canvasDialogueControls";
describe("单句语气控制编译", () => {
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
