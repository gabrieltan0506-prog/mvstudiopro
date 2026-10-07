import {buildSrcDoc,type StageSceneConfig} from "@shared/manhuaStageRuntime";
export {buildSrcDoc} from "@shared/manhuaStageRuntime";
export type {StageSceneConfig} from "@shared/manhuaStageRuntime";
import type { PrevisStageAnimation } from "@shared/manhuaPrevisAnimation";
import { loadPrevisStageAnimation } from "@/lib/manhuaStageAnimation";
import type { AdvisorWorldControl } from "@/lib/manhuaAdvisorWorkflowControl";
/**
 * 角色进场景预览（PR-10）：SparkJS（three.js 高斯渲染）+ three.js 在 iframe 里跑——
 * 仓库没装 three/@sparkjsdev/spark 且本 PR 不加依赖，所以和 ModelViewer 一样走 srcdoc + importmap（jsdelivr）动态加载；
 * 渲染器拉不下来时只显示占位「3D 世界预览需要加载渲染器」，绝不让工作台崩。
 *
 * 坐标：SPZ 按 shared/manhuaWorldStage.marbleToStageTransform 摆正到舞台（Z 上、米）；
 * 人物 GLB（Y 上）绕 X +90° 立起来，按 placeCharacterOnGround 贴地；碰撞网格只做显示开关。
 * 三机位（建立/过肩/单人）来自 threeCameraRigForKeyframe；「导出当前视角 PNG」由 iframe canvas.toDataURL 回传。
 *
 * WL-D02 就绪门禁：每次场景配置（世界/人物/碰撞）生成一个 revision；iframe 汇总必需资产清单（世界高斯 + 每个人物 + 碰撞），
 * await 各自真实成功信号后才报 ready（带 loaded/failed）；缺人物 → partial，列出 actorId，可看不可导出；
 * 主机只收当前 revision 的消息，旧实例迟到的 ready/frame 一律作废；导出回执带 revision + cameraKind，导出前换机位即作废。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ManhuaWorld3dAssets } from "@shared/manhuaWorld3d";
import {
  classifyManhuaStageLoadFailure,
  describeManhuaStageLoadFailure,
  describeManhuaStageModelIssue,
  type ManhuaStageModelIssue,
  type ManhuaStageReasonZh,
} from "@/lib/manhuaStageActorModel";
import {
  STAGE_CAMERA_KINDS,
  STAGE_CAMERA_LABEL_ZH,
  marbleToStageTransform,
  placeCharacterOnGround,
  threeCameraRigForKeyframe,
  type StageCameraKind,
  type StageCameraRig,
} from "@shared/manhuaWorldStage";

export type ManhuaStageCharacter = {
  id: string;
  assetRef?: string;
  labelZh: string;
  /** 已就绪的人物 GLB（https） */
  glbUrl: string;
  /** glbUrl 为空时由页面按人物绑定与模型任务状态给出的原因（resolveManhuaStageActorModel），不参与场景签名 */
  modelIssue?: ManhuaStageModelIssue;
  /** 舞台点（米，Z 上） */
  stagePoint: readonly [number, number];
  heightM?: number;
  yawDeg?: number;
};

/** 导出回执：PNG 之外还带机位/人物/实例版本，由上层补世界与镜号后写进 ref.stageFrame */
export type ManhuaStageFrameExport = {
  viewLabelZh: string;
  cameraKind: StageCameraKind;
  /** 本帧里加载成功的人物 id（= 全部预期人物；缺人不放行） */
  actorIds: string[];
  revision: string;
  camera: StageCameraRig;
  actors: ManhuaStageCharacter[];
  timeSec: 0;
};

/** code 由 iframe 按错误类型打：http（带 status）/ network / parse / no_position / missing_url；页面侧据此归类，不按文字猜 */
export type StageAssetFailure = { id: string; kind: "world" | "collider" | "actor"; message: string; code?: string; status?: number };

type Props = {
  sceneLabelZh: string;
  world: ManhuaWorld3dAssets;
  characters: readonly ManhuaStageCharacter[];
  animation?: PrevisStageAnimation;
  height?: number | string;
  /** 导出当前视角 PNG（供关键帧参考）；不传则不显示导出按钮 */
  onAdvisorControl?: (control: AdvisorWorldControl | null) => void;
  onExportStageFrame?: (blob: Blob, frame: ManhuaStageFrameExport) => void | Promise<void>;
};


