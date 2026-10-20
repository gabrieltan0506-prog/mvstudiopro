import { creativeUserText } from "@/lib/creativeUserText";
import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { musicMvSourceKey } from "@/lib/musicMvAdvisor";
import { manhuaSourceVersionIdentity } from "@shared/manhuaMultiview";
import { creativeLearningReportSchema, type CreativeLearningSession } from "@shared/creativeGenerationLibrary";
import type { CanvasMusicCandidate } from "@shared/canvasMusicMv";
import { CreativeEvidenceReviewPanel } from "./CreativeEvidenceReviewPanel";

type Props = {
  audio?: CanvasMusicCandidate;
  mediaKind: "audio" | "video";
  projectId?: string;
  videoModel: string;
  disabled: boolean;
  session?: CreativeLearningSession;
  onSession: (session: CreativeLearningSession, isNew: boolean) => void;
};
const button = "rounded border border-white/20 px-2 py-1 text-xs disabled:opacity-40";
const requirements = "从本次完整音视频提炼有证据的歌曲创作方法，逐段说明情绪推进、具体写作与编曲做法、适用和不适用条件；矛盾与不确定项如实保留。";
export function CanvasCreativeLearning(p: Props) {
  const ask = trpc.mvAnalysis.askPlatformSkillQa.useMutation({retry:false});
  const save = trpc.canvasMusicMv.saveCreativeLibrary.useMutation({retry:false});
  const quota = trpc.mvAnalysis.getManhuaAdvisorQuota.useQuery(p.projectId ? {projectId:p.projectId} : undefined, {retry:false});
  const utils = trpc.useUtils();
  const current = useRef(p); current.current = p;
  const lock = useRef(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [paid,setPaid] = useState(false);
  const run = async (confirmPaid=false,newVersion=false) => {
    if(lock.current || p.disabled)return;
    lock.current=true;setBusy(true);setError("");
    let session=current.current.session;
    try {
      if(!session || newVersion){
        if(session?.status==="pending")throw Error("请先恢复原学习请求，避免重复读取");
        const source=current.current;
        if(!source.audio)throw Error("请先上传或选择参考音视频");
        const audio={...source.audio};
        const sourceKey=await musicMvSourceKey({audio:{...audio,url:manhuaSourceVersionIdentity(audio.gcsUri||audio.url)},mediaKind:source.mediaKind,requirements});
        if(current.current.audio?.id!==audio.id || current.current.mediaKind!==source.mediaKind || manhuaSourceVersionIdentity(current.current.audio?.gcsUri||current.current.audio?.url)!==manhuaSourceVersionIdentity(audio.gcsUri||audio.url))throw Error("参考素材已变化，请重新发起学习");
        session={requestId:crypto.randomUUID(),projectId:source.projectId,videoModel:source.videoModel,target:{audio,sourceKey,referenceMediaKind:source.mediaKind,requirements},status:"pending"};
        current.current={...current.current,session};
        p.onSession(session,true);
      }
      const result=await ask.mutateAsync({requestId:session.requestId,question:requirements,rawQuestion:requirements,
        manhuaContext:{projectId:session.projectId,seriesTitle:"创意生成库",episodeIndex:1,episodeTitle:"音视频方法学习",stage:"storyboard",activeStudio:{tool:"musicMv",episodeIndex:1},videoModel:session.videoModel,writerConfirmed:false,episodeBody:"",assetSummary:"",shotSummary:"",blockers:[],creativeLearning:session.target},
        ...(confirmPaid?{confirmPaid:true,confirmedCredits:quota.data?.price}:{})});
      const report=creativeLearningReportSchema.parse(typeof result.answer==="string"?JSON.parse(result.answer):result.answer);
      if(report.sourceKey!==session.target.sourceKey)throw Error("学习结果来源版本不一致");
      if(current.current.session?.requestId!==session.requestId)return;
      const next={...session,status:"succeeded" as const,report};current.current={...current.current,session:next};p.onSession(next,false);setPaid(false);void quota.refetch();
    }catch(e){
      const message=e instanceof Error?e.message:String(e);setError(message);
      if(/PAYMENT_REQUIRED|免费.*用完|请确认后重试/.test(message))setPaid(true);
      if(session && /ADVISOR_OPERATION_FAILED/.test(message)){const next={...session,status:"failed" as const};current.current={...current.current,session:next};p.onSession(next,false);}
    }finally{lock.current=false;setBusy(false);}
  };
  const collect=async()=>{
    const session=current.current.session;
    if(lock.current||p.disabled||!session?.report?.evidenceId||session.report.review?.verdict!=="approved")return;
    lock.current=true;setBusy(true);setError("");
    try{const entry=await save.mutateAsync({evidenceId:session.report.evidenceId});
      if(current.current.session?.requestId===session.requestId)p.onSession({...session,savedEntryId:entry.id},false);
      await utils.canvasMusicMv.listCreativeLibrary.invalidate();
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{lock.current=false;setBusy(false);}
  };
  return <section aria-label="学习并扩充创意生成库" className="space-y-2 rounded border border-white/20 p-2 text-xs">
    <h4>把参考作品的方法加入创意生成库</h4>
    <p>本次提交：{p.audio?.title||"尚未选择素材"} {p.audio?`· ${p.audio.durationSec.toFixed(2)} 秒`:""}。完整分析参考作品，提炼可复用的创作方法。</p>
    <p>{requirements} 分析使用顾问额度，收藏不另收费；新创作可选用已收藏方法。</p>
    <button className={button} disabled={busy||p.disabled||(!p.audio&&!p.session)||Boolean(p.session&&p.session.status!=="pending")} onClick={()=>void run()}>{busy?"处理中…":p.session?.status==="pending"?"恢复原学习请求":"读取素材并提炼方法"}</button>
    {p.session&&p.session.status!=="pending"&&<button className={button} disabled={busy||p.disabled||!p.audio} onClick={()=>void run(false,true)}>按当前素材新建学习版本</button>}
    {paid&&<button className={button} disabled={busy||p.disabled||!Number.isFinite(quota.data?.price)} onClick={()=>void run(true)}>确认本次咨询 {quota.data?.price} 积分</button>}
    {error&&<p role="alert">{creativeUserText(error)}</p>}
    {p.session?.report&&<div><h5>{p.session.report.titleZh}</h5><p>{p.session.report.summaryZh}</p>
      {p.session.report.methods.map(method=><details key={method.id}><summary>{method.titleZh}</summary><p>{method.principleZh}</p>{method.stepsZh.map((step,i)=><p key={i}>{i+1}. {step}</p>)}<p>适用：{method.suitableWhenZh}</p><p>不宜照搬：{method.avoidWhenZh}</p>{method.uncertaintiesZh.map((line,i)=><p key={i}>{line}</p>)}</details>)}
      {p.session.report.limitationsZh.map((line,i)=><p key={i}>{line}</p>)}
      <CreativeEvidenceReviewPanel review={p.session.report.review}/>
      <button className={button} disabled={busy||p.disabled||Boolean(p.session.savedEntryId)||p.session.report.review?.verdict!=="approved"} onClick={()=>void collect()}>{p.session.savedEntryId?"已收藏，后续咨询可使用":"确认收藏到创意生成库"}</button>
    </div>}
  </section>;
}
