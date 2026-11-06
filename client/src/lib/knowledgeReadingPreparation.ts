import { knowledgeBatchRequestId } from "@shared/knowledgePublication";
import type { KnowledgeReadingPreparation, KnowledgeReadingProgress } from "@shared/knowledgeReadingPreparation";

export type ReadingDraft = {index:number;pages:Array<{headline:string;body:string}>};
export type ReadingPreparationState = KnowledgeReadingPreparation & {
  status: string; ready: number[]; completed: number[]; failed: number[];
  drafts?: ReadingDraft[];
  paidUnit: number; maxCredits: number; estimatedCredits: number;
};
/** 与读档轮询解耦的两通道队列；每个稳定请求只发一次，未知结果仅查询原任务。 */
export function createKnowledgeReadingController(deps: {
  state: (jobId: string) => Promise<ReadingPreparationState>;
  confirm: (state: ReadingPreparationState) => Promise<boolean>;
  execute: (link: KnowledgeReadingPreparation, index: number, requestId: string, paidUnit: number) => Promise<{creditsCharged:number;replayed?:boolean}>;
  progress: (message: string) => void;
  content?: (drafts: ReadingDraft[]) => void;
}) {
  let link: KnowledgeReadingPreparation | undefined, state: ReadingPreparationState | undefined;
  let accepted: boolean | undefined, stopped = false, failure: Error | undefined, checking: Promise<void> | undefined;
  let authorized = 0, charged = 0, authorizedBatches = 0;
  const completed = new Set<number>(), running = new Map<number,Promise<void>>();
  let latestSignature = "";
  const drafts = new Map<number, ReadingDraft>();
  const publish = (incoming: ReadingDraft[]) => {
    if(stopped)return;
    incoming.forEach(draft=>drafts.set(draft.index,draft));
    deps.content?.(Array.from(drafts.values()).sort((a,b)=>a.index-b.index));
  };
  const pump = () => {
    if(!accepted || stopped || failure || !state || !link)return;
    for(const index of state.ready) {
      if(running.size>=2)break;
      if(completed.has(index)||running.has(index))continue;
      deps.progress("读档顾问正在整理已读取的内容，整理结果将自动显示在下方…");
      const requestId=knowledgeBatchRequestId(link.documentId,index,0);
      const work=(async()=>{
        try {
          const result=await deps.execute(link!,index,requestId,state!.paidUnit);
          if(!result.replayed)charged+=result.creditsCharged;
          if(charged>authorized)throw Error("读档顾问费用超出确认范围，已停止后续请求");
          completed.add(index);
          if(!stopped) {
            try {
              const latest=await deps.state(link!.jobId);
              publish(latest.drafts||[]);
              if(!stopped)deps.progress(drafts.size ? "整理结果已保存并显示在下方，后续内容将自动更新" : "顾问已返回，正在读取已保存的整理内容");
            }
            catch { if(!stopped)deps.progress("已保存整理结果，内容暂未载入；不会重复购买，请保留当前页面"); }
          }
        }catch(e){failure=e instanceof Error?e:new Error(String(e));if(!stopped)deps.progress(`读档顾问暂停：${failure.message}。原读档继续，已完成工作保留`);}
        finally{running.delete(index);pump();}
      })();
      running.set(index,work);
    }
  };
  const update = async (value:KnowledgeReadingProgress) => {
    if(stopped)return;
    if(link&&link.jobId!==value.jobId)throw Error("读档顾问不能混入另一份文件");
    const signature=JSON.stringify(value);
    if(signature===latestSignature)return;
    if(checking) { await checking; if(signature===latestSignature)return; }
    checking=(async()=>{
      state=await deps.state(value.jobId);
      if(stopped)return;
      link={jobId:state.jobId,documentId:state.documentId,batches:state.batches};
      if(accepted===undefined || (accepted && state.batches>authorizedBatches)) {
        accepted=await deps.confirm(state);
        if(accepted){authorized=Math.max(authorized,charged+state.maxCredits);authorizedBatches=state.batches;}
      }
      publish(state.drafts||[]);
      if(stopped)return;
      state.completed.forEach(i=>completed.add(i));
      if(state.failed.length)failure=Error("部分原文没有读取成功，不能把缺段资料当完整稿交给顾问");
      latestSignature=signature;
      if(accepted)pump();else deps.progress("本次未启用读档同步顾问；完整原稿继续读取，出图前仍可整理");
    })();
    try{await checking;}finally{checking=undefined;}
  };
  return {
    update,
    stop(){stopped=true;},
    link(){return accepted&&!stopped?link:undefined;},
    async wait() {
      if(checking)await checking;
      while(running.size)await Promise.all(Array.from(running.values()));
      if(!accepted)return;
      if(failure)throw failure;
      if(stopped)throw Error("读档同步顾问已停止，未开始后续审校");
      if(!link||completed.size!==link.batches)throw Error("读档顾问仍有未整理分段，请恢复原任务；不会重新购买已完成部分");
    },
  };
}
