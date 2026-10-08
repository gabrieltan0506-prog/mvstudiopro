import { afterAll,beforeAll,beforeEach,expect,it,vi } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const m=vi.hoisted(()=>({root:"",role:"app",write:vi.fn(),read:vi.fn(),stat:vi.fn(),mounts:vi.fn()}));
vi.mock("node:fs/promises",async original=>{
 const real=await original<typeof import("node:fs/promises")>();
 const map=(p:any)=>typeof p==="string"&&p.startsWith("/data/growth/file-conversion")?p.replace("/data/growth/file-conversion",m.root):p;
 return {...real,readFile:(p:any,...args:any[])=>p==="/proc/self/mountinfo"?m.mounts():real.readFile(map(p),...args),
  mkdir:(p:any,...args:any[])=>real.mkdir(map(p),...args),open:(p:any,...args:any[])=>real.open(map(p),...args),
  link:(a:any,b:any)=>real.link(map(a),map(b)),unlink:(p:any)=>real.unlink(map(p))};
});
vi.mock("./gcs",()=>({getGcsBucketName:()=>"test-only-bucket",uploadBufferToGcsIfAbsent:m.write,inspectGcsObjectBounded:m.read,statGcsObjectVersion:m.stat}));
vi.mock("../jobs/workerRole",()=>({resolveJobWorkerRole:()=>m.role}));
vi.mock("./flyMachines",()=>({resolveFlyMachinesConfig:()=>({appName:"test-only"}),listFlyMachines:async()=>[{state:"started",id:"test-website",processGroup:"app"}]}));
import { saveConversionObject,readConversionSource,readConversionObject,conversionSha,writeConversionWebsite,saveConversionReceipt,readConversionReceipt } from "./fileConversionStorage";
const data=Buffer.from("exact-test-source"),objectName="file-conversion/u7/sources/fixture";
const source={objectName,generation:"123",sha256:conversionSha(data),bytes:data.length,fileName:"test.txt"};
beforeAll(async()=>{m.root=await fs.mkdtemp(path.join(os.tmpdir(),"conversion-store-test-"));});
afterAll(async()=>{await fs.rm(m.root,{recursive:true,force:true});});
beforeEach(()=>{vi.clearAllMocks();vi.unstubAllGlobals();m.role="app";m.mounts.mockResolvedValue("0 0 0:0 / /data rw - ext4 test-only rw");
 m.write.mockResolvedValue({created:true,generation:"123"});m.read.mockImplementation(async (args:any)=>{args.onChunk?.(data);return {...source,byteLength:data.length,header:data,bucket:"test-only-bucket"};});});
it("F3：GCS正常写读不触碰网站/data，也不依赖网站机",async()=>{
 const saved=await saveConversionObject({userId:"7",objectName},data,"text/plain");expect(saved).toEqual({storage:"gcs",generation:"123"});
 const chunks:Buffer[]=[];expect((await readConversionSource("7",source,{maxBytes:100,onChunk:x=>chunks.push(Buffer.from(x))})).sha256).toBe(source.sha256);
 expect(Buffer.concat(chunks)).toEqual(data);expect(m.mounts).not.toHaveBeenCalled();
});
it("F3：GCS写失败才原子写网站卷，来源与产物可按同一位置读回并校验SHA",async()=>{
 m.write.mockRejectedValue(new Error("test-only GCS outage"));
 const result=await saveConversionObject({userId:"7",objectName},data,"text/plain");expect(result.storage).toBe("website_data");
 expect((await readConversionSource("7",{...source,...result},{maxBytes:100})).sha256).toBe(source.sha256);
 const taskId="conv_test",outputName=`file-conversion/u7/results/${taskId}/test.txt`;
 await saveConversionObject({userId:"7",taskId,objectName:outputName},data,"text/plain");
 expect(await readConversionObject({userId:"7",taskId,objectName:outputName,storage:"website_data",bytes:data.length,sha256:source.sha256})).toEqual(data);
});
it("F3：GCS读取故障访问既存网站备份；SHA错误不能切换掩盖",async()=>{
 await writeConversionWebsite({userId:"7",objectName,bytes:data.length,sha256:source.sha256},data,m.root);
 m.read.mockRejectedValueOnce(new Error("test-only read outage"));
 expect((await readConversionSource("7",source,{maxBytes:100})).sha256).toBe(source.sha256);
 m.mounts.mockClear();m.read.mockResolvedValue({...source,sha256:"0".repeat(64),byteLength:data.length});
 await expect(readConversionSource("7",source,{maxBytes:100})).rejects.toThrow("SHA");expect(m.mounts).not.toHaveBeenCalled();
});
it("F3：跨账号、篡改、冲突拒绝，不覆盖旧件，不写工作机/data",async()=>{
 await expect(readConversionSource("8",source,{maxBytes:100})).rejects.toThrow("归属");
 await expect(saveConversionObject({userId:"7",objectName:"file-conversion/u7/sources/../evil"},data,"text/plain")).rejects.toThrow("归属");
 await writeConversionWebsite({userId:"7",objectName,bytes:data.length,sha256:source.sha256},data,m.root);
 const changed=Buffer.from("changed");await expect(writeConversionWebsite({userId:"7",objectName,bytes:changed.length,sha256:conversionSha(changed)},changed,m.root)).rejects.toThrow("保留原件");
 m.write.mockResolvedValue({created:false});m.read.mockImplementation(async (a:any)=>{a.onChunk?.(changed);return {byteLength:changed.length};});
 await expect(saveConversionObject({userId:"7",objectName},data,"text/plain")).rejects.toThrow("保留原件");
 m.role="rig";m.write.mockRejectedValue(new Error("test GCS outage"));vi.stubEnv("JWT_SECRET","test-only-signature-secret-abcdefghijklmnopqrstuvwxyz");
 const remote=vi.fn(async(_url:any,init:any)=>{expect(init.headers["Fly-Force-Instance-Id"]).toBe("test-website");expect(Buffer.from(init.body)).toEqual(data);return Response.json({bytes:data.length,sha256:source.sha256});});vi.stubGlobal("fetch",remote);
 expect((await saveConversionObject({userId:"7",objectName},data,"text/plain")).storage).toBe("website_data");expect(m.mounts).toHaveBeenCalledTimes(0);expect(remote).toHaveBeenCalledTimes(1);
});
it("F3：网站永久回执可重读；JSONB键重排不产生不一致或再次转换",async()=>{
 m.write.mockRejectedValue(new Error("test GCS outage"));
 await saveConversionReceipt("conv_receipt","7",{z:1,a:{y:2,b:3}});
 await saveConversionReceipt("conv_receipt","7",{a:{b:3,y:2},z:1});
 m.read.mockRejectedValue(new Error("gcs_download_failed:404"));
 expect(await readConversionReceipt("conv_receipt","7")).toEqual({a:{b:3,y:2},z:1});
});

