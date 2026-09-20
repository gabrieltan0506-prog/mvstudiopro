import { useEffect, useRef, useState } from "react";
import { PREVIS_ACTION_LABELS } from "@shared/manhuaPrevis";
import { PREVIS_ACTION_PREVIEW_SAMPLES as samples } from "./ManhuaPrevisActionPreview.samples";

type Kind = keyof typeof samples.clips;

/** 播放生产白模的逐帧骨骼投影；没有第二套动作公式，也不提交任何渲染。 */
export function ManhuaPrevisActionPreview({
  kind,
  disabled,
}: {
  kind: Kind;
  disabled: boolean;
}) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const frameRef = useRef(0);
  frameRef.current = frame;
  const clip = samples.clips[kind];
  useEffect(() => {
    setFrame(0);
    setPlaying(false);
  }, [kind]);
  useEffect(() => {
    if (disabled) setPlaying(false);
  }, [disabled]);
  useEffect(() => {
    if (!playing || disabled) return;
    let request = 0;
    const start = performance.now() - (frameRef.current * 1000) / samples.fps;
    const tick = (now: number) => {
      setFrame(
        Math.floor(((now - start) * samples.fps) / 1000) % clip.frames.length
      );
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [playing, disabled, kind, clip.frames.length]);
  return (
    <div
      className="space-y-2 rounded border border-white/15 p-2"
      data-previs-action-preview
      data-kind={kind}
      data-frame={frame}
      data-source-sha={
        samples.sourceFiles["server/scripts/render-manhua-previs.py"]
      }
    >
      <p className="text-xs text-cyan-100">
        {PREVIS_ACTION_LABELS[kind]} · 基础人形 · 2秒骨架预览
      </p>
      <svg
        role="img"
        aria-label={`${PREVIS_ACTION_LABELS[kind]}基础人形动作预览`}
        viewBox="0 0 320 180"
        style={{
          width: "100%",
          maxWidth: 480,
          display: "block",
          background: "#0f172a",
          borderRadius: 6,
        }}
      >
        <path d="M20 166H300" stroke="#334155" />
        {clip.bones.map((bone, index) => {
          const point = clip.frames[frame]?.[index] ?? clip.frames[0][index];
          return (
            <line
              key={bone}
              data-bone={bone}
              x1={point[0]}
              y1={point[1]}
              x2={point[2]}
              y2={point[3]}
              stroke={bone.endsWith("-1") ? "#e2e8f0" : "#94a3b8"}
              strokeWidth={
                bone === "head"
                  ? 15
                  : bone === "spine"
                    ? 12
                    : bone.includes("leg")
                      ? 7
                      : 5
              }
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          aria-pressed={playing}
          className="shrink-0 rounded border border-white/30 px-2 py-1 text-xs"
          onClick={() => setPlaying(value => !value)}
        >
          {playing ? "暂停动作预览" : "播放动作预览"}
        </button>
        <input
          aria-label="动作预览帧"
          type="range"
          min={0}
          max={clip.frames.length - 1}
          step={1}
          value={frame}
          disabled={disabled}
          className="min-w-0 flex-1"
          onChange={event => {
            setPlaying(false);
            setFrame(Number(event.target.value));
          }}
        />
        <span className="shrink-0 text-xs tabular-nums">
          {(frame / samples.fps).toFixed(2)}秒
        </span>
      </div>
      <p className="text-[11px] text-white/60">
        取自白模基础动作；行走示例为2秒移动1.2米，不含当前角色模型、站位或接触。添加后的实际秒窗以下方配置为准。
      </p>
    </div>
  );
}
