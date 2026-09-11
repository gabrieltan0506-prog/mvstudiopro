import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { CanvasBlock } from "@/lib/canvasTypes";
import type { ManhuaSegmentReferenceEntry } from "@shared/manhuaSegmentReference";
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

type Result = {
  gcsUri: string;
  url: string;
  durationSec: number;
  clipId: string;
  requestId: string;
  spec: ManhuaPrevisSpec;
  report?: { warnings?: string[] };
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
  characters: Array<{ id: string; label: string }>;
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
}: Props & { services: PrevisServices }) {
  const [initial] = useState(
    () => block.previsStudio ?? createManhuaPrevisStudio()
  );
  const studio = block.previsStudio ?? initial;
  const latest = useRef({ studio, onChange, services, disabled, block });
  latest.current = { studio, onChange, services, disabled, block };
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
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
    if (!disabled && !pendingId && !lock.current) publish({ ...studio, spec });
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
            result.clipId !== block.id
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
      actors: studio.spec.actors.map((a, i) =>
        i === index ? { ...a, ...patch } : a
      ),
    });
  function adopt(take: Studio["history"][number]) {
    if (disabled || pendingId || busy) return;
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
            <select
              aria-label={`角色${index + 1}形体`}
              className={field}
              disabled={disabled || Boolean(pendingId)}
              value={actor.shape}
              onChange={e =>
                actorEdit(index, {
                  shape: e.target.value as "human" | "horse",
                  actions: [],
                })
              }
            >
              <option value="human">人体关节</option>
              <option value="horse">四足白模</option>
            </select>
            {numeric(
              "朝向角度",
              actor.facingDeg,
              n => actorEdit(index, { facingDeg: n }),
              5
            )}
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
          <div className="flex flex-wrap gap-2">
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
          disabled || Boolean(pendingId) || studio.spec.actors.length >= 6
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
      <details>
        <summary className="text-xs text-cyan-100">
          机位与切镜（世界坐标）
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