it("F3：写入成功但读取GCS版本故障，保留同内容网站件，不伪造GCS版本", async()=>{
 m.write.mockResolvedValue({created:true}); m.stat.mockRejectedValue(new Error("test-only version outage"));
 const result=await saveConversionObject({userId:"7",objectName},data,"text/plain");
 expect(result).toEqual({storage:"website_data",generation:"1"});
 expect((await readConversionSource("7",{...source,...result},{maxBytes:100})).sha256).toBe(source.sha256);
});

vi.mock("../_core/sdk",()=>({sdk:{authenticateRequest:async()=>({id:7})}}));
vi.mock("../jobs/fileConversionUploads",()=>({
 claimConversionUpload:async()=>({id:"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",userId:"7",objectName:"file-conversion/u7/sources/timeout",bytes:17,lane:"free",fileName:"test.txt"}),
 finishConversionUpload:vi.fn(),conversionUploadByObject:vi.fn(),
}));
vi.mock("../jobs/fileConversionRepository",()=>({getConversionJob:vi.fn()}));
vi.mock("./fileConversion",()=>({conversionMemoryBudget:()=>20_000_000}));
it("F3：正式HTTP上传入口GCS真实超时后仍有网站落盘预算",async()=>{
 const {default:express}=await import("express"),{createServer}=await import("node:http");
 const {registerFileConversionTransfer}=await import("../routers/fileConversionTransfer"),{apiCorsMiddleware}=await import("../_core/apiCors");
 const originalTimeout=AbortSignal.timeout.bind(AbortSignal),durations:number[]=[];
 // 时间同比缩短；真实AbortSignal到期触发GCS拒绝，非立即抛错。
 const timer=vi.spyOn(AbortSignal,"timeout").mockImplementation(ms=>{durations.push(ms);return originalTimeout(ms/100);});
 m.write.mockImplementation(({signal})=>new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(signal.reason),{once:true})));
 const app=express();app.use("/api",apiCorsMiddleware);registerFileConversionTransfer(app);
 const server=createServer(app).listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
 try{
  const response=await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/file-conversion/upload/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`,{method:"PUT",body:new Uint8Array(data)});
  expect(response.status).toBe(200);expect(durations).toContain(65_000);expect(durations).toContain(30_000);
  expect(await fs.readFile(path.join(m.root,"file-conversion/u7/sources/timeout"))).toEqual(data);
 }finally{timer.mockRestore();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
it("F3：用户取消保持终止，不因GCS报错转写网站",async()=>{
 const abort=new AbortController();m.write.mockImplementation(async()=>{abort.abort(new Error("用户取消"));throw abort.signal.reason;});
 await expect(saveConversionObject({userId:"7",objectName},data,"text/plain",abort.signal)).rejects.toThrow("用户取消");
 expect(m.mounts).not.toHaveBeenCalled();
});
