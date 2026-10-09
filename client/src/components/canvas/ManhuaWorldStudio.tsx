import { buildManhuaStageBgmAudio, type ManhuaPrevisAudio } from "@shared/manhuaPrevisAudio";
import { getSelectedAudioTake, type CanvasAudioStudio } from "@shared/canvasAudioStudio";
import type { ManhuaPrevisStudio as PrevisStudio } from "@shared/manhuaPrevis";
import {artMotionSpecSchema,type ArtMotionSpec} from "@shared/artMotion";
import type { PrevisStageAnimation } from "@shared/manhuaPrevisAnimation";
import type { AdvisorWorldControl } from "@/lib/manhuaAdvisorWorkflowControl";
import { useEffect } from "react";
/**
 * 场景 3D 世界工作台（PR-8）：每个已锁场景一行——生成 Marble 3DGS 世界 → 预览（全景/缩略图）→ 产物链接（Fly 桥稳定地址）。
 * 场景方案由顾问编写，确认后沿用原生成入口；预览和视角图留在同页。
 * 付费动作只发回调；确认在页面统一做。
 */
import { useMemo, useState, useRef } from "react";
import {
  type ManhuaWorld3dEligibility,
  type ManhuaWorld3dModel,
} from "@shared/manhuaWorld3d";
import type { DepthPanoMeta } from "@shared/manhuaLayoutDepthPano";
import { ManhuaWorldStagePreview, type ManhuaStageCharacter, type ManhuaStageFrameExport } from "./ManhuaWorldStagePreview";

export type ManhuaWorldStudioScene = {
  id: string;
  labelZh: string;
  thumbUrl?: string;
  /** 场景表氛围句，作默认提示词 */
  hintZh?: string;
  eligibility: ManhuaWorld3dEligibility;
};

export type ManhuaWorldGenerateOptions = { model: ManhuaWorld3dModel; textPrompt: string };

/** 导出视角图的绑定草稿：预览给机位/人物/实例版本，工作台补世界身份；上层再补集/段号 */
export type ManhuaStageFrameBindingDraft = ManhuaStageFrameExport & { worldTaskId: string; worldId?: string; worldSourceVersion: string };

/** PR-11 布局可控：深度全景 PNG + 元数据 + 提示词，由页面上传后以 layout 提示提交 */
export type ManhuaWorldLayoutSubmitOptions = { model: ManhuaWorld3dModel; textPrompt: string; depthPng: Blob; meta: DepthPanoMeta };

/** 当前段白模站位（用于生成深度全景） */
export type ManhuaWorldLayoutActor = { id: string; nameZh?: string; start: readonly [number, number]; shape?: "human" | "horse" };

type Props = {
  advisorSceneRequest?: { id: string; assetId: string };
  onAdvisorViewControl?: (control: AdvisorWorldControl | null, assetId: string) => void;
  scenes: ManhuaWorldStudioScene[];
  onSelectionChange?: (id: string | null) => void;
  onOpenAdvisor?: (sceneRefId: string) => void;
  busyIds: readonly string[];
  disabled?: boolean;
  onGenerate?: (id: string, options: ManhuaWorldGenerateOptions) => void | Promise<void>;
  onRetry?: (id: string) => void | Promise<void>;
  onRemove?: (id: string) => void | Promise<void>;
  /** PR-10：已就绪人物 GLB + 舞台点，放进就绪世界预览 */
  stageCharacters?: readonly ManhuaStageCharacter[];
  /** PR-10：导出的视角 PNG → 上传 → 作该场景候选参考图 */
  onExportStageFrame?: (sceneRefId: string, blob: Blob, frame: ManhuaStageFrameBindingDraft) => void | Promise<void>;
  /** PR-11：当前段白模站位；有则显示「布局可控」子面板 */
  layoutActors?: readonly ManhuaWorldLayoutActor[];
  onSubmitLayoutWorld?: (sceneRefId: string, options: ManhuaWorldLayoutSubmitOptions) => void | Promise<void>;
  /** 本段白模采用状态与返回入口；3D 场景只使用演员起点站位，不播放白模动作。 */
  previsStatusZh?: string;
  stageAnimation?: PrevisStageAnimation;
  previsAnimationSource?: {previsJobId:string;scopeId:string;clipId:string;duration:number;aspect:"9:16"|"16:9"};
  onRenderStageAnimation?: (spec:ArtMotionSpec)=>Promise<void>;
  previsStudio?: PrevisStudio;
  stageAudioStudio?: CanvasAudioStudio;
  onOpenPrevis?: () => void;
  savedFrameCount?: number;
  adoptedFrameCount?: number;
};

