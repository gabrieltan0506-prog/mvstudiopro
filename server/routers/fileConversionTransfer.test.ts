import express from "express";
import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
const m=vi.hoisted(()=>({user:7,claim:vi.fn(),finish:vi.fn(),ticket:vi.fn(),job:vi.fn(),save:vi.fn(),read:vi.fn(),mount:vi.fn(),writeWebsite:vi.fn(),readWebsite:vi.fn()}));
vi.mock("../_core/sdk",()=>({sdk:{authenticateRequest:async()=>{if(!m.user)throw new Error("test unauthorized");return {id:m.user};}}}));
vi.mock("../jobs/fileConversionUploads",()=>({claimConversionUpload:m.claim,finishConversionUpload:m.finish,conversionUploadByObject:m.ticket}));
vi.mock("../jobs/fileConversionRepository",()=>({getConversionJob:m.job}));
vi.mock("../services/fileConversion",()=>({conversionMemoryBudget:()=>20_000_000}));
vi.mock("../services/fileConversionStorage",async original=>({...(await original<any>()),saveConversionObject:m.save,readConversionObject:m.read,
 assertConversionWebsiteVolume:m.mount,writeConversionWebsite:m.writeWebsite,readConversionWebsite:m.readWebsite}));
import { registerFileConversionTransfer,receiveConversionBytes } from "./fileConversionTransfer";
import { apiCorsMiddleware } from "../_core/apiCors";
import { artEvidenceSignature } from "../services/artMotionEvidence";
import { CONVERSION_STORE_ROUTE,conversionSha } from "../services/fileConversionStorage";
const id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",objectName=`file-conversion/u7/sources/${id}`,data=Buffer.from("test");
const nativeFetch=globalThis.fetch;
async function request(route:string,method:string,body?:Buffer,headers:Record<string,string>={}) {
 const app=express();app.use("/api",apiCorsMiddleware);registerFileConversionTransfer(app);const server=createServer(app).listen(0,"127.0.0.1");await once(server,"listening");
 try {const r=await nativeFetch(`http://127.0.0.1:${(server.address() as any).port}${route}`,{method,headers,body:body?new Uint8Array(body):undefined});return{status:r.status,body:await r.text(),...(headers.Origin?{cors:r.headers.get("access-control-allow-methods"),origin:r.headers.get("access-control-allow-origin"),credentials:r.headers.get("access-control-allow-credentials")}: {})};}
 finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
}
beforeEach(()=>{vi.clearAllMocks();m.user=7;m.finish.mockResolvedValue(undefined);m.claim.mockResolvedValue({id,userId:"7",objectName,bytes:4,lane:"free",fileName:"test.txt"});m.save.mockResolvedValue({storage:"gcs",generation:"123"});
 m.ticket.mockResolvedValue({userId:"7",status:"receiving",bytes:4});m.read.mockResolvedValue(data);m.readWebsite.mockResolvedValue(data);m.job.mockResolvedValue(null);});
