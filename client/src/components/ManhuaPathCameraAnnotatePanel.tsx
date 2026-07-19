/**
 * 自研静帧红/蓝双轨标注：默认拖拽画流畅笔迹，抽稀锚点供编译。
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
  upsertStroke,
  type ManhuaPathAnchor,
  type ManhuaPathAnnotation,
  type ManhuaPathStroke,
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

function polyPoints(pts: Array<{ x: number; y: number }>) {
  return pts.map((a) => `${a.x * 100},${a.y * 100}`).join(" ");
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
  const strokes = value?.strokes || [];
  const activeActionId = actionRecipeId || value?.actionRecipeId || "";

  const motionPreview = useMemo(() => {
    if (!value || anchors.length < PATH_ANNOTATE_ANCHOR_MIN) return "";
    return compilePathAnnotationToMotionPrompt(value);
  }, [value, anchors.length]);

  const brief = useMemo(() => (value ? formatPathAnnotationBrief(value) : ""), [value]);

  const commitAnnotation = useCallback(
    (next: {
      anchors: ManhuaPathAnchor[];
      strokes?: ManhuaPathStroke[];
      recipeId?: string | null;
      actionRecipeId?: string | null;
    }) => {
      const renumbered = next.anchors.slice(0, PATH_ANNOTATE_ANCHOR_MAX).map((a, i) => ({
        ...a,
        index: i + 1,
      }));
      if (!renumbered.length && !(next.strokes || []).length) {
        onChange(null);
        return;
      }
      onChange({
        version: 1,
        imageUrl,
        recipeId:
          next.recipeId !== undefined ? next.recipeId : recipeId || value?.recipeId || null,
        actionRecipeId:
          next.actionRecipeId !== undefined
            ? next.actionRecipeId
            : activeActionId || value?.actionRecipeId || null,
        anchors: renumbered.length
          ? renumbered
          : [
              emptyAnchor(1, 0.3, 0.7, "subject"),
              emptyAnchor(2, 0.5, 0.5, "subject"),
              emptyAnchor(3, 0.7, 0.3, "camera"),
            ],
        strokes: next.strokes,
      });
    },
    [activeActionId, imageUrl, onChange, recipeId, value?.actionRecipeId, value?.recipeId],
  );

  const applyRecipe = useCallback(
    (id: string) => {
      onRecipeIdChange?.(id);
      if (!id) {
        if (value?.anchors?.length) {
          commitAnnotation({
            anchors: value.anchors,
            strokes: value.strokes,
            recipeId: null,
          });
        } else onChange(null);
        return;
      }
      const ann = annotationFromRecipeId(id, { imageUrl });
      if (ann) {
        onChange({
          ...ann,
          actionRecipeId: activeActionId || null,
          strokes: undefined,
        });
        setSelectedIndex(1);
      }
    },
    [activeActionId, commitAnnotation, imageUrl, onChange, onRecipeIdChange, value],
  );

  const applyActionRecipe = useCallback(
    (id: string) => {
      onActionRecipeIdChange?.(id);
      if (value?.anchors?.length) {
        commitAnnotation({
          anchors: value.anchors,
          strokes: value.strokes,
          actionRecipeId: id || null,
        });
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
    [commitAnnotation, imageUrl, onActionRecipeIdChange, onChange, recipeId, value],
  );

  const finishStroke = useCallback(() => {
    const pts = strokeRef.current;
    drawingRef.current = false;
    strokeRef.current = [];
    setStrokePreview([]);
    if (pts.length < 2) return;
    const otherCount = anchors.filter((a) => (a.trackRole || "subject") !== paintRole).length;
    const room = Math.max(2, PATH_ANNOTATE_ANCHOR_MAX - otherCount);
    const sampled = downsampleStrokeToAnchors(pts, paintRole, {
      maxPoints: Math.min(5, room),
      minDist: 0.03,
    });
    if (!sampled.length) return;
    const mergedAnchors = mergeTrackAnchors(anchors, sampled, paintRole);
    const nextStrokes = upsertStroke(strokes, paintRole, pts);
    commitAnnotation({ anchors: mergedAnchors, strokes: nextStrokes });
    const firstOfRole = mergedAnchors.find((a) => (a.trackRole || "subject") === paintRole);
    if (firstOfRole) setSelectedIndex(firstOfRole.index);
  }, [anchors, commitAnnotation, paintRole, strokes]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || !imageUrl) return;
    const el = surfaceRef.current;
    if (!el) return;
    const p = clientToNorm(el, e.clientX, e.clientY);
    if (!p) return;

    if (inputMode === "tap") {
      if (anchors.length >= PATH_ANNOTATE_ANCHOR_MAX) return;
      const next = [...anchors, emptyAnchor(anchors.length + 1, p.x, p.y, paintRole)];
      commitAnnotation({ anchors: next, strokes });
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
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 0.006) return;
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
    commitAnnotation({
      anchors: anchors.map((a) => (a.index === selected.index ? { ...a, ...patch } : a)),
      strokes,
    });
  };

  const clearTrack = (role: ManhuaPathTrackRole) => {
    const nextAnchors = anchors.filter((a) => (a.trackRole || "subject") !== role);
    const nextStrokes = strokes.filter((s) => s.trackRole !== role);
    if (!nextAnchors.length && !nextStrokes.length) {
      onChange(null);
      return;
    }
    commitAnnotation({ anchors: nextAnchors, strokes: nextStrokes });
  };

  const strokeColor = paintRole === "camera" ? "rgba(56,189,248,0.95)" : "rgba(251,113,133,0.95)";

  const displayPolylines = (["subject", "camera"] as const).map((role) => {
    const stroke = strokes.find((s) => s.trackRole === role);
    if (stroke && stroke.points.length >= 2) return { role, pts: stroke.points, dense: true };
    const pts = anchors.filter((a) => (a.trackRole || "subject") === role);
    if (pts.length >= 2) return { role, pts, dense: false };
    return null;
  });

  return (
    <div className="space-y-2 rounded-lg border border-cyan-400/25 bg-cyan-500/[0.06] p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-[11px] font-medium text-cyan-100/90">运镜工作台 · 红蓝双轨</label>
        <div className="flex flex-wrap gap-1.5">
          <select
            value={recipeId || value?.recipeId || ""}
            disabled={disabled}
            onChange={(e) => applyRecipe(e.target.value)}
            className="max-w-[10.5rem] rounded-md border border-cyan-400/30 bg-black/50 px-2 py-1 text-[11px] text-white/90 outline-none disabled:opacity-50"
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
            className="max-w-[10.5rem] rounded-md border border-rose-400/35 bg-black/50 px-2 py-1 text-[11px] text-white/90 outline-none disabled:opacity-50"
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

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setPaintRole("subject")}
          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
            paintRole === "subject"
              ? "border-rose-300/80 bg-rose-500/30 text-rose-50"
              : "border-white/10 text-white/50"
          }`}
        >
          红轨·人物
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setPaintRole("camera")}
          className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
            paintRole === "camera"
              ? "border-sky-300/80 bg-sky-500/30 text-sky-50"
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
              ? "border-emerald-300/70 bg-emerald-500/25 text-emerald-50"
              : "border-white/10 text-white/45"
          }`}
        >
          画线
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setInputMode("tap")}
          className={`rounded border px-2 py-0.5 text-[10px] ${
            inputMode === "tap"
              ? "border-white/35 bg-white/10 text-white/80"
              : "border-white/10 text-white/40"
          }`}
        >
          加点
        </button>
        <button
          type="button"
          disabled={disabled || (!strokes.some((s) => s.trackRole === paintRole) && !anchors.some((a) => (a.trackRole || "subject") === paintRole))}
          onClick={() => clearTrack(paintRole)}
          className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-white/45 hover:text-white/80 disabled:opacity-30"
        >
          清当前轨
        </button>
      </div>

      <p className="text-[10px] leading-snug text-white/45">
        {inputMode === "draw"
          ? "按住拖出流畅轨迹；松手保留笔迹，并抽稀为编译锚点（替换当前轨）。"
          : `点击加点（合计 ${PATH_ANNOTATE_ANCHOR_MIN}–${PATH_ANNOTATE_ANCHOR_MAX}）。`}{" "}
        成片不显示轨迹线。
      </p>

      <div
        ref={surfaceRef}
        role="presentation"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`relative mx-auto aspect-[9/16] max-h-80 w-full max-w-[14rem] touch-none overflow-hidden rounded-lg border border-white/20 bg-black/60 shadow-inner ${
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
          <div className="flex h-full items-center justify-center px-3 text-center text-[10px] leading-relaxed text-white/40">
            生成静帧后，在此拖出红轨（人物）与蓝轨（镜头）
          </div>
        )}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {displayPolylines.map((line) => {
            if (!line) return null;
            return (
              <polyline
                key={line.role}
                fill="none"
                stroke={line.role === "camera" ? "rgba(56,189,248,0.92)" : "rgba(251,113,133,0.92)"}
                strokeWidth={line.dense ? 2.2 : 1.4}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.95}
                points={polyPoints(line.pts)}
              />
            );
          })}
          {strokePreview.length >= 2 ? (
            <polyline
              fill="none"
              stroke={strokeColor}
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={polyPoints(strokePreview)}
            />
          ) : null}
          {anchors.map((a) => {
            const isCam = a.trackRole === "camera";
            return (
              <g key={a.index}>
                <circle
                  cx={a.x * 100}
                  cy={a.y * 100}
                  r={a.index === selectedIndex ? 2.8 : 2.1}
                  fill={isCam ? "#38bdf8" : "#fb7185"}
                  stroke="#0f172a"
                  strokeWidth="0.5"
                  opacity={0.85}
                />
              </g>
            );
          })}
        </svg>
      </div>

      {selected && inputMode === "tap" ? (
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
                : "border-white/10 bg-black/30 text-white/55"
            }`}
          >
            {a.index}.{a.trackRole === "camera" ? "蓝" : "红"}
          </button>
        ))}
        {value ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
            className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/45 hover:text-white/80"
          >
            清空
          </button>
        ) : null}
      </div>

      {brief ? (
        <pre className="max-h-16 overflow-auto whitespace-pre-wrap rounded border border-white/8 bg-black/40 p-1.5 text-[9px] text-white/40">
          {brief}
        </pre>
      ) : null}
      {motionPreview ? (
        <pre className="max-h-20 overflow-auto whitespace-pre-wrap rounded border border-cyan-400/20 bg-black/50 p-1.5 text-[9px] leading-snug text-cyan-50/80">
          {motionPreview}
        </pre>
      ) : (
        <p className="text-[10px] text-white/30">
          画满至少一轨流畅线（合计 ≥{PATH_ANNOTATE_ANCHOR_MIN} 锚点）后生成运镜句。
        </p>
      )}
    </div>
  );
}