type Stage = "blocked" | "none" | "building" | "review" | "failed" | "ready";

const btn = "rounded border border-cyan-300/30 px-2 py-1 text-[11px] text-cyan-50 disabled:opacity-40";
const btnPrimary = "rounded border border-cyan-300/60 bg-cyan-500/20 px-2 py-1 text-[11px] text-cyan-50 disabled:opacity-40";

function hasStagePreviewUrl(s: ManhuaWorldStudioScene): boolean {
  try {
    return new URL(s.eligibility.currentWorld3d?.assets?.spz500kUrl || "").protocol === "https:";
  } catch {
    return false;
  }
}

export function manhuaWorldStageOf(s: ManhuaWorldStudioScene): { stage: Stage; labelZh: string; reasonZh?: string } {
  if (!s.eligibility.eligible) return { stage: "blocked", labelZh: "还不能生成", reasonZh: s.eligibility.reasonZh };
  const w = s.eligibility.currentWorld3d;
  if (!w) return { stage: "none", labelZh: "未生成" };
  switch (w.status) {
    case "queued":
    case "running":
      return { stage: "building", labelZh: "生成中…（约 1–5 分钟）" };
    case "reconcile_manual":
      return { stage: "review", labelZh: "结果待核对", reasonZh: "请稍后查看结果，暂勿重复生成" };
    case "failed":
      return { stage: "failed", labelZh: "生成失败", reasonZh: "可重试生成" };
    case "succeeded":
      return hasStagePreviewUrl(s)
        ? { stage: "ready", labelZh: "世界任务完成 · 可检查画面" }
        : { stage: "review", labelZh: "世界任务完成 · 预览文件未就绪", reasonZh: `暂不能查看或保存视角图；刷新后若仍无链接，请保留任务号 ${w.taskId} 核查，不要重新付费生成。` };
  }
}

export function manhuaWorldCounts(scenes: ManhuaWorldStudioScene[]): { total: number; ready: number } {
  return { total: scenes.length, ready: scenes.filter((s) => manhuaWorldStageOf(s).stage === "ready").length };
}

const STAGE_CLASS: Record<Stage, string> = {
  blocked: "bg-white/10 text-white/60",
  none: "bg-white/10",
  building: "bg-cyan-500/25",
  review: "bg-amber-500/25",
  failed: "bg-red-500/25",
  ready: "bg-emerald-500/20",
};

