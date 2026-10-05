import { describe, it, expect } from "vitest";
import { referenceVideoDimensions, MIN_REFERENCE_VIDEO_PIXELS } from "./seedanceReferenceVideoSize.js";
describe("已保留白模视频像素下限", () => {
  it.each([[480,270,960,540],[270,480,540,960],[960,540,960,540],[540,960,540,960],[320,240,1280,960]])("%i×%i", (w,h,ow,oh) => {
    const size = referenceVideoDimensions(w,h);
    expect(size).toEqual({width:ow,height:oh,factor:ow/w});
    expect(size.width*size.height).toBeGreaterThanOrEqual(MIN_REFERENCE_VIDEO_PIXELS);
  });
  it("拒绝无法读取的尺寸", () => expect(() => referenceVideoDimensions(0,270)).toThrow());
});

import { vi } from "vitest";
import { normalizeSeedanceReferenceVideo, ReferenceVideoPending, ReferenceVideoUnknown, type ReferenceVideoUpscaleRecord } from "./seedanceReferenceVideoSize.js";
import { getGcsBucketName } from "./gcs.js";
function dependencies() {
  return {
    probe: vi.fn(async () => ({width:480,height:270,duration:23})),
    submit: vi.fn(async () => ({predictionId:"test-upscale-id"})),
    poll: vi.fn(async () => ({state:"running" as const,status:"processing"})),
    mirror: vi.fn(async () => `https://storage.googleapis.com/${getGcsBucketName()}/generated/test.mp4?test=1`),
    register: vi.fn(async () => "created" as const), verify: vi.fn(async () => true), sign: vi.fn((bucket: string, object: string) => `https://storage.googleapis.com/${bucket}/${object}?test=1`),
  };
}
describe("WaveSpeed原单恢复与生成阻断", () => {
  it("先保存提交意图和任务ID；运行中恢复不重投", async () => {
    const record: ReferenceVideoUpscaleRecord = {}; const deps=dependencies();
    const save = vi.fn(async () => {});
    deps.submit.mockImplementationOnce(async () => {
      expect(record.submissionStartedAt).toBeTruthy(); expect(save).toHaveBeenCalled();
      return {predictionId:"test-upscale-id"};
    });
    await expect(normalizeSeedanceReferenceVideo("https://example.test/source.mp4",1,record,save,"test",deps)).rejects.toBeInstanceOf(ReferenceVideoPending);
    expect(record.predictionId).toBe("test-upscale-id"); expect(record.factor).toBe(2);
    await expect(normalizeSeedanceReferenceVideo("https://example.test/source.mp4",1,record,save,"test",deps)).rejects.toBeInstanceOf(ReferenceVideoPending);
    expect(deps.submit).toHaveBeenCalledTimes(1); expect(deps.poll).toHaveBeenCalledWith("test-upscale-id");
  });
  it("回执未知禁止重投", async () => {
    const record: ReferenceVideoUpscaleRecord = {width:480,height:270,duration:23,submissionStartedAt:"test"}; const deps=dependencies();
    await expect(normalizeSeedanceReferenceVideo("https://example.test/source.mp4",1,record,async()=>{},"test",deps)).rejects.toBeInstanceOf(ReferenceVideoUnknown);
    expect(deps.submit).not.toHaveBeenCalled();
  });
  it("已达标视频不放大", async () => {
    const record: ReferenceVideoUpscaleRecord = {}; const deps=dependencies(); deps.probe.mockResolvedValue({width:960,height:540,duration:23});
    expect(await normalizeSeedanceReferenceVideo("https://example.test/source.mp4",1,record,async()=>{},"test",deps)).toBe("https://example.test/source.mp4");
    expect(deps.submit).not.toHaveBeenCalled();
  });
  it("放大completed但像素不足，仍禁止交给生成供应商", async () => {
    const record: ReferenceVideoUpscaleRecord = {width:480,height:270,duration:23,predictionId:"test"}; const deps=dependencies();
    deps.poll.mockResolvedValue({state:"completed",sourceUrl:"https://example.test/output.mp4"} as never);
    await expect(normalizeSeedanceReferenceVideo("https://example.test/source.mp4",1,record,async()=>{},"test",deps)).rejects.toBeInstanceOf(ReferenceVideoUnknown);
    expect(deps.mirror).not.toHaveBeenCalled();
  });
  it("达标产物登记后保存对象身份，恢复不再放大", async () => {
    const record: ReferenceVideoUpscaleRecord = {width:480,height:270,duration:23,predictionId:"test"}; const deps=dependencies();
    deps.poll.mockResolvedValue({state:"completed",sourceUrl:"https://example.test/output.mp4"} as never);
    deps.probe.mockResolvedValue({width:1920,height:1080,duration:23});
    await normalizeSeedanceReferenceVideo("https://example.test/source.mp4",1,record,async()=>{},"test",deps);
    expect(record.outputObject).toBe("generated/test.mp4"); expect(deps.register).toHaveBeenCalled();
    await normalizeSeedanceReferenceVideo("https://example.test/source.mp4",1,record,async()=>{},"test",deps);
    expect(deps.submit).not.toHaveBeenCalled(); expect(deps.poll).toHaveBeenCalledTimes(1);
  });
});

it("白模放大使用真实视频路径与所有权校验，不能用mock掩盖mp4登记失败",async()=>{
 const {registerCanvasMediaOwner,verifyCanvasMediaOwnership,__resetCanvasMediaOwnershipCacheForTests}=await import("./canvasMediaOwnership.js");__resetCanvasMediaOwnershipCacheForTests();const owners=new Map();const store={get:async(p:string)=>owners.get(p)||null,createIfAbsent:async(p:string,record:any)=>{if(owners.has(p))return "exists" as const;owners.set(p,record);return "created" as const}};
 const record:ReferenceVideoUpscaleRecord={width:480,height:270,duration:23,predictionId:"existing-upscale"};const deps=dependencies();deps.poll.mockResolvedValue({state:"completed",sourceUrl:"https://example.test/done.mp4"} as never);deps.probe.mockResolvedValue({width:1920,height:1080,duration:23});const object="growth-camp/videos/1791165600000-seedance-i2v.mp4";deps.mirror.mockResolvedValue(`https://storage.googleapis.com/${getGcsBucketName()}/${object}?signed=fixture`);
 const real={...deps,register:(x:any)=>registerCanvasMediaOwner({...x,store}),verify:(uid:number,p:string)=>verifyCanvasMediaOwnership(uid,p,{store,skipCache:true})};
 await normalizeSeedanceReferenceVideo("https://example.test/original.mp4",91003,record,async()=>{},"isolated",real);expect(record.outputObject).toBe(object);expect(await verifyCanvasMediaOwnership(91004,object,{store,skipCache:true})).toBe(false);expect(await registerCanvasMediaOwner({objectPath:object,ownerUserId:91004,store})).toBe("conflict");await normalizeSeedanceReferenceVideo("https://example.test/original.mp4",91003,record,async()=>{},"isolated",real);expect(deps.submit).not.toHaveBeenCalled();expect(deps.poll).toHaveBeenCalledTimes(1);
 expect(await registerCanvasMediaOwner({objectPath:"growth-camp/videos/../private.mp4",ownerUserId:91003,store})).toBe("invalid");
});
