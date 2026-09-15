import type { PreparedRigProfile } from "@/lib/manhuaPrevisProfiles";
import { useEffect, useRef, useState } from "react";
import { ManhuaPrevisRigControls } from "./ManhuaPrevisRigControls";
import { trpc } from "@/lib/trpc";
import type { CanvasBlock } from "@/lib/canvasTypes";
import type { ManhuaSegmentReferenceEntry } from "@shared/manhuaSegmentReference";
import type { ManhuaPrevisDraftFromPlan } from "@shared/manhuaPrevisFromActionPlan";
import {
  createManhuaPrevisStudio,
  formatPrevisMotionGuide,
  manhuaPrevisSpecSchema,
  PREVIS_ACTION_LABELS,
  previsSpecKey,
  type ManhuaPrevisRequest,
  type ManhuaPrevisSpec,
  type ManhuaPrevisStudio as Studio,
} from "@shared/manhuaPrevis";
import {
  compilePrevisScriptDraft,
  previsScriptSourceKey,
  type PrevisSourceShot,
  type PrevisScriptDraft,
} from "@shared/manhuaPrevisScript";

type Result = {
  gcsUri: string;
  url: string;
  durationSec: number;
  clipId: string;
  requestId: string;
  spec: ManhuaPrevisSpec;
  report?: { warnings?: string[] };
  layerBundle?: {
    gcsUri: string;
    url?: string;
    bytes: number;
    sha256: string;
    format: "previs-layers-v1";
  };
};
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
  disabled?: boolean;
  /** 0915 PR-4：从动作节奏时间轴生成的白模草案（每可执行镜一条）；有它就不必手填数字表 */
  actionPlanDrafts?: ManhuaPrevisDraftFromPlan[];
  characters: Array<{
    id: string;
    label: string;
    tag?: string;
    model?: { taskId: string };
  }>;
  sourceShots?: PrevisSourceShot[];
  profiles?: PreparedRigProfile[];
  onChange: (
    studio: Studio,
    reference?: ManhuaSegmentReferenceEntry
  ) => void | boolean;
};
const field =
  "rounded border border-white/20 bg-[#141a24] p-1 text-xs text-white min-w-0";