afterEach(()=>vi.unstubAllEnvs());
it("F2：申报1字节却PUT超过3MB，接收处拒绝，未写GCS/网站存储",async()=>{
 m.claim.mockResolvedValue({id,userId:"7",objectName,bytes:1,lane:"free",fileName:"test.txt"});
 const r=await request(`/api/file-conversion/upload/${id}`,"PUT",Buffer.alloc(3_000_001));expect(r.status).toBe(413);
 expect(m.save).not.toHaveBeenCalled();expect(m.finish).toHaveBeenCalledWith(expect.objectContaining({id}),null);
 let consumed=0;async function* chunks(){for(const n of [1,2,1_000_000]){consumed++;yield Buffer.alloc(n);}}
 await expect(receiveConversionBytes(chunks(),1)).rejects.toThrow("超过授权");expect(consumed).toBe(2);
});
it("F2：单次URL没有上游签名，复用/过期拒绝；合法数据按SHA留下源版本",async()=>{
 const r=await request(`/api/file-conversion/upload/${id}`,"PUT",data);expect(r.status).toBe(200);
 expect(m.finish).toHaveBeenCalledWith(expect.objectContaining({id}),{objectName,fileName:"test.txt",bytes:4,sha256:conversionSha(data),storage:"gcs",generation:"123"});
 m.claim.mockResolvedValue(null);expect((await request(`/api/file-conversion/upload/${id}`,"PUT",data)).status).toBe(409);expect(m.save).toHaveBeenCalledTimes(1);
});
it("F2：无登录、跨账号授权不能写，截断上传不能写",async()=>{
 m.user=0;expect((await request(`/api/file-conversion/upload/${id}`,"PUT",data)).status).toBe(401);expect(m.claim).not.toHaveBeenCalled();
 m.user=8;m.claim.mockResolvedValue(null);expect((await request(`/api/file-conversion/upload/${id}`,"PUT",data)).status).toBe(409);expect(m.claim).toHaveBeenCalledWith(id,"8");
 m.claim.mockResolvedValue({id,userId:"7",objectName,bytes:12,lane:"free"});expect((await request(`/api/file-conversion/upload/${id}`,"PUT",data)).status).toBe(413);expect(m.save).not.toHaveBeenCalled();
});
it("F3：下载核本人成功任务和真实存储位置/SHA，不签发旁路",async()=>{
 m.job.mockResolvedValue({id:"conv_test",userId:"8",status:"succeeded",output:{type:"converted"}});
 expect((await request("/api/file-conversion/download/conv_test","GET")).status).toBe(404);expect(m.read).not.toHaveBeenCalled();
 m.job.mockResolvedValue({id:"conv_test",userId:"7",status:"succeeded",output:{type:"converted",objectName:"file-conversion/u7/results/conv_test/x.txt",fileName:"x.txt",mimeType:"text/plain",bytes:4,sha256:conversionSha(data),storage:"website_data"}});
 expect(await request("/api/file-conversion/download/conv_test","GET")).toEqual({status:200,body:"test"});
 expect(m.read).toHaveBeenCalledWith(expect.objectContaining({userId:"7",taskId:"conv_test",storage:"website_data",bytes:4,sha256:conversionSha(data)}),expect.any(AbortSignal));
});
it("F3：网站桥核签名、账号和任务；合法PUT/读回使用同一对象",async()=>{
 const secret="test-only-signature-secret-abcdefghijklmnopqrstuvwxyz";vi.stubEnv("JWT_SECRET",secret);
 const input={userId:"7",objectName,bytes:4,sha256:conversionSha(data)},metadata=Buffer.from(JSON.stringify(input)),timestamp=String(Date.now());
 const headers={"X-Conversion-Metadata":metadata.toString("base64"),"X-Art-Evidence-Time":timestamp,"X-Art-Evidence-Signature":artEvidenceSignature(secret,timestamp,metadata)};
 expect((await request(CONVERSION_STORE_ROUTE,"PUT",data,{...headers,"X-Art-Evidence-Signature":"0".repeat(64)})).status).toBe(403);expect(m.mount).not.toHaveBeenCalled();
 expect((await request(CONVERSION_STORE_ROUTE,"PUT",data,headers)).status).toBe(200);expect(m.writeWebsite).toHaveBeenCalledWith(input,data);
 expect(await request(CONVERSION_STORE_ROUTE,"POST",metadata,headers)).toEqual({status:200,body:"test"});
 m.ticket.mockResolvedValue({userId:"8",status:"receiving",bytes:4});expect((await request(CONVERSION_STORE_ROUTE,"PUT",data,headers)).status).toBe(503);expect(m.writeWebsite).toHaveBeenCalledTimes(1);
});

it("F2：实际大小正确但存储故障，明确返回503并保留失败上传记录", async()=>{
 m.save.mockRejectedValue(new Error("test-only storage outage"));
 const result=await request(`/api/file-conversion/upload/${id}`,"PUT",data);
 expect(result.status).toBe(503);expect(result.body).toContain("保存暂不可用");
 expect(m.finish).toHaveBeenCalledWith(expect.objectContaining({id}),null);
});

it("F5：生产全局CORS先于转换处理器，正式域PUT预检允许且其他路径和外域不放宽",async()=>{
 const headers={Origin:"https://mvstudiopro.com","Access-Control-Request-Method":"PUT"};
 expect(await request(`/api/file-conversion/upload/${id}`,"OPTIONS",undefined,headers)).toMatchObject({status:204,cors:"PUT,OPTIONS",origin:headers.Origin});
 expect(await request(`/api/file-conversion/upload/${id}`,"OPTIONS",undefined,{...headers,Origin:"https://untrusted.example"})).toMatchObject({status:204,cors:null,origin:null});
 expect(await request("/api/unrelated","OPTIONS",undefined,headers)).toMatchObject({cors:"GET,POST,OPTIONS"});
 expect(m.claim).not.toHaveBeenCalled();
 const uploaded=await request(`/api/file-conversion/upload/${id}`,"PUT",data,{Origin:headers.Origin});
 expect(uploaded).toMatchObject({status:200,cors:"PUT,OPTIONS",origin:headers.Origin,credentials:"true"});
 expect(m.save).toHaveBeenCalledTimes(1);
 expect(m.finish).toHaveBeenCalledWith(expect.objectContaining({id}),expect.objectContaining({objectName,sha256:conversionSha(data)}));
});
