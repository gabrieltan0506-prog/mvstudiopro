import React, {
  useId,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { cn } from "@/lib/utils";
import {
  adjustManhuaBoardOverlayPoint,
  MANHUA_BOARD_MOTION_OVERLAY_VISUAL,
  type ManhuaBoardMotionOverlay,
} from "@shared/manhuaDirectorBoardOverlay";

type NormalizedPoint = { x: number; y: number };

export type ManhuaDirectorBoardOverlayLayers = {
  actorRoutes: boolean;
  cameraPath: boolean;
  spatialAxis: boolean;
};

export type ManhuaDirectorBoardOverlayPointTarget =
  | { kind: "actor_route"; routeId: string; pointIndex: number }
  | { kind: "camera_path"; pointIndex: number };

export type ManhuaDirectorBoardOverlayProps = {
  overlay: ManhuaBoardMotionOverlay | null;
  onChange?: (next: ManhuaBoardMotionOverlay) => void;
  layers?: ManhuaDirectorBoardOverlayLayers;
  defaultLayers?: Partial<ManhuaDirectorBoardOverlayLayers>;
  onLayersChange?: (next: ManhuaDirectorBoardOverlayLayers) => void;
  className?: string;
  readOnly?: boolean;
  showControls?: boolean;
  ariaLabel?: string;
};

const DEFAULT_LAYERS: ManhuaDirectorBoardOverlayLayers = {
  actorRoutes: true,
  cameraPath: true,
  spatialAxis: true,
};

const ROUTE_RED = MANHUA_BOARD_MOTION_OVERLAY_VISUAL.actorRoute.stroke;
const CAMERA_CYAN = MANHUA_BOARD_MOTION_OVERLAY_VISUAL.cameraPath.stroke;
const AXIS_STEEL = "#c5d2d8";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function clampPoint(point: NormalizedPoint): NormalizedPoint {
  return { x: clamp01(point.x), y: clamp01(point.y) };
}

export function nudgeManhuaOverlayPoint(
  point: NormalizedPoint,
  key: string,
  coarse = false
): NormalizedPoint {
  const step = coarse ? 0.05 : 0.01;
  if (key === "ArrowLeft") return clampPoint({ x: point.x - step, y: point.y });
  if (key === "ArrowRight")
    return clampPoint({ x: point.x + step, y: point.y });
  if (key === "ArrowUp") return clampPoint({ x: point.x, y: point.y - step });
  if (key === "ArrowDown") return clampPoint({ x: point.x, y: point.y + step });
  return clampPoint(point);
}

export function updateManhuaOverlayPoint(
  overlay: ManhuaBoardMotionOverlay,
  target: ManhuaDirectorBoardOverlayPointTarget,
  nextPoint: NormalizedPoint
): ManhuaBoardMotionOverlay {
  return (
    adjustManhuaBoardOverlayPoint(overlay, target, clampPoint(nextPoint)) ??
    overlay
  );
}

export function countVisibleManhuaOverlayLayers(
  overlay: ManhuaBoardMotionOverlay,
  layers: ManhuaDirectorBoardOverlayLayers
): {
  actorRoutes: number;
  cameraPaths: number;
  axisMarks: number;
  landingPoints: number;
} {
  return {
    actorRoutes: layers.actorRoutes ? overlay.actorRoutes.length : 0,
    cameraPaths:
      layers.cameraPath &&
      overlay.cameraPath &&
      overlay.cameraPath.move !== "fixed"
        ? 1
        : 0,
    axisMarks:
      layers.spatialAxis && overlay.axis
        ? Number(Boolean(overlay.axis.entrance)) +
          Number(Boolean(overlay.axis.exit)) +
          overlay.axis.subjectAnchors.length
        : 0,
    landingPoints: layers.actorRoutes ? overlay.landingPoints.length : 0,
  };
}

function viewBoxFor(overlay: ManhuaBoardMotionOverlay): {
  width: number;
  height: number;
} {
  return overlay.baseAspectRatio === "9:16"
    ? { width: 900, height: 1600 }
    : { width: 1600, height: 900 };
}

function pointToSvg(
  point: NormalizedPoint,
  width: number,
  height: number
): NormalizedPoint {
  return { x: clamp01(point.x) * width, y: clamp01(point.y) * height };
}

function polylinePoints(
  points: NormalizedPoint[],
  width: number,
  height: number
): string {
  return points
    .map(point => pointToSvg(point, width, height))
    .map(point => `${point.x},${point.y}`)
    .join(" ");
}

function statusMeta(overlay: ManhuaBoardMotionOverlay): {
  label: string;
  className: string;
} {
  if (overlay.needsReview) {
    return {
      label: "待确认",
      className: "border-amber-300/50 bg-amber-400/15 text-amber-50",
    };
  }
  if (overlay.userAdjusted) {
    return {
      label: "已调整",
      className: "border-cyan-300/50 bg-cyan-400/15 text-cyan-50",
    };
  }
  return {
    label: "自动标注",
    className: "border-emerald-300/45 bg-emerald-400/15 text-emerald-50",
  };
}

function isArrowKey(key: string): boolean {
  return (
    key === "ArrowLeft" ||
    key === "ArrowRight" ||
    key === "ArrowUp" ||
    key === "ArrowDown"
  );
}

function routeKindLabel(kind: "character" | "prop"): string {
  return kind === "prop" ? "道具" : "人物";
}

function landingKindLabel(
  kind: ManhuaBoardMotionOverlay["landingPoints"][number]["kind"]
): string {
  if (kind === "contact") return "接触";
  if (kind === "collision") return "碰撞";
  if (kind === "handoff") return "交接";
  if (kind === "pause") return "停顿";
  return "结果";
}

export function ManhuaDirectorBoardOverlay({
  overlay,
  onChange,
  layers,
  defaultLayers,
  onLayersChange,
  className,
  readOnly = false,
  showControls = true,
  ariaLabel = "分镜动作与运镜轨迹",
}: ManhuaDirectorBoardOverlayProps) {
  const markerScope = useId().replaceAll(":", "");
  const [internalLayers, setInternalLayers] =
    useState<ManhuaDirectorBoardOverlayLayers>({
      ...DEFAULT_LAYERS,
      ...defaultLayers,
    });
  const [activeTarget, setActiveTarget] =
    useState<ManhuaDirectorBoardOverlayPointTarget | null>(null);
  const visibleLayers = layers ?? internalLayers;
  const editable = Boolean(onChange) && !readOnly;
  const status = overlay ? statusMeta(overlay) : null;
  const viewBox = useMemo(
    () => (overlay ? viewBoxFor(overlay) : null),
    [overlay]
  );

  if (!overlay || !viewBox || !status) return null;

  const actorArrowId = `manhua-actor-arrow-${markerScope}`;
  const cameraArrowId = `manhua-camera-arrow-${markerScope}`;
  const axisArrowId = `manhua-axis-arrow-${markerScope}`;
  const emitPoint = (
    target: ManhuaDirectorBoardOverlayPointTarget,
    point: NormalizedPoint
  ) => {
    if (!editable || !onChange) return;
    onChange(updateManhuaOverlayPoint(overlay, target, point));
  };
  const pointFromPointer = (
    event: ReactPointerEvent<SVGSVGElement>
  ): NormalizedPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0 };
    return clampPoint({
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    });
  };
  const setLayer = (key: keyof ManhuaDirectorBoardOverlayLayers) => {
    const next = { ...visibleLayers, [key]: !visibleLayers[key] };
    if (!layers) setInternalLayers(next);
    onLayersChange?.(next);
  };
  const onHandleKeyDown = (
    event: ReactKeyboardEvent<SVGCircleElement>,
    target: ManhuaDirectorBoardOverlayPointTarget,
    point: NormalizedPoint
  ) => {
    if (!isArrowKey(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    emitPoint(
      target,
      nudgeManhuaOverlayPoint(point, event.key, event.shiftKey)
    );
  };
  const renderHandle = (
    target: ManhuaDirectorBoardOverlayPointTarget,
    point: NormalizedPoint,
    label: string,
    color: string
  ) => {
    const svgPoint = pointToSvg(point, viewBox.width, viewBox.height);
    return (
      <circle
        key={`${target.kind}-${"routeId" in target ? target.routeId : "camera"}-${target.pointIndex}`}
        data-drag-handle="endpoint"
        role={editable ? "button" : undefined}
        aria-label={editable ? `${label}，使用方向键微调` : undefined}
        tabIndex={editable ? 0 : undefined}
        cx={svgPoint.x}
        cy={svgPoint.y}
        r={editable ? 13 : 8}
        fill="#0a1217"
        stroke={color}
        strokeWidth={editable ? 5 : 4}
        style={editable ? { touchAction: "none" } : undefined}
        className={
          editable
            ? "pointer-events-auto cursor-grab outline-none focus:stroke-white"
            : ""
        }
        onPointerDown={
          editable
            ? event => {
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                setActiveTarget(target);
              }
            : undefined
        }
        onKeyDown={
          editable ? event => onHandleKeyDown(event, target, point) : undefined
        }
      >
        <title>{label}</title>
      </circle>
    );
  };

  return (
    <section
      data-manhua-director-board-overlay
      aria-label={ariaLabel}
      className={cn(
        "pointer-events-none absolute inset-0 isolate overflow-hidden",
        className
      )}
    >
      <svg
        aria-label={ariaLabel}
        role={editable ? "group" : "img"}
        viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
        onPointerMove={event => {
          if (activeTarget) emitPoint(activeTarget, pointFromPointer(event));
        }}
        onPointerUp={event => {
          if (!activeTarget) return;
          emitPoint(activeTarget, pointFromPointer(event));
          setActiveTarget(null);
        }}
        onPointerCancel={() => setActiveTarget(null)}
      >
        <defs>
          <marker
            id={actorArrowId}
            viewBox="0 0 10 10"
            refX="8.2"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={ROUTE_RED} />
          </marker>
          <marker
            id={cameraArrowId}
            viewBox="0 0 10 10"
            refX="8.2"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={CAMERA_CYAN} />
          </marker>
          <marker
            id={axisArrowId}
            viewBox="0 0 10 10"
            refX="8.2"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={AXIS_STEEL} />
          </marker>
        </defs>

        {visibleLayers.spatialAxis && overlay.axis ? (
          <g data-layer="spatial-axis" className="pointer-events-none">
            {overlay.axis.entrance && overlay.axis.exit ? (
              <line
                x1={
                  pointToSvg(
                    overlay.axis.entrance,
                    viewBox.width,
                    viewBox.height
                  ).x
                }
                y1={
                  pointToSvg(
                    overlay.axis.entrance,
                    viewBox.width,
                    viewBox.height
                  ).y
                }
                x2={
                  pointToSvg(overlay.axis.exit, viewBox.width, viewBox.height).x
                }
                y2={
                  pointToSvg(overlay.axis.exit, viewBox.width, viewBox.height).y
                }
                stroke={AXIS_STEEL}
                strokeWidth="3"
                strokeDasharray="10 14"
                opacity="0.72"
                markerEnd={`url(#${axisArrowId})`}
              />
            ) : null}
            {overlay.axis.entrance ? (
              <g data-axis-mark="entrance">
                <circle
                  cx={
                    pointToSvg(
                      overlay.axis.entrance,
                      viewBox.width,
                      viewBox.height
                    ).x
                  }
                  cy={
                    pointToSvg(
                      overlay.axis.entrance,
                      viewBox.width,
                      viewBox.height
                    ).y
                  }
                  r="12"
                  fill="#071016"
                  stroke={AXIS_STEEL}
                  strokeWidth="4"
                />
                <title>入口</title>
              </g>
            ) : null}
            {overlay.axis.exit ? (
              <g data-axis-mark="exit">
                <circle
                  cx={
                    pointToSvg(overlay.axis.exit, viewBox.width, viewBox.height)
                      .x
                  }
                  cy={
                    pointToSvg(overlay.axis.exit, viewBox.width, viewBox.height)
                      .y
                  }
                  r="12"
                  fill="#071016"
                  stroke={AXIS_STEEL}
                  strokeWidth="4"
                />
                <title>出口</title>
              </g>
            ) : null}
            {overlay.axis.subjectAnchors.map(anchor => {
              const at = pointToSvg(anchor.at, viewBox.width, viewBox.height);
              return (
                <g key={anchor.entityId} data-axis-mark="subject">
                  <circle
                    cx={at.x}
                    cy={at.y}
                    r="15"
                    fill="#071016"
                    stroke="#ffffff"
                    strokeWidth="3"
                  />
                  <circle cx={at.x} cy={at.y} r="4" fill="#ffffff" />
                  <title>主体站位</title>
                </g>
              );
            })}
          </g>
        ) : null}

        {visibleLayers.actorRoutes ? (
          <g data-layer="actor-route" className="pointer-events-none">
            {overlay.actorRoutes.map(route => {
              const lastIndex = route.points.length - 1;
              const handleIndexes =
                lastIndex > 0 ? [0, lastIndex] : lastIndex === 0 ? [0] : [];
              return (
                <g key={route.routeId} data-route-kind={route.entityKind}>
                  {route.points.length > 1 ? (
                    <polyline
                      points={polylinePoints(
                        route.points,
                        viewBox.width,
                        viewBox.height
                      )}
                      fill="none"
                      stroke={ROUTE_RED}
                      strokeWidth="7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      markerEnd={`url(#${actorArrowId})`}
                      style={{
                        filter: "drop-shadow(0 2px 3px rgba(0,0,0,.75))",
                      }}
                    >
                      <title>{`${routeKindLabel(route.entityKind)}动作路线`}</title>
                    </polyline>
                  ) : null}
                  {route.points.slice(1, -1).map((point, pointIndex) => {
                    const at = pointToSvg(point, viewBox.width, viewBox.height);
                    return (
                      <circle
                        key={`via-${pointIndex + 1}`}
                        data-route-waypoint
                        cx={at.x}
                        cy={at.y}
                        r="5"
                        fill={ROUTE_RED}
                        opacity="0.76"
                      />
                    );
                  })}
                  {handleIndexes.map(pointIndex =>
                    renderHandle(
                      {
                        kind: "actor_route",
                        routeId: route.routeId,
                        pointIndex,
                      },
                      route.points[pointIndex],
                      `调整${routeKindLabel(route.entityKind)}路线${pointIndex === 0 ? "起点" : "终点"}`,
                      ROUTE_RED
                    )
                  )}
                </g>
              );
            })}
            {overlay.landingPoints.map(landing => {
              const at = pointToSvg(landing.at, viewBox.width, viewBox.height);
              return (
                <g key={landing.landingId} data-landing-point={landing.kind}>
                  <circle
                    cx={at.x}
                    cy={at.y}
                    r="16"
                    fill="none"
                    stroke={ROUTE_RED}
                    strokeWidth="4"
                  />
                  <path
                    d={`M ${at.x - 24} ${at.y} H ${at.x + 24} M ${at.x} ${at.y - 24} V ${at.y + 24}`}
                    stroke={ROUTE_RED}
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                  <circle cx={at.x} cy={at.y} r="4" fill={ROUTE_RED} />
                  <title>{`关键落点：${landingKindLabel(landing.kind)}`}</title>
                </g>
              );
            })}
          </g>
        ) : null}

        {visibleLayers.cameraPath && overlay.cameraPath?.move !== "fixed" ? (
          <g data-layer="camera-path" className="pointer-events-none">
            {overlay.cameraPath && overlay.cameraPath.points.length > 1 ? (
              <polyline
                points={polylinePoints(
                  overlay.cameraPath.points,
                  viewBox.width,
                  viewBox.height
                )}
                fill="none"
                stroke={CAMERA_CYAN}
                strokeWidth="6"
                strokeDasharray={
                  MANHUA_BOARD_MOTION_OVERLAY_VISUAL.cameraPath.strokeDasharray
                }
                strokeLinecap="round"
                strokeLinejoin="round"
                markerEnd={`url(#${cameraArrowId})`}
                style={{ filter: "drop-shadow(0 2px 3px rgba(0,0,0,.75))" }}
              >
                <title>摄影机运动路线</title>
              </polyline>
            ) : null}
            {overlay.cameraPath
              ? Array.from(
                  new Set(
                    overlay.cameraPath.points.length > 1
                      ? [0, overlay.cameraPath.points.length - 1]
                      : overlay.cameraPath.points.length === 1
                        ? [0]
                        : []
                  )
                ).map(pointIndex =>
                  renderHandle(
                    { kind: "camera_path", pointIndex },
                    overlay.cameraPath!.points[pointIndex],
                    `调整摄影机路线${pointIndex === 0 ? "起点" : "终点"}`,
                    CAMERA_CYAN
                  )
                )
              : null}
          </g>
        ) : null}
      </svg>

      <div
        data-overlay-status={
          overlay.needsReview
            ? "review"
            : overlay.userAdjusted
              ? "adjusted"
              : "auto"
        }
        className={cn(
          "absolute left-2 top-2 rounded-full border px-2 py-1 text-[10px] font-semibold shadow-lg backdrop-blur-md",
          status.className
        )}
      >
        {status.label}
      </div>

      {visibleLayers.cameraPath && overlay.cameraPath?.move === "fixed" ? (
        <div className="absolute right-2 top-2 rounded-full border border-cyan-300/40 bg-[#071016]/80 px-2 py-1 text-[10px] font-medium text-cyan-50 shadow-lg backdrop-blur-md">
          固定机位
        </div>
      ) : null}

      {showControls ? (
        <div
          data-director-board-overlay-controls
          aria-label="标注图层"
          className="pointer-events-auto absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-white/15 bg-[#071016]/85 p-1 text-[10px] text-white/75 shadow-xl backdrop-blur-md"
        >
          <button
            type="button"
            aria-pressed={visibleLayers.actorRoutes}
            onClick={() => setLayer("actorRoutes")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-white/80",
              visibleLayers.actorRoutes
                ? "bg-white/12 text-white"
                : "text-white/45 hover:text-white/75"
            )}
          >
            <span aria-hidden className="h-0.5 w-4 rounded-full bg-[#ef4444]" />
            人物／道具
          </button>
          <button
            type="button"
            aria-pressed={visibleLayers.cameraPath}
            onClick={() => setLayer("cameraPath")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-white/80",
              visibleLayers.cameraPath
                ? "bg-white/12 text-white"
                : "text-white/45 hover:text-white/75"
            )}
          >
            <span
              aria-hidden
              className="h-0.5 w-4 border-t-2 border-dashed border-[#22d3ee]"
            />
            摄影机
          </button>
          <button
            type="button"
            aria-pressed={visibleLayers.spatialAxis}
            onClick={() => setLayer("spatialAxis")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-white/80",
              visibleLayers.spatialAxis
                ? "bg-white/12 text-white"
                : "text-white/45 hover:text-white/75"
            )}
          >
            <span
              aria-hidden
              className="h-0.5 w-4 border-t border-dashed border-white/70"
            />
            空间轴线
          </button>
        </div>
      ) : null}
    </section>
  );
}
