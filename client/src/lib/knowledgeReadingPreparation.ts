import { knowledgeBatchRequestId } from "@shared/knowledgePublication";
import type { KnowledgeReadingPreparation, KnowledgeReadingProgress } from "@shared/knowledgeReadingPreparation";

export type ReadingPreparationState = KnowledgeReadingPreparation & {
  status: string; ready: number[]; completed: number[]; failed: number[];
  paidUnit: number; maxCredits: number; estimatedCredits: number;
};
/** 与读档轮询解耦的两通道队列；每个稳定请求只发一次，未知结果仅查询原任务。 */
export function createKnowledgeReadingController(deps: {
  state: (jobId: string) => Promise<ReadingPreparationState>;
  confirm: (state: ReadingPreparationState) => Promise<boolean>;
  execute: (link: KnowledgeReadingPreparation, index: number, requestId: string, paidUnit: number) => Promise<{creditsCharged:number;replayed?:boolean}>;
  progress: (message: string) => void;
}) {
  let link: KnowledgeReadingPreparation | undefined, state: ReadingPreparationState | undefined;
  let accepted: boolean | undefined, stopped = false, failure: Error | undefined, checking: Promise<void> | undefined;
  let authorized = 0, charged = 0;
  const completed = new Set<number>(), running = new Map<number,Promise<void>>();
  let latestSignature = "";
  const pump = () => {
    if(!accepted || stopped || failure || !state || !link)return;
    for(const index of state.ready) {
      if(running.size>=2)break;
      if(completed.has(index)||running.has(index))continue;
      const requestId=knowledgeBatchRequestId(link.documentId,index,0);
      const work=(async()=>{
        try {
          const result=await deps.execute(link!,index,requestId,state!.paidUnit);
          if(!result.replayed)charged+=result.creditsCharged;
          if(charged>authorized)throw Error("读档顾问费用超出确认范围，已停止后续请求");
          completed.add(index);
          if(!stopped)deps.progress(`读档顾问已整理 ${completed.size}/${link!.batches} 组，正在与读档同步工作`);
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
      if(accepted===undefined){authorized=state.maxCredits;accepted=await deps.confirm(state);}
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