export function ManhuaWorldStudio(props: Props) {
  const [animationBusy,setAnimationBusy]=useState(false),[animationError,setAnimationError]=useState("");
  const animationLock=useRef(false);
  const { scenes, busyIds, disabled, onOpenAdvisor, onGenerate, onRetry, onRemove, stageCharacters = [], onExportStageFrame, onSubmitLayoutWorld, previsStatusZh, onOpenPrevis, savedFrameCount = 0, adoptedFrameCount = 0 } = props;
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeSceneId = scenes.some(scene => scene.id === activeId) ? activeId : scenes[0]?.id || null;
  useEffect(() => { props.onSelectionChange?.(activeSceneId); }, [activeSceneId, props.onSelectionChange]);
  const [openPreviewId, setOpenPreviewId] = useState<string | null>(null);
  const rows = useMemo(() => scenes.map(s => ({ s, ...manhuaWorldStageOf(s) })), [scenes]);
  const counts = useMemo(() => manhuaWorldCounts(scenes), [scenes]);
  useEffect(()=>{if(props.advisorSceneRequest){setActiveId(props.advisorSceneRequest.assetId);setOpenPreviewId(props.advisorSceneRequest.assetId);}},[props.advisorSceneRequest]);
  return (
    <section className="w-full rounded-xl border border-cyan-300/25 bg-[#0c121d] p-3 text-white" data-manhua-world-studio>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-cyan-100">3D 场景</span>
        <span className="rounded bg-white/10 px-1.5 py-0.5">可尝试载入 {counts.ready}/{counts.total}</span>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-cyan-300/20 bg-cyan-500/5 p-2 text-[11px] text-white/75" data-world-previs-link>
        <span>本段白模：{previsStatusZh || "尚无可用白模"}。3D 场景读取白模人物的起点站位，逐秒动作与切镜请回白模预演查看。</span>
        {onOpenPrevis ? <button type="button" className={btn} onClick={onOpenPrevis}>查看本段白模预演</button> : null}
      </div>
      <ol className="mb-2 flex flex-wrap items-center gap-1 text-[11px] text-cyan-50" data-world-steps aria-label="3D 场景使用步骤">
        {["选场景", "查看场景", "选机位", "保存视角图", "采用到镜头"].map((step, i) => (
          <li key={step} className="flex items-center gap-1">
            {i ? <span aria-hidden="true" className="text-white/35">→</span> : null}
            <span className="rounded bg-cyan-500/10 px-1.5 py-0.5">{i + 1}. {step}</span>
          </li>
        ))}
      </ol>
      <p className="mb-2 text-[11px] text-white/50">场景只提供空间与机位参考；人物动作、对白和成片仍在后续步骤制作。还没有世界的场景，点击该场景的顾问入口描述生成要求。</p>
      <p className="mb-2 text-[11px] text-white/60" data-world-frame-progress>本段视角图：已保存候选 {savedFrameCount} 张，已采用到镜头 {adoptedFrameCount} 处。保存只建立候选，须在下方逐镜采用后才可进入视频输入。</p>
      {!scenes.length ? <p className="text-[11px] text-amber-100">本剧还没有锁定的场景资产，先在资产区出场景空镜并确认。</p> : null}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[200px_minmax(0,1fr)]" data-world-workspace>
      <nav aria-label="选择当前3D场景" className="max-h-[65vh] space-y-2 overflow-y-auto rounded-xl border border-white/10 p-2">
        {rows.map(({s,labelZh}) => <button key={s.id} type="button" aria-pressed={activeSceneId === s.id} className={`block w-full rounded-lg border p-2 text-left ${activeSceneId === s.id ? "border-cyan-300/60 bg-cyan-500/10" : "border-white/10"}`} onClick={() => {setActiveId(s.id);setOpenPreviewId(null);}}>
          {s.thumbUrl && <img src={s.thumbUrl} alt="" className="mb-2 aspect-video w-full rounded object-cover" />}<strong className="block break-words text-sm">{s.labelZh}</strong><span className="mt-1 block text-xs text-white/60">{busyIds.includes(s.id) ? "处理中…" : labelZh}</span>
        </button>)}
      </nav>
      <ul className="min-w-0" data-world-main-list>
        {rows.filter(row => row.s.id === activeSceneId).map(({ s, stage, labelZh, reasonZh }) => {
          const busy = busyIds.includes(s.id);
          const world = s.eligibility.currentWorld3d;
          const assets = world?.assets;
          const canView = stage === "ready" && Boolean(assets);
          let audioTimeline:ManhuaPrevisAudio|undefined;
          let audioIssue="";
          if(props.previsAnimationSource){
            try{audioTimeline=buildManhuaStageBgmAudio(props.stageAudioStudio,props.previsAnimationSource.duration,props.previsStudio?.audioStartSec??0,props.previsStudio?.loopBgm??false);}
            catch(error){audioIssue=error instanceof Error?error.message:"配乐配置未通过检查";}
          }
          return (
            <li key={s.id} className={`flex min-w-0 flex-wrap items-center gap-3 rounded-xl p-3 text-xs ${canView ? "bg-white/5" : "bg-white/[0.02] text-white/55"}`} data-scene-id={s.id} data-stage={stage}>
              {s.thumbUrl ? <img src={s.thumbUrl} alt={s.labelZh} className="h-12 w-20 rounded object-cover" /> : <span className="h-8 w-12 rounded bg-white/10" />}
              <span className="min-w-[4rem] font-medium">{s.labelZh}</span>
              <span className={`rounded px-1.5 py-0.5 ${STAGE_CLASS[stage]}`}>{busy ? "处理中…" : labelZh}</span>
              {reasonZh ? <span className="text-amber-100">{reasonZh}</span> : null}
              <span className="ml-auto flex gap-1">
                {stage === "failed" && onRetry ? <button type="button" className={btn} disabled={disabled || busy} onClick={() => void onRetry(s.id)}>重试原任务（费用另行确认）</button> : null}
                {onOpenAdvisor && (stage === "none" || stage === "failed" || stage === "ready") ? <button type="button" className={btnPrimary} disabled={disabled || busy} onClick={() => onOpenAdvisor(s.id)}>{stage === "ready" ? "讨论场景调整" : "让顾问安排3D场景"}</button> : null}
                {onRemove && (stage === "ready" || stage === "failed" || stage === "review") ? <button type="button" className={btn} disabled={disabled || busy} onClick={() => void onRemove(s.id)}>删除世界</button> : null}

                {canView ? (
                  <button type="button" className={btnPrimary} disabled={disabled} data-world-primary="view" onClick={() => setOpenPreviewId((prev) => (prev === s.id ? null : s.id))}>
                    {openPreviewId === s.id ? "收起" : "查看场景"}
                  </button>
                ) : null}
              </span>
              {openPreviewId !== s.id || !canView ? <div className="flex min-h-80 w-full flex-col items-center justify-center rounded-xl border border-white/10 bg-black/30 p-3" data-world-reference-preview>{s.thumbUrl ? <img src={s.thumbUrl} alt={`${s.labelZh}场景参考图`} className="max-h-[55vh] max-w-full object-contain" /> : <p>尚无场景参考图</p>}<p className="mt-3 text-xs text-white/55">当前为场景参考图{canView ? "，点击查看场景载入真实3D空间。" : "；世界就绪后可检查空间与保存机位。"}</p></div> : null}
              {canView && props.onRenderStageAnimation ? <div className="w-full space-y-2 rounded border border-cyan-300/30 p-3" data-stage-animation-submission>
                <p className="font-medium">本次场景动画提交内容</p>
                <p>场景：{s.labelZh} · 版本 {world?.taskId}；动作工程：{props.previsAnimationSource?.previsJobId??"尚未采用"}；{props.previsAnimationSource?.duration??"—"} 秒 · 720p／24fps。保留原角色、动作、特效和运镜，本次不含对白。</p>
                <p>费用：不调用视频模型，无新增视频模型费用；渲染计算按现有记账。复用已采用BGM，不新生成音乐。</p>
                {audioIssue?<p role="alert" className="text-amber-100">{audioIssue}</p>:audioTimeline?<div data-stage-animation-audio-review>
                  <p>本次已采用配乐 {audioTimeline.bgmCount} 条，共 {audioTimeline.clips.length} 个裁片；本段 {audioTimeline.startSec}—{audioTimeline.startSec+audioTimeline.durationSec} 秒。</p>
                  {audioTimeline.clips.map((clip,index)=>{
                    const cue=props.stageAudioStudio?.cues.find(c=>getSelectedAudioTake(c)?.gcsUri===clip.audioUri);
                    const take=cue&&getSelectedAudioTake(cue);
                    return <p key={index}>{cue?.labelZh||"已采用BGM"} · 版本 {take?.id??"来源见方案"}：源 {clip.sourceStartSec.toFixed(3)}—{clip.sourceEndSec.toFixed(3)} 秒 → 片内 {clip.startSec.toFixed(3)}—{(clip.startSec+clip.sourceEndSec-clip.sourceStartSec).toFixed(3)} 秒；音量 {clip.volume}，淡入 {clip.fadeInSec} 秒，淡出 {clip.fadeOutSec} 秒。</p>;
                  })}
                </div>:props.previsAnimationSource?<p data-stage-animation-silent>当前片段在这个秒窗没有启用BGM，本次按留白输出无声音轨；需要配乐时请先到对白与BGM绑定已有采用音轨。</p>:null}
                {props.previsStudio?<details open><summary>本次逐镜原文、人物动作与相机输入</summary>
                  <div className="space-y-3 py-2">{props.previsStudio.advisorShotSource?.shots.map(shot=><div key={shot.index} className="rounded border border-white/15 p-2">
                    <p className="font-medium">第{shot.index}镜 · {shot.startSec}—{shot.endSec}秒</p><p className="whitespace-pre-wrap">剧情动作：{shot.actionZh}</p>
                    <p className="whitespace-pre-wrap">运镜：{shot.cameraZh||"沿用下方已采用相机工程"}</p>
                    {shot.dialogueZh?<p className="whitespace-pre-wrap">原对白（本次不生成声音）：{shot.dialogueZh}</p>:<p>本镜无对白。</p>}
                  </div>)}</div>
                  <p>工程人物：{props.previsStudio.spec.actors.map(actor=>actor.id).join("、")}</p>
                  <p>相机秒窗：{props.previsStudio.spec.cameras.map(camera=>`${camera.startSec}—${camera.endSec}秒，${camera.lens}mm${camera.endLens?`→${camera.endLens}mm`:""}`).join("；")}</p>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap">{JSON.stringify({shots:props.previsStudio.advisorShotSource?.shots??[],spec:props.previsStudio.spec},null,2)}</pre>
                </details>:null}
                <button type="button" className={btnPrimary} disabled={disabled||animationBusy||!props.previsAnimationSource||Boolean(audioIssue)} onClick={async()=>{
                  if(animationLock.current||!props.previsAnimationSource||!world||audioIssue)return;
                  animationLock.current=true;setAnimationBusy(true);setAnimationError("");
                  try{
                    const source=props.previsAnimationSource;
                    const spec=artMotionSpecSchema.parse({version:1,mode:"animation",grammar:"y5_kinetic_type",duration:source.duration,
                      width:source.aspect==="9:16"?720:1280,height:source.aspect==="9:16"?1280:720,fps:24,title:s.labelZh+" · 本段场景动画",cues:[],data:{},scenes:[],
                      stageAnimation:{previsJobId:source.previsJobId,scopeId:source.scopeId,clipId:source.clipId,worldTaskId:world.taskId,sceneRef:s.id,worldSourceVersion:world.sourceVersion},...(audioTimeline?{audioTimeline}:{})});
                    await props.onRenderStageAnimation!(spec);
                  }catch(error){setAnimationError(error instanceof Error?error.message:"场景动画提交未确认，请续查原任务");}
                  finally{animationLock.current=false;setAnimationBusy(false);}
                }}>{animationBusy?"保存原请求并提交…":"确认以上内容并生成本段场景动画"}</button>
                <p className="mt-2 text-xs text-white/70">先在白模勾选导出场景动画并采用当前候选；输出沿用原动作与相机，720p／24fps，不调用视频模型。配乐按上方已采用版本及全部裁片随首次提交；不会自动采用成片。</p>
                {animationError?<p role="alert">{animationError}</p>:null}
              </div>:null}
              {openPreviewId === s.id && canView && assets ? (
                <div className="mt-1 w-full rounded border border-cyan-300/20 bg-black/30 p-2" data-manhua-world-preview>
                  <div>
                    <ManhuaWorldStagePreview
                      onAdvisorControl={control=>props.onAdvisorViewControl?.(control ? (action,signal)=>{if(action.assetId && action.assetId!==s.id)throw new Error("载入的3D世界尚不是目标场景，未导出");return control(action,signal);} : null,s.id)}
                      sceneLabelZh={s.labelZh}
                      world={assets}
                      characters={stageCharacters}
                      animation={props.stageAnimation}
                      onExportStageFrame={
                        onExportStageFrame && world
                          ? (blob, frame) => onExportStageFrame(s.id, blob, { ...frame, worldTaskId: world.taskId, ...(world.worldId ? { worldId: world.worldId } : {}), worldSourceVersion: world.sourceVersion })
                          : undefined
                      }
                    />
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      </div>
      {scenes.length && (onGenerate || onRemove || onSubmitLayoutWorld) ? (
        <p className="rounded border border-cyan-300/20 p-3 text-xs text-white/70">选定场景后，向创作顾问描述空间关系、时间与氛围；确认方案后生成3DGS。已有场景和视角图保留在本页，人物动作请切换到动作白模标签。</p>
      ) : null}
    </section>
  );
}
