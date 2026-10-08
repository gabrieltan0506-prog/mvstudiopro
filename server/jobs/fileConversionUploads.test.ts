import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll,beforeAll,beforeEach,expect,it,vi } from "vitest";
const m=vi.hoisted(()=>({db:null as any}));vi.mock("../db",()=>({getDb:async()=>m.db}));
import { ensureConversionTables } from "./fileConversionRepository";
import { createConversionUpload,claimConversionUpload,conversionUploadByObject,finishConversionUpload,markConversionUploadChecked } from "./fileConversionUploads";
const pg=new PGlite(),args={userId:"7",ipHash:"a".repeat(64),day:"2026-10-09",fileName:"test.txt",formatId:"txt-docx",bytes:12,lane:"free" as const};
beforeAll(async()=>{m.db=drizzle(pg);await ensureConversionTables(m.db);await createConversionUpload(args);},30000);
beforeEach(async()=>{await pg.exec("TRUNCATE file_conversion_uploads");});afterAll(()=>pg.close());
it("F2：并发授权最多三个未完成，账号与IP均约束，不能只申新object绕过",async()=>{
 const result=await Promise.allSettled(Array.from({length:8},()=>createConversionUpload(args)));
 expect(result.filter(x=>x.status==="fulfilled")).toHaveLength(3);
 await expect(createConversionUpload({...args,userId:"8"})).rejects.toThrow("授权已达上限");
 await expect(createConversionUpload({...args,ipHash:"b".repeat(64)})).rejects.toThrow("授权已达上限");
});
it("F2：单次授权只能本人领一次，按实际完整源回执才能检查",async()=>{
 const upload=await createConversionUpload(args),id=upload.uploadUrl.split("/").at(-1)!;
 expect(await claimConversionUpload(id,"8")).toBeNull();const ticket=(await claimConversionUpload(id,"7"))!;
 expect(await claimConversionUpload(id,"7")).toBeNull();
 const source={objectName:upload.objectName,fileName:args.fileName,bytes:12,generation:"123",sha256:"b".repeat(64),storage:"gcs" as const};
 await finishConversionUpload(ticket,source);expect((await conversionUploadByObject(upload.objectName))?.source).toEqual(source);
 await markConversionUploadChecked(upload.objectName,"8");expect((await conversionUploadByObject(upload.objectName))?.status).toBe("uploaded");
 await markConversionUploadChecked(upload.objectName,"7");expect((await conversionUploadByObject(upload.objectName))?.status).toBe("checked");
});
it("F2：失败授权也计入每日上限，避免检查失败反复存原件；免费上限不关闭付费",async()=>{
 for(let n=0;n<9;n++){
  const upload=await createConversionUpload(args),id=upload.uploadUrl.split("/").at(-1)!;
  await finishConversionUpload((await claimConversionUpload(id,"7"))!,null);
 }
 await expect(createConversionUpload(args)).rejects.toThrow("授权已达上限");
 await expect(createConversionUpload({...args,userId:"8"})).rejects.toThrow("授权已达上限");
 await expect(createConversionUpload({...args,ipHash:"b".repeat(64)})).rejects.toThrow("授权已达上限");
 expect((await createConversionUpload({...args,lane:"paid"})).uploadUrl).toMatch(/^\/api\/file-conversion\/upload\//);
 expect((await createConversionUpload({...args,day:"2026-10-10"})).objectName).toMatch(/^file-conversion\/u7\/sources\//);
});
