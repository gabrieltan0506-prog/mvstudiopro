import { describe, expect, it } from "vitest";
import { assertCanvasDialogueInputControls, compileCanvasDialogueInput, resolveCanvasDialogueEmotion, suggestCanvasDialogueEmotion } from "./canvasDialogueControls";
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
    expect(compileCanvasDialogueInput("阿菁，[cough][gasp]还有多久到医馆呀？", "[tired]")).toBe("[tired]阿菁，[cough][gasp]还有多久到医馆呀？");
    expect(() => assertCanvasDialogueInputControls("阿菁，[pant]还有多久到医馆呀？")).toThrow();
  });
  it("按台词情境给出可审的表演标签，不改原词或误加他人的咳嗽", () => {
    const shotZh = "先生比出一碗；墨屠带伤走近；娘咳嗽";
    expect(suggestCanvasDialogueEmotion({ textZh: "要取多少墨屠的血？", speakerZh: "阿菁", shotZh })?.tag).toBe("[trembling]");
    expect(suggestCanvasDialogueEmotion({ textZh: "一碗就够，不伤性命。", speakerZh: "坐堂先生", shotZh })?.tag).toBe("[serious]");
    expect(suggestCanvasDialogueEmotion({ textZh: "你肩上的伤还没好——", speakerZh: "阿菁", shotZh })?.tag).toBe("[trembling]");
    expect(suggestCanvasDialogueEmotion({ textZh: "草藥只能撐三天，太短了，取點血沒事的，我撐得住。", speakerZh: "墨屠", shotZh })?.tag).toBe("[serious]");
    expect(suggestCanvasDialogueEmotion({ textZh: "喔……好痛好痛！", speakerZh: "墨屠", shotZh })?.tag).toBe("[trembling]");
  });
  it("新句自动演技，已有候选与手动自然语气不被覆盖", () => {
    const cue = { textZh: "好痛好痛！", speakerZh: "墨屠", shotZh: "阿菁揪耳朵", emotion: "" };
    expect(resolveCanvasDialogueEmotion({ ...cue, hasCandidates: false })).toBe("[trembling]");
    expect(resolveCanvasDialogueEmotion({ ...cue, hasCandidates: true })).toBe("");
    expect(resolveCanvasDialogueEmotion({ ...cue, autoEmotion: false, hasCandidates: false })).toBe("");
    expect(resolveCanvasDialogueEmotion({ ...cue, emotion: "[angry]", hasCandidates: false })).toBe("[angry]");
  });
});
