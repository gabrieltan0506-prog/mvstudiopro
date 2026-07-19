/**
 * 自研静帧路径运镜标注：点击画面加点，编辑阶段文案，导出 JSON / 运镜句。
 * 交互自研，不仿制第三方工具栏。
 */
import { useCallback, useMemo, useState, type MouseEvent } from "react";
import {
  PATH_ANNOTATE_ANCHOR_MAX,
  PATH_ANNOTATE_ANCHOR_MIN,
  annotationFromRecipeId,
  compilePathAnnotationToMotionPrompt,
  formatPathAnnotationBrief,
  type ManhuaPathAnchor,
  type ManhuaPathAnnotation,
} from "@shared/manhuaPathCameraAnnotate";
import {
  listPathCameraRecipes,
  type ManhuaPathCameraRecipe,
} from "@shared/manhuaPathCameraRecipeBank";

type Props = {
  imageUrl?: string;
  value?: ManhuaPathAnnotation | null;
  recipeId?: string;
  disabled?: boolean;
  onChange: (ann: ManhuaPathAnnotation | null) => void;
  onRecipeIdChange?: (id: string) => void;
};

function emptyAnchor(index: number, x: number, y: number): ManhuaPathAnchor {
  return {
    index,
    x,
    y,
    focusZh: `点${index}`,
    cameraEn: "slow motivated camera move along path",
    subjectActionEn: "subtle natural micro-motion",
    durationHintSec: 2,
  };
}

export default function ManhuaPathCameraAnnotatePanel({
  imageUrl,
  value,
  recipeId,
  disabled,
  onChange,
  onRecipeIdChange,
}: Props) {
  const recipes = useMemo(() => listPathCameraRecipes(), []);
  const [selectedIndex, setSelectedIndex] = useState(1);
  const anchors = value?.anchors || [];

  const motionPreview = useMemo(() => {
    if (!value || anchors.length < PATH_ANNOTATE_ANCHOR_MIN) return "";
    return compilePathAnnotationToMotionPrompt(value);
  }, [value, anchors.length]);

  const brief = useMemo(() => (value ? formatPathAnnotationBrief(value) : ""), [value]);

  const applyRecipe = useCallback(
    (id: string) => {
      onRecipeIdChange?.(id);
      if (!id) {
        onChange(null);
        return;
      }
      const ann = annotationFromRecipeId(id, { imageUrl });
      onChange(ann);
      setSelectedIndex(1);
    },
    [imageUrl, onChange, onRecipeIdChange],
  );

  const updateAnchors = useCallback(
    (next: ManhuaPathAnchor[], nextRecipeId?: string | null) => {
      const renumbered = next.slice(0, PATH_ANNOTATE_ANCHOR_MAX).map((a, i) => ({
        ...a,
        index: i + 1,
      }));
      if (renumbered.length < PATH_ANNOTATE_ANCHOR_MIN) {
        onChange(
          renumbered.length
            ? {
                version: 1,
                imageUrl,
                recipeId: nextRecipeId ?? recipeId ?? null,
                anchors: renumbered,
              }
            : null,
        );
        return;
      }
      onChange({
        version: 1,
        imageUrl,
        recipeId: nextRecipeId ?? recipeId ?? null,
        anchors: renumbered,
      });
    },
    [imageUrl, onChange, recipeId],
  );

  const onCanvasClick = (e: MouseEvent<HTMLDivElement>) => {
    if (disabled || !imageUrl) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (anchors.length >= PATH_ANNOTATE_ANCHOR_MAX) return;
    const next = [...anchors, emptyAnchor(anchors.length + 1, x, y)];
    updateAnchors(next, null);
    setSelectedIndex(next.length);
  };

  const selected = anchors.find((a) => a.index === selectedIndex) || anchors[anchors.length - 1];

  const patchSelected = (patch: Partial<ManhuaPathAnchor>) => {
    if (!selected) return;
    updateAnchors(
      anchors.map((a) => (a.index === selected.index ? { ...a, ...patch } : a)),
      value?.recipeId ?? recipeId ?? null,
    );
  };

  return (
    <div className="space-y-2 rounded-lg border border-cyan-400/25 bg-cyan-500/[0.06] p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-[11px] text-cyan-100/80">路径运镜标注（静帧）</label>
        <select
          value={recipeId || value?.recipeId || ""}
          disabled={disabled}
          onChange={(e) => applyRecipe(e.target.value)}
          className="max-w-[14rem] rounded-md border border-cyan-400/30 bg-black/50 px-2 py-1 text-[11px] text-white/90 outline-none disabled:opacity-50"
        >
          <option value="">自定义锚点 / 不套配方</option>
          {recipes.map((r: ManhuaPathCameraRecipe) => (
            <option key={r.id} value={r.id}>
              {String(r.no).padStart(2, "0")} {r.nameZh}
            </option>
          ))}
        </select>
      </div>

      <p className="text-[10px] leading-snug text-white/40">
        点击画面添加锚点（{PATH_ANNOTATE_ANCHOR_MIN}–{PATH_ANNOTATE_ANCHOR_MAX}）；每点可写焦点 / 镜头 / 主体微动。自研标注，非第三方工具复刻。
      </p>

      <div
        role="presentation"
        onClick={onCanvasClick}
        className={`relative mx-auto aspect-[9/16] max-h-56 w-full max-w-[10rem] overflow-hidden rounded-md border border-white/15 bg-black/60 ${
          disabled || !imageUrl ? "cursor-not-allowed opacity-60" : "cursor-crosshair"
        }`}
      >
        {imageUrl ? (
          <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center px-2 text-center text-[10px] text-white/35">
            生成静帧后可在此标注路径
          </div>
        )}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {anchors.length > 1 ? (
            <polyline
              fill="none"
              stroke="rgba(34,211,238,0.85)"
              strokeWidth="1.2"
              points={anchors.map((a) => `${a.x * 100},${a.y * 100}`).join(" ")}
            />
          ) : null}
          {anchors.map((a) => (
            <g key={a.index}>
              <circle
                cx={a.x * 100}
                cy={a.y * 100}
                r={a.index === selectedIndex ? 3.2 : 2.4}
                fill={a.index === selectedIndex ? "#22d3ee" : "#67e8f9"}
                stroke="#0e7490"
                strokeWidth="0.6"
              />
              <text
                x={a.x * 100}
                y={a.y * 100 - 4}
                textAnchor="middle"
                fontSize="4"
                fill="#ecfeff"
              >
                {a.index}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {selected ? (
        <div className="grid gap-1.5 sm:grid-cols-2">
          <label className="text-[10px] text-white/45">
            焦点
            <input
              value={selected.focusZh}
              disabled={disabled}
              onChange={(e) => patchSelected({ focusZh: e.target.value })}
              className="mt-0.5 w-full rounded border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] text-white/90"
            />
          </label>
          <label className="text-[10px] text-white/45">
            时长(s)
            <input
              type="number"
              min={1}
              max={6}
              value={selected.durationHintSec}
              disabled={disabled}
              onChange={(e) => patchSelected({ durationHintSec: Number(e.target.value) || 2 })}
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
            {a.index}.{a.focusZh}
          </button>
        ))}
        {anchors.length ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => updateAnchors(anchors.slice(0, -1), null)}
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
        <p className="text-[10px] text-white/30">至少 {PATH_ANNOTATE_ANCHOR_MIN} 个锚点后生成 Seedance 运镜句。</p>
      )}
    </div>
  );
}
