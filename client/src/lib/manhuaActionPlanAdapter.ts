/**
 * 动作计划适配器（PR-2）：把**已存在的生产者**——导演板 overlay、previs 相机、ShotIR——
 * 翻成 `ManhuaActionPlanBindingContext`，交给 shared/manhuaActionPlanBindings 做交叉校验。
 *
 * 老实口径（决定四 / 六 / 空间合同）：
 *   - 导演板落点只有**屏幕归一化点**，这里就给 `space:"screen"`，不猜世界坐标；
 *     执行期 bindings 会以 landing_world_point_required 拦下，那是对的——2D 板不能冒充 3D。
 *   - `surfaceRef` **只**来自调用方传入的表面实体（稳定 ID），不从中文标题生成；没有就不填。
 *   - overlay.cameraPath 只有点没有秒数 → `timedSamplesAvailable:false`，不假称已带时间。
 *   - previs cameras 有 startSec/endSec → 覆盖区间成对给出，采样 discrete 24fps，时间基准=源时间。
 *   - ShotIR 只有 cameraZh 文本 → 只登记来源与覆盖，无采样证据。
 *
 * 纯函数、无 DOM、无网络。
 */
import type { ManhuaBoardMotionOverlay } from "@shared/manhuaDirectorBoardOverlay";
import type { ShotIR } from "@shared/manhuaShotIR";
import {
  manhuaActionPlanBindingContextSchema,
  type ManhuaActionPlanBindingContext,
  type ManhuaResolvedCameraSource,
  type ManhuaResolvedLanding,
} from "@shared/manhuaActionPlanBindings";
import { MANHUA_TIMING_FPS } from "@shared/manhuaActionPlanTiming";

/** 落地表面实体：由资产/场景层提供，ID 稳定，展示名可改 */
export type ManhuaSurfaceEntity = {
  surfaceRef: string;
  nameZh: string;
  episodeIndex: number;
  segmentIndex?: number;
  shotIndex?: number;
  /** 该表面上哪些落点（landingId）落在它上面；缺省=本镜所有落点 */
  landingIds?: string[];
};

export type ManhuaPrevisCameraSourceInput = {
  /** 稳定引用，如 previs 任务 ID */
  sourceShotRef: string;
  sourceRevision: string;
  durationSec: number;
  cameras: Array<{ startSec: number; endSec: number }>;
};

export type ManhuaShotIrCameraSourceInput = {
  episodeIndex: number;
  segmentIndex: number;
  sourceRevision: string;
  shots: ShotIR[];
};

export function overlayShotRef(o: Pick<ManhuaBoardMotionOverlay, "episodeIndex" | "segmentIndex" | "shotIndex">): string {
  return `e${o.episodeIndex}-s${o.segmentIndex}-t${o.shotIndex}`;
}

function surfaceFor(
  surfaces: ManhuaSurfaceEntity[],
  overlay: ManhuaBoardMotionOverlay,
  landingId: string,
): ManhuaSurfaceEntity | undefined {
  const matches = surfaces.filter(
    (s) =>
      s.episodeIndex === overlay.episodeIndex &&
      (s.segmentIndex == null || s.segmentIndex === overlay.segmentIndex) &&
      (s.shotIndex == null || s.shotIndex === overlay.shotIndex) &&
      (!s.landingIds || s.landingIds.includes(landingId)),
  );
  // 多个候选表面都声称覆盖同一落点 = 数据冲突，不猜：不填 surfaceRef，让校验报 landing_surface_ref_missing
  return matches.length === 1 ? matches[0] : undefined;
}

export function landingsFromOverlays(
  overlays: ManhuaBoardMotionOverlay[],
  surfaces: ManhuaSurfaceEntity[] = [],
): ManhuaResolvedLanding[] {
  const out: ManhuaResolvedLanding[] = [];
  for (const o of overlays) {
    for (const lp of o.landingPoints) {
      const surface = surfaceFor(surfaces, o, lp.landingId);
      out.push({
        landingId: lp.landingId,
        overlayRef: { episodeIndex: o.episodeIndex, segmentIndex: o.segmentIndex, shotIndex: o.shotIndex },
        sourceRevision: o.sourceRevision,
        // 导演板是 2D 归一化坐标：如实给 screen，不造 world
        point: { space: "screen", x: lp.at.x, y: lp.at.y },
        ...(lp.entityIds[0] ? { boundActorId: lp.entityIds[0] } : {}),
        ...(surface ? { surfaceRef: surface.surfaceRef, surfaceZh: surface.nameZh } : {}),
      });
    }
  }
  return out;
}

export function camerasFromOverlays(overlays: ManhuaBoardMotionOverlay[]): ManhuaResolvedCameraSource[] {
  return overlays
    .filter((o) => o.cameraPath && o.cameraPath.points.length > 0)
    .map((o) => ({
      source: "overlay_camera_path" as const,
      sourceShotRef: overlayShotRef(o),
      sourceRevision: o.sourceRevision,
      // 只有点、没有秒数：不给 coverage / sampling，timedSamplesAvailable=false（决定六）
      timedSamplesAvailable: false,
    }));
}

export function camerasFromPrevis(inputs: ManhuaPrevisCameraSourceInput[]): ManhuaResolvedCameraSource[] {
  return inputs.map((p) => {
    const start = p.cameras.length ? Math.min(...p.cameras.map((c) => c.startSec)) : 0;
    const end = p.cameras.length ? Math.max(...p.cameras.map((c) => c.endSec)) : 0;
    return {
      source: "previs_cameras" as const,
      sourceShotRef: p.sourceShotRef,
      sourceRevision: p.sourceRevision,
      coverage: { startSec: start, endSec: Math.min(end, p.durationSec) },
      coverageBasis: "source" as const,
      sampling: { kind: "discrete" as const, fps: MANHUA_TIMING_FPS },
      timedSamplesAvailable: p.cameras.length > 0,
    };
  });
}

export function camerasFromShotIr(inputs: ManhuaShotIrCameraSourceInput[]): ManhuaResolvedCameraSource[] {
  const out: ManhuaResolvedCameraSource[] = [];
  for (const seg of inputs) {
    let cursor = 0;
    for (const shot of seg.shots) {
      const dur = Math.max(0, Number(shot.durationSec) || 0);
      out.push({
        source: "shot_ir",
        sourceShotRef: `e${seg.episodeIndex}-s${seg.segmentIndex}-t${shot.index}`,
        sourceRevision: seg.sourceRevision,
        // ShotIR 的相机是文字（cameraZh），时间轴是呈现时长：只登记覆盖，不假称有采样
        coverage: { startSec: cursor, endSec: cursor + dur },
        coverageBasis: "presentation",
        timedSamplesAvailable: false,
      });
      cursor += dur;
    }
  }
  return out;
}

export function buildManhuaActionPlanBindingContext(input: {
  overlays?: ManhuaBoardMotionOverlay[];
  surfaces?: ManhuaSurfaceEntity[];
  previs?: ManhuaPrevisCameraSourceInput[];
  shotIr?: ManhuaShotIrCameraSourceInput[];
}): ManhuaActionPlanBindingContext {
  const overlays = input.overlays ?? [];
  const context = {
    landings: landingsFromOverlays(overlays, input.surfaces ?? []),
    cameras: [
      ...camerasFromOverlays(overlays),
      ...camerasFromPrevis(input.previs ?? []),
      ...camerasFromShotIr(input.shotIr ?? []),
    ],
  };
  // 过一遍合同：适配器产出必须是 bindings 能吃的形状，不合就当场炸（不发出一份错形状）
  return manhuaActionPlanBindingContextSchema.parse(context);
}