function isHttps(url: string | undefined): url is string {
  try {
    return Boolean(url) && new URL(String(url)).protocol === "https:";
  } catch {
    return false;
  }
}


/** 组件外可测的纯函数：世界资产 + 人物 → iframe 场景配置（无 https 主产物则 null） */
export function buildStageSceneConfig(world: ManhuaWorld3dAssets, characters: readonly ManhuaStageCharacter[], initialCamera: StageCameraRig, revision = "0"): StageSceneConfig | null {
  if (!isHttps(world.spz500kUrl)) return null;
  const t = marbleToStageTransform({ metricScaleFactor: world.metricScaleFactor, groundPlaneOffset: world.groundPlaneOffset });
  return {
    revision,
    spzUrl: world.spz500kUrl,
    ...(isHttps(world.colliderGlbUrl) ? { colliderUrl: world.colliderGlbUrl } : {}),
    transform: { scale: t.scale, quaternionXYZW: t.quaternionXYZW, translationStage: t.translationStage },
    characters: characters
      .map((c) => ({ id: c.id, glbUrl: c.glbUrl, stagePoint: c.stagePoint, heightM: c.heightM && c.heightM > 0 ? c.heightM : 1.7, yawDeg: c.yawDeg ?? 0 })),
    initialCamera,
  };
}

/** 初始机位至少离所有人物中心一定距离；背负乘员与近距离站位也不能把镜头压进模型。 */
function clearStageCamera(rig: StageCameraRig, characters: readonly ManhuaStageCharacter[], minDistanceM: number): StageCameraRig {
  const target = rig.target;
  const dx = rig.position[0] - target[0];
  const dy = rig.position[1] - target[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  let distance = len;
  const occupied: Array<{ near: number; far: number }> = [];
  for (const actor of characters) {
    const ax = actor.stagePoint[0] - target[0];
    const ay = actor.stagePoint[1] - target[1];
    const projected = ax * ux + ay * uy;
    const perpendicularSquared = ax * ax + ay * ay - projected * projected;
    if (perpendicularSquared < minDistanceM * minDistanceM) {
      const halfWidth = Math.sqrt(Math.max(0, minDistanceM * minDistanceM - perpendicularSquared));
      occupied.push({ near: projected - halfWidth, far: projected + halfWidth });
    }
  }
  occupied.sort((a, b) => a.near - b.near);
  for (const range of occupied) {
    if (distance >= range.near && distance < range.far) distance = range.far + 0.01;
  }
  const position: [number, number, number] = [target[0] + ux * distance, target[1] + uy * distance, rig.position[2]];
  return { ...rig, position };
}

/** 过肩者可选；被拍主体为名单中另一人，没人则以原点为主体。 */
export function stageCameraRigs(characters: readonly ManhuaStageCharacter[], shoulderActorId?: string, world?: ManhuaWorld3dAssets): Record<StageCameraKind, StageCameraRig> {
  const over = characters.find((actor) => actor.id === shoulderActorId) ?? characters[1];
  const subject = characters.find((actor) => actor.id !== over?.id) ?? characters[0];
  const subjectStage = [subject?.stagePoint[0] ?? 0, subject?.stagePoint[1] ?? 0, 0] as const;
  const overStage = over ? ([over.stagePoint[0], over.stagePoint[1], 0] as const) : undefined;
  const facingRad = ((subject?.yawDeg ?? 0) * Math.PI) / 180;
  return {
    // 空场景没有角色中心，向后退七米可能进入墙后；从已知原始采集原点沿 +Z 前方查看。
    establish: !characters.length && Number.isFinite(world?.groundPlaneOffset) && Number(world?.metricScaleFactor) > 0
      ? { kind: "establish", position: marbleToStageTransform(world).toStage([0,0,0]), target: marbleToStageTransform(world).toStage([0,0,5]), lens: 28, labelZh: "建立·场景原点" }
      : threeCameraRigForKeyframe({ subjectStage, kind: "establish" }),
    ots: clearStageCamera(threeCameraRigForKeyframe({ subjectStage, kind: "ots", overStage }), characters, 1.2),
    single: clearStageCamera(threeCameraRigForKeyframe({ subjectStage, kind: "single", facingStage: [Math.sin(facingRad), -Math.cos(facingRad)] }), characters, 1.2),
  };
}

/** 只在场景内容改变时重建 iframe；上层刷新数据时可能传来内容相同的新对象。 */
export function stageSceneSignature(world: ManhuaWorld3dAssets, characters: readonly ManhuaStageCharacter[]): string {
  return JSON.stringify({
    spzUrl: world.spz500kUrl ?? "",
    colliderUrl: world.colliderGlbUrl ?? "",
    scale: world.metricScaleFactor ?? null,
    ground: world.groundPlaneOffset ?? null,
    actors: characters.map((actor) => ({
      id: actor.id,
      glbUrl: actor.glbUrl,
      stagePoint: actor.stagePoint,
      heightM: actor.heightM ?? null,
      yawDeg: actor.yawDeg ?? null,
    })),
  });
}


export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const signature = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  if (blob.type !== "image/png" || blob.size <= 8
    || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => signature[index] === byte)) {
    throw new Error("invalid_png");
  }
  return blob;
}

