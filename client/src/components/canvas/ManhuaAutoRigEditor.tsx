import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  AUTO_RIG_BONES,
  AUTO_RIG_JOINTS,
  AUTO_RIG_LABELS,
  autoRigRequestSchema,
  type AutoRigAdoptedModel,
  type AutoRigInspection,
  type AutoRigJoint,
  type AutoRigJoints,
  type AutoRigRequest,
  type AutoRigSettings,
  type AutoRigView,
} from "@shared/manhuaAutoRig";

export type AutoRigServices = {
  submit: (request: AutoRigRequest) => Promise<AutoRigView>;
  get: (requestId: string) => Promise<AutoRigView | null>;
  list: (
    assetRef: string,
    before?: string
  ) => Promise<{ items: AutoRigView[]; nextCursor: string | null }>;
  adopt: (requestId: string, sha256: string) => Promise<AutoRigAdoptedModel>;
  restore: (requestId: string, sha256: string) => Promise<AutoRigAdoptedModel>;
};
type Props = {
  assetRef: string;
  label: string;
  sourceJobId: string;
  sourceVersion: string;
  disabled?: boolean;
  onApply: (
    model: AutoRigAdoptedModel,
    expectedTaskId: string
  ) => boolean | Promise<boolean>;
  onClose: () => void;
};
const field =
  "w-full rounded border border-input bg-background px-2 py-1.5 text-sm";
const button =
  "rounded border border-border bg-secondary px-3 py-1.5 text-sm text-secondary-foreground disabled:opacity-40";
const terminal = (task: AutoRigView) =>
  ["succeeded", "failed", "canceled"].includes(task.status);

/** 与后台正交相机使用完全相同的中心和比例，拖动不依赖图片分辨率。 */

/** 网关质询（HTML 代替 JSON）、断网、上游 502/503/504：任务本身没坏，只是这一轮没问到。 */
const TRANSIENT_TRPC_CODES = new Set(["INTERNAL_SERVER_ERROR", "TIMEOUT", "TOO_MANY_REQUESTS"]);
const TRANSIENT_HTTP_STATUS = new Set([502, 503, 504]);
const HTML_INSTEAD_OF_JSON = /Unexpected token|is not valid JSON|SyntaxError|JSON\.parse|质询|challenge/i;
const NETWORK_DOWN = /Failed to fetch|NetworkError|Load failed|ECONN(?:REFUSED|RESET)|ERR_NETWORK/i;
const TIMED_OUT = /TimeoutError|timed out|AbortError/i;
function trpcErrorData(e: unknown): { code: string; httpStatus: number } {
  const data = (e as { data?: { code?: unknown; httpStatus?: unknown } } | null)?.data;
  return {
    code: typeof data?.code === "string" ? data.code : "",
    httpStatus: typeof data?.httpStatus === "number" ? data.httpStatus : 0,
  };
}
export function isTransientPollError(e: unknown): boolean {
  const { code, httpStatus } = trpcErrorData(e);
  // 服务端明确回了 tRPC 错误码（需登录 / 无权限 / 参数错 / 不存在 …）：真实错误，必须进 error 面板，不按文案猜
  if (code && !TRANSIENT_TRPC_CODES.has(code)) return false;
  if (TRANSIENT_HTTP_STATUS.has(httpStatus)) return true;
  const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return HTML_INSTEAD_OF_JSON.test(message) || NETWORK_DOWN.test(message) || TIMED_OUT.test(message);
}
export function transientPollReasonZh(e: unknown): string {
  const { httpStatus } = trpcErrorData(e);
  const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  if (HTML_INSTEAD_OF_JSON.test(message)) return "网关返回了网页而不是数据";
  if (NETWORK_DOWN.test(message)) return "网络断开";
  if (TRANSIENT_HTTP_STATUS.has(httpStatus)) return `服务端暂时不可用（${httpStatus}）`;
  if (TIMED_OUT.test(message)) return "请求超时";
  return "服务端暂时不可用";
}

