import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { runOptimizeCustomCopyForUser, type OptimizeCopyRouteInput } from "./optimizeCopyRouteRun";

type Result = Awaited<ReturnType<typeof runOptimizeCustomCopyForUser>>;
export type StoryboardCopyTask = {
 requestId:string; status:"running"|"succeeded"|"failed"; createdAt:string; lastHeartbeatAt:string;
 result?:Result; error?:string;
};
type RecordTask = StoryboardCopyTask & {userId:number;inputHash:string};
const active = new Set<string>();
const dir=()=>process.env.STORYBOARD_COPY_TASK_DIR || "/data/growth/storyboard-copy";
function filename(id:string,userId:number){
 if(!/^[0-9a-f-]{36}$/i.test(id)||!Number.isSafeInteger(userId)||userId<=0)throw new Error("无效分镜任务编号");
 return path.join(dir(),`${userId}-${id}.json`);
}
async function persist(record:RecordTask){
 const file=filename(record.requestId,record.userId),temporary=`${file}.${randomUUID()}.tmp`;
 await fs.writeFile(temporary,JSON.stringify(record),{mode:0o600});await fs.rename(temporary,file);
}
function view(record:RecordTask):StoryboardCopyTask {
 const {userId:_,inputHash:__,...result}=record;return result;
}
export async function readStoryboardCopyTask(id:string,userId:number):Promise<StoryboardCopyTask>{
 let record:RecordTask;
 try{record=JSON.parse(await fs.readFile(filename(id,userId),"utf8"));}
 catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")throw new TRPCError({code:"NOT_FOUND",message:"当前账户没有这个分镜任务"});throw e;}
 if(record.userId!==userId)throw new TRPCError({code:"FORBIDDEN"});
 const result=view(record);
 if(result.status==="running"&&!active.has(filename(id,userId))) result.error="原任务进程已中断，保留编号和记录；不自动重提。";
 return result;
}
export async function startStoryboardCopyTask(id:string,input:OptimizeCopyRouteInput,user:{id:number;role:string}):Promise<StoryboardCopyTask>{
 await fs.mkdir(dir(),{recursive:true});
 const file=filename(id,user.id),inputHash=createHash("sha256").update(JSON.stringify(input)).digest("hex");
 const record:RecordTask={requestId:id,userId:user.id,inputHash,status:"running",createdAt:new Date().toISOString(),lastHeartbeatAt:new Date().toISOString()};
 try{await fs.writeFile(file,JSON.stringify(record),{flag:"wx",mode:0o600});}
 catch(e){
  if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;
  let existing:RecordTask|undefined;
  // 排他创建者可能仍在写首条记录；只续读同一文件，不创建第二笔。
  for(let attempt=0;attempt<5;attempt++){
    try{existing=JSON.parse(await fs.readFile(file,"utf8"));break;}
    catch(error){if(!(error instanceof SyntaxError)||attempt===4)throw error;await new Promise(resolve=>setTimeout(resolve,20));}
  }
  if(!existing)throw new Error("原任务记录尚未完整，不重复提交");
  if(existing.userId!==user.id||existing.inputHash!==inputHash)throw new TRPCError({code:"CONFLICT",message:"同一分镜请求的内容发生变化，未重复提交"});
  return view(existing);
 }
 active.add(file);
 const heartbeat=async()=>{
  if(Date.now()-Date.parse(record.lastHeartbeatAt)<2000)return;
  const now=new Date().toISOString();await persist({...record,lastHeartbeatAt:now});record.lastHeartbeatAt=now;
 };
 void (async()=>{
  try {
   const result=await runOptimizeCustomCopyForUser({...input,storyboardCandidate:true},user,heartbeat);
   record.result=result;record.status="succeeded";record.lastHeartbeatAt=new Date().toISOString();
  }catch(e){record.status="failed";record.error=e instanceof Error?e.message:"分镜生成失败";}
  try{await persist(record);}catch{console.error("[storyboardCopyTask] 最终结果落盘失败，保留任务编号",id);}
  finally{active.delete(file);}
 })();
 return view(record);
}
