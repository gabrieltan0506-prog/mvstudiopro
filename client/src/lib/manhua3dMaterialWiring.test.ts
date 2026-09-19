import { expect, it, vi } from "vitest";
vi.mock("./jobs", () => ({ createJobSameOrigin: vi.fn(), pollJobUntilTerminal: vi.fn() }));
import { createJobSameOrigin, pollJobUntilTerminal } from "./jobs";
import { defaultCanvasBlock, normalizeCanvasBlock } from "./canvasTypes";
import { runCanvasBlock } from "./canvasRunBlock";
import { sanitizeManhuaCloudDraftBlock } from "@shared/manhuaCloudDraft";
import { compileManhua3dImageTreatment } from "@shared/manhua3dMaterialPrompt";
import { getManhuaArtStylePreset } from "@shared/manhuaCharacterAssetLibrary";

it("自由画布3D改图经云清洗恢复，实际图片请求保留身份与材质要求", async () => {
 vi.mocked(createJobSameOrigin).mockResolvedValue({jobId:"offline-3d"} as never);
 vi.mocked(pollJobUntilTerminal).mockResolvedValue({status:"succeeded",output:{imageUrl:"https://test.invalid/result.png"}} as never);
 const input = {...defaultCanvasBlock("image",0,0), id:"image-material",imageMode:"edit" as const,imageTreatment:"preserve_3d" as const,refImageUrl:"https://test.invalid/source.png",prompt:"保留金角黑翼四彩尾，处理衣料和毛发"};
 const block=normalizeCanvasBlock(JSON.parse(JSON.stringify(sanitizeManhuaCloudDraftBlock(input))))!;
 expect(block.imageTreatment).toBe("preserve_3d");
 await runCanvasBlock({optimizeCopy:async()=>"",userRole:"admin"},block);
 const request=JSON.stringify(vi.mocked(createJobSameOrigin).mock.calls.at(-1)?.[0]);
 expect(request).toContain("保留底图构图");
 expect(request).toContain("不把多尾、有翼或非人角色改成人类");
 expect(request).toContain("金角黑翼四彩尾");
 expect(request).toContain("https://test.invalid/source.png");
 expect(input.outputUrl).toBeUndefined();
});
it("可选处理不污染旧稿，文生图不假装保留底图", () => {
 expect(compileManhua3dImageTreatment(undefined,false)).toBe("");
 expect(()=>compileManhua3dImageTreatment("preserve_3d",false)).toThrow("需要底图");
});
it("工厂3D画风复用材质规则，解除无条件光雾与浅景深", () => {
 for(const style of ["cg_3d","photoreal_3d"]){
  const text=getManhuaArtStylePreset(style).promptZh;
  expect(text).toContain("肢体数量");
  expect(text).toContain("轮廓光、雾与景深只在镜头需要时使用");
  expect(text).not.toContain("strong backlight rim");
 }
 expect(getManhuaArtStylePreset("cg_drama").promptZh).not.toContain("PBR材质");
});