const button =
  "rounded border border-cyan-300/30 px-2 py-1 text-xs text-cyan-50 disabled:opacity-40";

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
  disabled,
  characters,
  onChange,
  services,
  sourceShots = [],
  profiles = [],
  actionPlanDrafts = [],
}: Props & { services: PrevisServices }) {
  const [initial] = useState(
    () => block.previsStudio ?? createManhuaPrevisStudio()
  );
  // 高级数字表折叠只由**初始**有无草案决定；之后跟着用户手动开合走，草案出现/消失不会把正在编辑的表收起来（1468 R1）
  const [advancedOpen, setAdvancedOpen] = useState(() => !actionPlanDrafts.length);
  const studio = block.previsStudio ?? initial;
  const latest = useRef({ studio, onChange, services, disabled, block });
  latest.current = { studio, onChange, services, disabled, block };
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [scriptDraft, setScriptDraft] = useState<PrevisScriptDraft | null>(
    null
  );
  const draftBaseKey = useRef("");
  const [reviewedDraft, setReviewedDraft] = useState(false);
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
    const current = latest.current;
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
  const edit = (spec: ManhuaPrevisSpec) => {
    if (disabled || pendingId || lock.current) return false;
    if (spec.waterEmergence) {
      const water = spec.waterEmergence;
      const base = water.events[0]?.crossSec ?? 1;
      let nextCross = water.events.length
        ? Math.max(...water.events.map(e => e.crossSec)) + 0.25
        : 1;
      spec = {
        ...spec,
        waterEmergence: {
          ...water,
          events: spec.actors.map(
            (actor, i) =>
              water.events.find(e => e.actorId === actor.id) ?? {
                actorId: actor.id,
                crossSec:
                  water.mode === "staggered"
                    ? (nextCross += 0.25) - 0.25
                    : base,
                riseSec: 1.25,
                height: 2.8,
                waveRadius: 1.5,
                waveHeight: 1.8,
                waveDurationSec: 2.5,
              }
          ),
        },
      };
    }
    return publish({ ...studio, spec });
  };
  function consume(response: PrevisResponse) {
    if (!mounted.current) return;
    const current = latest.current;
    if (
      response.params.scopeId !== current.studio.scopeId ||
      response.params.clipId !== current.block.id
    )
      return;
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
        result.durationSec !== response.params.spec.durationSec ||
        result.requestId !== response.params.requestId ||
        result.clipId !== response.params.clipId
      ) {
        setError("产物回执不完整，请查询原任务");
        return;
      }
      if (
        response.params.spec.exportLayers &&
        (!result.layerBundle?.url?.startsWith("https://") ||
          result.layerBundle.format !== "previs-layers-v1")
      ) {
        setError("遮罩与深度层包回执未确认，请查询原任务；不要重复生成");
        return;
      }
      setPreview({ ...result, spec: response.params.spec });
      const old = current.studio.history.find(t => t.jobId === response.jobId);
      const take = {
        jobId: response.jobId,
        requestId: response.params.requestId,
        gcsUri: result.gcsUri,
        url: result.url,
        durationSec: result.durationSec,
        createdAt: old?.createdAt ?? new Date().toISOString(),
        spec: response.params.spec,
      };
      publish({
        ...current.studio,
        pending: matching ? undefined : current.studio.pending,
        history: old
          ? current.studio.history.map(t => (t.jobId === take.jobId ? take : t))
          : [...current.studio.history, take],
      });
    } else if (response.status === "failed") {
      setError(response.error || "渲染未完成，请检查配置；旧参考保留");
      if (matching) publish({ ...current.studio, pending: undefined });
    }
  }
  useEffect(() => {
    if (!pendingId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await latest.current.services.get(pendingId);
        if (!active) return;
        if (response) {
          consume(response);
          if (response.status === "succeeded" || response.status === "failed")
            return;
        } else setStatus("尚未查到原请求；可确认原编号，不会新建重复任务");
      } catch {
        if (active) setStatus("查询暂不可用，保留原任务编号，稍后继续查询");
      }
      if (active) timer = setTimeout(poll, 4000);
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [pendingId]);
  async function generate() {
    if (disabled || lock.current) return;
    const parsed = manhuaPrevisSpecSchema.safeParse(studio.spec);
    if (!parsed.success) {
      setError(parsed.error.issues.map(i => i.message).join("；"));
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    const input = studio.pending ?? {
      requestId: crypto.randomUUID(),
      scopeId: studio.scopeId,
      clipId: block.id,
      spec: parsed.data,
    };
    try {
      // 同一段状态先保留请求，再入队。响应只入候选，不自动替换本段参考。
      if (!publish({ ...studio, pending: input })) return;
      consume(await services.submit(input));
    } catch {
      if (mounted.current)
        setError(
          "提交结果尚未确认。保留原编号；请查询或确认原请求，不要新建任务。"
        );
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
            result.durationSec !== response.params.spec.durationSec ||
            result.requestId !== response.params.requestId ||
            result.clipId !== block.id ||
            (response.params.spec.exportLayers &&
              (!result.layerBundle?.url?.startsWith("https://") ||
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
  const numeric = (
    label: string,
    value: number,
    change: (n: number) => void,
    step = 0.1
  ) => (
    <label className="flex items-center gap-1 text-xs text-white/70">
      {label}
      <input
        className={`${field} w-20`}
        aria-label={label}
        type="number"
        step={step}
        value={value}
        disabled={disabled || Boolean(pendingId)}
        onChange={e => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) change(n);
        }}
      />
    </label>
  );
  const actorEdit = (
    index: number,
    patch: Partial<ManhuaPrevisSpec["actors"][number]>
  ) =>
    edit({
      ...studio.spec,
      actors: studio.spec.actors.map((a, i) => {
        if (i !== index) return a;
        const next = { ...a, ...patch };
        if (next.motionRoute?.length && !("motionRoute" in patch))
          next.motionRoute = next.motionRoute.map((node, j) => ({
            ...node,
            ...(j === 0
              ? { position: next.start, facingDeg: next.facingDeg }
              : {}),
            ...(j === next.motionRoute!.length - 1
              ? { position: next.end }
              : {}),
          }));
        return next;
      }),
    });
  function adopt(take: Studio["history"][number]) {
    if (disabled || pendingId || busy) return;
    if (
      take.spec.exportLayers &&
      (preview?.requestId !== take.requestId ||
        !preview.layerBundle?.url?.startsWith("https://") ||
        preview.layerBundle.format !== "previs-layers-v1")
    ) {
      setError(
        "请先预览查询这条原任务，确认遮罩与深度层包后再采用；不要重复生成"
      );
      return;
    }
    const old = block.manhuaSegmentRefs?.previs;
    const reference: ManhuaSegmentReferenceEntry = {
      url: take.url,
      gcsUri: take.gcsUri,
      fileName: `动作白模-${take.jobId}.mp4`,
      durationSec: take.durationSec,
      updatedAt: new Date().toISOString(),
      motionGuideZh: formatPrevisMotionGuide(take.spec),
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
      return;
    setStatus("已采用为本段白模参考，旧参考保留；尚未验证最终生成片跟随质量");
  }
  return (
    <section
      data-manhua-previs-studio
      className="w-full space-y-3 rounded-lg border border-cyan-300/25 bg-[#0c121d] p-3"
    >
      <p className="text-xs text-white/70">
        本段动作白模 ·
        简化人体关节／四足站位，不是角色模型自动绑定。渲染不调用付费生成模型；预览后再采用，不会自动出成片。
      </p>
      {sourceShots.length > 0 ? (
        <section
          className="space-y-2 rounded border border-cyan-300/20 p-2"
          data-previs-script-draft
        >
          <p className="text-xs text-cyan-100">
            本段原镜动作草案 · 不调用付费模型
          </p>
          <button
            className={button}
            disabled={disabled || Boolean(pendingId) || busy}
            onClick={() => {
              draftBaseKey.current = previsSpecKey(studio.spec);
              setScriptDraft(
                compilePrevisScriptDraft({
                  shots: sourceShots,
                  characters,
                  currentSpec: studio.spec,
                })
              );
              setReviewedDraft(false);
            }}
          >
            从本段剧本生成动作草案
          </button>
          {scriptDraft ? (
            <>
              <p className="text-xs text-white/70">
                已映射 {scriptDraft.mappedShotIndices.length}/
                {sourceShots.length} 镜；双人事件{" "}
                {scriptDraft.spec?.interactions?.length ?? 0}{" "}
                个。草案尚未采用，也未提交渲染。
              </p>
              {scriptDraft.notes.map((note, i) => (
                <p key={i} className="text-xs text-amber-100">
                  {note}
                </p>
              ))}
              {scriptDraft.errors.map((message, i) => (
                <p key={i} role="alert" className="text-xs text-red-200">
                  {message}
                </p>
              ))}
              {scriptDraft.unmapped.map(row => (
                <p key={row.index} className="text-xs text-amber-100">
                  原镜{row.index}未映射：{row.reasonZh}。原文：{row.text}
                </p>
              ))}
              {scriptDraft.spec ? (
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap text-xs text-white/80">
                  {formatPrevisMotionGuide(scriptDraft.spec)}
                </pre>
              ) : null}
              {scriptDraft.sourceKey !==
              previsScriptSourceKey(sourceShots, characters) ? (
                <p role="alert" className="text-xs text-amber-100">
                  原剧本或角色已变化，请重新生成草案。
                </p>
              ) : null}
              {draftBaseKey.current !== previsSpecKey(studio.spec) ? (
                <p role="alert" className="text-xs text-amber-100">
                  当前动作配置已变化，请重新生成草案，避免覆盖刚才的编辑。
                </p>
              ) : null}
              <label className="flex gap-2 text-xs text-white/80">
                <input
                  type="checkbox"
                  checked={reviewedDraft}
                  disabled={disabled || Boolean(pendingId) || busy}
                  onChange={e => setReviewedDraft(e.target.checked)}
                />
                我已审阅动作、建议站位及未映射原文；仅采用当前草案，旧配置保留
              </label>
              <button
                className={button}
                disabled={
                  !reviewedDraft ||
                  !scriptDraft.spec ||
                  disabled ||
                  Boolean(pendingId) ||
                  busy ||
                  scriptDraft.sourceKey !==
                    previsScriptSourceKey(sourceShots, characters) ||
                  draftBaseKey.current !== previsSpecKey(studio.spec)
                }
                onClick={() => {
                  if (
                    !scriptDraft.spec ||
                    !reviewedDraft ||
                    scriptDraft.sourceKey !==
                      previsScriptSourceKey(sourceShots, characters) ||
                    disabled ||
                    pendingId ||
                    lock.current ||
                    draftBaseKey.current !== previsSpecKey(studio.spec)
                  )
                    return;
                  if (
                    publish({
                      ...studio,
                      spec: scriptDraft.spec,
                      specHistory: [
                        ...(studio.specHistory ?? []),
                        {
                          spec: studio.spec,
                          createdAt: new Date().toISOString(),
                          reasonZh: "采用剧本动作草案前的配置",
                        },
                      ],
                    })
                  ) {
                    setScriptDraft(null);
                    setReviewedDraft(false);
                    setStatus(
                      "动作草案已采用为可编辑配置，尚未提交渲染；旧参考未改变"
                    );
                  }
                }}
              >
                采用动作草案
              </button>
            </>
          ) : null}
        </section>
      ) : null}
      {actionPlanDrafts.length ? (
        <section className="space-y-2 rounded border border-cyan-300/30 p-2" data-previs-action-plan-drafts>
          <p className="text-xs text-cyan-100">从动作节奏生成白模草案 · 不调用付费模型</p>
          <p className="text-xs text-white/60">
            时间轴上排好的起手/接触/卸力已换算成白模时序（对齐 24 帧）。站位与机位为默认值，套用后可在「高级参数」微调；套用不提交渲染。
          </p>
          {actionPlanDrafts.map((d) => (
            <div key={d.executableShotId} className="space-y-1 rounded border border-white/15 p-2" data-draft-shot={d.executableShotId}>
              <p className="text-xs text-white/85">
                {d.executableShotId} · {d.kind === "water_emerge" ? "出水" : d.kind === "engagement" ? "交锋" : "过渡"} · 源 {d.timing.durationSec}s
              </p>
              {d.summaryZh.map((line, i) => (
                <p key={i} className="text-[11px] text-white/70">{line}</p>
              ))}
              {d.issuesZh.map((line, i) => (
                <p key={`i${i}`} className="text-[11px] text-amber-100">{line}</p>
              ))}
              <button
                className={button}
                disabled={disabled || Boolean(pendingId) || busy || !d.spec}
                title={d.spec ? "把这镜的白模规格套用到下方（可撤销：规格历史里可回退）" : "草案未过白模合同，先按上面提示修时间轴"}
                onClick={() => {
                  if (d.spec) edit(d.spec);
                }}
              >
                套用这镜到白模规格
              </button>
            </div>
          ))}
        </section>
      ) : null}
      {studio.specHistory?.length ? (
        <button
          className={button}
          disabled={disabled || Boolean(pendingId) || busy}
          onClick={() => {
            const history = studio.specHistory ?? [];
            const old = history.at(-1);
            if (old && !disabled && !pendingId && !lock.current)
              publish({
                ...studio,
                spec: old.spec,
                specHistory: history.slice(0, -1),
              });
          }}
        >
          恢复上一份动作配置（不改已采用参考）
        </button>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {numeric(
          "片长（秒）",
          studio.spec.durationSec,
          n => edit({ ...studio.spec, durationSec: n }),
          1
        )}
        <label className="text-xs">
          画幅{" "}
          <select
            aria-label="白模画幅"
            className={field}
            disabled={disabled || Boolean(pendingId)}
            value={studio.spec.aspect}
            onChange={e =>
              edit({
                ...studio.spec,
                aspect: e.target.value as "16:9" | "9:16",
              })
            }
          >
            <option>16:9</option>
            <option>9:16</option>
          </select>
        </label>
      </div>
      <details open={advancedOpen} onToggle={(e) => setAdvancedOpen(e.currentTarget.open)} className="space-y-2" data-previs-advanced>
        <summary className="text-xs text-cyan-100">高级参数 · 数字表（站位 / 动作 / 特效 / 出水 / 短打）</summary>
      {studio.spec.actors.map((actor, index) => (
        <fieldset
          key={actor.id}
          className="space-y-2 rounded border border-white/15 p-2"
        >
          <legend className="text-xs">
            白模角色 {index + 1} · {actor.nameZh}
          </legend>
          <div className="flex flex-wrap gap-2">
            <input
              aria-label={`角色${index + 1}名称`}
              className={field}
              value={actor.nameZh}
              disabled={disabled || Boolean(pendingId)}
              onChange={e => actorEdit(index, { nameZh: e.target.value })}
            />
            <select
              aria-label={`角色${index + 1}项目资产`}
              className={field}
              value={actor.assetRef ?? ""}
              disabled={disabled || Boolean(pendingId)}
              onChange={e => {
                const selected = characters.find(c => c.id === e.target.value);
                actorEdit(index, {
                  assetRef: selected?.id,
                  nameZh: selected?.label ?? actor.nameZh,
                  riggedModel: undefined,
                });
              }}
            >
              <option value="">手填角色名</option>
              {characters.map(c => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <button
              className={button}
              disabled={
                disabled ||
                Boolean(pendingId) ||
                studio.spec.actors.length === 1
              }
              onClick={() =>
                edit({
                  ...studio.spec,
                  actors: studio.spec.actors.filter((_, i) => i !== index),
                })
              }
            >
              移除角色
            </button>
          </div>
          <details className="rounded border border-white/10 bg-white/[0.025] p-2">
            <summary className="cursor-pointer text-xs text-white/60">
              专业调度 · 形体、朝向与走位
            </summary>
            <div className="mt-2 flex flex-wrap gap-2">
              {" "}
              <select
                aria-label={`角色${index + 1}形体`}
                className={field}
                disabled={disabled || Boolean(pendingId)}
                value={actor.shape}
                onChange={e =>
                  actorEdit(index, {
                    shape: e.target.value as "human" | "horse",
                    actions: [],
                    weapon: undefined,
                    creature: undefined,
                    riggedModel: undefined,
                  })
                }
              >
                <option value="human">人体关节</option>
                <option value="horse">四足白模</option>
              </select>
              <label className="text-xs text-white/70">
                持械
                <select
                  className={field}
                  aria-label={`角色${index + 1}持械`}
                  value={actor.weapon ?? "none"}
                  disabled={disabled || Boolean(pendingId)}
                  onChange={e =>
                    actorEdit(index, {
                      weapon:
                        e.target.value === "practice_sword"
                          ? "practice_sword"
                          : undefined,
                    })
                  }
                >
                  <option value="none">空手</option>
                  <option
                    value="practice_sword"
                    disabled={
                      actor.shape !== "human" || Boolean(actor.riggedModel)
                    }
                  >
                    右手练习剑
                  </option>
                </select>
              </label>
              {numeric(
                "朝向角度",
                actor.facingDeg,
                n => actorEdit(index, { facingDeg: n }),
                5
              )}
              {(["start", "end"] as const).flatMap(key =>
                [0, 1].map(axis =>
                  numeric(
                    `${key === "start" ? "起点" : "终点"}${axis === 0 ? "X" : "Y"}`,
                    actor[key][axis],
                    n => {
                      const p = [...actor[key]] as [number, number];
                      p[axis] = n;
                      actorEdit(index, { [key]: p });
                    }
                  )
                )
              )}
              {numeric("移动开始", actor.moveStartSec, n =>
                actorEdit(index, { moveStartSec: n })
              )}
              {numeric("移动结束", actor.moveEndSec, n =>
                actorEdit(index, { moveEndSec: n })
              )}
            </div>
          </details>
          <section
            className="space-y-2 rounded border border-white/15 p-2"
            data-previs-route={actor.id}
          >
            <label className="text-xs text-white/70">
              <input
                type="checkbox"
                aria-label={`角色${index + 1}分段运动轨`}
                disabled={disabled || Boolean(pendingId)}
                checked={Boolean(actor.motionRoute)}
                onChange={e =>
                  actorEdit(index, {
                    motionRoute: e.target.checked
                      ? [
                          {
                            timeSec: 0,
                            position: [...actor.start],
                            facingDeg: actor.facingDeg,
                          },
                          {
                            timeSec: (studio.spec.durationSec * 24 - 1) / 24,
                            position: [...actor.end],
                            facingDeg: actor.facingDeg,
                          },
                        ]
                      : undefined,
                  })
                }
              />
              分段站位与转身
            </label>
            {actor.motionRoute && (
              <>
                <p className="text-xs text-white/60">
                  设置每个时刻的站位和朝向；启用后按这些节点运动。可用于进场、退让与换对手，路线不会自动避让。首末位置同步原起终点，时刻按视频帧对齐。
                </p>
                {actor.motionRoute.map((node, j) => {
                  const patchNode = (value: Partial<typeof node>) => {
                    const nodes = actor.motionRoute!.map((row, k) =>
                      k === j ? { ...row, ...value } : row
                    );
                    actorEdit(index, {
                      motionRoute: nodes,
                      ...(j === 0
                        ? {
                            start: nodes[0].position,
                            facingDeg: nodes[0].facingDeg,
                          }
                        : {}),
                      ...(j === nodes.length - 1
                        ? { end: nodes[j].position }
                        : {}),
                    });
                  };
                  return (
                    <div key={j} className="flex flex-wrap gap-2">
                      {numeric(
                        `路线${index + 1}节点${j + 1}秒位`,
                        node.timeSec,
                        n => patchNode({ timeSec: Math.round(n * 24) / 24 }),
                        1 / 24
                      )}
                      {[0, 1].map(axis =>
                        numeric(
                          `路线${index + 1}节点${j + 1}${"XY"[axis]}`,
                          node.position[axis],
                          n => {
                            const position = [...node.position] as [
                              number,
                              number,
                            ];
                            position[axis] = n;
                            patchNode({ position });
                          }
                        )
                      )}
                      {numeric(
                        `路线${index + 1}节点${j + 1}朝向`,
                        node.facingDeg,
                        n => patchNode({ facingDeg: n }),
                        5
                      )}
                      {j > 0 && j < actor.motionRoute!.length - 1 && (
                        <button
                          className={button}
                          disabled={disabled || Boolean(pendingId)}
                          onClick={() =>
                            actorEdit(index, {
                              motionRoute: actor.motionRoute!.filter(
                                (_, k) => k !== j
                              ),
                            })
                          }
                        >
                          移除路线节点
                        </button>
                      )}
                    </div>
                  );
                })}
                <button
                  className={button}
                  disabled={
                    disabled ||
                    Boolean(pendingId) ||
                    actor.motionRoute.length >= 12 ||
                    actor.motionRoute.length < 2
                  }
                  onClick={() => {
                    const nodes = actor.motionRoute!;
                    let longest = 0;
                    for (let j = 1; j < nodes.length - 1; j++)
                      if (
                        nodes[j + 1].timeSec - nodes[j].timeSec >
                        nodes[longest + 1].timeSec - nodes[longest].timeSec
                      )
                        longest = j;
                    const a = nodes[longest],
                      b = nodes[longest + 1];
                    let angle = ((b.facingDeg - a.facingDeg + 540) % 360) - 180;
                    if (angle === -180) angle = 180;
                    const facing =
                      ((a.facingDeg + angle / 2 + 540) % 360) - 180;
                    actorEdit(index, {
                      motionRoute: [
                        ...nodes.slice(0, longest + 1),
                        {
                          timeSec:
                            Math.round((a.timeSec + b.timeSec) * 12) / 24,
                          position: [
                            (a.position[0] + b.position[0]) / 2,
                            (a.position[1] + b.position[1]) / 2,
                          ],
                          facingDeg: facing,
                        },
                        ...nodes.slice(longest + 1),
                      ],
                    });
                  }}
                >
                  添加路线节点
                </button>
              </>
            )}
          </section>
          {actor.shape === "horse" ? (
            <div className="space-y-2 rounded border border-white/15 p-2">
              <label className="flex gap-2 text-xs">
                <input
                  type="checkbox"
                  aria-label={`角色${index + 1}四尾黑翼`}
                  disabled={disabled || Boolean(pendingId)}
                  checked={Boolean(actor.creature)}
                  onChange={e =>
                    actorEdit(index, {
                      creature: e.target.checked
                        ? {
                            preset: "four_tail_black_wings",
                            transformStartSec: 0,
                            transformEndSec: Math.min(
                              1,
                              (studio.spec.durationSec * 24 - 1) / 24
                            ),
                          }
                        : undefined,
                    })
                  }
                />
                四尾黑翼 · 同一马体附件显形
              </label>
              {actor.creature ? (
                <div className="flex gap-2">
                  {numeric(
                    "显形开始",
                    actor.creature.transformStartSec,
                    n =>
                      actorEdit(index, {
                        creature: { ...actor.creature!, transformStartSec: n },
                      }),
                    1 / 24
                  )}
                  {numeric(
                    "显形结束",
                    actor.creature.transformEndSec,
                    n =>
                      actorEdit(index, {
                        creature: { ...actor.creature!, transformEndSec: n },
                      }),
                    1 / 24
                  )}
                </div>
              ) : null}
              <p className="text-xs text-white/60">
                固定四尾与双翼，不改变主体体型；显形须在最后实际帧前完成。
              </p>
            </div>
          ) : (
            <ManhuaPrevisRigControls
              actor={actor}
              spec={studio.spec}
              profiles={profiles}
              model={characters.find(c => c.id === actor.assetRef)?.model}
              durationSec={studio.spec.durationSec}
              disabled={disabled || Boolean(pendingId)}
              onChange={riggedModel => actorEdit(index, { riggedModel })}
            />
          )}
          {actor.actions.map((action, j) => (
            <div key={j} className="flex flex-wrap gap-2">
              <select
                className={field}
                aria-label={`角色${index + 1}动作${j + 1}`}
                value={action.kind}
                disabled={disabled || Boolean(pendingId)}
                onChange={e =>
                  actorEdit(index, {
                    actions: actor.actions.map((a, k) =>
                      k === j
                        ? { ...a, kind: e.target.value as typeof action.kind }
                        : a
                    ),
                  })
                }
              >
                {Object.entries(PREVIS_ACTION_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              {numeric("动作开始", action.startSec, n =>
                actorEdit(index, {
                  actions: actor.actions.map((a, k) =>
                    k === j ? { ...a, startSec: n } : a
                  ),
                })
              )}
              {numeric("动作结束", action.endSec, n =>
                actorEdit(index, {
                  actions: actor.actions.map((a, k) =>
                    k === j ? { ...a, endSec: n } : a
                  ),
                })
              )}
              <button
                className={button}
                disabled={disabled || Boolean(pendingId)}
                onClick={() =>
                  actorEdit(index, {
                    actions: actor.actions.filter((_, k) => k !== j),
                  })
                }
              >
                移除动作
              </button>
            </div>
          ))}
          <button
            className={button}
            disabled={
              disabled ||
              Boolean(pendingId) ||
              actor.shape !== "human" ||
              actor.actions.length >= 12
            }
            onClick={() =>
              actorEdit(index, {
                actions: [
                  ...actor.actions,
                  {
                    kind: "guard",
                    startSec: actor.actions.at(-1)?.endSec ?? 0,
                    endSec: studio.spec.durationSec,
                  },
                ],
              })
            }
          >
            添加动作
          </button>
        </fieldset>
      ))}
      <button
        className={button}
        disabled={
          disabled ||
          Boolean(pendingId) ||
          studio.spec.actors.length >= (studio.spec.waterEmergence ? 3 : 6)
        }
        onClick={() =>
          edit({
            ...studio.spec,
            actors: [
              ...studio.spec.actors,
              {
                ...createManhuaPrevisStudio(studio.spec.durationSec).spec
                  .actors[0],
                id: crypto.randomUUID(),
                nameZh: `角色 ${studio.spec.actors.length + 1}`,
                start: [1, 0],
                end: [1, 0],
              },
            ],
          })
        }
      >
        添加角色
      </button>
      <section
        className="space-y-2 rounded border border-white/15 p-2"
        data-previs-effects
      >
        <p className="text-xs text-cyan-100">爆点与烟雾 · 事件编排</p>
        <p className="text-xs text-white/60">
          最多四个事件、三人八秒。用于验证触发、漂移、遮挡与局部受光；几何烟火不代表真实破坏、碎片或人物受力。
        </p>
        {(studio.spec.effects ?? []).map((event, index) => {
          const patch = (value: Partial<typeof event>) =>
            edit({
              ...studio.spec,
              effects: studio.spec.effects!.map((e, i) =>
                i === index ? { ...e, ...value } : e
              ),
            });
          return (
            <div
              key={event.id}
              className="flex flex-wrap gap-2 rounded border border-white/15 p-2"
            >
              <label className="text-xs text-white/70">
                事件{index + 1}
                <select
                  aria-label={`特效${index + 1}类型`}
                  className={field}
                  disabled={disabled || Boolean(pendingId)}
                  value={event.kind}
                  onChange={e =>
                    patch({ kind: e.target.value as "explosion" | "smoke" })
                  }
                >
                  <option value="explosion">爆点闪光与烟团</option>
                  <option value="smoke">烟团</option>
                </select>
              </label>
              {numeric(
                `特效${index + 1}开始`,
                event.startSec,
                n => patch({ startSec: Math.round(n * 24) / 24 }),
                1 / 24
              )}
              {numeric(
                `特效${index + 1}时长`,
                event.durationSec,
                n => patch({ durationSec: Math.round(n * 24) / 24 }),
                1 / 24
              )}
              {[0, 1, 2].map(axis =>
                numeric(
                  `特效${index + 1}位置${"XYZ"[axis]}`,
                  event.origin[axis],
                  n => {
                    const origin = [...event.origin] as [
                      number,
                      number,
                      number,
                    ];
                    origin[axis] = n;
                    patch({ origin });
                  }
                )
              )}
              {numeric(`特效${index + 1}横向倍率`, event.radius, n =>
                patch({ radius: n })
              )}
              {numeric(`特效${index + 1}纵向倍率`, event.height, n =>
                patch({ height: n })
              )}
              {[0, 1].map(axis =>
                numeric(
                  `特效${index + 1}烟团漂移${"XY"[axis]}`,
                  event.wind[axis],
                  n => {
                    const wind = [...event.wind] as [number, number];
                    wind[axis] = n;
                    patch({ wind });
                  }
                )
              )}
              <button
                className={button}
                disabled={disabled || Boolean(pendingId)}
                onClick={() =>
                  edit({
                    ...studio.spec,
                    effects: studio.spec.effects!.filter((_, i) => i !== index),
                  })
                }
              >
                移除特效事件
              </button>
            </div>
          );
        })}
        <button
          className={button}
          disabled={
            disabled ||
            Boolean(pendingId) ||
            (studio.spec.effects?.length ?? 0) >= 4
          }
          onClick={() =>
            edit({
              ...studio.spec,
              effects: [
                ...(studio.spec.effects ?? []),
                {
                  id: crypto.randomUUID(),
                  kind: "explosion",
                  startSec: 0.5,
                  durationSec: Math.min(
                    2,
                    Math.floor((studio.spec.durationSec - 0.55) * 24) / 24
                  ),
                  origin: [0, 0, 0.3],
                  radius: 1,
                  height: 1.5,
                  wind: [0, 0],
                },
              ],
            })
          }
        >
          添加特效事件
        </button>
        <label className="flex gap-2 text-xs text-white/70">
          <input
            type="checkbox"
            aria-label="输出合成辅助层"
            checked={Boolean(studio.spec.exportLayers)}
            disabled={disabled || Boolean(pendingId)}
            onChange={e => {
              if (e.target.checked)
                edit({ ...studio.spec, exportLayers: true });
              else {
                const { exportLayers: _layers, ...rest } = studio.spec;
                edit(rest);
              }
            }}
          />
          输出人物／特效几何遮罩与深度（增加本次渲染时间）
        </label>
      </section>
      <section
        className="space-y-2 rounded border border-white/15 p-2"
        data-previs-water
      >
        <p className="text-xs text-cyan-100">多人出水 · 动作与浪花预演</p>
        <p className="text-xs text-white/60">
          当前支持最多三人、八秒。预演人物腾空、独立浪花范围与时序，水体质感需后续制作。先将人体角色设为原地站位；出水暂不混合持械、短打或已绑定模型。
        </p>
        <label className="text-xs text-white/70">
          出水节奏
          <select
            aria-label="出水节奏"
            className={field}
            disabled={disabled || Boolean(pendingId)}
            value={studio.spec.waterEmergence?.mode ?? "none"}
            onChange={e => {
              if (e.target.value === "none") {
                const { waterEmergence: _water, ...rest } = studio.spec;
                edit(rest);
                return;
              }
              const mode = e.target.value as "simultaneous" | "staggered";
              const previous = studio.spec.waterEmergence;
              const base = previous?.events[0]?.crossSec ?? 1;
              edit({
                ...studio.spec,
                waterEmergence: {
                  mode,
                  events: studio.spec.actors.map((a, i) => ({
                    ...(previous?.events.find(
                      event => event.actorId === a.id
                    ) ?? {
                      actorId: a.id,
                      riseSec: 1.25,
                      height: 2.8,
                      waveRadius: 1.5,
                      waveHeight: 1.8,
                      waveDurationSec: 2.5,
                    }),
                    crossSec: base + (mode === "staggered" ? i * 0.25 : 0),
                  })),
                },
              });
            }}
          >
            <option value="none">不启用</option>
            <option value="simultaneous">同时冲出</option>
            <option value="staggered">错峰冲出</option>
          </select>
        </label>
        {studio.spec.waterEmergence?.events.map((event, index) => {
          const patch = (value: Partial<typeof event>) =>
            edit({
              ...studio.spec,
              waterEmergence: {
                ...studio.spec.waterEmergence!,
                events: studio.spec.waterEmergence!.events.map((row, i) =>
                  i === index ? { ...row, ...value } : row
                ),
              },
            });
          const name =
            studio.spec.actors.find(a => a.id === event.actorId)?.nameZh ??
            "已移除角色";
          return (
            <div key={event.actorId} className="flex flex-wrap gap-2">
              <span className="text-xs text-white/70">{name}</span>
              {numeric(
                `出水${index + 1}破水秒位`,
                event.crossSec,
                n => {
                  const crossSec = Math.round(n * 24) / 24;
                  if (studio.spec.waterEmergence!.mode === "simultaneous")
                    edit({
                      ...studio.spec,
                      waterEmergence: {
                        ...studio.spec.waterEmergence!,
                        events: studio.spec.waterEmergence!.events.map(row => ({
                          ...row,
                          crossSec,
                        })),
                      },
                    });
                  else patch({ crossSec });
                },
                1 / 24
              )}
              {numeric(`出水${index + 1}上升时长`, event.riseSec, n =>
                patch({ riseSec: Math.round(n * 24) / 24 })
              )}
              {numeric(`出水${index + 1}腾空高度`, event.height, n =>
                patch({ height: n })
              )}
              {numeric(`出水${index + 1}浪花半径`, event.waveRadius, n =>
                patch({ waveRadius: n })
              )}
              {numeric(`出水${index + 1}浪花高度`, event.waveHeight, n =>
                patch({ waveHeight: n })
              )}
              {numeric(`出水${index + 1}浪花时长`, event.waveDurationSec, n =>
                patch({ waveDurationSec: Math.round(n * 24) / 24 })
              )}
            </div>
          );
        })}
        {studio.spec.waterEmergence && (
          <p className="text-xs text-white/60">
            增减角色会同步出水轨；站位、镜头和已有参考不会自动覆盖。
          </p>
        )}
      </section>
      <section
        className="space-y-2 rounded border border-white/15 p-2"
        data-previs-interactions
      >
        <p className="text-xs text-cyan-100">双人短打 · 白模角色互动</p>
        {studio.spec.actors.some(actor => actor.riggedModel) && (
          <p className="text-xs text-amber-100">
            已绑定角色暂不参与双人短打，请使用角色动作与表演。既有互动保留，可移除或改选未绑定的人体白模。
          </p>
        )}
        {(studio.spec.interactions ?? []).map((event, index) => {
          const patch = (value: Partial<typeof event>) =>
            edit({
              ...studio.spec,
              interactions: studio.spec.interactions!.map((item, i) =>
                i === index ? { ...item, ...value } : item
              ),
            });
          return (
            <div key={event.id} className="flex flex-wrap items-center gap-2">
              {(["actorId", "targetActorId"] as const).map(key => (
                <label key={key} className="text-xs text-white/70">
                  {key === "actorId" ? "出手者" : "受方"}
                  <select
                    className={field}
                    aria-label={`互动${index + 1}${key === "actorId" ? "出手者" : "受方"}`}
                    value={event[key]}
                    disabled={disabled || Boolean(pendingId)}
                    onChange={e => {
                      const chosen = studio.spec.actors.find(
                        actor => actor.id === e.target.value
                      );
                      if (chosen?.shape === "human" && !chosen.riggedModel)
                        patch({ [key]: chosen.id });
                    }}
                  >
                    {studio.spec.actors.map(actor => (
                      <option
                        key={actor.id}
                        value={actor.id}
                        disabled={
                          actor.shape !== "human" || Boolean(actor.riggedModel)
                        }
                      >
                        {actor.nameZh}
                        {actor.riggedModel
                          ? "（绑定角色暂不支持短打）"
                          : actor.shape !== "human"
                            ? "（非双人短打角色）"
                            : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <select
                className={field}
                aria-label={`互动${index + 1}反应`}
                value={event.kind}
                disabled={disabled || Boolean(pendingId)}
                onChange={e =>
                  patch({ kind: e.target.value as typeof event.kind })
                }
              >
                <option value="strike_recoil">胸前接触后缩</option>
                <option value="strike_guard">抬手接触格挡</option>
                <option value="sword_guard">
                  持剑交叉格挡（双方需装备练习剑）
                </option>
              </select>
              {numeric(
                "互动开始",
                event.startSec,
                n => patch({ startSec: Math.round(n * 24) / 24 }),
                1 / 24
              )}
              {numeric(
                "接触秒位",
                event.contactSec,
                n => patch({ contactSec: Math.round(n * 24) / 24 }),
                1 / 24
              )}
              {numeric(
                "互动结束",
                event.endSec,
                n => patch({ endSec: Math.round(n * 24) / 24 }),
                1 / 24
              )}
              <button
                className={button}
                disabled={disabled || Boolean(pendingId)}
                onClick={() =>
                  edit({
                    ...studio.spec,
                    interactions: studio.spec.interactions!.filter(
                      (_, i) => i !== index
                    ),
                  })
                }
              >
                移除互动
              </button>
            </div>
          );
        })}
        <button
          className={button}
          disabled={
            disabled ||
            Boolean(pendingId) ||
            (studio.spec.interactions?.length ?? 0) >= 24 ||
            studio.spec.actors.filter(
              a => a.shape === "human" && !a.riggedModel
            ).length < 2
          }
          onClick={() => {
            const [actor, target] = studio.spec.actors.filter(
              a => a.shape === "human" && !a.riggedModel
            );
            if (!actor || !target) return;
            edit({
              ...studio.spec,
              interactions: [
                ...(studio.spec.interactions ?? []),
                {
                  id: crypto.randomUUID(),
                  kind: "strike_recoil",
                  actorId: actor.id,
                  targetActorId: target.id,
                  startSec: 0,
                  contactSec: Math.round(studio.spec.durationSec * 12) / 24,
                  endSec: studio.spec.durationSec,
                },
              ],
            });
          }}
        >
          添加双人互动
        </button>
        <p className="text-xs text-white/60">
          请人工审阅双方距离和朝向。持剑格挡须双方选择右手练习剑，结束后回到准备姿态；剑体仅用于动作预演。不可达接触会明确失败，同一时段不能叠加独立动作。
        </p>
      </section>
      </details>
      <details>
        <summary className="text-xs text-cyan-100">
          专业调度 · 相机与切镜
        </summary>
        <div className="space-y-2 pt-2">
          {studio.spec.cameras.map((camera, i) => {
            const patch = (value: Partial<typeof camera>) =>
              edit({
                ...studio.spec,
                cameras: studio.spec.cameras.map((c, j) =>
                  j === i ? { ...c, ...value } : c
                ),
              });
            return (
              <div
                key={i}
                className="flex flex-wrap gap-2 border border-white/15 p-2"
              >
                {numeric("镜头开始", camera.startSec, n =>
                  patch({ startSec: n })
                )}
                {numeric("镜头结束", camera.endSec, n => patch({ endSec: n }))}
                {numeric("焦距", camera.lens, n => patch({ lens: n }), 1)}
                {(["position", "target"] as const).flatMap(key =>
                  [0, 1, 2].map(axis =>
                    numeric(
                      `${key === "position" ? "相机" : "看向"}${"XYZ"[axis]}`,
                      camera[key][axis],
                      n => {
                        const p = [...camera[key]] as [number, number, number];
                        p[axis] = n;
                        patch({ [key]: p });
                      }
                    )
                  )
                )}
                <button
                  className={button}
                  disabled={
                    disabled ||
                    Boolean(pendingId) ||
                    studio.spec.cameras.length === 1
                  }
                  onClick={() =>
                    edit({
                      ...studio.spec,
                      cameras: studio.spec.cameras.filter((_, j) => j !== i),
                    })
                  }
                >
                  移除机位
                </button>
              </div>
            );
          })}
          <button
            className={button}
            disabled={
              disabled || Boolean(pendingId) || studio.spec.cameras.length >= 8
            }
            onClick={() => {
              const last = studio.spec.cameras.at(-1)!;
              const mid = (last.startSec + last.endSec) / 2;
              edit({
                ...studio.spec,
                cameras: [
                  ...studio.spec.cameras.slice(0, -1),
                  { ...last, endSec: mid },
                  { ...last, startSec: mid },
                ],
              });
            }}
          >
            拆分最后一个机位
          </button>
        </div>
      </details>
      <div className="flex flex-wrap gap-2">
        <button
          className={button}
          disabled={disabled || busy}
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
        <span role="status" className="text-xs text-white/65">
          {status}
        </span>
      </div>
      {pendingId && (
        <p className="text-xs text-white/50">
          请求编号：{pendingId}。配置已锁定，任务结束后可修改。
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-amber-200">
          {error}
        </p>
      )}
      {preview && (
        <div>
          <video controls src={preview.url} className="max-h-80 w-full" />
          <p className="text-xs text-amber-100">
            {preview.report?.warnings?.join("；") ||
              "请检查动作节拍、遮挡和接触；技术检查不等于表演质量通过。"}
          </p>
        </div>
      )}
      {studio.history.map(take => (
        <div
          key={take.jobId}
          className="flex flex-wrap items-center gap-2 text-xs text-white/70"
        >
          <span>
            {take.durationSec} 秒 · {take.createdAt.slice(0, 19)}
            {studio.selectedJobId === take.jobId ? " · 当前采用" : ""}
            {previsSpecKey(take.spec) !== previsSpecKey(studio.spec)
              ? " · 较早配置"
              : ""}
          </span>
          <button
            className={button}
            onClick={async () => {
              try {
                const response = await services.get(take.requestId);
                if (response && isCurrent(studio.scopeId, block.id))
                  consume(response);
              } catch {
                if (isCurrent(studio.scopeId, block.id))
                  setError("预览续签失败，请稍后查询原任务");
              }
            }}
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
          {preview?.requestId === take.requestId &&
            preview.layerBundle?.url?.startsWith("https://") && (
              <a
                className={button}
                href={preview.layerBundle.url}
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
    </section>
  );
}
