import { describe, expect, it } from "vitest";
import { assertSpokenPerformance } from "./spokenPerformance";
import { compileViralCreatorInput } from "./viralCreationMethods";
import { fictionalViralBlueprint } from "./viralCreation.fixture";

describe("新口播的表演合同", () => {
  it("逐镜演法非空且不让长说明被镜表归一静默截断", () => {
    const cells = fictionalViralBlueprint("短视频").storyboardCells;
    expect(() => assertSpokenPerformance(cells)).not.toThrow();
    cells[0].actionZh = "手势：待定；视线：镜头";
    expect(() => assertSpokenPerformance(cells)).toThrow("手势");
    cells[0].actionZh = "手势：右手随重音点落；视线：镜头";
    cells[0].editNoteZh += "声量保持克制。".repeat(20);
    expect(() => assertSpokenPerformance(cells)).toThrow("不得截断");
  });
  it("无对白动作镜不强加口播演法", () => {
    expect(() => assertSpokenPerformance([{dialogueZh:"",actionZh:"侧身接住光弹"}])).not.toThrow();
  });
  it("独立创作输入也携带视频演法，图文不强加口播格式", () => {
    const input = {profile:"创作者",stage:"expand" as const,selectedTopic:{title:"整理资料"},targetPlatform:"xiaohongshu" as const};
    const video = compileViralCreatorInput({...input,formats:["短视频"],targetFormat:"短视频"});
    expect(video.system).toContain("逐句口播表演");
    const graphic = compileViralCreatorInput({...input,targetFormat:"图文"});
    expect(graphic.system).not.toContain("【逐句口播表演】");
  });
});
