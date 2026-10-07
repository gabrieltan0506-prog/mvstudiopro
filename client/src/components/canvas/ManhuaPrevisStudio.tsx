import type { AdvisorEffectsControl, AdvisorEffectsRegistration } from "@shared/manhuaAdvisorEffects";
import { advisorWorkflowRevision } from "@shared/manhuaAdvisorWorkflowPlan";
import { ManhuaPrevisSceneEffectsEditor } from "./ManhuaPrevisSceneEffectsEditor";
import { usePreparedRig } from "@/lib/manhuaPrevisCreator";
import { createRigForm, applyRigForm } from "@/lib/manhuaPrevisRigForm";
import { buildManhuaPrevisAudio, type ManhuaPrevisAudio } from "@shared/manhuaPrevisAudio";
import { previsPlaybackDuration } from "@shared/manhuaPrevisPlayback";
import { manhuaGeneratedPrevisCoverageIssue, manhuaPrevisSourceLabel } from "@shared/manhuaPrevisScope";
import { previsActorColor } from "@shared/manhuaPrevisColors";
import { parseManhuaClipTargetDurationSec } from "@shared/manhuaScriptWorkbench";
import { clampManhuaClipDurationSecForVideoModel } from "@shared/manhuaSeedanceLayout";
import { manhuaPrevisMediaUrl } from "@/lib/manhuaPrevisMediaUrl";
import type { PreparedRigProfile } from "@/lib/manhuaPrevisProfiles";
import { useEffect, useRef, useState } from "react";
import { isDefiniteRejection, withRiggedModelSourceAssetRefs } from "@/lib/manhuaPrevisSubmit";
import { trpc } from "@/lib/trpc";
import type { CanvasBlock } from "@/lib/canvasTypes";
import type { ManhuaSegmentReferenceEntry } from "@shared/manhuaSegmentReference";
import { applyManhuaPrevisDraftToStudio, type ManhuaPrevisDraftFromPlan } from "@shared/manhuaPrevisFromActionPlan";
import { appendManhuaCameraPromptToMotionGuide, MANHUA_CAMERA_PROMPT_BLOCK_MAX_CHARS } from "@shared/manhuaCameraTempo";
import type { ManhuaDirectedShot } from "@shared/manhuaCameraDirection";
import {
  createManhuaPrevisStudio,
  formatPrevisMotionGuide,
  manhuaPrevisSpecSchema,
  previsRenderCostUnits,
  PREVIS_RENDER_UNIT_BUDGET,
  previsSpecKey,
  type ManhuaPrevisRequest,
  type ManhuaPrevisSpec,
  type ManhuaPrevisStudio as Studio,
} from "@shared/manhuaPrevis";
import {
  clearPrevisMissingSince,
  previsAbandonable,
  readPrevisMissingSince,
  writePrevisMissingSince,
} from "@shared/manhuaPrevisAbandon";
import {
  previsInitialDurationSec,
  type PrevisSourceShot,
} from "@shared/manhuaPrevisScript";

type Result = {
  gcsUri: string;
  url: string;
  sceneUrl?: string;
  durationSec: number;
  clipId: string;
  requestId: string;
  spec: ManhuaPrevisSpec;
  audio?: ManhuaPrevisAudio;
  quality?: "draft" | "standard";
  report?: { warnings?: string[] };
  layerBundle?: {
    gcsUri: string;
    url?: string;
    bytes: number;
    sha256: string;
    format: "previs-layers-v1";
  };
};
const isPrevisMediaUrl = (value: unknown) =>
  typeof value === "string" &&
  (value.startsWith("https://") || value.startsWith("/api/manhua-previs-media/"));
export type PrevisResponse = {
  jobId: string;
  status: string;
  error?: string | null;
  output: unknown;
  params: ManhuaPrevisRequest;
};
export type PrevisServices = {
  submit: (input: ManhuaPrevisRequest) => Promise<PrevisResponse>;
  get: (requestId: string) => Promise<PrevisResponse | null>;
  list: (
    scopeId: string,
    clipId: string,
    before?: string
  ) => Promise<{ items: PrevisResponse[]; nextCursor: string | null }>;
};
type Props = {
  block: CanvasBlock;
  effectsScopeKey?: string;
  onAdvisorEffectsControl?: AdvisorEffectsRegistration;
  disabled?: boolean;
  /** 0915 PR-4：从动作节奏时间轴生成的白模草案（每可执行镜一条）；有它就不必手填数字表 */
  actionPlanDrafts?: ManhuaPrevisDraftFromPlan[];
  characters: Array<{
    id: string;
    label: string;
    tag?: string;
    aliasZh?: string;
    shape?: "human" | "horse";
    /** assetRef：模型所在 ref（可能是 A-pose 候选图，与人物 id 不同） */
    model?: { taskId: string; assetRef?: string };
  }>;
  sourceShots?: PrevisSourceShot[];
  /** 0929：本段分镜的景别/机位/运镜原文，用于按分镜自动排运镜（不进草案身份键） */
  directionShots?: ManhuaDirectedShot[];
  /** 本集导演包主卡；只取卡片里已写明、能落到机位上的手法 */
  directionCardId?: string | null;
  profiles?: PreparedRigProfile[];
  /** PR-6：采用白模成功后露出「下一步：生成本段草稿视频」；走工作台既有的本段成片入口（扣费确认沿用） */
  onNextDraftVideo?: () => void;
  onOpenAdvisor?: (requestId?: string, preparedStudio?: Studio) => void;
  onChange: (
    studio: Studio,
    reference?: ManhuaSegmentReferenceEntry
  ) => void | boolean;
};
const button =
  "rounded border border-cyan-300/30 px-2 py-1 text-xs text-cyan-50 disabled:opacity-40";

/**
 * 「第一次查不到」的时间戳按 requestId 落在 sessionStorage 里，而不是只放组件内的 ref。
 * 理由：等十分钟期间用户切页签／换路由是常态，组件一卸载重挂 ref 就清零，计时永远重来，
 * 「放弃原编号」这个出口实际上永远点不亮——功能等于没有。
 * 只按 requestId 存：换了编号读不到旧值，不会把上一单的等待时间算到新单头上。
 * sessionStorage 在隐私模式/禁用站点数据时会抛，全部包 try/catch，读失败就退回本次会话内计时。
 * 判据（阈值、脏值/未来时间戳）在 @shared/manhuaPrevisAbandon，这里只负责存取。
 */
