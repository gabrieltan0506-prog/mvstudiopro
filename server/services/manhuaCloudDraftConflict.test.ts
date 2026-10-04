import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ files: new Map<string, {buffer: Buffer; generation: string}>(), seq: 0, failIndex: false, missingMedia: false }));
vi.mock("./gcs.js", () => ({
  uploadBufferToGcs: vi.fn(async (p: {objectName: string; buffer: Buffer; ifGenerationMatch?: string}) => {
    if (state.failIndex && p.objectName.startsWith("manhua-project-index")) throw new Error("index unavailable");
    if (p.ifGenerationMatch !== undefined && p.ifGenerationMatch !== (state.files.get(p.objectName)?.generation || "0")) throw new Error("gcs_upload_failed:412:test");
    const generation = String(++state.seq); state.files.set(p.objectName, {buffer: p.buffer, generation});
    return {gcsUri: `gs://test/${p.objectName}`, generation};
  }),
  deleteGcsObject: vi.fn(async ({objectName,ifGenerationMatch}: {objectName:string;ifGenerationMatch?:string})=>{
    if (state.files.get(objectName)?.generation === ifGenerationMatch) state.files.delete(objectName);
  }),
  downloadGcsObjectVersioned: vi.fn(async ({gcsUri}: {gcsUri: string}) => {
    const file = state.files.get(gcsUri.replace(/^gs:\/\/[^/]+\//, ""));
    if (!file) throw new Error("gcs_stat_failed:404");
    if (state.missingMedia) throw new Error("gcs_download_failed:404");
    return file;
  }),
  downloadGcsObject: vi.fn(async ({gcsUri}: {gcsUri: string}) => {
    const file = state.files.get(gcsUri.replace(/^gs:\/\/[^/]+\//, ""));
    if (!file) throw new Error("gcs_download_failed:404"); return file;
  }),
  createGcsSignedUploadUrl: vi.fn(async ({objectName}: {objectName: string}) => ({objectName, uploadUrl:"https://test.invalid/upload",gcsUri:`gs://test/${objectName}`})),
  listGcsObjectNamesByPrefix: vi.fn(async ({prefix}: {prefix: string}) => Array.from(state.files.keys()).filter(k=>k.startsWith(prefix))),
}));
import { createManhuaCloudDraftSignedUpload, commitManhuaCloudDraftAfterDirectUpload, writeManhuaCloudDraftToGcs,
  readManhuaCloudDraftFromGcs, listManhuaProjects, manhuaCloudDraftObjectName, ManhuaCloudDraftConflictError } from "./manhuaCloudDraftGcsStore";
import { buildManhuaCloudDraftPayload } from "../../shared/manhuaCloudDraft";
const projectId="11111111-1111-4111-8111-111111111111";
const payload=(topic:string)=>buildManhuaCloudDraftPayload({clientUpdatedAt:"2026-10-04T00:00:00Z",writerSession:{topic},blocks:[],edges:[]});
const write=(topic:string,expectedGeneration?:string)=>writeManhuaCloudDraftToGcs({userId:1,projectId,payload:payload(topic),expectedGeneration});
beforeEach(()=>{state.files.clear();state.seq=0;state.failIndex=false;state.missingMedia=false;});
it("两设备读同版本后并发写，只有一笔成功；重试旧版本也不能覆盖",async()=>{
  const first=await write("原稿","0");
  const results=await Promise.allSettled([write("设备A",first.generation),write("设备B",first.generation)]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
  const current=await readManhuaCloudDraftFromGcs(1,projectId);
  await expect(write("响应丢失后的重试",first.generation)).rejects.toBeInstanceOf(ManhuaCloudDraftConflictError);
  expect((await readManhuaCloudDraftFromGcs(1,projectId))?.generation).toBe(current?.generation);
  expect((await listManhuaProjects(1)).projects[0].title).toBe(current?.payload.writerSession.topic);
});
it("直传先落暂存，旧版本commit冲突，另一设备新稿保持不变",async()=>{
  const original=await write("原稿","0");
  const stage=await createManhuaCloudDraftSignedUpload(1,projectId,original.generation);
  expect(stage.objectName).not.toBe(manhuaCloudDraftObjectName(1,projectId));
  state.files.set(stage.objectName,{buffer:Buffer.from(JSON.stringify(payload("旧设备暂存"))),generation:"900"});
  await write("另一设备新稿",original.generation);
  await expect(commitManhuaCloudDraftAfterDirectUpload(1,projectId,original.generation,stage.uploadId)).rejects.toBeInstanceOf(ManhuaCloudDraftConflictError);
  expect((await readManhuaCloudDraftFromGcs(1,projectId))?.payload.writerSession.topic).toBe("另一设备新稿");
});
it("直传首次创建与后续保存返回真实版本；账号/项目不能借用别人的暂存",async()=>{
  const stage=await createManhuaCloudDraftSignedUpload(1,projectId,"0");
  state.files.set(stage.objectName,{buffer:Buffer.from(JSON.stringify(payload("新稿"))),generation:"900"});
  expect(await commitManhuaCloudDraftAfterDirectUpload(2,projectId,"0",stage.uploadId)).toBeNull();
  const saved=await commitManhuaCloudDraftAfterDirectUpload(1,projectId,"0",stage.uploadId);
  expect(saved?.generation).toBe((await readManhuaCloudDraftFromGcs(1,projectId))?.generation);
  await expect(write("再次首次创建","0")).rejects.toBeInstanceOf(ManhuaCloudDraftConflictError);
  await expect(write("有版本追加",saved?.generation)).resolves.toHaveProperty("generation");
});
it("旧客户端缺版本不能绕过prepare、commit或fallback",async()=>{
  await expect(write("空稿")).rejects.toBeInstanceOf(ManhuaCloudDraftConflictError);
  await expect(createManhuaCloudDraftSignedUpload(1,projectId)).rejects.toBeInstanceOf(ManhuaCloudDraftConflictError);
  await expect(commitManhuaCloudDraftAfterDirectUpload(1,projectId)).rejects.toBeInstanceOf(ManhuaCloudDraftConflictError);
  expect(state.files.size).toBe(0);
});
it("索引故障先失败，不发布无法发现的正文；空登记不会成为虚假作品",async()=>{
  state.failIndex=true;
  await expect(write("新稿","0")).rejects.toThrow("index unavailable");
  expect(state.files.size).toBe(0);
  state.failIndex=false;
  state.files.set(`manhua-project-index/user-1/${projectId}.json`,{buffer:Buffer.from('{}'),generation:"1"});
  expect((await listManhuaProjects(1)).projects).toEqual([]);
});
it("版本正文在读取期间消失不能报告云端无稿",async()=>{
  await write("原稿","0");state.missingMedia=true;
  await expect(readManhuaCloudDraftFromGcs(1,projectId)).rejects.toThrow("gcs_download_failed:404");
});

it("成功发布只清理对应版本暂存，正式正文与其他暂存保留",async()=>{
  const stage=await createManhuaCloudDraftSignedUpload(1,projectId,"0");
  const other=await createManhuaCloudDraftSignedUpload(1,projectId,"0");
  state.files.set(stage.objectName,{buffer:Buffer.from(JSON.stringify(payload("新稿"))),generation:"900"});
  state.files.set(other.objectName,{buffer:Buffer.from(JSON.stringify(payload("其他在途稿"))),generation:"901"});
  const saved=await commitManhuaCloudDraftAfterDirectUpload(1,projectId,"0",stage.uploadId);
  expect(saved?.generation).toBeTruthy();
  expect(state.files.has(stage.objectName)).toBe(false);
  expect(state.files.has(other.objectName)).toBe(true);
  expect((await readManhuaCloudDraftFromGcs(1,projectId))?.payload.writerSession.topic).toBe("新稿");
});
