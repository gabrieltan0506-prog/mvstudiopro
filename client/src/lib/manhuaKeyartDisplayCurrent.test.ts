import { describe, expect, it } from "vitest";
import { keyartOutputUrl, manhuaShotKeyartInputOf, isManhuaWorkbenchKeyartCurrent } from "../components/ManhuaScriptWorkbench";
import { defaultCanvasBlock } from "./canvasTypes";
import { manhuaShotKeyartState, manhuaShotKeyartStateZh } from "./manhuaShotKeyartState";

describe("原稿过期静帧的真实UI入参", () => {
  const receipt = { required: "new", generatedFor: "new", generatedUrl: "https://example.test/still.png" };
  const current = () => ({ ...defaultCanvasBlock("image", 0, 0), id: "keyart-e01-s01", imageMode: "edit" as const, refImageUrl: "https://example.test/ref.png", outputUrl: receipt.generatedUrl, manhuaKeyartLookState: { ...receipt }, manhuaKeyartSourceState: { ...receipt } });

  it("造型有效但原稿已变时，卡片与参数栏不能宣称可出片", () => {
    const block = current();
    block.manhuaKeyartSourceState.generatedFor = "old";
    const saved = structuredClone(block);
    expect(isManhuaWorkbenchKeyartCurrent(block)).toBe(false);
    const input = manhuaShotKeyartInputOf(block);
    expect(manhuaShotKeyartState(input)).toBe("stale");
    expect(manhuaShotKeyartStateZh(input)).toContain("已变更");
    expect(block).toEqual(saved);
  });

  it("同一镜新回执有效才恢复就绪；缺图不伪造过期产物", () => {
    expect(manhuaShotKeyartState(manhuaShotKeyartInputOf(current()))).toBe("ready");
    expect(manhuaShotKeyartState(manhuaShotKeyartInputOf())).toBe("idle");
  });

  it("只挂参考图尚未生成时，不计成图或旧产物", () => {
    const block = current();
    block.outputUrl = "";
    block.manhuaKeyartSourceState.generatedFor = "old";
    expect(keyartOutputUrl(block)).toBeUndefined();
    expect(manhuaShotKeyartState(manhuaShotKeyartInputOf(block))).toBe("idle");
    block.status = "running";
    expect(manhuaShotKeyartState(manhuaShotKeyartInputOf(block))).toBe("running");
    block.status = "error";
    expect(manhuaShotKeyartState(manhuaShotKeyartInputOf(block))).toBe("error");
  });

  it("只有真实输出可算静帧，多输出取首个非空值", () => {
    const block = current();
    block.outputUrl = "";
    block.outputUrls = ["", receipt.generatedUrl];
    expect(keyartOutputUrl(block)).toBe(receipt.generatedUrl);
    // 像素锁仍要求主 outputUrl 与造型回执一致；仅备用输出不得放行成片。
    expect(manhuaShotKeyartState(manhuaShotKeyartInputOf(block))).toBe("unlocked");
  });
});