export function ManhuaWorldStagePreview(props: Props) {
  const { sceneLabelZh, world, characters, height = "clamp(520px, 68vh, 820px)", onExportStageFrame } = props;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const revisionCounter = useRef(0);
  const [cameraKind, setCameraKind] = useState<StageCameraKind>("establish");
  const [shoulderActorId, setShoulderActorId] = useState<string | undefined>();
  const [colliderVisible, setColliderVisible] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "partial" | "error">("loading");
  const [loadedActorCount, setLoadedActorCount] = useState(0);
  const [noteZh, setNoteZh] = useState<string>("");
  const [failures, setFailures] = useState<StageAssetFailure[]>([]);
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  /** 「重新载入」：只重读同一份已生成的场景与模型文件，不提交任何生成任务 */
  const [reloadNonce, setReloadNonce] = useState(0);
  const [animationMode,setAnimationMode]=useState(false);
  const [animationLoading,setAnimationLoading]=useState(false);
  const animationRequest=useRef<AbortController|null>(null);
  const sceneSignature = stageSceneSignature(world, characters)+JSON.stringify(props.animation??null);
  // 签名覆盖场景、人物和机位的实际输入；仅引用变化不应重载高斯和 iframe。
  const scene = useMemo(() => {
    revisionCounter.current += 1;
    return buildStageSceneConfig(world, characters, stageCameraRigs(characters, undefined, world).establish, `r${revisionCounter.current}`);
  }, [sceneSignature, reloadNonce]);
  const rigs = useMemo(() => stageCameraRigs(characters, shoulderActorId, world), [sceneSignature, shoulderActorId]);
  const config = scene;
  const revision = config?.revision ?? "";
  const liveState = useRef({ revision, cameraKind });
  liveState.current = { revision, cameraKind };
  const exportCounter = useRef(0);
  const pendingExport = useRef<{ requestId: number; revision: string; cameraKind: StageCameraKind; frame: ManhuaStageFrameExport; deliver: Props["onExportStageFrame"]; phase: "capturing" | "decoding" | "saving"; complete?: (error?: Error) => void } | null>(null);
  const srcDoc = useMemo(() => (config ? buildSrcDoc(config) : ""), [config]);
  const expectedActorIds = useMemo(() => (config?.characters ?? []).map((c) => c.id), [config]);

  useEffect(() => {
    animationRequest.current?.abort();
    setAnimationMode(false);setAnimationLoading(false);
    setStatus("loading");
    setLoadedActorCount(0);
    setNoteZh("");
    setFailures([]);
    if (pendingExport.current?.phase !== "saving") {
      setExporting(false);
      pendingExport.current?.complete?.(new Error("视角导出状态已变化，请核对原候选，未自动重试。"));
      pendingExport.current = null;
    }
    return ()=>animationRequest.current?.abort();
  }, [revision]);

  const send = useCallback(
    (message: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage({ source: "manhua-world-stage-host", revision, ...message }, "*");
    },
    [revision],
  );

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const m = (ev.data || {}) as { source?: string; revision?: string; type?: string; message?: string; dataUrl?: string; viewLabelZh?: string; cameraKind?: string; cameraRig?: StageCameraRig; requestId?: number; loaded?: string[]; failed?: StageAssetFailure[] };
      if (m.source !== "manhua-world-stage" || ev.source !== iframeRef.current?.contentWindow) return;
      // 旧实例迟到的消息：作废
      if (m.revision !== revision) return;
      if(m.type==="animation_started"){setAnimationMode(true);setAnimationLoading(false);setNoteZh("正在播放原白模骨骼动作与逐帧相机；人物外观沿用白模，不等于正式成片或已保存视频。");}
      else if(m.type==="animation_error"){setAnimationLoading(false);setNoteZh(m.message||"动画载入失败");}
      else if(m.type==="animation_finished"){setNoteZh("场景动作预览播放完毕；尚未输出或采用成片。");}
      else if (m.type === "ready") {
        const failed = Array.isArray(m.failed) ? m.failed : [];
        const loaded = new Set(Array.isArray(m.loaded) ? m.loaded : []);
        const missingActors = expectedActorIds.filter((id) => !loaded.has(id));
        setLoadedActorCount(expectedActorIds.length - missingActors.length);
        setFailures(failed);
        const essentialFailures = failed.filter((item) => item.kind !== "collider");
        if (missingActors.length || essentialFailures.length) {
          setStatus("partial");
          const labels = missingActors.map((id) => characters.find((c) => c.id === id)?.labelZh || "未命名人物");
          setNoteZh(`${labels.length ? `人物未载入：${labels.join("、")}。` : ""}${essentialFailures.some((f) => f.kind === "world") ? "世界画面未载入。" : ""}可预览，暂不能导出视角图。`);
        } else {
          setStatus("ready");
          setNoteZh(failed.some((item) => item.kind === "collider") ? "场景辅助碰撞数据未载入，世界和人物已载入，仍可保存视角图。" : "");
        }
      } else if (m.type === "error") {
        if (pendingExport.current?.phase !== "saving") {
          pendingExport.current?.complete?.(new Error("视角导出状态已变化，请核对原候选，未自动重试。"));
          pendingExport.current = null;
          setExporting(false);
        }
        setStatus("error");
        setLoadedActorCount(0);
        setNoteZh(m.message || "3D 场景暂时无法打开");
      } else if (m.type === "export_error") {
        if (m.requestId !== pendingExport.current?.requestId || pendingExport.current?.phase !== "capturing") return;
        pendingExport.current?.complete?.(new Error("视角导出状态已变化，请核对原候选，未自动重试。"));
        pendingExport.current = null;
        setExporting(false);
        setNoteZh("视角图导出失败，请重试");
      } else if (m.type === "warn") {
        setNoteZh(m.message || "");
      } else if (m.type === "frame" && m.dataUrl) {
        const pending = pendingExport.current;
        if (!pending || pending.phase !== "capturing" || m.requestId !== pending.requestId || pending.revision !== revision) return;
        if (m.cameraKind !== pending.cameraKind || pending.cameraKind !== cameraKind) {
          pendingExport.current?.complete?.(new Error("视角导出状态已变化，请核对原候选，未自动重试。"));
          pendingExport.current = null;
          setExporting(false);
          setNoteZh("导出期间切换了机位，这帧已作废，请重新导出");
          return;
        }
        const rig = m.cameraRig;
        if (!rig || !Array.isArray(rig.position) || !Array.isArray(rig.target)
          || rig.position.length !== 3 || rig.target.length !== 3
          || ![...rig.position, ...rig.target, rig.lens].every((value) => typeof value === "number" && Number.isFinite(value))) {
          pendingExport.current?.complete?.(new Error("视角导出状态已变化，请核对原候选，未自动重试。"));
          pendingExport.current = null;
          setExporting(false);
          setNoteZh("视角数据不完整，请重新导出");
          return;
        }
        pending.phase = "decoding";
        void (async () => {
          try {
            const blob = await dataUrlToBlob(m.dataUrl!);
            if (pendingExport.current !== pending || liveState.current.revision !== pending.revision || liveState.current.cameraKind !== pending.cameraKind) return;
            pending.phase = "saving";
            await pending.deliver?.(blob, { ...pending.frame, camera: rig });
            pending.complete?.();
            if (pendingExport.current === pending) setNoteZh("保存请求已返回；请在下方核对新候选图，再选择要采用的镜头。未采用的图不会进入视频输入。");
          } catch (error) {
            pending.complete?.(error instanceof Error ? error : new Error("视角保存未确认"));
            if (pendingExport.current === pending) setNoteZh("视角图保存失败，请重新导出");
          } finally {
            if (pendingExport.current === pending) {
              pendingExport.current?.complete?.(new Error("视角导出状态已变化，请核对原候选，未自动重试。"));
              pendingExport.current = null;
              setExporting(false);
            }
          }
        })();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [cameraKind, characters, expectedActorIds, onExportStageFrame, revision]);

  /**
   * 人物载入问题：没有模型的按页面数据说原因（绑定、建模状态、定妆图是否换过）；
   * 有模型却没载入的按 iframe 回报的 HTTP 状态 / 网络错误 / 解析失败归类。每条都给一句怎么办。
   */
  const actorReasons = useMemo(() => characters.flatMap((c): Array<ManhuaStageReasonZh & { id: string; labelZh: string; code: string }> => {
    if (!c.glbUrl) return [{ id: c.id, labelZh: c.labelZh, code: c.modelIssue?.code ?? "no_model", ...describeManhuaStageModelIssue(c.modelIssue) }];
    const failure = failures.find((f) => f.kind === "actor" && f.id === c.id);
    if (!failure) return [];
    const code = classifyManhuaStageLoadFailure({ code: failure.code, status: failure.status, glbUrl: c.glbUrl });
    return [{ id: c.id, labelZh: c.labelZh, code, ...describeManhuaStageLoadFailure(code, failure.status) }];
  }), [characters, failures]);
  const colliderFailed = failures.some((f) => f.kind === "collider");
  const loaded = status === "ready" || status === "partial";
  useEffect(() => {
    if (loaded) send({ type: "camera", rig: rigs[cameraKind], cameraKind });
  }, [cameraKind, loaded, rigs, send]);
  useEffect(() => {
    if (loaded) send({ type: "collider", visible: colliderVisible });
  }, [colliderVisible, loaded, send]);
  useEffect(() => {
    if (!expanded) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [expanded]);

  function exportCurrentFrame(camera?: {position:[number,number,number];target:[number,number,number];fov:number}): Promise<string> {
    if(animationMode || animationLoading)return Promise.reject(new Error("请先返回静态机位，动态预览不冒充静态参考图"));
    if(status!=="ready" || pendingExport.current || !onExportStageFrame)throw new Error("场景或人物未完整载入，或原视角仍在保存，不能导出。");
    const rig=camera ? {...rigs[cameraKind],position:camera.position,target:camera.target,lens:12/Math.tan(camera.fov*Math.PI/360)} : rigs[cameraKind];
    if(camera)send({type:"camera",rig,cameraKind});
    const requestId=++exportCounter.current;
    const frame: ManhuaStageFrameExport={viewLabelZh:STAGE_CAMERA_LABEL_ZH[cameraKind],cameraKind,actorIds:expectedActorIds,revision,camera:structuredClone(rig),actors:structuredClone([...characters]),timeSec:0};
    return new Promise((resolve,reject)=>{
      let timer:ReturnType<typeof setTimeout>;
      let settled=false;
      const complete=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(JSON.stringify({status:"export_delivered",revision,cameraKind,actorIds:expectedActorIds,note:"保存请求已返回，须核对候选并采用到具体镜头。"}));};
      timer=setTimeout(()=>complete(new Error("原视角保存回执尚未确认，请核对原候选，不重复上传。")),60000);
      pendingExport.current={requestId,revision,cameraKind,frame,deliver:onExportStageFrame,phase:"capturing",complete};
      setExporting(true);send({type:"export",requestId,viewLabelZh:frame.viewLabelZh,cameraKind});
    });
  }
  const advisorControl=useRef<AdvisorWorldControl|null>(null);
  advisorControl.current=async(action,signal)=>{
    signal.throwIfAborted();
    if(action.operation==="inspect")return JSON.stringify({status,revision,cameraKind,actors:expectedActorIds,exporting});
    if(action.operation!=="exportFrame")throw new Error("此控件只负责视角导出；镜头采用沿原工作台入口。");
    return exportCurrentFrame(action.camera);
  };
  useEffect(()=>{
    props.onAdvisorControl?.((action,signal)=>{if(!advisorControl.current)throw new Error("原视角控件未就绪");return advisorControl.current(action,signal);});
    return ()=>props.onAdvisorControl?.(null);
  },[props.onAdvisorControl]);

  if (!config) {
    return <p className="text-[11px] text-amber-100">这个场景还不能预览，请稍后重试。</p>;
  }
  const btn = "rounded border border-cyan-300/30 px-2 py-0.5 text-[11px] text-cyan-50 disabled:opacity-40";
  const btnOn = "rounded border border-cyan-300/70 bg-cyan-500/25 px-2 py-0.5 text-[11px] text-cyan-50";

  return (
    <div className={`grid min-w-0 w-full grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_220px] ${expanded ? "fixed inset-2 z-[100] overflow-y-auto rounded-lg border border-cyan-300/40 bg-[#0b1018] p-3 shadow-2xl md:inset-4" : ""}`} data-manhua-world-stage data-stage-status={status} data-stage-revision={revision} data-stage-expanded={expanded}>
      <div className="flex flex-wrap gap-1 text-xs xl:col-span-2" data-stage-load-summary>
        <span className={`rounded px-2 py-0.5 ${loaded ? "bg-emerald-500/20 text-emerald-100" : "bg-white/10 text-white/70"}`} data-world-load-state={loaded ? "loaded" : status}>世界画面：{loaded ? "已载入" : status === "error" ? "载入失败" : "载入中"}</span>
        <span className={`rounded px-2 py-0.5 ${loadedActorCount === expectedActorIds.length && loaded ? "bg-emerald-500/20 text-emerald-100" : "bg-amber-500/15 text-amber-100"}`} data-actor-load-count={`${loadedActorCount}/${expectedActorIds.length}`}>人物模型：{expectedActorIds.length ? `${loadedActorCount}/${expectedActorIds.length} 已载入` : "本段未摆人物"}</span>
        <span className="text-white/50">世界与全部预期人物均载入后，才能保存视角图。</span>
      </div>
      <div aria-label="场景机位与保存" className="flex flex-wrap items-start gap-2 rounded-xl border border-white/10 p-3 text-xs xl:col-start-2 xl:row-start-2 xl:flex-col">
        <button type="button" className={btn} aria-label={expanded ? "退出放大场景" : "放大场景"} onClick={() => setExpanded((value) => !value)}>
          {expanded ? "退出放大" : "放大场景"}
        </button>
        <span className="text-white/60">机位</span>
        {STAGE_CAMERA_KINDS.map((k) => (
          <button key={k} type="button" className={cameraKind === k ? btnOn : btn} disabled={!loaded} onClick={() => {
            // 已开始上传的视角图无法取消；换机位也要等本次保存结束，避免并发提交。
            if (pendingExport.current?.phase !== "saving") {
              pendingExport.current?.complete?.(new Error("视角导出状态已变化，请核对原候选，未自动重试。"));
              pendingExport.current = null;
              setExporting(false);
            }
            if (cameraKind === k) send({ type: "camera", rig: rigs[k], cameraKind: k });
            else setCameraKind(k);
          }} title={rigs[k].labelZh}>
            {STAGE_CAMERA_LABEL_ZH[k]}
          </button>
        ))}
        {characters.length > 1 ? (
          <label className="flex items-center gap-1 text-white/70">
            从谁肩后拍
            <select aria-label="从谁肩后拍" className="rounded border border-cyan-300/30 bg-[#101822] px-1 py-0.5 text-white" value={characters.some((actor) => actor.id === shoulderActorId) ? shoulderActorId : characters[1]?.id} disabled={!loaded || pendingExport.current?.phase === "saving"} onChange={(event) => {
              pendingExport.current?.complete?.(new Error("视角导出状态已变化，请核对原候选，未自动重试。"));
              pendingExport.current = null;
              setExporting(false);
              setShoulderActorId(event.target.value);
              setCameraKind("ots");
            }}>
              {characters.map((actor) => <option key={actor.id} value={actor.id}>{actor.labelZh || actor.id}</option>)}
            </select>
          </label>
        ) : null}
        {props.animation ? <>
          <button type="button" className={btn} disabled={status!=="ready" || animationLoading || exporting} onClick={async()=>{
            if(animationMode){send({type:"animation_toggle"});return;}
            const controller=new AbortController();animationRequest.current?.abort();animationRequest.current=controller;
            const currentRevision=revision;setAnimationLoading(true);
            try{
              const pack=await loadPrevisStageAnimation(props.animation!,controller.signal);
              if(controller.signal.aborted || liveState.current.revision!==currentRevision)return;
              iframeRef.current?.contentWindow?.postMessage({source:"manhua-world-stage-host",revision,type:"animation_load",...pack},"*",[pack.glb]);
            }catch(error){if(!controller.signal.aborted){setAnimationLoading(false);setNoteZh(error instanceof Error?error.message:"场景动画读取失败");}}
          }}>{animationLoading?"载入动作…":animationMode?"暂停／继续动作":"播放本段动作与运镜"}</button>
          {animationMode?<button type="button" className={btn} onClick={()=>{send({type:"animation_clear"});setAnimationMode(false);}}>返回静态机位</button>:null}
        </>:null}
        {config.colliderUrl ? (
          <label className="ml-2 flex items-center gap-1 text-white/70">
            <input type="checkbox" checked={colliderVisible} disabled={!loaded || colliderFailed} onChange={(e) => setColliderVisible(e.target.checked)} />
            显示场景辅助线
          </label>
        ) : null}
        {status === "partial" || status === "error" || colliderFailed ? (
          <button type="button" className={btn} data-stage-reload title="重新读取已生成的场景与人物模型，不会重新生成" onClick={() => setReloadNonce((n) => n + 1)}>
            重新载入
          </button>
        ) : null}
        {onExportStageFrame ? (
          <button
            type="button"
            className={`ml-auto ${btn}`}
            disabled={status !== "ready" || exporting || animationMode || animationLoading}
            title={status === "partial" ? "有人物/资产没加载成功，不能导出" : status === "loading" ? "机位切换后等待场景载入完成" : exporting ? "正在保存当前视角图" : undefined}
            onClick={() => { void exportCurrentFrame().catch(error=>setNoteZh(error instanceof Error?error.message:"视角保存未确认")); }}
          >
            {exporting ? "保存中…" : "保存当前视角图"}
          </button>
        ) : null}
      </div>
      <p className="text-xs text-white/55 xl:col-span-2">
        在画面中拖动可旋转视角，滚轮可推近或推远；切换机位会回到该机位的初始角度。
        {characters.length ? `本段有 ${characters.length} 个人物；` : "本段暂未摆入人物；"}
        {rigs.ots.kind === "single" && cameraKind === "ots" ? " 缺过肩对象，过肩退为单人正面。" : ""}
        {status === "loading" ? " 场景加载中，载入完成后才能保存视角图。" : ""}
        {status === "partial" ? " 有人物或资产未载入，暂不能保存视角图。" : ""}
        {exporting ? " 视角图正在保存，请稍候。" : ""}
      </p>
      <div className="relative min-w-0 w-full overflow-hidden rounded-xl border border-cyan-300/20 bg-black xl:col-start-1 xl:row-start-2" style={{ height: expanded ? "max(340px, calc(100dvh - 180px))" : height }} data-stage-viewer>
        <iframe key={revision} ref={iframeRef} title={`${sceneLabelZh} 3D 世界预览`} srcDoc={srcDoc} sandbox="allow-scripts" className="h-full w-full" style={{ border: 0 }} />
        {status === "error" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-3 text-center text-[11px] text-amber-100" data-stage-placeholder>
            {noteZh}
          </div>
        ) : null}
      </div>
      {status !== "error" && noteZh ? (
        <p className="text-xs text-amber-100 xl:col-span-2" data-stage-note>
          {noteZh}
        </p>
      ) : null}
      {actorReasons.length || colliderFailed ? (
        <ul className="flex flex-col gap-1 text-xs text-amber-100/90 xl:col-span-2" data-stage-failures>
          {actorReasons.map((r) => (
            <li key={`actor:${r.id}`} data-actor-id={r.id} data-actor-issue={r.code}>
              <b className="font-medium text-amber-50">{r.labelZh}</b>：{r.titleZh}。{r.fixZh}
            </li>
          ))}
          {colliderFailed ? <li data-actor-issue="collider">场景辅助线没载入：不影响看场景，点「重新载入」重试。</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
