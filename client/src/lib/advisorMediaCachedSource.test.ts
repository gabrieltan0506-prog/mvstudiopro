import { afterEach, expect, it, vi } from "vitest";
import { rememberLocalMediaDisplay, resolveUrlForCloudSync } from "./manhuaLocalMediaStore";
import { prepareAdvisorMediaPlan, isAdvisorMediaSourceUrl } from "@shared/manhuaAdvisorMediaEdit";
import { runAdvisorImageEdit } from "./advisorMediaImageJob";
const jobs=vi.hoisted(()=>({createJobSameOrigin:vi.fn(),pollJobUntilTerminal:vi.fn()}));
vi.mock("./jobs",()=>jobs);
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
const stable="/api/canvas-media/generated/isolated/hero.png";
const source={blockId:"hero",kind:"image" as const,url:stable,revision:"a",label:"人物",aspectRatio:"9:16" as const};
const proposal={kind:"image",blockId:"hero",instruction:"保留人物，背景改成月夜"};
it("缓存图片仍能按原始素材身份进入顾问方案，不发送blob或本机指针",()=>{
 rememberLocalMediaDisplay({displayUrl:"blob:https://mvstudiopro.com/test",pointer:"local-media:v1/cached-hero",sourceUrl:stable});
 const url=resolveUrlForCloudSync("blob:https://mvstudiopro.com/test")!;
 expect(prepareAdvisorMediaPlan(proposal,[{...source,url}]).source.url).toBe(stable);
 expect(isAdvisorMediaSourceUrl("blob:https://mvstudiopro.com/test")).toBe(false);
 expect(isAdvisorMediaSourceUrl("/api/canvas-media/../secret")).toBe(false);
 expect(isAdvisorMediaSourceUrl("//untrusted.example/file")).toBe(false);
});
it("受保护素材先鉴权取得读取地址，失败不入队；恢复原任务不再次读取或下单",async()=>{
 const plan=prepareAdvisorMediaPlan(proposal,[source]);const fetch=vi.fn().mockResolvedValue({ok:false,url:"http://localhost/api/canvas-media/denied",json:async()=>({url:"http://localhost/denied"})});vi.stubGlobal("fetch",fetch);
 await expect(runAdvisorImageEdit({plan,userId:"7",variant:"flare",onJob:vi.fn()})).rejects.toMatchObject({terminal:true});expect(jobs.createJobSameOrigin).not.toHaveBeenCalled();
 fetch.mockResolvedValue({ok:true,url:"https://storage.googleapis.com/test/hero.png?signature=fixture",json:async()=>({url:"https://storage.googleapis.com/test/hero.png?signature=fixture"})});jobs.createJobSameOrigin.mockResolvedValue({jobId:"new"});jobs.pollJobUntilTerminal.mockResolvedValue({status:"succeeded",output:{imageUrl:"https://test/result.png"}});
 await runAdvisorImageEdit({plan,userId:"7",variant:"flare",onJob:vi.fn()});expect(fetch).toHaveBeenLastCalledWith(stable+"?format=json",{credentials:"include"});expect(jobs.createJobSameOrigin.mock.calls[0][0].input.params.referenceImageUrls).toEqual(["https://storage.googleapis.com/test/hero.png?signature=fixture"]);
 fetch.mockClear();jobs.createJobSameOrigin.mockClear();await runAdvisorImageEdit({plan,userId:"7",variant:"flare",jobId:"new",onJob:vi.fn()});expect(fetch).not.toHaveBeenCalled();expect(jobs.createJobSameOrigin).not.toHaveBeenCalled();
});
