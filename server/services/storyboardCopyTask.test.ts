import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
vi.mock("./optimizeCopyRouteRun",()=>({runOptimizeCustomCopyForUser:vi.fn()}));
import {runOptimizeCustomCopyForUser} from "./optimizeCopyRouteRun";
import {startStoryboardCopyTask,readStoryboardCopyTask} from "./storyboardCopyTask";
let directory="";
afterEach(async()=>{vi.unstubAllEnvs();vi.clearAllMocks();if(directory)await fs.rm(directory,{recursive:true,force:true});});
it("同编号并发只产生一次计费调用，结果落盘后可续查且账户隔离",async()=>{
 directory=await fs.mkdtemp(path.join(os.tmpdir(),"storyboard-test-"));vi.stubEnv("STORYBOARD_COPY_TASK_DIR",directory);
 let resolve!:(value:any)=>void;vi.mocked(runOptimizeCustomCopyForUser).mockImplementation(()=>new Promise(r=>{resolve=r}));
 const id="11111111-1111-4111-8111-111111111111",input={sourceText:"完整且真实的测试正文"},user={id:1,role:"user"};
 await Promise.all([startStoryboardCopyTask(id,input,user),startStoryboardCopyTask(id,input,user)]);expect(runOptimizeCustomCopyForUser).toHaveBeenCalledTimes(1);
 await expect(startStoryboardCopyTask(id,{sourceText:"修改之后的不同测试正文"},user)).rejects.toThrow("内容发生变化");
 await expect(readStoryboardCopyTask(id,2)).rejects.toThrow("当前账户");
 resolve({success:true,cost:5,result:{optimizedMarkdown:"真实生产函数的完整返回"}});
 await vi.waitFor(async()=>expect((await readStoryboardCopyTask(id,1)).status).toBe("succeeded"));
 expect((await readStoryboardCopyTask(id,1)).result?.result.optimizedMarkdown).toBe("真实生产函数的完整返回");
 expect(JSON.parse(await fs.readFile(path.join(directory,`1-${id}.json`),"utf8")).status).toBe("succeeded");
 expect((await startStoryboardCopyTask(id,input,user)).status).toBe("succeeded");expect(runOptimizeCustomCopyForUser).toHaveBeenCalledTimes(1);
});
it("生产失败持久化失败回执，续查及重复启动不再次调用",async()=>{
 directory=await fs.mkdtemp(path.join(os.tmpdir(),"storyboard-test-"));vi.stubEnv("STORYBOARD_COPY_TASK_DIR",directory);
 vi.mocked(runOptimizeCustomCopyForUser).mockRejectedValue(new Error("生成失败，积分已退回"));
 const id="22222222-2222-4222-8222-222222222222",input={sourceText:"测试失败恢复，不能重复付费"},user={id:1,role:"user"};
 await startStoryboardCopyTask(id,input,user);await vi.waitFor(async()=>expect((await readStoryboardCopyTask(id,1)).status).toBe("failed"));
 expect((await startStoryboardCopyTask(id,input,user)).error).toContain("积分已退回");expect(runOptimizeCustomCopyForUser).toHaveBeenCalledTimes(1);
});
