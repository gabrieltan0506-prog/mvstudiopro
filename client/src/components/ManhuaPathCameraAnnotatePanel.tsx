/**
 * 自研静帧路径运镜标注：拖拽画线 / 点击加点，红蓝双轨，导出 JSON / 运镜句。
 * 交互自研，不仿制第三方工具栏。
 */
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  PATH_ANNOTATE_ANCHOR_MAX,
  PATH_ANNOTATE_ANCHOR_MIN,
  annotationFromRecipeId,
  compilePathAnnotationToMotionPrompt,
  downsampleStrokeToAnchors,
  formatPathAnnotationBrief,
  mergeTrackAnchors,
  type ManhuaPathAnchor,
  type ManhuaPathAnnotation,
  type ManhuaPathTrackRole,
} from "@shared/manhuaPathCameraAnnotate";
import {
  listPathCameraRecipes,
  type ManhuaPathCameraRecipe,
} from "@shared/manhuaPathCameraRecipeBank";
import {
  listActionCameraRecipes,
  type ManhuaActionCameraRecipe,
} from "@shared/manhuaActionCameraRecipeBank";

type Props = {
  imageUrl?: string;
  value?: ManhuaPathAnnotation | null;
  recipeId?: string;
  actionRecipeId?: string;
  disabled?: boolean;
  onChange: (ann: ManhuaPathAnnotation | null) => void;
  onRecipeIdChange?: (id: string) => void;
  onActionRecipeIdChange?: (id: string) => void;
};

type InputMode = "draw" | "tap";

function emptyAnchor(
  index: number,
  x: number,
  y: number,
  trackRole: ManhuaPathTrackRole,
): ManhuaPathAnchor {
  return {
    index,
    x,
    y,
    focusZh: `点${index}`,
    cameraEn: "slow motivated camera move along path",
    subjectActionEn: "subtle natural micro-motion",
    durationHintSec: 2,
    trackRole,
  };
}

function clientToNorm(el: HTMLElement, clientX: number, clientY: number) {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
  };
}