// 取 sessionStorage 这个**属性访问**本身就可能抛（隐私模式/站点数据被禁），
// 所以兜底要包在这里，不能只包 store.getItem。
const previsStore = () => {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

export function ManhuaPrevisStudio(props: Props) {
  const utils = trpc.useUtils();
  const submit = trpc.manhuaPrevis.submit.useMutation();
  return (
    <ManhuaPrevisStudioView
      {...props}
      services={{
        submit: input => submit.mutateAsync(input),
        get: requestId => utils.manhuaPrevis.get.fetch({ requestId }),
        list: (scopeId, clipId, before) =>
          utils.manhuaPrevis.list.fetch({ scopeId, clipId, before }),
      }}
    />
  );
}

export function ManhuaPrevisStudioView({
  block,
  effectsScopeKey,
  onAdvisorEffectsControl,
  disabled,
  characters,
  onChange,
  services,
  sourceShots = [],
  directionShots = [],
  directionCardId = null,
  profiles = [],
  actionPlanDrafts = [],
  onNextDraftVideo,
  onOpenAdvisor,
}: Props & { services: PrevisServices }) {
  const [initial] = useState(
    () => block.previsStudio ?? createManhuaPrevisStudio(
      previsInitialDurationSec(sourceShots, (() => {
        const duration = parseManhuaClipTargetDurationSec(block.prompt || "");
        return duration == null ? null : clampManhuaClipDurationSecForVideoModel(block.videoModel, duration);
      })()),
    )
  );
  const studio = block.previsStudio ?? initial;
  const latest = useRef({ studio, onChange, services, disabled, block });
  latest.current = { studio, onChange, services, disabled, block };
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState<Result | null>(null);
  const previewVideo = useRef<HTMLVideoElement>(null);
  const previewRequestVersion = useRef(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [initialPreviewRequestId] = useState(() => [...studio.history]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.requestId);
  useEffect(() => {
    if (initialPreviewRequestId && !studio.pending) void loadPreview(initialPreviewRequestId);
    return () => { previewRequestVersion.current += 1; };
  }, [initialPreviewRequestId]);
  const [previewTime, setPreviewTime] = useState(0);
  const [reviewedRequestId, setReviewedRequestId] = useState("");
  const [reviewedFrames, setReviewedFrames] = useState<number[]>([]);
  const [frameReviewConfirmed, setFrameReviewConfirmed] = useState(false);
  const [normalSpeedConfirmed, setNormalSpeedConfirmed] = useState(false);
  const [normalSpeedPlayed, setNormalSpeedPlayed] = useState(false);
  const normalPlaybackStarted = useRef(false);
  useEffect(() => {
    if (preview) previewVideo.current?.scrollIntoView({ block: "nearest" });
  }, [preview]);
  const [busy, setBusy] = useState(false);
  // 0917 PR-D：服务端连续查不到原编号时给一个可放弃的出口，别让用户永远卡在「确认原请求」。
  // 判据是「连续查不到满 10 分钟」——入队成功的任务最迟几秒内就查得到，十分钟仍为空说明这单没建成。
  const missingSince = useRef<number | null>(null);
  const [abandonable, setAbandonable] = useState(false);
  /** 采用白模成功后才露出下一步按钮；换段/换任务即收起 */
  const [adoptedJobId, setAdoptedJobId] = useState("");
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const pendingId = studio.pending?.requestId;
  function publish(next: Studio, reference?: ManhuaSegmentReferenceEntry) {
    const parsed = manhuaPrevisSpecSchema.safeParse(next.spec);
    if (!parsed.success) { setError(`方案未通过白模检查：${parsed.error.issues.map(issue => issue.message).join("；")}`); return false; }
    const current = latest.current;
    const targetDuration = parseManhuaClipTargetDurationSec(current.block.prompt || "");
    const issue = manhuaGeneratedPrevisCoverageIssue({
      reference, studio: next,
      autoSegment: current.block.manhuaAutoSegment,
      durationSec: targetDuration == null ? undefined : clampManhuaClipDurationSecForVideoModel(current.block.videoModel, targetDuration),
      shotIndexes: current.block.manhuaAutoSegment?.shotIndexes ?? sourceShots.map(shot => shot.index),
    });
    if (issue) { setError(issue); return false; }
    if (current.onChange(next, reference) === false) {
      setError("本段状态未保存，未提交新任务或替换参考；请先处理保存问题。");
      return false;
    }
    latest.current = { ...current, studio: next };
    return true;
  }
  const isCurrent = (scopeId: string, clipId: string) =>
    mounted.current &&
    latest.current.studio.scopeId === scopeId &&
    latest.current.block.id === clipId;
  function consume(response: PrevisResponse) {
    if (!mounted.current) return false;
    const current = latest.current;
    const adoptedTrial = current.studio.history.some(t =>
      t.jobId === response.jobId && t.requestId === response.params.requestId &&
      JSON.stringify(t.spec) === JSON.stringify(response.params.spec) &&
      JSON.stringify(t.audio) === JSON.stringify(response.params.audio) &&
      t.quality === response.params.quality
    );
    if (
      (response.params.scopeId !== current.studio.scopeId && !adoptedTrial) ||
      response.params.clipId !== current.block.id
    )
      return false;
    setStatus(
      response.status === "queued"
        ? "排队中"
        : response.status === "running"
          ? "渲染中"
          : response.status === "succeeded"
            ? "已生成，预览后可采用"
            : "本次失败，旧参考未改变"
    );
    const matching =
      current.studio.pending?.requestId === response.params.requestId;
    if (response.status === "succeeded") {
      const result = response.output as Result;
      if (
        !result?.gcsUri ||
        !result.url ||
        Math.abs(result.durationSec - previsPlaybackDuration(response.params.spec)) > 0.05 ||
        result.requestId !== response.params.requestId ||
        result.clipId !== response.params.clipId ||
        JSON.stringify(result.audio) !== JSON.stringify(response.params.audio) || result.quality !== response.params.quality
      ) {
        setError("产物回执不完整，请查询原任务");
        return false;
      }
      if (
        response.params.spec.exportLayers &&
        (!result.layerBundle ||
          !isPrevisMediaUrl(result.layerBundle.url) ||
          result.layerBundle.format !== "previs-layers-v1")
      ) {
        setError("遮罩与深度层包回执未确认，请查询原任务；不要重复生成");
        return false;
      }
      previewRequestVersion.current += 1;
      setPreviewLoading(false);
      setPreview({ ...result, spec: response.params.spec });
      setReviewedRequestId(response.params.requestId);
      setReviewedFrames([]);
      setFrameReviewConfirmed(false);
      setNormalSpeedConfirmed(false);
      setNormalSpeedPlayed(false);
      normalPlaybackStarted.current = false;
      const old = current.studio.history.find(t => t.jobId === response.jobId);
      const take = {
        jobId: response.jobId,
        requestId: response.params.requestId,
        gcsUri: result.gcsUri,
        url: result.url,
        durationSec: result.durationSec,
        createdAt: old?.createdAt ?? new Date().toISOString(),
        spec: response.params.spec,
        ...(response.params.audio ? { audio: response.params.audio } : {}),
        ...(response.params.quality ? { quality: response.params.quality } : {}),
      };
      return publish({
        ...current.studio,
        pending: matching ? undefined : current.studio.pending,
        history: old
          ? current.studio.history.map(t => (t.jobId === take.jobId ? take : t))
          : [...current.studio.history, take],
      });
    } else if (response.status === "failed") {
      setError(`渲染任务失败：${response.error || "请检查配置；旧参考保留"}`);
      if (matching) return publish({ ...current.studio, pending: undefined });
    }
    return true;
  }
  useEffect(() => {
    if (!pendingId) {
      missingSince.current = null;
      setAbandonable(false);
      return;
    }
    // 重挂载（切页签/换路由）接着上次的计时走，别从零开始。
    // 但**只恢复计时、不恢复「已可放弃」权限**：旧时间戳只说明上次会话连续查不到，
    // 这期间任务可能已经建成甚至跑完了；权限要等本次 get 明确回 null 才开放（终审 1495-R1-03）。
    missingSince.current = readPrevisMissingSince(previsStore(), pendingId, Date.now());
    setAbandonable(false);
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await latest.current.services.get(pendingId);
        if (!active) return;
        if (response) {
          missingSince.current = null;
          clearPrevisMissingSince(previsStore(), pendingId);
          setAbandonable(false);
          consume(response);
          if (response.status === "succeeded" || response.status === "failed")
            return;
        } else {
          const first = missingSince.current ?? Date.now();
          missingSince.current = first;
          writePrevisMissingSince(previsStore(), pendingId, first);
          const canAbandon = previsAbandonable(first, Date.now());
          if (canAbandon) setAbandonable(true);
          setStatus(
            canAbandon
              ? "服务端连续十分钟查不到这个编号，可放弃后重新生成"
              : "尚未查到原请求；可确认原编号，不会新建重复任务"
          );
        }
      } catch {
        if (!active) return;
        // 查询本身失败 ≠ 服务端查不到这个编号：断网/网关抖动不能计进「连续查不到十分钟」，
        // 否则一次外网抖动就把「放弃原编号」按钮点亮，用户放弃掉一单真实在跑的任务再重提 = 重复建单。
        missingSince.current = null;
        clearPrevisMissingSince(previsStore(), pendingId);
        setAbandonable(false);
        setStatus("查询暂不可用，保留原任务编号，稍后继续查询");
      }
      if (active) timer = setTimeout(poll, 4000);
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pendingId]);
  /**
   * 放弃原编号（终审 1495-R1-03）：点下去之前**再查一次**。
   * 十分钟里任务可能已经建成甚至跑完，凭旧时间戳直接清 pending 会把一单真实任务丢掉，
   * 用户再点一次就是重复建单（事故簿坑 14 的代价）。查到就消费掉、保留编号；
   * 只有这次也明确查不到、且计时确实满十分钟，才真的放弃。
   */
  async function abandonPending() {
    const before = latest.current;
    const id = before.studio.pending?.requestId;
    if (
      !id ||
      before.disabled ||
      lock.current ||
      !previsAbandonable(missingSince.current, Date.now())
    )
      return;
    const scopeId = before.studio.scopeId;
    const blockId = before.block.id;
    lock.current = true;
    setBusy(true);
    setAbandonable(false);
    try {
      const response = await before.services.get(id);
      const current = latest.current;
      // 复查期间用户可能换了段/换了编号：认不出就什么都不做，绝不动别的段的 pending
      if (
        !mounted.current ||
        current.disabled ||
        current.studio.scopeId !== scopeId ||
        current.block.id !== blockId ||
        current.studio.pending?.requestId !== id
      )
        return;
      if (response) {
        missingSince.current = null;
        clearPrevisMissingSince(previsStore(), id);
        consume(response);
        return;
      }
      if (!previsAbandonable(missingSince.current, Date.now())) return;
      if (!publish({ ...current.studio, pending: undefined })) return;
      missingSince.current = null;
      clearPrevisMissingSince(previsStore(), id);
      setError("");
      setStatus("已放弃原编号；再点「确认生成动作白模」会新建一次");
    } catch {
      // 复查本身失败：保留编号，计时清零重新算，不让一次抖动把任务丢掉
      missingSince.current = null;
      clearPrevisMissingSince(previsStore(), id);
      if (mounted.current) setStatus("查询暂不可用，保留原任务编号");
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function generate(advisor?: { signal: AbortSignal; assertTarget: () => void }) {
    advisor?.assertTarget();
    if (disabled || lock.current) { if (advisor) throw new Error("白模当前不可提交"); return; }
    // 带骨模型可能挂在同一人物的候选图上：提交时按当前人物表补上模型所在 ref，服务端按它核回执。
    const parsed = manhuaPrevisSpecSchema.safeParse(
      withRiggedModelSourceAssetRefs(studio.spec, characters)
    );
    if (!parsed.success) {
      setError(parsed.error.issues.map(i => i.message).join("；"));
      if (advisor) throw new Error("当前白模方案未通过校验");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    let input: ManhuaPrevisRequest;
    try { input = studio.pending ?? {
      requestId: crypto.randomUUID(),
      scopeId: studio.scopeId,
      clipId: block.id,
      spec: parsed.data,
      quality: "draft",
      ...(studio.audioEnabled === true ? { audio: buildManhuaPrevisAudio(block.audioStudio, parsed.data, studio.audioStartSec ?? 0, studio.loopBgm ?? false) } : {}),
    }; } catch (error) {
      setError(error instanceof Error ? error.message : "请检查音轨"); lock.current = false; setBusy(false); if (advisor) throw error; return;
    }
    try {
      // 同一段状态先保留请求，再入队。响应只入候选，不自动替换本段参考。
      if (!publish({ ...studio, pending: input })) { if (advisor) throw new Error("原白模请求未保存，未提交渲染"); return; }
      advisor?.assertTarget();
      const response = await services.submit(input);
      advisor?.assertTarget();
      if (!consume(response) && advisor) throw new Error("白模回执未通过校验或未保存，请查询原编号");
    } catch (error) {
      if (advisor) advisor.assertTarget();
      if (!mounted.current) return;
      if (isDefiniteRejection(error)) {
        // 服务端明确拒绝＝没建任务；放弃该编号，下次点击重新生成，不再卡在「确认原请求」。
        publish({ ...latest.current.studio, pending: undefined });
        setError(error.message);
      } else
        setError(
          "提交结果尚未确认。保留原编号；请查询或确认原请求，不要新建任务。"
        );
      if (advisor) throw error;
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function recover() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      let before: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await services.list(studio.scopeId, block.id, before);
        if (!isCurrent(studio.scopeId, block.id)) return;
        // 分页结果一次合并，避免多个异步 setState 使用同一旧快照丢历史。
        const current = latest.current;
        const history = [...current.studio.history];
        for (const response of page.items) {
          const result = response.output as Result | null;
          if (
            response.params.scopeId !== studio.scopeId ||
            response.params.clipId !== block.id ||
            response.status !== "succeeded" ||
            !result?.gcsUri ||
            !result.url ||
            Math.abs(result.durationSec - previsPlaybackDuration(response.params.spec)) > 0.05 ||
            result.requestId !== response.params.requestId ||
            result.clipId !== block.id ||
            JSON.stringify(result.audio) !== JSON.stringify(response.params.audio) || result.quality !== response.params.quality ||
            (response.params.spec.exportLayers &&
              (!result.layerBundle ||
                !isPrevisMediaUrl(result.layerBundle.url) ||
                result.layerBundle.format !== "previs-layers-v1"))
          )
            continue;
          const take = {
            jobId: response.jobId,
            requestId: response.params.requestId,
            gcsUri: result.gcsUri,
            url: result.url,
            durationSec: result.durationSec,
            createdAt: new Date().toISOString(),
            spec: response.params.spec,
        ...(response.params.audio ? { audio: response.params.audio } : {}),
        ...(response.params.quality ? { quality: response.params.quality } : {}),
          };
          const index = history.findIndex(t => t.jobId === take.jobId);
          if (index < 0) history.push(take);
          else
            history[index] = { ...take, createdAt: history[index].createdAt };
        }
        const next = { ...current.studio, history };
        if (!publish(next)) return;
        before = page.nextCursor ?? undefined;
        if (before && seen.has(before)) throw new Error("游标重复");
        if (before) seen.add(before);
      } while (before);
      setStatus("原任务候选已恢复，未改变当前采用项");
    } catch {
      if (mounted.current) setError("历史暂时无法读取，已有候选保留");
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function loadPreview(requestId: string) {
    const version = ++previewRequestVersion.current;
    const scopeId = studio.scopeId;
    const clipId = block.id;
    setPreviewLoading(true);
    try {
      const response = await services.get(requestId);
      if (!isCurrent(scopeId, clipId) || version !== previewRequestVersion.current) return;
      if (!response || response.params.requestId !== requestId) {
        setError("预览暂不可用，请重读本段历史或查询原编号；无需重新生成。");
        return;
      }
      setError("");
      consume(response);
    } catch {
      if (isCurrent(scopeId, clipId) && version === previewRequestVersion.current)
        setError("预览续签失败，请稍后查询原任务");
    } finally {
      if (mounted.current && isCurrent(scopeId, clipId) && version === previewRequestVersion.current)
        setPreviewLoading(false);
    }
  }
  async function queryPending() {
    const id = latest.current.studio.pending?.requestId;
    if (!id || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const response = await services.get(id);
      if (!isCurrent(studio.scopeId, block.id) || latest.current.studio.pending?.requestId !== id) return;
      setError("");
      if (response) {
        missingSince.current = null;
        clearPrevisMissingSince(previsStore(), id);
        setAbandonable(false);
        consume(response);
      }
      else setStatus("原编号暂未查到，已保留；稍后可再查，不会新建任务");
    } catch {
      if (isCurrent(studio.scopeId, block.id))
        setError("查询暂不可用，原编号已保留；稍后重试查询，不要重新生成");
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function adopt(take: Studio["history"][number]) {
    if (disabled || pendingId || busy) return false;
    if (
      take.spec.exportLayers &&
      (preview?.requestId !== take.requestId ||
        !preview.layerBundle ||
        !isPrevisMediaUrl(preview.layerBundle.url) ||
        preview.layerBundle.format !== "previs-layers-v1")
    ) {
      setError(
        "请先预览查询这条原任务，确认遮罩与深度层包后再采用；不要重复生成"
      );
      return false;
    }
    if (
      preview?.requestId !== take.requestId ||
      reviewedRequestId !== take.requestId ||
      reviewedFrames.length !== Math.round(take.durationSec * 24) ||
      !frameReviewConfirmed ||
      !normalSpeedPlayed ||
      !normalSpeedConfirmed
    ) {
      setError("请先预览这条白模，逐帧检查并按正常速度复核后，再采用为本段参考。未审候选和旧参考均保留。");
      return false;
    }
    try {
      const currentAudio = studio.audioEnabled === true ? buildManhuaPrevisAudio(block.audioStudio, take.spec, studio.audioStartSec ?? 0, studio.loopBgm ?? false) : undefined;
      if (JSON.stringify(currentAudio) !== JSON.stringify(take.audio)) throw new Error("当前音轨与此白模版本不同，请重新试看并审片后采用；旧视频保留。");
    } catch (error) { setError(error instanceof Error ? error.message : "音轨无法核对"); return false; }
    const old = block.manhuaSegmentRefs?.previs;
    const reference: ManhuaSegmentReferenceEntry = {
      url: take.url,
      gcsUri: take.gcsUri,
      fileName: `动作白模-${take.jobId}.mp4`,
      durationSec: take.durationSec,
      updatedAt: new Date().toISOString(),
      // PR-6：草案的每镜运镜句逐镜追加进运动指引（超出预算截断、保留前面镜头）
      motionGuideZh: appendManhuaCameraPromptToMotionGuide(
        formatPrevisMotionGuide(take.spec),
        studio.draftCameraPromptZh ?? [],
        formatPrevisMotionGuide(take.spec).length + MANHUA_CAMERA_PROMPT_BLOCK_MAX_CHARS
      ),
    };
    const referenceHistory = [...studio.referenceHistory];
    if (
      old &&
      !referenceHistory.some(
        r => (r.gcsUri || r.url) === (old.gcsUri || old.url)
      )
    )
      referenceHistory.push(old);
    if (
      !publish(
        { ...studio, selectedJobId: take.jobId, referenceHistory },
        reference
      )
    )
      return false;
    setError("");
    setAdoptedJobId(take.jobId);
    setStatus("已采用为本段白模参考，旧参考保留；尚未验证最终生成片跟随质量");
    return true;
  }
  const effectsScopeRef = useRef(effectsScopeKey); effectsScopeRef.current = effectsScopeKey;
  const effectsReviewRef = useRef({ reviewedRequestId, reviewedFrames, frameReviewConfirmed, normalSpeedPlayed, normalSpeedConfirmed });
  effectsReviewRef.current = { reviewedRequestId, reviewedFrames, frameReviewConfirmed, normalSpeedPlayed, normalSpeedConfirmed };
  const currentEffectsKey = () => advisorWorkflowRevision([effectsScopeRef.current, latest.current.block.id, latest.current.studio, effectsReviewRef.current]);
  const sceneControl = useRef<AdvisorEffectsControl>(async () => "");
  const sceneControlLock = useRef(false);
  sceneControl.current = async (action, signal) => {
    signal.throwIfAborted();
    const scopeId = studio.scopeId, clipId = block.id, projectScope = effectsScopeKey;
    const assertTarget = () => { signal.throwIfAborted(); if (!isCurrent(scopeId, clipId) || effectsScopeRef.current !== projectScope) throw new Error("片段或作品已变化，未应用旧场景操作"); };
    const assertSource = () => { assertTarget(); if (!action.sourceKey || action.sourceKey !== currentEffectsKey()) throw new Error("白模或审片状态已变化，请重新读取当前配置"); };
    assertTarget();
    if (action.tool !== "scene" || (action.clipId && action.clipId !== clipId)) throw new Error("请先打开目标片段的白模工作台");
    if (action.operation === "inspect") return JSON.stringify({tool:"scene",sourceKey:currentEffectsKey(),clipId,spec:JSON.parse(JSON.stringify(latest.current.studio.spec, (key,value)=>["assetRef","riggedModel","scriptSource"].includes(key)?undefined:value)),pendingRequestId:latest.current.studio.pending?.requestId,candidates:latest.current.studio.history.map(row=>({requestId:row.requestId,jobId:row.jobId,selected:row.jobId===latest.current.studio.selectedJobId})),reviewedRequestId,frameReviewConfirmed,normalSpeedConfirmed});
    assertSource();
    if (disabled || busy || lock.current || sceneControlLock.current) throw new Error("白模原操作尚未结束，请查询原任务");
    sceneControlLock.current = true;
    try {
      if (action.operation === "configure") {
        if (studio.pending) throw new Error("本段仍有原任务，先查询原编号");
        if (!action.sceneEffects) throw new Error("缺少场景特效设置");
        const spec = manhuaPrevisSpecSchema.parse({...studio.spec,sceneEffects:action.sceneEffects});
        if (!publish({...studio,spec,specHistory:[...(studio.specHistory||[]),{spec:studio.spec,createdAt:new Date().toISOString(),reasonZh:"创作顾问调整场景特效前"}]})) throw new Error("场景特效配置未保存");
        return JSON.stringify({status:"configured",clipId,note:"已保存到原白模配置，尚未渲染或采用；请重新inspect"});
      }
      if (action.operation === "submit") {
        if (studio.pending) throw new Error("已有原请求，不能重复提交，请resume原编号");
        if (!window.confirm("按当前白模配置渲染场景特效候选？保留旧参考，需审片后采用。")) return "用户取消，未提交";
        assertSource();
        const before = new Set(studio.history.map(row=>row.requestId));
        await generate({ signal, assertTarget });
        assertTarget();
        const current = latest.current.studio;
        const requestId = current.pending?.requestId || current.history.find(row=>!before.has(row.requestId))?.requestId;
        if (!requestId) throw new Error("未取得白模请求回执，请看原工作台错误；未自动重试");
        return JSON.stringify({requestId,status:current.pending?"pending_or_unknown":"candidate_ready",note:"仅原请求回执；未自动采用"});
      }
      if (!action.requestId) throw new Error("请指定当前原请求编号");
      if (action.operation === "resume") {
        if (studio.pending?.requestId !== action.requestId && !studio.history.some(row=>row.requestId===action.requestId)) throw new Error("当前片段没有这个原请求，未查询其他片段");
        const response = await services.get(action.requestId);
        assertSource();
        if (!response || response.params.requestId !== action.requestId || response.params.clipId !== clipId || response.params.scopeId !== scopeId) throw new Error("原请求尚未找到或回执身份不一致，未重做");
        if (!consume(response)) throw new Error("原任务回执未通过校验或未保存，请保留原编号");
        return JSON.stringify({requestId:action.requestId,jobId:response.jobId,status:response.status});
      }
      if (action.operation !== "adopt") throw new Error("不支持此场景操作");
      const take = studio.history.find(row=>row.requestId===action.requestId);
      if (!take) throw new Error("当前白模候选不存在，请先读取原任务");
      if (!window.confirm("采用已在原白模面板完成审片的此候选？旧参考会保留。")) return "用户取消，未采用";
      assertSource();
      if (!adopt(take) || latest.current.studio.selectedJobId !== take.jobId) throw new Error("尚未通过原白模审片或保存门禁，未采用");
      return JSON.stringify({status:"adopted",requestId:take.requestId,jobId:take.jobId});
    } finally { sceneControlLock.current = false; }
  };
  useEffect(()=>{
    if(!effectsScopeKey)return;
    onAdvisorEffectsControl?.(effectsScopeKey,"scene",(action,signal)=>sceneControl.current(action,signal));
    return ()=>onAdvisorEffectsControl?.(effectsScopeKey,"scene",null);
  },[effectsScopeKey,onAdvisorEffectsControl]);
  return (
    <section
      data-manhua-previs-studio
      className="w-full space-y-3 rounded-lg border border-cyan-300/25 bg-[#0c121d] p-3"
    >
      <p className="text-xs leading-5 text-white/75" data-previs-intro>
        按分镜自动排好运镜，渲染几何预演，逐帧审过再采用为本段视频的动作参考。渲染不调用付费生成模型，也不会自动出成片。
      </p>
      {onOpenAdvisor && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cyan-300/30 bg-cyan-500/10 p-3" data-previs-advisor-entry>
        <div><strong className="text-sm text-cyan-100">用自然语言调整运镜与动作</strong><p className="mt-1 text-xs text-white/70">告诉创作顾问谁往哪里走、何时做什么、镜头如何变化；先讨论方案，再渲染试看；不满意继续修改，满意后再应用。</p></div>
        <button type="button" className={button} disabled={disabled || Boolean(pendingId) || busy} onClick={() => onOpenAdvisor(preview?.requestId)}>让创作顾问调整</button>
      </div>}
      <p className="text-xs text-cyan-100" data-previs-source-scope>{manhuaPrevisSourceLabel(studio.spec)}</p>
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]" data-previs-workspace>
      <div className="min-w-0 self-start xl:sticky xl:top-4">
      {!preview && (
        <section data-previs-player-empty className="rounded border border-cyan-300/30 bg-black/25 p-5 text-sm text-white/75">
          <strong className="block text-cyan-50">白模渲染预览</strong>
          <p className="my-2">{previewLoading ? "正在载入已有白模…" : studio.history.length ? `已有 ${studio.history.length} 版渲染，选择预览后在这里播放。` : pendingId ? "本段白模正在处理，完成后会在这里显示。" : "本段还没有可播放的白模。向创作顾问描述人物动作和镜头要求，生成的视频会显示在这里。"}</p>
          {/预览|历史/.test(error) && <p className="mb-2 text-amber-200">{error}</p>}
          {studio.history.length > 0 && <button type="button" className={button} disabled={previewLoading} onClick={() => void loadPreview([...studio.history].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].requestId)}>预览最近一次渲染</button>}
        </section>
      )}
      {preview && (
        <section data-previs-player className="space-y-2 rounded border border-cyan-300/30 bg-black/20 p-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-cyan-50">
            <strong>白模渲染预览 · {preview.durationSec} 秒</strong>
            <span className="text-xs text-white/60">预览不等于采用或审片通过</span>
          </div>
          <video aria-label="白模渲染视频" key={preview.requestId} ref={previewVideo} controls preload="metadata" src={manhuaPrevisMediaUrl(preview.url)} className="max-h-[70vh] w-full bg-black object-contain"
            onTimeUpdate={event => setPreviewTime(event.currentTarget.currentTime)}
            onLoadedMetadata={() => setPreviewTime(0)}
            onPlay={event => {
              if (event.currentTarget.playbackRate !== 1) normalPlaybackStarted.current = false;
              else if (event.currentTarget.currentTime <= 1 / 24) normalPlaybackStarted.current = true;
            }}
            onSeeking={() => {
              if (normalPlaybackStarted.current) {
                normalPlaybackStarted.current = false;
                setNormalSpeedPlayed(false);
                setNormalSpeedConfirmed(false);
              }
            }}
            onRateChange={event => {
              if (event.currentTarget.playbackRate !== 1) {
                normalPlaybackStarted.current = false;
                setNormalSpeedPlayed(false);
                setNormalSpeedConfirmed(false);
              }
            }}
            onEnded={event => {
              if (normalPlaybackStarted.current && event.currentTarget.playbackRate === 1 && event.currentTarget.currentTime >= preview.durationSec - 1 / 24 - 0.01) {
                setNormalSpeedPlayed(true);
              }
              normalPlaybackStarted.current = false;
            }} />
          <div data-previs-preview-controls className="flex flex-wrap items-center gap-2 py-2 text-xs text-white/80">
            <span>定位问题：{previewTime.toFixed(2)} 秒</span>
            {[-1, 1].map(direction => (
              <button key={direction} type="button" className={button} onClick={() => {
                const video = previewVideo.current;
                if (!video || video.readyState < 1) return;
                video.pause();
                video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + direction / 24));
                setPreviewTime(video.currentTime);
              }}>{direction < 0 ? "上一帧" : "下一帧"}</button>
            ))}
            <input aria-label="白模预览时间" type="range" min={0} max={preview.durationSec} step={1 / 24}
              value={Math.min(previewTime, preview.durationSec)} onChange={event => {
                const video = previewVideo.current;
                if (!video || video.readyState < 1) return;
                video.pause();
                video.currentTime = Math.min(video.duration, Number(event.target.value));
                setPreviewTime(video.currentTime);
              }} />
          </div>
          {previsSpecKey(preview.spec) !== previsSpecKey(studio.spec) && (
            <p data-previs-preview-stale className="text-xs text-amber-200">
              配置已修改，正在播放修改前的白模。请用“确认生成动作白模”重新渲染，再预览采用；旧版仍保留。
            </p>
          )}
          <p className="text-xs text-amber-100">
            {preview.report?.warnings?.join("；") ||
              "请检查动作节拍、遮挡和接触；技术检查不等于表演质量通过。"}
          </p>
          <details data-previs-review-gate className="space-y-1 rounded border border-amber-200/25 p-2 text-xs text-amber-50">
            <summary className="cursor-pointer font-medium">逐帧审片与采用检查</summary>
            <p>本次审片仅对应当前预览。逐帧记录问题帧号和修正结果，再按正常速度播放检查动作节奏；有未解决问题时先修改并重新渲染。</p>
            <p data-previs-reviewed-frames>已检查 {reviewedFrames.length}/{Math.round(preview.durationSec * 24)} 帧（24 帧/秒）</p>
            <button type="button" className={button} onClick={() => {
              const video = previewVideo.current;
              if (!video || video.readyState < 2 || video.seeking) {
                setError("当前帧尚未加载，请等待画面显示后再标记审片。");
                return;
              }
              video.pause();
              const total = Math.round(preview.durationSec * 24);
              if (video.ended || (Number.isFinite(video.duration) && video.currentTime >= video.duration - 0.001)) {
                setError("已到片尾，请用“上一帧”回到最后一帧画面，再标记审片。");
                return;
              }
              const frame = Math.max(0, Math.min(total - 1, Math.floor(video.currentTime * 24 + 0.001)));
              setReviewedFrames(current => current.includes(frame) ? current : [...current, frame]);
              setError("");
              if (frame + 1 < total) video.currentTime = (frame + 1) / 24;
              setPreviewTime(video.currentTime);
            }}>确认当前帧并看下一帧</button>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={frameReviewConfirmed} disabled={reviewedFrames.length !== Math.round(preview.durationSec * 24)} onChange={event => setFrameReviewConfirmed(event.target.checked)} />
              我已记录并处理本次白模的人数、站位、接触与穿模问题
            </label>
            <button type="button" className={button} onClick={() => {
              const video = previewVideo.current;
              if (!video || video.readyState < 2) {
                setError("白模画面尚未加载，暂不能常速播放。");
                return;
              }
              video.pause();
              video.currentTime = 0;
              video.playbackRate = 1;
              setError("");
              void video.play().catch(() => setError("播放未开始，请在预览播放器中从头播放。"));
            }}>从头常速播放</button>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={normalSpeedConfirmed} disabled={!normalSpeedPlayed} onChange={event => setNormalSpeedConfirmed(event.target.checked)} />
              我已从头到尾按正常速度播放本次白模，确认动作节奏和切镜连续性{normalSpeedPlayed ? "（已播放）" : "（请从头播放至结束）"}
            </label>
          </details>
        </section>
      )}
      </div>
      <aside aria-label="本段白模方案与渲染版本" className="min-w-0 space-y-3 rounded-xl border border-white/10 p-3">
      {actionPlanDrafts.length > 0 && <section aria-label="已保存动作节奏" className="space-y-2 rounded border border-white/15 p-3 text-xs">
        <strong>已保存动作节奏</strong>
        {actionPlanDrafts.map(draft => <div key={draft.executableShotId} className="space-y-1 border-t border-white/10 pt-2"><p>{draft.summaryZh.join("；")}</p><p className="text-amber-100">{draft.issuesZh.join("；")}</p><button type="button" className={button} disabled={disabled || busy || Boolean(pendingId) || !draft.spec || !onOpenAdvisor} onClick={() => {
          if (!draft.spec) return;
          const next = applyManhuaPrevisDraftToStudio(studio, draft.spec, new Date().toISOString(), draft);
          if (publish(next)) onOpenAdvisor?.(undefined, next);
        }}>沿用这份节奏，向顾问描述后续调整</button></div>)}
      </section>}
      {block.previsStudio && <section id="previs-cast" className="space-y-2 rounded border border-cyan-300/20 p-3" data-previs-cast>
        <p className="text-sm font-medium text-cyan-50">当前方案人物</p>
        <p className="text-xs text-cyan-100">渲染容量：{previsRenderCostUnits(studio.spec)} / {PREVIS_RENDER_UNIT_BUDGET}</p>
        <div className="flex flex-wrap gap-3">{studio.spec.actors.map(actor => <span key={actor.id} className="text-xs"><span className="mr-1 inline-block h-3 w-3 rounded-full" style={{ backgroundColor: previsActorColor(actor.id, studio.spec.actors).hex }} aria-hidden="true" />{actor.nameZh} · {actor.shape === "horse" ? "四足" : "人形"}</span>)}</div>
        {studio.spec.actors.filter(actor => actor.shape === "human" && !actor.creature).map(actor => {
          const model = characters.find(c => c.id === actor.assetRef)?.model;
          return profiles.filter(profile => profile.assetRef === actor.assetRef && profile.sourceJobId === model?.taskId).map((profile, index) => <button key={`${actor.id}:${index}`} type="button" className={button} disabled={disabled || busy || Boolean(pendingId)} onClick={() => {
            try {
              const form = usePreparedRig(createRigForm(actor.riggedModel, model?.taskId), profile, { assetRef: actor.assetRef, taskId: model?.taskId, durationSec: studio.spec.durationSec, spec: studio.spec, actorId: actor.id });
              const riggedModel = applyRigForm(form, { taskId: model?.taskId, durationSec: studio.spec.durationSec, shape: actor.shape, hasCreature: Boolean(actor.creature) });
              const next = { ...studio, spec: { ...studio.spec, actors: studio.spec.actors.map(row => row.id === actor.id ? { ...row, riggedModel } : row) }, specHistory: [...(studio.specHistory || []), { spec: studio.spec, createdAt: new Date().toISOString(), reasonZh: "沿用项目已准备模型前的配置" }] };
              if (publish(next)) setStatus(`已沿用${actor.nameZh}的项目模型配置；尚未渲染，当前段动作由顾问继续调整。`);
            } catch (error) { setError(error instanceof Error ? error.message : "模型配置未应用"); }
          }}>沿用{actor.nameZh}的已准备模型 · {profile.originLabel}</button>);
        })}
        <p className="text-xs text-white/65">人物、动作与运镜请向创作顾问描述；原配置和已采用参考保留。</p>
      </section>}
      <ManhuaPrevisSceneEffectsEditor key={`${studio.scopeId}:${block.id}`} spec={studio.spec} disabled={disabled || busy || Boolean(pendingId)} onApply={spec => {
        if (disabled || busy || pendingId || lock.current) return false;
        const current = latest.current.studio;
        if (previsSpecKey(current.spec) !== previsSpecKey(studio.spec)) { setError("白模方案已更新，请重新载入当前配置再保存特效。"); return false; }
        const next = { ...current, spec, specHistory: [...(current.specHistory || []), { spec: current.spec, createdAt: new Date().toISOString(), reasonZh: "调整场景特效前的白模配置" }] };
        if (!publish(next)) return false;
        setStatus("场景特效配置已保存；原配置与已采用白模保留，请从下方渲染新候选。");
        return true;
      }} />
      {studio.specHistory?.length ? (
        <button
          className={button}
          disabled={disabled || Boolean(pendingId) || busy}
          onClick={() => {
            const history = studio.specHistory ?? [];
            const old = history.at(-1);
            if (old && !disabled && !pendingId && !lock.current) {
              // 回退规格时把草案带来的运镜句一并清掉，句子不能和旧规格对不上
              const { draftCameraPromptZh: _p, draftTempoZh: _t, ...rest } = studio;
              publish({
                ...rest,
                spec: old.spec,
                specHistory: history.slice(0, -1),
              });
            }
          }}
        >
          恢复上一份动作配置（不改已采用参考）
        </button>
      ) : null}
      <p className="text-sm font-medium text-cyan-50" data-previs-step-render>生成与审片</p>
      <p className="text-[11px] text-white/60">生成后逐帧看人数、背负、接触和穿模，再从头按正常速度播放一遍；没问题再点「采用为本段参考」。</p>
      <div className="flex flex-wrap gap-2">
        <button
          className={button}
          disabled={disabled || busy || (!block.previsStudio && !pendingId)}
          onClick={() => void generate()}
        >
          {pendingId ? "确认原请求（不新建编号）" : "确认生成动作白模"}
        </button>
        <button
          className={button}
          disabled={busy}
          onClick={() => void recover()}
        >
          恢复本段历史
        </button>
        {pendingId && abandonable ? (
          <button
            type="button"
            className={button}
            data-previs-abandon-pending
            disabled={disabled || busy}
            onClick={() => void abandonPending()}
          >
            原编号不存在，放弃它
          </button>
        ) : null}
        <span role="status" className="text-xs text-white/65">{error ? "" : status}</span>
      </div>
      {adoptedJobId && studio.selectedJobId === adoptedJobId && onNextDraftVideo ? (
        <div className="flex flex-wrap items-center gap-2 rounded border border-emerald-300/30 bg-emerald-500/10 p-2" data-previs-next-draft-video>
          <span className="text-xs text-emerald-100">白模已采用。下一步按当前视频模型与片段设置生成；提交前请核对提示词、参考和费用。</span>
          <button
            type="button"
            className={button}
            disabled={disabled || busy}
            onClick={() => onNextDraftVideo()}
          >
            生成当前片段视频
          </button>
        </div>
      ) : null}
      {pendingId && (
        <p className="text-xs text-white/50">
          请求编号：{pendingId}。配置已锁定，任务结束后可修改。
        </p>
      )}
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded border border-amber-300/35 bg-amber-500/10 p-2 text-xs text-amber-100" data-previs-recovery>
          <span className="min-w-0 flex-1 break-words"><strong>{/回执|层包/.test(error) ? "产物待核对" : pendingId ? "提交或查询结果未确认" : error.startsWith("渲染任务失败：") ? "本次渲染失败" : /历史|续签/.test(error) ? "历史读取失败" : /帧|播放|画面/.test(error) ? "预览审片受阻" : "配置需检查"}：</strong>{error.replace(/^渲染任务失败：/, "")}</span>
          {pendingId ? (
            <button type="button" className={button} disabled={busy} onClick={() => void queryPending()}>查询原编号</button>
          ) : /历史|续签/.test(error) ? (
            <button type="button" className={button} disabled={busy} onClick={() => void recover()}>重读本段历史</button>
          ) : /帧|播放|画面/.test(error) && preview ? (
            <button type="button" className={button} onClick={() => { previewVideo.current?.load(); setNormalSpeedConfirmed(false); setNormalSpeedPlayed(false); normalPlaybackStarted.current = false; setError(""); }}>重新载入预览</button>
          ) : (
            <a className={button} href="#previs-cast">检查人物与配置</a>
          )}
        </div>
      )}
      {studio.history.map(take => (
        <div
          key={take.jobId}
          className="flex flex-wrap items-center gap-2 text-xs text-white/70"
        >
          <span>
            {take.durationSec} 秒 · {take.createdAt.slice(0, 19)}
            <span data-previs-take-source> · {manhuaPrevisSourceLabel(take.spec)}</span>
            {studio.selectedJobId === take.jobId ? " · 当前采用" : ""}
            {previsSpecKey(take.spec) !== previsSpecKey(studio.spec)
              ? " · 较早配置"
              : ""}
          </span>
          <button
            className={button}
            onClick={() => void loadPreview(take.requestId)}
          >
            预览
          </button>
          <button
            className={button}
            disabled={disabled || Boolean(pendingId) || busy}
            onClick={() => adopt(take)}
          >
            采用为本段参考
          </button>
          {preview?.requestId === take.requestId && preview.sceneUrl
            && /^\/api\/manhua-previs-media\/prv_[a-f0-9]{48}\/scene$/.test(preview.sceneUrl) && (
              <a className={button} href={manhuaPrevisMediaUrl(preview.sceneUrl)} download="白模动画工程.blend" target="_blank" rel="noreferrer">
                下载动作与镜头工程
              </a>
            )}
          {preview?.requestId === take.requestId &&
            preview.layerBundle &&
            isPrevisMediaUrl(preview.layerBundle.url) && (
              <a
                className={button}
                href={manhuaPrevisMediaUrl(preview.layerBundle.url)}
                download="遮罩与深度层包.zip"
                target="_blank"
                rel="noreferrer"
              >
                下载遮罩与深度层包
              </a>
            )}
        </div>
      ))}
      {studio.referenceHistory.map((entry, i) => (
        <button
          key={entry.gcsUri || entry.url}
          className={button}
          disabled={disabled || Boolean(pendingId) || busy}
          onClick={() => {
            const current = block.manhuaSegmentRefs?.previs;
            const history = [...studio.referenceHistory];
            if (
              current &&
              !history.some(
                r => (r.gcsUri || r.url) === (current.gcsUri || current.url)
              )
            )
              history.push(current);
            publish(
              {
                ...studio,
                selectedJobId: undefined,
                referenceHistory: history,
              },
              entry
            );
          }}
        >
          恢复旧参考 {i + 1}
        </button>
      ))}
      </aside>
      </div>
    </section>
  );
}
