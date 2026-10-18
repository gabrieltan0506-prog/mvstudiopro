vi.mock("./postProdMediaSource", async original => ({ ...await original<typeof import("./postProdMediaSource")>(), resolveRegisteredPostProdMediaSource: vi.fn(async ({source}: {source:string}) => source) }));
import { resolveRegisteredPostProdMediaSource } from "./postProdMediaSource";
import { describe, expect, it, vi } from "vitest";
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("./gcs", () => ({ getGcsBucketName: () => "test-bucket" }));
import { assertDigitalHumanKeyframeGenerationJob, digitalHumanKeyframeGenerationJob, queueDigitalHumanKeyframeGeneration, getDigitalHumanKeyframeGeneration } from "./digitalHumanKeyframeGeneration";
import { getDb } from "../db";
import { digitalHumanDraftSchema, newDigitalHumanDraft } from "../../shared/digitalHumanStudio";
const request = {
 requestId: "00000000-0000-4000-8000-000000000001", draftId: "00000000-0000-4000-8000-000000000002",
 label: "B透明曲面屏开场", description: "人物在透明曲面屏幕后方，画面两侧显示资料，面部无遮挡。", aspectRatio: "9:16" as const,
 portraits: [{ source: "gs://test-bucket/uploads/u7/original.png", name: "用户指定基础人像.png" }, { source: "gs://test-bucket/uploads/u7/photo.jpg", name: "实拍.jpg" }],
};
describe("关键分镜原始人像与恢复", () => {
 it("本段场景追加在原照之后，身份与环境职责不混淆，未登记素材在入队前拒绝", async () => {
  const input = { ...request, scene: { source: "gs://test-bucket/uploads/u7/scene.png", name: "固定工作室" } };
  const task = digitalHumanKeyframeGenerationJob(7, input);
  expect(task.input.params.referenceImageUrls).toEqual([...request.portraits.map(p => p.source), input.scene.source]);
  expect(task.input.params.prompt).toContain("第3张图片是本段已选场景");
  expect(task.input.params.prompt).toContain("不用于人物身份");
  expect(task.digest).not.toBe(digitalHumanKeyframeGenerationJob(7, request).digest);
  expect(() => digitalHumanKeyframeGenerationJob(7, {...input,scene:request.portraits[0]})).toThrow("同一份文件");
  vi.mocked(resolveRegisteredPostProdMediaSource).mockRejectedValueOnce(new Error("未登记素材"));
  await expect(queueDigitalHumanKeyframeGeneration(7,input)).rejects.toThrow("未登记素材");
  expect(getDb).not.toHaveBeenCalled();
 });

 it("全部原照直接进入请求，不使用前一张分镜", () => {
  const task = digitalHumanKeyframeGenerationJob(7, request);
  expect(task.input.params.referenceImageUrls).toEqual(request.portraits.map(p => p.source));
  expect(task.input.params.prompt).toContain("不得把之前生成的分镜当作改图底图");
  expect(task.input.params.prompt).toContain(request.description);
  expect(task.input.params.requireImageVariant).toBe(true);
  expect(task.id).toBe(digitalHumanKeyframeGenerationJob(7, request).id);
  expect(task.digest).not.toBe(digitalHumanKeyframeGenerationJob(7, { ...request, description: request.description + "手指点选" }).digest);
 });
 it("原照为空、外桶、他人上传、任务生成图及路径穿越均拒绝", () => {
  for (const source of ["gs://test-bucket/uploads/u8/face.png", "gs://evil/uploads/u7/face.png", "gs://test-bucket/generated/face.png", "gs://test-bucket/uploads/u7/../u8/face.png"]) {
   expect(() => digitalHumanKeyframeGenerationJob(7, { ...request, portraits: [{source, name:"原照"}] })).toThrow();
  }
  expect(() => digitalHumanKeyframeGenerationJob(7, {...request, portraits:[]})).toThrow();
  expect(() => digitalHumanKeyframeGenerationJob(0, request)).toThrow();
 });
 it("worker拒绝换脸引用、改价标记与错账号，JSON字段重排不影响", () => {
  const task = digitalHumanKeyframeGenerationJob(7, request);
  expect(assertDigitalHumanKeyframeGenerationJob(7, task.id, JSON.parse(JSON.stringify(task.input))).exactSunburst).toBe(true);
  for (const patch of [{ referenceImageUrls: ["https://test.invalid/previous.png"] }, { batchIndex: 9 }, { openaiImageVariant: "flare" }])
   expect(() => assertDigitalHumanKeyframeGenerationJob(7,task.id,{...task.input,params:{...task.input.params,...patch}})).toThrow();
  expect(() => assertDigitalHumanKeyframeGenerationJob(8,task.id,task.input)).toThrow();
 });
 it("新字段经过真实草稿schema往返保留，旧稿默认无原始参考", () => {
  const old = newDigitalHumanDraft("7", request.draftId);
  expect(old.originalPortraits).toEqual([]);
  const restored = digitalHumanDraftSchema.parse(JSON.parse(JSON.stringify({...old, originalPortraits: request.portraits, keyframeGenerations:[{request,status:"unknown"}]})));
  expect(restored.keyframeGenerations[0].request).toEqual(request);
  expect(restored.originalPortraits).toEqual(request.portraits);
 });
 it("重复提交原编号只保留一个任务，换输入冲突，查询不创建", async () => {
  let saved: any; let writes=0;
  const db={insert:()=>({values:(row:any)=>({onConflictDoNothing:async()=>{writes++;saved ||= row;}})}),select:()=>({from:()=>({where:async()=>saved?[saved]:[]})})};
  vi.mocked(getDb).mockResolvedValue(db as any);
  const a=await queueDigitalHumanKeyframeGeneration(7,request);
  expect(await queueDigitalHumanKeyframeGeneration(7,request)).toEqual(a);
  expect(writes).toBe(2); expect(saved.id).toBe(a.jobId);
  await expect(queueDigitalHumanKeyframeGeneration(7,{...request,description:request.description+'另一镜'})).rejects.toThrow('另一份输入');
  const before=writes;expect((await getDigitalHumanKeyframeGeneration(7,request.requestId))?.jobId).toBe(a.jobId);expect(writes).toBe(before);
 });
});