export default function ManhuaPathCameraAnnotatePanel({
  imageUrl,
  value,
  recipeId,
  actionRecipeId,
  disabled,
  onChange,
  onRecipeIdChange,
  onActionRecipeIdChange,
}: Props) {
  const recipes = useMemo(() => listPathCameraRecipes(), []);
  const actionRecipes = useMemo(() => listActionCameraRecipes(), []);
  const [selectedIndex, setSelectedIndex] = useState(1);
  const [paintRole, setPaintRole] = useState<ManhuaPathTrackRole>("subject");
  const [inputMode, setInputMode] = useState<InputMode>("draw");
  const [strokePreview, setStrokePreview] = useState<Array<{ x: number; y: number }>>([]);
  const drawingRef = useRef(false);
  const strokeRef = useRef<Array<{ x: number; y: number }>>([]);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const anchors = value?.anchors || [];
  const activeActionId = actionRecipeId || value?.actionRecipeId || "";

  const motionPreview = useMemo(() => {
    if (!value || anchors.length < PATH_ANNOTATE_ANCHOR_MIN) return "";
    return compilePathAnnotationToMotionPrompt(value);
  }, [value, anchors.length]);

  const brief = useMemo(() => (value ? formatPathAnnotationBrief(value) : ""), [value]);

  const commit = useCallback(
    (
      nextAnchors: ManhuaPathAnchor[],
      patch?: Partial<Pick<ManhuaPathAnnotation, "recipeId" | "actionRecipeId">>,
    ) => {
      const renumbered = nextAnchors.slice(0, PATH_ANNOTATE_ANCHOR_MAX).map((a, i) => ({
        ...a,
        index: i + 1,
      }));
      if (!renumbered.length) {
        onChange(null);
        return;
      }
      onChange({
        version: 1,
        imageUrl,
        recipeId: patch?.recipeId !== undefined ? patch.recipeId : recipeId || value?.recipeId || null,
        actionRecipeId:
          patch?.actionRecipeId !== undefined
            ? patch.actionRecipeId
            : activeActionId || value?.actionRecipeId || null,
        anchors: renumbered,
      });
    },
    [activeActionId, imageUrl, onChange, recipeId, value?.actionRecipeId, value?.recipeId],
  );

  const applyRecipe = useCallback(
    (id: string) => {
      onRecipeIdChange?.(id);
      if (!id) {
        if (value?.anchors?.length) commit(value.anchors, { recipeId: null });
        else onChange(null);
        return;
      }
      const ann = annotationFromRecipeId(id, { imageUrl });
      if (ann) {
        onChange({
          ...ann,
          actionRecipeId: activeActionId || null,
        });
        setSelectedIndex(1);
      }
    },
    [activeActionId, commit, imageUrl, onChange, onRecipeIdChange, value?.anchors],
  );

  const applyActionRecipe = useCallback(
    (id: string) => {
      onActionRecipeIdChange?.(id);
      if (value?.anchors?.length) {
        commit(value.anchors, { actionRecipeId: id || null });
      } else if (id) {
        onChange({
          version: 1,
          imageUrl,
          recipeId: recipeId || null,
          actionRecipeId: id,
          anchors: [
            emptyAnchor(1, 0.3, 0.75, "subject"),
            emptyAnchor(2, 0.5, 0.5, "subject"),
            emptyAnchor(3, 0.7, 0.3, "camera"),
          ],
        });
        setSelectedIndex(1);
      }
    },
    [commit, imageUrl, onActionRecipeIdChange, onChange, recipeId, value?.anchors],
  );

  const finishStroke = useCallback(() => {
    const pts = strokeRef.current;
    drawingRef.current = false;
    strokeRef.current = [];
    setStrokePreview([]);
    if (pts.length < 2) return;
    const otherCount = anchors.filter((a) => (a.trackRole || "subject") !== paintRole).length;
    const room = Math.max(PATH_ANNOTATE_ANCHOR_MIN, PATH_ANNOTATE_ANCHOR_MAX - otherCount);
    const sampled = downsampleStrokeToAnchors(pts, paintRole, { maxPoints: Math.min(5, room) });
    if (!sampled.length) return;
    const merged = mergeTrackAnchors(anchors, sampled, paintRole);
    commit(merged);
    const firstOfRole = merged.find((a) => (a.trackRole || "subject") === paintRole);
    if (firstOfRole) setSelectedIndex(firstOfRole.index);
  }, [anchors, commit, paintRole]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || !imageUrl) return;
    const el = surfaceRef.current;
    if (!el) return;
    const p = clientToNorm(el, e.clientX, e.clientY);
    if (!p) return;

    if (inputMode === "tap") {
      if (anchors.length >= PATH_ANNOTATE_ANCHOR_MAX) return;
      const next = [...anchors, emptyAnchor(anchors.length + 1, p.x, p.y, paintRole)];
      commit(next);
      setSelectedIndex(next.length);
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    strokeRef.current = [p];
    setStrokePreview([p]);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawingRef.current || inputMode !== "draw") return;
    const el = surfaceRef.current;
    if (!el) return;
    const p = clientToNorm(el, e.clientX, e.clientY);
    if (!p) return;
    const prev = strokeRef.current[strokeRef.current.length - 1];
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 0.008) return;
    strokeRef.current = [...strokeRef.current, p];
    setStrokePreview(strokeRef.current);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawingRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    finishStroke();
  };

  const selected = anchors.find((a) => a.index === selectedIndex) || anchors[anchors.length - 1];

  const patchSelected = (patch: Partial<ManhuaPathAnchor>) => {
    if (!selected) return;
    commit(anchors.map((a) => (a.index === selected.index ? { ...a, ...patch } : a)));
  };

  const strokeColor = paintRole === "camera" ? "rgba(56,189,248,0.95)" : "rgba(251,113,133,0.95)";

  return (
    <div className="space-y-2 rounded-lg border border-cyan-400/25 bg-cyan-500/[0.06] p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-[11px] text-cyan-100/80">路径运镜标注（静帧）</label>
        <div className="flex flex-wrap gap-1.5">
          <select
            value={recipeId || value?.recipeId || ""}
            disabled={disabled}
            onChange={(e) => applyRecipe(e.target.value)}
            className="max-w-[11rem] rounded-md border border-cyan-400/30 bg-black/50 px-2 py-1 text-[11px] text-white/90 outline-none disabled:opacity-50"
          >
            <option value="">路径配方</option>
            {recipes.map((r: ManhuaPathCameraRecipe) => (
              <option key={r.id} value={r.id}>
                {String(r.no).padStart(2, "0")} {r.nameZh}
              </option>
            ))}
          </select>
          <select
            value={activeActionId}
            disabled={disabled}
            onChange={(e) => applyActionRecipe(e.target.value)}
            className="max-w-[11rem] rounded-md border border-rose-400/35 bg-black/50 px-2 py-1 text-[11px] text-white/90 outline-none disabled:opacity-50"
          >
            <option value="">动作配方</option>
            {actionRecipes.map((r: ManhuaActionCameraRecipe) => (
              <option key={r.id} value={r.id}>
                {String(r.no).padStart(2, "0")} {r.nameZh}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setPaintRole("subject")}
          className={`rounded border px-2 py-0.5 text-[10px] ${
            paintRole === "subject"
              ? "border-rose-300/70 bg-rose-500/25 text-rose-50"
              : "border-white/10 text-white/50"
          }`}
        >
          红轨·人物
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setPaintRole("camera")}
          className={`rounded border px-2 py-0.5 text-[10px] ${
            paintRole === "camera"
              ? "border-sky-300/70 bg-sky-500/25 text-sky-50"
              : "border-white/10 text-white/50"
          }`}
        >
          蓝轨·镜头
        </button>
        <span className="mx-0.5 h-4 w-px self-center bg-white/15" />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setInputMode("draw")}
          className={`rounded border px-2 py-0.5 text-[10px] ${
            inputMode === "draw"
              ? "border-emerald-300/60 bg-emerald-500/20 text-emerald-50"
              : "border-white/10 text-white/50"
          }`}
        >
          拖拽画线
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setInputMode("tap")}
          className={`rounded border px-2 py-0.5 text-[10px] ${
            inputMode === "tap"
              ? "border-emerald-300/60 bg-emerald-500/20 text-emerald-50"
              : "border-white/10 text-white/50"
          }`}
        >
          点击加点
        </button>
      </div>

      <p className="text-[10px] leading-snug text-white/40">
        {inputMode === "draw"
          ? "按住拖拽画当前轨；松手后自动抽稀为锚点并替换该轨（另一轨保留）。"
          : `点击添加锚点（${PATH_ANNOTATE_ANCHOR_MIN}–${PATH_ANNOTATE_ANCHOR_MAX}）。`}{" "}
        红=人物，蓝=镜头；成片不显示轨迹。
      </p>

      <div
        ref={surfaceRef}
        role="presentation"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`relative mx-auto aspect-[9/16] max-h-72 w-full max-w-[12rem] touch-none overflow-hidden rounded-md border border-white/15 bg-black/60 ${
          disabled || !imageUrl
            ? "cursor-not-allowed opacity-60"
            : inputMode === "draw"
              ? "cursor-crosshair"
              : "cursor-cell"
        }`}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover select-none"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-2 text-center text-[10px] text-white/35">
            生成静帧后可在此画红/蓝轨迹
          </div>
        )}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {(["subject", "camera"] as const).map((role) => {
            const pts = anchors.filter((a) => (a.trackRole || "subject") === role);
            if (pts.length < 2) return null;
            return (
              <polyline
                key={role}
                fill="none"
                stroke={role === "camera" ? "rgba(56,189,248,0.9)" : "rgba(251,113,133,0.9)"}
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={pts.map((a) => `${a.x * 100},${a.y * 100}`).join(" ")}
              />
            );
          })}
          {strokePreview.length >= 2 ? (
            <polyline
              fill="none"
              stroke={strokeColor}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="2 1.5"
              points={strokePreview.map((a) => `${a.x * 100},${a.y * 100}`).join(" ")}
            />
          ) : null}
          {anchors.map((a) => {
            const isCam = a.trackRole === "camera";
            return (
              <g key={a.index}>
                <circle
                  cx={a.x * 100}
                  cy={a.y * 100}
                  r={a.index === selectedIndex ? 3.2 : 2.4}
                  fill={isCam ? "#38bdf8" : "#fb7185"}
                  stroke="#0f172a"
                  strokeWidth="0.6"
                />
                <text x={a.x * 100} y={a.y * 100 - 4} textAnchor="middle" fontSize="4" fill="#ecfeff">
                  {a.index}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {selected ? (
        <div className="grid gap-1.5 sm:grid-cols-2">
          <label className="text-[10px] text-white/45">
            轨色
            <select
              value={selected.trackRole || "subject"}
              disabled={disabled}
              onChange={(e) => patchSelected({ trackRole: e.target.value as ManhuaPathTrackRole })}
              className="mt-0.5 w-full rounded border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] text-white/90"
            >
              <option value="subject">红·人物</option>
              <option value="camera">蓝·镜头</option>
            </select>
          </label>
          <label className="text-[10px] text-white/45">
            焦点
            <input
              value={selected.focusZh}
              disabled={disabled}
              onChange={(e) => patchSelected({ focusZh: e.target.value })}
              className="mt-0.5 w-full rounded border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] text-white/90"
            />
          </label>
          <label className="text-[10px] text-white/45 sm:col-span-2">
            镜头（英文短句）
            <input
              value={selected.cameraEn}
              disabled={disabled}
              onChange={(e) => patchSelected({ cameraEn: e.target.value })}
              className="mt-0.5 w-full rounded border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] text-white/90"
            />
          </label>
          <label className="text-[10px] text-white/45 sm:col-span-2">
            主体微动（英文短句）
            <input
              value={selected.subjectActionEn}
              disabled={disabled}
              onChange={(e) => patchSelected({ subjectActionEn: e.target.value })}
              className="mt-0.5 w-full rounded border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] text-white/90"
            />
          </label>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {anchors.map((a) => (
          <button
            key={a.index}
            type="button"
            disabled={disabled}
            onClick={() => setSelectedIndex(a.index)}
            className={`rounded border px-1.5 py-0.5 text-[10px] ${
              a.index === selectedIndex
                ? "border-cyan-300/60 bg-cyan-500/20 text-cyan-50"
                : "border-white/10 bg-black/30 text-white/60"
            }`}
          >
            {a.index}.{a.trackRole === "camera" ? "蓝" : "红"}·{a.focusZh}
          </button>
        ))}
        {anchors.length ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => commit(anchors.slice(0, -1))}
            className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/50 hover:text-white/80"
          >
            撤销末点
          </button>
        ) : null}
        {value ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
            className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/50 hover:text-white/80"
          >
            清空
          </button>
        ) : null}
      </div>

      {brief ? (
        <pre className="max-h-20 overflow-auto whitespace-pre-wrap rounded border border-white/8 bg-black/40 p-1.5 text-[9px] text-white/45">
          {brief}
        </pre>
      ) : null}
      {motionPreview ? (
        <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded border border-cyan-400/20 bg-black/50 p-1.5 text-[9px] leading-snug text-cyan-50/80">
          {motionPreview}
        </pre>
      ) : (
        <p className="text-[10px] text-white/30">
          至少 {PATH_ANNOTATE_ANCHOR_MIN} 个锚点后生成运镜句（可先画红轨再画蓝轨）。
        </p>
      )}
    </div>
  );
}
