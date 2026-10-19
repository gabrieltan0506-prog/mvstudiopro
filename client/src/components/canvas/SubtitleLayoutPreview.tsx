import { useMemo, useState } from "react";
import {
  subtitleLayoutCues,
  placeSubtitleHighlights,
} from "@shared/subtitleLayout";
import type { SubtitleHighlight } from "@shared/subtitleHighlights";
import { flyDownloadUrl } from "@/lib/gcsTransfer";

/** 预览使用同一组字幕输入；横竖切换仅检查排版，不裁切导出原片。 */
export function SubtitleLayoutPreview({
  source,
  srt,
  fontSize,
  marginV,
  highlights,
}: {
  source: string;
  srt: string;
  fontSize: number;
  marginV: number;
  highlights: SubtitleHighlight[];
}) {
  const [aspect, setAspect] = useState("auto"),
    [ratio, setRatio] = useState(9 / 16),
    [time, setTime] = useState(0);
  const [mediaError, setMediaError] = useState(false);
  const displayRatio =
    aspect === "auto" ? ratio : aspect === "9:16" ? 9 / 16 : 16 / 9;
  const width = Math.max(1, Math.round(288 * displayRatio));
  const layout = useMemo(() => {
    try {
      const cues = subtitleLayoutCues(srt, width, fontSize);
      return {
        cues,
        highlights: placeSubtitleHighlights(highlights, cues, {
          fontSize,
          marginV,
        }),
        error: "",
      };
    } catch (e) {
      return {
        cues: [],
        highlights: [],
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [srt, width, fontSize, marginV, highlights]);
  const active = layout.highlights.filter(
    c => time >= c.startSec && time < c.endSec
  );
  return (
    <div className="mt-3 space-y-2" aria-label="字幕排版预览">
      <label className="text-xs">
        预览画幅{" "}
        <select
          aria-label="字幕预览画幅"
          value={aspect}
          onChange={e => setAspect(e.target.value)}
          className="rounded border bg-transparent p-2"
        >
          <option value="auto">沿用原片</option>
          <option value="9:16">竖屏 9:16</option>
          <option value="16:9">横屏 16:9</option>
        </select>
      </label>
      <div
        className="relative mx-auto overflow-hidden rounded bg-black"
        style={{
          aspectRatio: String(displayRatio),
          width: `min(100%, ${440 * displayRatio}px)`,
        }}
      >
        {source && (
          <video
            key={source}
            src={flyDownloadUrl(source)}
            controls
            playsInline
            preload="metadata"
            aria-label="字幕排版原片"
            className="h-full w-full object-contain"
            onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
            onLoadStart={() => {
              setTime(0);
              setMediaError(false);
            }}
            onError={() => setMediaError(true)}
            onLoadedMetadata={e => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight)
                setRatio(v.videoWidth / v.videoHeight);
            }}
          />
        )}
        <svg
          aria-label="当前字幕叠加"
          viewBox={`0 0 ${width} 288`}
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ fontFamily: '"Noto Sans CJK SC", sans-serif' }}
        >
          {layout.cues
            .filter(c => time >= c.startSec && time < c.endSec)
            .map((c, i) => {
              const lines = c.lines;
              return (
                <text
                  key={i}
                  x={width / 2}
                  y={288 - marginV - (lines.length - 1) * fontSize * 1.2}
                  textAnchor="middle"
                  fill="white"
                  stroke="black"
                  strokeWidth="0.7"
                  paintOrder="stroke"
                  fontSize={fontSize}
                >
                  {lines.map((line, n) => (
                    <tspan key={n} x={width / 2} dy={n ? fontSize * 1.2 : 0}>
                      {line}
                    </tspan>
                  ))}
                </text>
              );
            })}
          {active.map(c => {
            const age = time - c.startSec,
              y = (288 * c.positionPercent) / 100;
            const opacity = Math.max(
              0,
              Math.min(1, age / 0.18, (c.endSec - time) / 0.18)
            );
            const scale =
              c.effect === "impact"
                ? age < 0.13
                  ? 0.65 + (age / 0.13) * 0.47
                  : age < 0.26
                    ? 1.12 - ((age - 0.13) / 0.13) * 0.12
                    : 1
                : 1;
            const words =
              c.effect === "arrange" ? c.text.split(/[|｜]/) : [c.text];
            const spiral = Array.from({ length: 48 }, (_, i) => {
              const t = i / 47,
                r = 0.14 + 0.86 * t,
                a =
                  t * Math.PI * 4 + (Math.floor(age * 12) / 12) * Math.PI * 1.5;
              return `${i ? "L" : "M"}${width / 2 + 22 * r * Math.cos(a)},${y + c.fontSize * 0.7 + 4 + 3.2 * r * Math.sin(a)}`;
            }).join(" ");
            return (
              <g
                key={c.id}
                opacity={opacity}
                fill={c.effect === "arrange" ? "#9cf1ff" : "#ffd777"}
              >
                {words.map((word, i) => {
                  const start =
                    Math.min(
                      0.35,
                      (c.endSec - c.startSec) / (words.length + 2)
                    ) * i;
                  const x =
                    c.effect === "arrange"
                      ? 10 +
                        ((width - 20) / words.length) * (i + 0.5) -
                        12 * Math.max(0, 1 - (age - start) / 0.22)
                      : width / 2;
                  return (
                    age >= start && (
                      <text
                        key={i}
                        transform={`translate(${x} ${y}) scale(${scale})`}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontWeight="bold"
                        stroke="#101820"
                        strokeWidth=".9"
                        paintOrder="stroke"
                        fontSize={c.fontSize}
                      >
                        {word.trim()}
                      </text>
                    )
                  );
                })}
                {c.effect === "spiral" && (
                  <path
                    d={spiral}
                    fill="none"
                    stroke="#ffe99a"
                    strokeWidth=".6"
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>
      {layout.error && srt.trim() && (
        <p role="alert" className="text-xs text-amber-200">
          {layout.error}
        </p>
      )}
      {mediaError && (
        <p role="alert" className="text-xs text-amber-200">
          原片暂时无法播放，请检查素材访问权限或重新选择。
        </p>
      )}
      <p className="text-xs text-white/60">
        播放原片查看当前时间的字幕。横竖切换用于排版参考，导出沿用原片画幅；重点字幕遇到普通字幕会自动向上避让，仍需核对人物位置。最终字形和动效以烧录结果为准。
      </p>
    </div>
  );
}
