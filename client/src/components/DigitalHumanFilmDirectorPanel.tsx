import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { trpc } from "@/lib/trpc";
import { buildDigitalHumanAdvisorProject } from "@/lib/digitalHumanAdvisor";
import { manhuaCreativeAdvisorContextSchema } from "@shared/manhuaCreativeAdvisor";
import { digitalHumanFilmTarget, digitalHumanAdoptedFilmPrompt, type DigitalHumanDraft } from "@shared/digitalHumanStudio";
import { DIGITAL_HUMAN_FILM_MODELS, digitalHumanFilmTargetSchema, digitalHumanFilmPlanSchema, parseDigitalHumanFilmPlan, compileDigitalHumanFilm } from "@shared/digitalHumanFilmDirector";

const pendingSchema = z.object({id:z.string().uuid(),target:digitalHumanFilmTargetSchema,context:manhuaCreativeAdvisorContextSchema,paid:z.boolean(),credits:z.number().optional()});
const key = "film-director-pending";
const errorText = (e:unknown) => e instanceof Error ? e.message : String(e);
export function DigitalHumanFilmDirectorPanel(props:{draft:DigitalHumanDraft;disabled:boolean;save:(fn:(d:DigitalHumanDraft)=>DigitalHumanDraft)=>void;beforeSubmit:()=>Promise<void>;acquireWork:(label:string)=>()=>void}) {
  const [error,setError]=useState(""), [busy,setBusy]=useState(false), [listened,setListened]=useState(false);
  const lock=useRef(false);
  const [paymentNeeded,setPaymentNeeded]=useState(false);
  const ask=trpc.mvAnalysis.askPlatformSkillQa.useMutation({retry:false});
  const quota=trpc.mvAnalysis.getManhuaAdvisorQuota.useQuery(undefined,{retry:false});
  const pendingRaw=props.draft.advisorStorage[key];
  let revision="";
  try { revision=digitalHumanFilmTarget(props.draft).revision; } catch { /* 缺少有效音轨时由提交和采用入口显示原因。 */ }
  useEffect(()=>setListened(false),[revision]);
  const outdated=Boolean(props.draft.filmDirector && revision!==props.draft.filmDirector.target.revision);
  let current="";
  try { current=digitalHumanAdoptedFilmPrompt(props.draft); } catch { /* 状态在界面明确展示，预览同样阻断。 */ }
  let preview="";
  if(props.draft.filmDirector) {
    try { preview=compileDigitalHumanFilm(props.draft.filmDirector.plan,props.draft.filmDirector.target.model); }
    catch(e) { preview=`当前方案无法编译：${errorText(e)}`; }
  }
  async function send() {
    if(lock.current||props.disabled)return;
    lock.current=true;setBusy(true);setError("");
    let release:(()=>void)|undefined;
    try {
      release=props.acquireWork("完整导演方案");
      let pending=pendingRaw?pendingSchema.parse(JSON.parse(pendingRaw)):undefined;
      if(pending && paymentNeeded) {
        const latest=await quota.refetch();if(!latest.data)throw new Error("无法核对原请求价格");
        if(!window.confirm(`原导演请求需要${latest.data.price}积分，确认按原编号继续？`))return;
        pending={...pending,paid:true,credits:latest.data.price};
        props.save(d=>({...d,advisorStorage:{...d.advisorStorage,[key]:JSON.stringify(pending)}}));
        await props.beforeSubmit();setPaymentNeeded(false);
      }
      if(!pending){
        const latest=await quota.refetch();if(!latest.data)throw new Error("顾问额度暂不可用，未提交");
        const target=digitalHumanFilmTarget(props.draft);
        const context=manhuaCreativeAdvisorContextSchema.parse({...buildDigitalHumanAdvisorProject(props.draft).context,digitalHumanFilm:target});
        pending={id:crypto.randomUUID(),target,context,paid:latest.data.remaining===0&&!latest.data.exempt,credits:latest.data.price};
        if(pending.paid&&!window.confirm(`完整导演方案需要${pending.credits}积分。发送当前文稿、演法要求、所选模型与音轨时长，确认？`))return;
        props.save(d=>({...d,advisorStorage:{...d.advisorStorage,[key]:JSON.stringify(pending)}}));
        await props.beforeSubmit();
      }
      const question="为当前数字人完整文稿生成逐镜成片导演方案，逐项安排表情、演技、动作、运镜、灯光、氛围、视觉特效、环境底声与事件音效；严格保留全文，BGM后期加入，字幕关闭。";
      const result=await ask.mutateAsync({requestId:pending.id,question,rawQuestion:question,manhuaContext:pending.context,confirmPaid:pending.paid||undefined,confirmedCredits:pending.paid?pending.credits:undefined});
      const plan=digitalHumanFilmPlanSchema.parse(JSON.parse(result.answer.replace(/^```(?:json)?\s*|\s*```$/g,"")));
      if(plan.targetId!==pending.target.id||plan.revision!==pending.target.revision)throw new Error("导演返回了其他版本的方案，原请求已保留");
      try { parseDigitalHumanFilmPlan(JSON.stringify(plan),pending.target); } catch(e) { setError(`方案需要修正后才能采用：${errorText(e)}`); }
      props.save(d=>{const storage={...d.advisorStorage};if(d.filmDirector)storage[`film-director-history:${pending!.id}`]=JSON.stringify(d.filmDirector);storage[`film-director-response:${pending!.id}`]=result.answer;delete storage[key];return {...d,advisorStorage:storage,filmDirector:{target:pending!.target,plan,adopted:false}};});
      setListened(false);await props.beforeSubmit();
    }catch(e){
      setError(errorText(e));
      if ((e as {data?:{code?:string}})?.data?.code === "PAYMENT_REQUIRED") setPaymentNeeded(true);
      if(errorText(e).includes("ADVISOR_OPERATION_FAILED")){
        props.save(d=>{const storage={...d.advisorStorage};storage[`film-director-failed:${Date.now()}`]=JSON.stringify({request:storage[key],error:errorText(e)});delete storage[key];return {...d,advisorStorage:storage};});
        await props.beforeSubmit().catch(()=>{});
      }
    }finally{release?.();lock.current=false;setBusy(false);}
  }
  function editShot(index:number, field:"expression"|"performance"|"action"|"camera"|"lighting"|"atmosphere"|"soundEffect"|"visualEffect"|"environmentSound", value:string) {
    setListened(false);
    props.save(d=>!d.filmDirector?d:({...d,filmDirector:{...d.filmDirector,adopted:false,plan:{...d.filmDirector.plan,
      shots:d.filmDirector.plan.shots.map((shot,i)=>i===index?{...shot,[field]:value}:shot)}}}));
  }
  return <section className="dh-card dh-wide">
    <h3>完整导演方案 · 表演与成片提示词</h3>
    <p>使用漫剧工厂创作顾问，按当前文稿、原声时长、人物与场景逐镜安排。逐句时点须结合原声试听核对，方案不会自动生成视频。</p>
    <p>{DIGITAL_HUMAN_FILM_MODELS[props.draft.filmModel||"seedance-2.5"].label} · {quota.data?`顾问剩余免费${quota.data.remaining}次，超出${quota.data.price}积分/次` : "正在核对顾问额度"}</p>
    <details><summary>本次发送内容</summary><p>{props.draft.script}</p><p>{props.draft.direction}</p><p>身份与场景使用当前已选素材；BGM后期混音，字幕关闭；不上传录音内容给文字顾问。</p></details>
    <button type="button" disabled={props.disabled||busy} onClick={()=>void send()}>{pendingRaw?"恢复原导演请求":"生成完整导演方案"}</button>
    {error&&<p role="alert">{error}</p>}
    {props.draft.filmDirector&&<>
      <p>{current?"当前方案已采用":"候选方案未采用或输入已变化，请核对后采用"}</p>
      <p>自动方案可逐镜微调；修改后请重新核对并采用。已采用的版本同时供空间顾问和成片生成读取。</p>
      {props.draft.filmDirector.plan.shots.map((shot,index)=><details key={index}>
        <summary>镜{index+1} · {shot.startSec}–{shot.endSec}秒 · 手动微调</summary>
        <p>{shot.dialogue || "无对白"}；细节中的秒数从本镜0秒起算。</p>
        {([['expression','表情'],['performance','演技与语气'],['action','人物动作'],['camera','运镜'],['lighting','灯光'],['atmosphere','氛围'],['visualEffect','视觉特效与受光'],['environmentSound','环境底声'],['soundEffect','事件音效']] as const).map(([field,label])=><label key={field}>{label}<textarea value={shot[field] ?? ""} maxLength={1200} disabled={props.disabled||busy} onChange={e=>editShot(index,field,e.target.value)}/></label>)}
      </details>)}
      <pre>{preview}</pre>
      <label><input type="checkbox" checked={listened} onChange={e=>setListened(e.target.checked)}/>我已对照原声核对逐句时点、表情、动作与镜头</label>
      <button type="button" disabled={props.disabled||busy||!listened} onClick={()=>{
        try {const target=digitalHumanFilmTarget(props.draft);const plan=parseDigitalHumanFilmPlan(JSON.stringify({...props.draft.filmDirector!.plan,targetId:target.id,revision:target.revision}),target);setError("");props.save(d=>({...d,filmDirector:{target,plan,adopted:true}}));void props.beforeSubmit().catch(e=>setError(errorText(e)));}catch(e){setError(errorText(e));}
      }}>{outdated?"按当前素材重新核对并采用":"采用完整导演方案"}</button>
    </>}
  </section>;
}