export function rigProjection(
  inspection: AutoRigInspection,
  point: [number, number, number],
  view: "front" | "side"
) {
  const [low, high] = inspection.bounds;
  const scale = Math.max(high[2] - low[2], high[1] - low[1]) * 1.2;
  const axis = view === "front" ? 1 : 0;
  return [
    (0.5 + (point[axis] - (low[axis] + high[axis]) / 2) / scale) * 640,
    (0.5 - (point[2] - (low[2] + high[2]) / 2) / scale) * 640,
  ] as const;
}
export function moveRigPoint(
  inspection: AutoRigInspection,
  point: [number, number, number],
  view: "front" | "side",
  x: number,
  y: number
): [number, number, number] {
  const [low, high] = inspection.bounds,
    axis = view === "front" ? 1 : 0;
  const scale = Math.max(high[2] - low[2], high[1] - low[1]) * 1.2;
  const next = [...point] as [number, number, number];
  next[axis] = Math.max(
    low[axis],
    Math.min(high[axis], (x / 640 - 0.5) * scale + (low[axis] + high[axis]) / 2)
  );
  next[2] = Math.max(
    low[2],
    Math.min(high[2], (0.5 - y / 640) * scale + (low[2] + high[2]) / 2)
  );
  return next;
}
function JointView({
  inspection,
  joints,
  view,
  url,
  selected,
  onSelect,
  onChange,
  disabled,
  onLoaded,
  onFailed,
}: {
  inspection: AutoRigInspection;
  joints: AutoRigJoints;
  view: "front" | "side";
  url: string;
  selected: AutoRigJoint;
  onSelect: (key: AutoRigJoint) => void;
  onChange: (key: AutoRigJoint, point: [number, number, number]) => void;
  disabled?: boolean;
  onLoaded: () => void;
  onFailed: () => void;
}) {
  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<AutoRigJoint | null>(null);
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1 text-sm font-medium">
        {view === "front" ? "正面 · 调整左右与高低" : "侧面 · 调整前后与高低"}
      </figcaption>
      <div className="relative aspect-square overflow-hidden rounded-lg bg-black">
        <img
          src={url}
          alt={view === "front" ? "当前模型正面" : "当前模型侧面"}
          className="absolute inset-0 h-full w-full"
          onLoad={onLoaded}
          onError={onFailed}
        />
        <svg
          ref={svg}
          viewBox="0 0 640 640"
          className="absolute inset-0 h-full w-full touch-none"
          aria-label={view === "front" ? "正面关节校正" : "侧面关节校正"}
          onPointerMove={event => {
            if (!drag.current || disabled || !svg.current) return;
            const box = svg.current.getBoundingClientRect();
            onChange(
              drag.current,
              moveRigPoint(
                inspection,
                joints[drag.current],
                view,
                ((event.clientX - box.left) / box.width) * 640,
                ((event.clientY - box.top) / box.height) * 640
              )
            );
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          {Object.entries(AUTO_RIG_BONES).map(([name, [a, b]]) => {
            const p = rigProjection(inspection, joints[a], view),
              q = rigProjection(inspection, joints[b], view);
            return (
              <line
                key={name}
                x1={p[0]}
                y1={p[1]}
                x2={q[0]}
                y2={q[1]}
                stroke="#43ead1"
                strokeWidth={3}
                pointerEvents="none"
              />
            );
          })}
          {[...AUTO_RIG_JOINTS.filter(key => key !== selected), selected].map(
            key => {
              const [x, y] = rigProjection(inspection, joints[key], view);
              return (
                <g key={key}>
                  <circle
                    cx={x}
                    cy={y}
                    r={key === selected ? 10 : 7}
                    fill={key === selected ? "#ffcb69" : "#43ead1"}
                    stroke="#173c39"
                    strokeWidth={2}
                    role="button"
                    tabIndex={disabled ? -1 : 0}
                    aria-label={`${view === "front" ? "正面" : "侧面"}${AUTO_RIG_LABELS[key]}`}
                    aria-disabled={disabled}
                    onPointerDown={event => {
                      if (disabled) return;
                      event.preventDefault();
                      onSelect(key);
                      drag.current = key;
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onKeyDown={event => {
                      if (
                        disabled ||
                        ![
                          "ArrowLeft",
                          "ArrowRight",
                          "ArrowUp",
                          "ArrowDown",
                        ].includes(event.key)
                      )
                        return;
                      event.preventDefault();
                      onSelect(key);
                      const step = event.shiftKey ? 8 : 2;
                      onChange(
                        key,
                        moveRigPoint(
                          inspection,
                          joints[key],
                          view,
                          x +
                            (event.key === "ArrowLeft"
                              ? -step
                              : event.key === "ArrowRight"
                                ? step
                                : 0),
                          y +
                            (event.key === "ArrowUp"
                              ? -step
                              : event.key === "ArrowDown"
                                ? step
                                : 0)
                        )
                      );
                    }}
                  />
                  {key === selected ? (
                    <text
                      x={x + 14}
                      y={y - 12}
                      fill="#fffaf1"
                      stroke="#172a28"
                      strokeWidth={3}
                      paintOrder="stroke"
                      fontSize={18}
                      pointerEvents="none"
                    >
                      {AUTO_RIG_LABELS[key]}
                    </text>
                  ) : null}
                </g>
              );
            }
          )}
        </svg>
      </div>
    </figure>
  );
}

export function ManhuaAutoRigEditorView({
  assetRef,
  label,
  sourceJobId,
  sourceVersion,
  disabled,
  onApply,
  onClose,
  services,
}: Props & { services: AutoRigServices }) {
  const key = `manhua-auto-rig:${assetRef}:${sourceVersion}`;
  const [settings, setSettings] = useState<AutoRigSettings>({
    pose: "T",
    forwardAxis: "-Y",
    targetHeight: 1.7,
  });
  const [task, setTask] = useState<AutoRigView | null>(null),
    [pending, setPending] = useState<AutoRigRequest | null>(null);
  const [inspectionTask, setInspectionTask] = useState<AutoRigView | null>(
      null
    ),
    [joints, setJoints] = useState<AutoRigJoints | null>(null);
  const [selected, setSelected] = useState<AutoRigJoint>("pelvis");
  const [confirmed, setConfirmed] = useState(false),
    [quality, setQuality] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [history, setHistory] = useState<AutoRigView[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const mounted = useRef(true),
    lock = useRef(false),
    polling = useRef(false),
    latest = useRef({ services, onApply, sourceJobId });
  latest.current = { services, onApply, sourceJobId };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // 异步回执只能更新发起时所属的视图和请求，迟到结果仍保留在历史。
  const activity = useRef(0);
  const pendingRef = useRef<AutoRigRequest | null>(null);
  const taskRef = useRef<AutoRigView | null>(null);
  function track(request: AutoRigRequest | null) {
    pendingRef.current = request;
    setPending(request);
  }
  function show(value: AutoRigView | null) {
    taskRef.current = value;
    setTask(value);
  }
  function clearSaved(requestId: string) {
    try {
      const saved = localStorage.getItem(key);
      if (saved && JSON.parse(saved).requestId === requestId)
        localStorage.removeItem(key);
    } catch {
      /* 服务端历史仍可读取，不能删除无法确认身份的本机记录。 */
    }
  }
  const active =
    busy || Boolean(pending && (!task || !terminal(task))) || disabled;
  const inspection = inspectionTask?.output?.inspection;
  const previousSource = useRef(sourceJobId);
  useEffect(() => {
    if (previousSource.current === sourceJobId) return;
    previousSource.current = sourceJobId;
    setConfirmed(false);
    setQuality(false);
    setInspectionTask(null);
    setJoints(null);
    setNotice("人物模型已更新，请重新检查当前模型；既有候选仍可查看或恢复。");
  }, [sourceJobId]);
  function consume(value: AutoRigView, epoch: number, requestId: string) {
    if (
      !mounted.current ||
      value.params.assetRef !== assetRef ||
      value.params.requestId !== requestId
    )
      return;
    setHistory(items => {
      const previous = items.find(item => item.params.requestId === requestId);
      if (previous && terminal(previous) && !terminal(value)) return items;
      return [
        value,
        ...items.filter(item => item.params.requestId !== requestId),
      ];
    });
    if (
      activity.current !== epoch ||
      (pendingRef.current && pendingRef.current.requestId !== requestId)
    )
      return;
    if (
      taskRef.current?.params.requestId === requestId &&
      terminal(taskRef.current) &&
      !terminal(value)
    )
      return;
    show(value);
    setError(value.error || "");
    if (terminal(value)) {
      if (pendingRef.current?.requestId === requestId) track(null);
      clearSaved(requestId);
    } else {
      track(value.params);
    }
    if (
      value.status === "succeeded" &&
      value.output?.stage === "inspect" &&
      value.output.inspection
    ) {
      setConfirmed(false);
      if (value.params.sourceJobId === latest.current.sourceJobId) {
        setInspectionTask(value);
        setSettings(value.params.settings);
        setJoints(structuredClone(value.output.inspection.joints));
      } else {
        setInspectionTask(null);
        setJoints(null);
        setNotice("这次检查对应此前的模型，请重新检查当前模型；旧回执已保留。");
      }
    }
    if (value.status === "succeeded" && value.output?.stage === "bind") {
      setQuality(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    const epoch = activity.current;
    void (async () => {
      try {
        let request: AutoRigRequest | null = null;
        try {
          const saved = localStorage.getItem(key);
          request = saved
            ? autoRigRequestSchema.parse(JSON.parse(saved))
            : null;
        } catch {
          if (!cancelled)
            setNotice(
              "本机记录无法读取，正在查询服务端历史；不会自动重新提交。"
            );
        }
        if (request && request.assetRef === assetRef) {
          if (activity.current === epoch) track(request);
          const current = await latest.current.services.get(request.requestId);
          if (!cancelled && current) consume(current, epoch, request.requestId);
        }
        const result = await latest.current.services.list(assetRef);
        if (cancelled) return;
        setHistory(old => [
          ...old,
          ...result.items.filter(
            row =>
              !old.some(item => item.params.requestId === row.params.requestId)
          ),
        ]);
        setCursor(result.nextCursor);
        const running = result.items.find(item => !terminal(item));
        if (
          running &&
          activity.current === epoch &&
          !pendingRef.current &&
          taskRef.current?.params.requestId !== running.params.requestId
        ) {
          consume(running, epoch, running.params.requestId);
        }
      } catch (e) {
        if (!cancelled && activity.current === epoch)
          setError(
            e instanceof Error ? e.message : "历史读取失败，未提交新任务"
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, assetRef]);
  /** 连续瞬时失败次数：网关质询 / 断网 / 5xx 不算任务失败，下一轮继续查同一编号。 */
  const pollFailures = useRef(0);
  const POLL_FAILURES_BEFORE_ERROR = 12;
  async function query() {
    const request = pendingRef.current;
    if (!request || polling.current) return;
    const epoch = activity.current;
    polling.current = true;
    try {
      const value = await latest.current.services.get(request.requestId);
      if (pollFailures.current > 0 && mounted.current && activity.current === epoch) {
        setNotice("");
        // 已升级成错误面板的「查询暂时不通」，这一轮问到了就撤掉；consume 若带 value.error 会再写回真实错误
        if (pollFailures.current >= POLL_FAILURES_BEFORE_ERROR) setError("");
      }
      pollFailures.current = 0;
      if (value) consume(value, epoch, request.requestId);
      else if (
        mounted.current &&
        activity.current === epoch &&
        pendingRef.current?.requestId === request.requestId
      )
        setNotice("暂未查到该编号，保持原编号等待确认；没有创建第二个任务。");
    } catch (e) {
      if (
        mounted.current &&
        activity.current === epoch &&
        pendingRef.current?.requestId === request.requestId
      ) {
        // 0916 真跑：密集轮询期间 Vercel 质询回 HTML，旧代码把 Unexpected token '<' 当失败停住，
        // 其实任务仍在服务端跑。瞬时错误只提示、继续查同一编号；连续 12 次（约 1 分钟）才升级成错误，仍不停查。
        if (isTransientPollError(e)) {
          pollFailures.current += 1;
          const zh = `查询暂时不通（第 ${pollFailures.current} 次：${transientPollReasonZh(e)}），5 秒后继续查同一编号；任务仍在服务端运行，未重复提交`;
          if (pollFailures.current >= POLL_FAILURES_BEFORE_ERROR) setError(zh);
          else setNotice(zh);
        } else {
          setError(e instanceof Error ? e.message : "查询暂不可用，未重新提交");
        }
      }
    } finally {
      polling.current = false;
    }
  }
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void query(), 5000);
    return () => clearInterval(timer);
  }, [pending]);
  function terminalResult(requestId: string) {
    return (
      taskRef.current?.params.requestId === requestId &&
      terminal(taskRef.current)
    );
  }
  async function submit(request: AutoRigRequest) {
    if (
      lock.current ||
      disabled ||
      (pendingRef.current && pendingRef.current.requestId !== request.requestId)
    )
      return;
    const epoch = ++activity.current;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const parsed = autoRigRequestSchema.parse(request);
      localStorage.setItem(key, JSON.stringify(parsed));
      track(parsed);
      show(null);
      consume(
        await latest.current.services.submit(parsed),
        epoch,
        parsed.requestId
      );
    } catch (e) {
      if (
        mounted.current &&
        activity.current === epoch &&
        !terminalResult(request.requestId)
      ) {
        const code = (e as { data?: { code?: string } })?.data?.code;
        if (
          code === "BAD_REQUEST" ||
          code === "FORBIDDEN" ||
          code === "UNAUTHORIZED"
        ) {
          if (pendingRef.current?.requestId === request.requestId) track(null);
          clearSaved(request.requestId);
        }
        setError(
          e instanceof Error ? e.message : "提交结果未确认，请查询原编号"
        );
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function useResult(restore = false) {
    if (
      lock.current ||
      active ||
      task?.output?.stage !== "bind" ||
      (!restore && !quality)
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    ++activity.current;
    const expected = latest.current.sourceJobId;
    try {
      const model = await (
        restore
          ? latest.current.services.restore
          : latest.current.services.adopt
      )(task.params.requestId, task.output.sha256);
      if (!mounted.current) return;
      if (!(await latest.current.onApply(model, expected)))
        throw Error("当前人物或模型已变化，结果已保留，请重新核对后采用");
      setNotice(
        restore
          ? "已恢复原模型；带骨候选仍保留在历史。"
          : "已另存并采用带骨模型；原模型可随时恢复。请在动作预演中选择新模型检查。"
      );
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "采用未确认，候选仍保留");
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const images =
    task?.output?.stage === "bind" ? (task.output.previewUrls ?? []) : [];
  const inspectionImages = inspectionTask?.output?.previewUrls ?? [];
  const imagesReady =
    inspectionImages.length === 2 &&
    inspectionImages.every(url => loaded.has(url));
  const bindReady = images.length === 5 && images.every(url => loaded.has(url));
  return (
    <section
      className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-border bg-card p-5 text-foreground shadow-xl"
      aria-label="人体模型绑骨"
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{label} · 人体绑骨</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            检查模型 → 校正关节 → 检查变形 → 另存采用
          </p>
        </div>
        <button className={button} onClick={onClose}>
          关闭
        </button>
      </header>
      <p className="mb-3 text-sm text-muted-foreground">
        仅支持单人、直立 A / T
        姿态、封闭连通的无骨人体。不会生成眼骨或表情，也不会删除原模型。关闭后，已提交任务仍在后台运行。
      </p>
      <fieldset disabled={active} className="grid gap-3 sm:grid-cols-3">
        <label>
          手臂姿态
          <select
            aria-label="绑骨姿态"
            className={field}
            value={settings.pose}
            onChange={e => {
              setSettings(s => ({ ...s, pose: e.target.value as "A" | "T" }));
              setInspectionTask(null);
              setJoints(null);
              setConfirmed(false);
            }}
          >
            <option value="T">T形 · 双臂平举</option>
            <option value="A">A形 · 双臂斜向下展开</option>
          </select>
        </label>
        <label>
          模型正面方向
          <select
            aria-label="模型正面方向"
            className={field}
            value={settings.forwardAxis}
            onChange={e => {
              setSettings(s => ({
                ...s,
                forwardAxis: e.target.value as AutoRigSettings["forwardAxis"],
              }));
              setInspectionTask(null);
              setJoints(null);
              setConfirmed(false);
            }}
          >
            <option value="-Y">默认朝向</option>
            <option value="+X">左转90度</option>
            <option value="+Y">转180度</option>
            <option value="-X">右转90度</option>
          </select>
        </label>
        <label>
          人物身高（米）
          <input
            aria-label="绑骨身高"
            className={field}
            type="number"
            min={0.5}
            max={3}
            step={0.01}
            value={settings.targetHeight}
            onChange={e => {
              setSettings(s => ({
                ...s,
                targetHeight: Number(e.target.value),
              }));
              setInspectionTask(null);
              setJoints(null);
              setConfirmed(false);
            }}
          />
        </label>
      </fieldset>
      <p className="mt-2 text-xs text-muted-foreground">
        方向用于校正模型朝向，检查后应在正面图看到人物正脸；方向不对时更换再检查。
      </p>
      <button
        className={`${button} my-3`}
        disabled={active}
        onClick={() =>
          void submit({
            stage: "inspect",
            requestId: crypto.randomUUID(),
            assetRef,
            sourceJobId,
            settings,
          })
        }
      >
        检查当前模型
      </button>
      {pending ? (
        <div role="status" className="my-3 rounded bg-muted p-3 text-sm">
          <p>
            {task?.status === "queued"
              ? "已排队，等待模型检查资源"
              : task?.status === "running"
                ? "正在检查或求解；检查约几分钟，绑定高面数真模可能需要二三十分钟，以服务端状态为准，无需重复提交"
                : "正在确认原任务回执"}
          </p>
          <button
            className={`${button} mt-2`}
            disabled={busy}
            onClick={() => void query()}
          >
            查询原任务
          </button>
          {!task && !busy ? (
            <button
              className={`${button} ml-2 mt-2`}
              onClick={() => void submit(pending)}
            >
              用原编号确认提交
            </button>
          ) : null}
        </div>
      ) : null}
      {inspection && joints && inspectionImages.length === 2 ? (
        <div className="space-y-3 border-t border-border pt-3">
          <p className="text-sm">
            已检查 {inspection.vertices.toLocaleString()}{" "}
            个顶点。下方点位是比例建议，请逐点对照模型；拖动正面和侧面圆点，或选中圆点后用方向键微调。
          </p>
          <label className="block max-w-xs">
            当前关节
            <select
              aria-label="当前校正关节"
              className={field}
              value={selected}
              onChange={e => setSelected(e.target.value as AutoRigJoint)}
            >
              {AUTO_RIG_JOINTS.map(key => (
                <option key={key} value={key}>
                  {AUTO_RIG_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            {(["front", "side"] as const).map((view, index) => (
              <JointView
                key={`${inspectionTask.params.requestId}:${view}`}
                inspection={inspection}
                joints={joints}
                view={view}
                url={inspectionImages[index]}
                selected={selected}
                onSelect={setSelected}
                disabled={active}
                onFailed={() => {
                  setLoaded(
                    old =>
                      new Set(
                        Array.from(old).filter(
                          url => url !== inspectionImages[index]
                        )
                      )
                  );
                  setConfirmed(false);
                  setError(
                    "检查图片读取失败，请从历史重新打开本次检查；未重新运行模型。"
                  );
                }}
                onLoaded={() =>
                  setLoaded(
                    old =>
                      new Set([...Array.from(old), inspectionImages[index]])
                  )
                }
                onChange={(key, point) => {
                  setJoints(old => (old ? { ...old, [key]: point } : old));
                  setConfirmed(false);
                }}
              />
            ))}
          </div>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={active || !imagesReady}
              onChange={e => setConfirmed(e.target.checked)}
            />
            我已确认这是单人直立 {settings.pose}{" "}
            姿态，并核对正面、侧面全部关节点
          </label>
          <button
            className={button}
            disabled={active || !confirmed || !imagesReady}
            onClick={() =>
              void submit({
                stage: "bind",
                requestId: crypto.randomUUID(),
                assetRef,
                sourceJobId: inspectionTask.params.sourceJobId,
                settings: inspectionTask.params.settings,
                inspectionRequestId: inspectionTask.params.requestId,
                sourceDigest: inspection.sourceDigest,
                joints,
                singleHuman: true,
                landmarksManuallyConfirmed: true,
              })
            }
          >
            按确认的关节生成带骨候选
          </button>
        </div>
      ) : null}
      {images.length === 5 ? (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <h3 className="font-semibold">检查真实变形</h3>
          <p className="text-sm text-muted-foreground">
            数值检查已通过；请看原姿态和四肢弯曲，确认没有严重塌陷、撕裂或外观丢失后再采用。
          </p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {images.map((url, index) => (
              <figure key={url}>
                <img
                  src={url}
                  alt={
                    ["原姿态", "右臂弯曲", "左臂弯曲", "右膝弯曲", "左膝弯曲"][
                      index
                    ]
                  }
                  className="w-full rounded"
                  onError={() => {
                    setLoaded(
                      old =>
                        new Set(Array.from(old).filter(item => item !== url))
                    );
                    setQuality(false);
                    setError(
                      "变形检查图片读取失败，请从历史重新打开这个候选；未重新绑骨。"
                    );
                  }}
                  onLoad={() =>
                    setLoaded(old => new Set([...Array.from(old), url]))
                  }
                />
                <figcaption className="text-center text-xs">
                  {["原姿态", "右臂", "左臂", "右膝", "左膝"][index]}
                </figcaption>
              </figure>
            ))}
          </div>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              disabled={active || !bindReady}
              checked={quality}
              onChange={e => setQuality(e.target.checked)}
            />
            我已查看五张检查图并接受这个候选的变形与外观
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              className={button}
              disabled={active || !quality || !bindReady}
              onClick={() => void useResult()}
            >
              另存并采用带骨模型
            </button>
            <button
              className={button}
              disabled={active}
              onClick={() => void useResult(true)}
            >
              恢复原模型
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mt-3 rounded border border-destructive p-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="mt-3 rounded bg-accent p-3 text-sm text-accent-foreground"
        >
          {notice}
        </p>
      ) : null}
      <details className="mt-4 border-t border-border pt-3">
        <summary>本人物检查与候选历史（{history.length}条已加载）</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {history.map(row => (
            <button
              key={row.jobId}
              className={button}
              disabled={active}
              onClick={async () => {
                if (lock.current || pendingRef.current || disabled) return;
                const epoch = ++activity.current;
                try {
                  const value = await services.get(row.params.requestId);
                  if (value) consume(value, epoch, row.params.requestId);
                } catch (e) {
                  if (mounted.current && activity.current === epoch)
                    setError(e instanceof Error ? e.message : "读取失败");
                }
              }}
            >
              {row.params.stage === "inspect" ? "模型检查" : "绑骨候选"} ·{" "}
              {row.status === "succeeded"
                ? "可查看"
                : row.status === "failed"
                  ? "未通过"
                  : row.status === "canceled"
                    ? "已取消"
                    : "处理中"}
              {row.createdAt
                ? ` · ${new Date(row.createdAt).toLocaleTimeString()}`
                : ""}
            </button>
          ))}
        </div>
        {cursor ? (
          <button
            className={`${button} mt-2`}
            disabled={active}
            onClick={async () => {
              const epoch = activity.current;
              try {
                const page = await services.list(assetRef, cursor);
                if (!mounted.current) return;
                setHistory(old => [
                  ...old,
                  ...page.items.filter(
                    row => !old.some(item => item.jobId === row.jobId)
                  ),
                ]);
                setCursor(page.nextCursor);
              } catch (e) {
                if (mounted.current && activity.current === epoch)
                  setError(e instanceof Error ? e.message : "读取失败");
              }
            }}
          >
            加载更早记录
          </button>
        ) : null}
      </details>
    </section>
  );
}

export default function ManhuaAutoRigEditor(props: Props) {
  const utils = trpc.useUtils();
  const submit = trpc.manhuaAutoRig.submit.useMutation(),
    adopt = trpc.manhuaAutoRig.adopt.useMutation(),
    restore = trpc.manhuaAutoRig.restore.useMutation();
  return (
    <ManhuaAutoRigEditorView
      {...props}
      services={{
        submit: request => submit.mutateAsync(request),
        get: requestId => utils.manhuaAutoRig.get.fetch({ requestId }),
        list: (assetRef, before) =>
          utils.manhuaAutoRig.list.fetch({ assetRef, before }),
        adopt: (requestId, expectedSha256) =>
          adopt.mutateAsync({
            requestId,
            expectedSha256,
            qualityReviewed: true,
          }),
        restore: (requestId, expectedSha256) =>
          restore.mutateAsync({ requestId, expectedSha256 }),
      }}
    />
  );
}
