/**
 * 动作计划的**落点与相机绑定交叉校验**（决定四 + 决定六）。
 *
 * shared 侧的动作计划**不 import overlay / previs**——那会把纯数据合同绑死在
 * 某一版编辑器的数据结构上。改成由适配器把「解析之后的绑定上下文」递进来，
 * 这里只做纯数据交叉核对。
 *
 * 0915 复审据此收紧了四处，都是「没证据也放行」这一类：
 *   1. 二维 screen 点不能通过 3D 登船/出水的执行校验——二维点无深度，
 *      证明不了世界落点。**不要求适配器自觉改名成 unresolved 才有保护**。
 *   2. 相机不能凭 timedSamplesResolved + timedSamplesAvailable 两个 true 就算已解析；
 *      执行期必须拿得出覆盖范围、**显式**时间基准与采样能力证据。
 *   3. 落地表面只查非空不够：计划写甲板、解析写水面必须拒绝。
 *      比对认稳定 surfaceRef，中文名只作展示。
 *   4. 落点按 overlayRef + landingId 复合键查找——裸 id 会被后者覆盖；
 *      复合键重复则报上下文歧义。
 */
import { z } from "zod";
import {
  manhuaSpatialPointSchema,
  type ManhuaActionPlan,
  type ManhuaActionPlanCheckMode,
  type ManhuaPlanShot,
  type ManhuaSpatialPoint,
} from "./manhuaActionPlan.js";
import {
  MANHUA_TIMING_FPS,
  manhuaPresentationDurationSec,
  manhuaTimeBasisSchema,
} from "./manhuaActionPlanTiming.js";

const idSchema = z.string().trim().min(1).max(120);

const overlayRefSchema = z
  .object({
    episodeIndex: z.number().int().positive(),
    segmentIndex: z.number().int().positive(),
    shotIndex: z.number().int().positive(),
  })
  .strict();
type OverlayRef = z.infer<typeof overlayRefSchema>;

/* ─────────────── 适配器递进来的「已解析」上下文 ─────────────── */

export const manhuaResolvedLandingSchema = z
  .object({
    landingId: idSchema,
    overlayRef: overlayRefSchema,
    sourceRevision: z.string().trim().min(1).max(160),
    /**
     * 落点坐标。只有屏幕点又拿不到深度依据时应给 space:"unresolved"，
     * 不要猜一个世界坐标冒充已锁定。
     * 给 screen 也不会被当成 3D 可执行——见 landing_world_point_required。
     */
    point: manhuaSpatialPointSchema,
    boundActorId: idSchema.optional(),
    /** 落地表面的稳定引用；比对只认它 */
    surfaceRef: idSchema.optional(),
    /** 落地表面展示名 */
    surfaceZh: z.string().trim().max(80).optional(),
  })
  .strict();
export type ManhuaResolvedLanding = z.infer<typeof manhuaResolvedLandingSchema>;

/**
 * 相机采样能力，判别式表达：
 * 稀疏关键帧 + 可连续求值的曲线，与逐帧离散采样不是一回事，
 * 不该逼着连续曲线去伪造一个 24fps。
 */
export const manhuaCameraSamplingSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("discrete"), fps: z.number().finite().positive().max(240) })
    .strict(),
  z.object({ kind: z.literal("continuous") }).strict(),
]);
export type ManhuaCameraSampling = z.infer<typeof manhuaCameraSamplingSchema>;

export const manhuaResolvedCameraSourceSchema = z
  .object({
    source: z.enum(["shot_ir", "overlay_camera_path", "previs_cameras"]),
    sourceShotRef: z.string().trim().min(1).max(160),
    sourceRevision: z.string().trim().min(1).max(160),
    /** 覆盖区间（秒）；单位按 coverageBasis 解释，**必须成对出现** */
    coverage: z
      .object({
        startSec: z.number().finite().min(0),
        endSec: z.number().finite().min(0),
      })
      .strict()
      .optional(),
    /** 覆盖区间属于哪条时间轴。**不回退到绑定自己的声明**：来源的事实要来源自己说 */
    coverageBasis: manhuaTimeBasisSchema.optional(),
    /** 采样能力证据；缺失＝没有证据，执行期不放行 */
    sampling: manhuaCameraSamplingSchema.optional(),
    /** 该来源当前能否给出带时间的采样（overlay.cameraPath 只有点 → false） */
    timedSamplesAvailable: z.boolean(),
  })
  .strict();
export type ManhuaResolvedCameraSource = z.infer<typeof manhuaResolvedCameraSourceSchema>;

export const manhuaActionPlanBindingContextSchema = z
  .object({
    landings: z.array(manhuaResolvedLandingSchema).max(500).default([]),
    cameras: z.array(manhuaResolvedCameraSourceSchema).max(500).default([]),
  })
  .strict();
export type ManhuaActionPlanBindingContext = z.infer<
  typeof manhuaActionPlanBindingContextSchema
>;

/* ─────────────── issue ─────────────── */

export type ManhuaBindingIssueCode =
  | "landing_not_found"
  | "landing_revision_mismatch"
  | "landing_overlay_mismatch"
  /** 同一复合键解析出多个落点，无法确定指的是哪个 */
  | "landing_context_ambiguous"
  /** 绑定记录的集段镜与本镜 sourceBinding 不是同一个镜头 */
  | "landing_shot_binding_mismatch"
  /** 本镜没有来源绑定，无从验证落点到底属不属于这一镜 */
  | "shot_source_binding_missing"
  | "landing_actor_mismatch"
  /** 落点还没绑定到任何角色 */
  | "landing_actor_unbound"
  | "landing_space_unresolved"
  /** 3D 执行需要世界坐标：二维屏幕点无深度，证明不了世界落点 */
  | "landing_world_point_required"
  /** 计划声明的落地表面与解析结果不是同一个 */
  | "landing_surface_conflict"
  /** 缺落地表面的稳定引用：同名只能证明名字一样，证明不了是同一个表面 */
  | "landing_surface_ref_missing"
  | "camera_source_not_found"
  | "camera_revision_mismatch"
  | "camera_context_ambiguous"
  | "camera_timed_samples_overclaimed"
  | "camera_timed_samples_pending"
  /** 缺覆盖范围 / 显式基准 / 采样能力证据，不能算已解析 */
  | "camera_evidence_missing"
  | "camera_coverage_gap"
  /** 离散采样帧率低于时间映射基准 */
  | "camera_sampling_fps_low";

export type ManhuaBindingIssue = {
  code: ManhuaBindingIssueCode;
  messageZh: string;
  /** draft 下 warning 不拦；execution 下一律拦 */
  severity: "error" | "warning";
  shotId?: string;
  eventId?: string;
  actorId?: string;
  landingId?: string;
};

/* ─────────────── 内部工具 ─────────────── */

/** 复合键一律 JSON 序列化，不用字符拼接——分隔符出现在 id 里就会撞键 */
const landingKey = (ref: OverlayRef, landingId: string): string =>
  JSON.stringify([ref.episodeIndex, ref.segmentIndex, ref.shotIndex, landingId]);
const cameraKey = (source: string, sourceShotRef: string): string =>
  JSON.stringify([source, sourceShotRef]);

const sameOverlayRef = (a: OverlayRef, b: OverlayRef): boolean =>
  a.episodeIndex === b.episodeIndex &&
  a.segmentIndex === b.segmentIndex &&
  a.shotIndex === b.shotIndex;

const refZh = (r: OverlayRef) => `第${r.episodeIndex}集第${r.segmentIndex}段第${r.shotIndex}镜`;
const basisZh = (b: "source" | "presentation") => (b === "presentation" ? "呈现时间" : "源时间");
const spaceZh = (p: ManhuaSpatialPoint) =>
  p.space === "world" ? "世界坐标" : p.space === "screen" ? "屏幕坐标" : "未解析";

/**
 * 需要真实三维落点的事件：登船/落地、出水。
 *
 * ⚠️ 口径收窄（0915 复审补充）：`emerge.landing` 是**可选**的，
 * 没绑落点的出水根本不会走到这里。所以这条只能说
 * 「**已绑定落点的** emerge 要核 world 点」，
 * 不能说「所有出水执行必有 world 点」——独立的出水轨迹/穿水点证据
 * 属于后续执行准备器的事，本模块没有，标未验证。
 * 也不为了凑全绿硬给出水加登船语义。
 */
const needsWorldPoint = (kind: string): boolean => kind === "land" || kind === "emerge";

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}

/* ─────────────── 校验 ─────────────── */

/**
 * 交叉校验落点与相机绑定。
 *
 * @param mode draft＝编辑中，缺项只报 issue；execution＝确认/送执行前，一律硬拦。
 */
export function validateManhuaActionPlanBindings(
  plan: ManhuaActionPlan,
  context: ManhuaActionPlanBindingContext,
  mode: ManhuaActionPlanCheckMode = "draft",
): ManhuaBindingIssue[] {
  const issues: ManhuaBindingIssue[] = [];
  const gate = (): "error" | "warning" => (mode === "execution" ? "error" : "warning");

  // 复合键查找；另留一份按裸 id 的索引，用来区分「被移走」与「被删掉」
  const byComposite = groupBy(context.landings, (l) => landingKey(l.overlayRef, l.landingId));
  const byLandingId = groupBy(context.landings, (l) => l.landingId);
  const cameraByKey = groupBy(context.cameras, (c) => cameraKey(c.source, c.sourceShotRef));

  for (const shot of plan.shots) {
    checkShotLandings(shot);
    checkShotCamera(shot);
  }
  return issues;

  function checkShotLandings(shot: ManhuaPlanShot): void {
    for (const event of shot.events) {
      const binding = "landing" in event && event.landing ? event.landing : undefined;
      if (!binding) continue;

      const hits = byComposite.get(landingKey(binding.overlayRef, binding.landingId)) ?? [];
      if (hits.length > 1) {
        issues.push({
          code: "landing_context_ambiguous",
          severity: "error",
          messageZh:
            `${refZh(binding.overlayRef)}里有 ${hits.length} 个落点都叫 ` +
            `${binding.landingId}，无法确定指的是哪一个。`,
          shotId: shot.shotId,
          eventId: event.eventId,
          landingId: binding.landingId,
        });
        continue;
      }
      const resolved = hits[0];
      if (!resolved) {
        const elsewhere = byLandingId.get(binding.landingId) ?? [];
        if (elsewhere.length) {
          issues.push({
            code: "landing_overlay_mismatch",
            severity: "error",
            messageZh:
              `落点 ${binding.landingId} 现在属于` +
              `${elsewhere.map((l) => refZh(l.overlayRef)).join("、")}，` +
              `与绑定记录的${refZh(binding.overlayRef)}不一致；不按裸 id 跨镜认领。`,
            shotId: shot.shotId,
            eventId: event.eventId,
            landingId: binding.landingId,
          });
        } else {
          issues.push({
            code: "landing_not_found",
            severity: "error",
            messageZh: `落点 ${binding.landingId} 不存在（可能已被删除）；依赖它的编排需要重新指定落点。`,
            shotId: shot.shotId,
            eventId: event.eventId,
            actorId: event.actorId,
            landingId: binding.landingId,
          });
        }
        continue;
      }

      if (resolved.sourceRevision !== binding.sourceRevision) {
        issues.push({
          code: "landing_revision_mismatch",
          severity: "error",
          messageZh:
            `落点 ${binding.landingId} 在绑定之后被改过` +
            `（绑定版本 ${binding.sourceRevision}，当前 ${resolved.sourceRevision}）；` +
            `请重新确认后再执行。`,
          shotId: shot.shotId,
          eventId: event.eventId,
          landingId: binding.landingId,
        });
      }

      // 绑定说的镜头，与本镜自己的来源绑定，必须是同一个镜头。
      // sourceBinding 的 segmentIndex / sourceShotIndex 是可选的——
      // 缺了就**无法完整验证**，如实报出来，不假装验过。
      const sb = shot.sourceBinding;
      if (!sb) {
        issues.push({
          code: "shot_source_binding_missing",
          severity: gate(),
          messageZh: `镜头 ${shot.shotId} 没有来源绑定，无从验证落点 ${binding.landingId} 是否属于这一镜。`,
          shotId: shot.shotId,
          eventId: event.eventId,
          landingId: binding.landingId,
        });
      } else {
        const mismatched: string[] = [];
        if (sb.episodeIndex !== binding.overlayRef.episodeIndex) {
          mismatched.push(`集号 ${sb.episodeIndex} ≠ ${binding.overlayRef.episodeIndex}`);
        }
        if (sb.segmentIndex != null && sb.segmentIndex !== binding.overlayRef.segmentIndex) {
          mismatched.push(`段号 ${sb.segmentIndex} ≠ ${binding.overlayRef.segmentIndex}`);
        }
        if (sb.sourceShotIndex != null && sb.sourceShotIndex !== binding.overlayRef.shotIndex) {
          mismatched.push(`镜号 ${sb.sourceShotIndex} ≠ ${binding.overlayRef.shotIndex}`);
        }
        if (mismatched.length) {
          issues.push({
            code: "landing_shot_binding_mismatch",
            severity: "error",
            messageZh:
              `落点绑定指向${refZh(binding.overlayRef)}，与镜头 ${shot.shotId} 的来源对不上` +
              `（${mismatched.join("；")}）。`,
            shotId: shot.shotId,
            eventId: event.eventId,
            landingId: binding.landingId,
          });
        } else if (sb.segmentIndex == null || sb.sourceShotIndex == null) {
          const lack = [
            sb.segmentIndex == null ? "段号" : "",
            sb.sourceShotIndex == null ? "镜号" : "",
          ].filter(Boolean);
          issues.push({
            code: "shot_source_binding_missing",
            severity: gate(),
            messageZh:
              `镜头 ${shot.shotId} 的来源绑定缺${lack.join("与")}，` +
              `只能验到集号，无法确认落点 ${binding.landingId} 属于这一镜。`,
            shotId: shot.shotId,
            eventId: event.eventId,
            landingId: binding.landingId,
          });
        }
      }

      if (!resolved.boundActorId) {
        issues.push({
          code: "landing_actor_unbound",
          severity: gate(),
          messageZh: `落点 ${binding.landingId} 还没绑定到具体角色，执行前必须绑定。`,
          shotId: shot.shotId,
          eventId: event.eventId,
          actorId: event.actorId,
          landingId: binding.landingId,
        });
      } else if (resolved.boundActorId !== event.actorId) {
        issues.push({
          code: "landing_actor_mismatch",
          severity: "error",
          messageZh:
            `落点 ${binding.landingId} 绑定的是 ${resolved.boundActorId}，` +
            `本事件的发起方是 ${event.actorId}；两边必须是同一个人。`,
          shotId: shot.shotId,
          eventId: event.eventId,
          actorId: event.actorId,
          landingId: binding.landingId,
        });
      }

      checkLandingSpace(shot, event, binding.landingId, resolved);
      checkLandingSurface(shot, event, binding, resolved);
    }
  }

  function checkLandingSpace(
    shot: ManhuaPlanShot,
    event: { eventId: string; kind: string },
    landingId: string,
    resolved: ManhuaResolvedLanding,
  ): void {
    if (resolved.point.space === "unresolved") {
      issues.push({
        code: "landing_space_unresolved",
        severity: gate(),
        messageZh:
          `落点 ${landingId} 标为未解析（${resolved.point.reasonZh}），` +
          `缺少深度/高度依据，无法还原出水或登船轨迹。`,
        shotId: shot.shotId,
        eventId: event.eventId,
        landingId,
      });
      return;
    }
    if (needsWorldPoint(event.kind) && resolved.point.space !== "world") {
      // 二维点没有深度，证明不了世界落点。
      // 不指望适配器自觉把 screen 改名成 unresolved 才有保护，校验器自己认这条。
      issues.push({
        code: "landing_world_point_required",
        severity: gate(),
        messageZh:
          `${event.kind === "land" ? "登船/落地" : "出水"}事件需要世界坐标落点，` +
          `当前落点 ${landingId} 只有${spaceZh(resolved.point)}；` +
          `二维点无深度，请补 3D 控制点或高度曲线（含单位与轴向）后再执行。`,
        shotId: shot.shotId,
        eventId: event.eventId,
        landingId,
      });
    }
  }

  function checkLandingSurface(
    shot: ManhuaPlanShot,
    event: { eventId: string; kind: string },
    binding: { landingId: string; surfaceRef?: string; surfaceZh?: string },
    resolved: ManhuaResolvedLanding,
  ): void {
    const ctx = {
      shotId: shot.shotId,
      eventId: event.eventId,
      landingId: binding.landingId,
    };

    // 两边都有稳定引用：**只认它**。同一 surfaceRef 改了展示名照样放行——
    // 中文名不是执行依据，改名不该让确认失效。
    if (binding.surfaceRef && resolved.surfaceRef) {
      if (binding.surfaceRef !== resolved.surfaceRef) {
        issues.push({
          code: "landing_surface_conflict",
          severity: "error",
          messageZh:
            `落点 ${binding.landingId} 的落地表面对不上：计划绑的是 ` +
            `${binding.surfaceRef}，解析结果是 ${resolved.surfaceRef}。`,
          ...ctx,
        });
      }
      return;
    }

    // 只有中文名时：同名**不能**证明是同一个表面，只能证明名字一样。
    // 名字都不一样就更明确了，直接报冲突。
    if (binding.surfaceZh && resolved.surfaceZh && binding.surfaceZh !== resolved.surfaceZh) {
      issues.push({
        code: "landing_surface_conflict",
        severity: "error",
        messageZh:
          `落点 ${binding.landingId} 的落地表面对不上：计划写「${binding.surfaceZh}」，` +
          `解析结果是「${resolved.surfaceZh}」。`,
        ...ctx,
      });
      return;
    }

    if (event.kind !== "land") return;

    // 登船/落地要**两边都有稳定引用**才算对得上。
    // 缺哪边就说哪边——**计划写了不能替解析来源补**：
    // 来源没有表面证据，执行就不能由计划单方面放行（0915 复审 P1）。
    const lacking: string[] = [];
    if (!binding.surfaceRef) lacking.push("计划侧");
    if (!resolved.surfaceRef) lacking.push("解析来源侧");
    if (lacking.length) {
      const bothChineseOnly =
        !binding.surfaceRef && !resolved.surfaceRef && Boolean(binding.surfaceZh || resolved.surfaceZh);
      issues.push({
        code: "landing_surface_ref_missing",
        severity: gate(),
        messageZh:
          `登船/落地事件 ${event.eventId} 缺少落地表面的稳定引用（${lacking.join("与")}）；` +
          (bothChineseOnly
            ? `目前只有展示名，同名只能证明名字一样、不能证明是同一个表面。`
            : `请在真实表面实体上取 surfaceRef，不要按展示名临时生成。`),
        ...ctx,
      });
      return;
    }
  }

  function checkShotCamera(shot: ManhuaPlanShot): void {
    const cam = shot.camera;
    if (!cam) return;

    const hits = cameraByKey.get(cameraKey(cam.source, cam.sourceShotRef)) ?? [];
    if (hits.length > 1) {
      issues.push({
        code: "camera_context_ambiguous",
        severity: "error",
        messageZh: `相机来源 ${cam.source}:${cam.sourceShotRef} 解析出 ${hits.length} 条记录，无法确定用哪一条。`,
        shotId: shot.shotId,
      });
      return;
    }
    const resolvedCam = hits[0];
    if (!resolvedCam) {
      issues.push({
        code: "camera_source_not_found",
        severity: "error",
        messageZh: `相机来源 ${cam.source}:${cam.sourceShotRef} 不存在（可能已被删除或改名）。`,
        shotId: shot.shotId,
      });
      return;
    }

    if (resolvedCam.sourceRevision !== cam.sourceRevision) {
      issues.push({
        code: "camera_revision_mismatch",
        severity: "error",
        messageZh:
          `相机来源 ${cam.sourceShotRef} 在绑定之后被改过` +
          `（绑定版本 ${cam.sourceRevision}，当前 ${resolvedCam.sourceRevision}）。`,
        shotId: shot.shotId,
      });
    }

    if (cam.timedSamplesResolved && !resolvedCam.timedSamplesAvailable) {
      // 任何模式都是 error：这不是「还没做」，是声称了做不到的事
      issues.push({
        code: "camera_timed_samples_overclaimed",
        severity: "error",
        messageZh:
          `相机绑定声称已解析成带时间采样，但来源 ${cam.sourceShotRef} 给不出` +
          `（该来源只有空间点、没有秒数）；不能当作已锁定机位。`,
        shotId: shot.shotId,
      });
      return;
    }
    if (!cam.timedSamplesResolved) {
      issues.push({
        code: "camera_timed_samples_pending",
        severity: gate(),
        messageZh: `相机来源 ${cam.sourceShotRef} 尚未解析成带时间采样，执行前需先解析。`,
        shotId: shot.shotId,
      });
      return;
    }

    // 到这里＝声称已解析、来源也说给得出。
    // **两个 true 不等于有证据**：执行期必须拿得出覆盖范围、显式基准与采样能力。
    const missing: string[] = [];
    if (!resolvedCam.coverage) missing.push("覆盖范围");
    if (!resolvedCam.coverageBasis) missing.push("覆盖时间基准");
    if (!resolvedCam.sampling) missing.push("采样能力");
    if (missing.length) {
      issues.push({
        code: "camera_evidence_missing",
        severity: gate(),
        messageZh:
          `相机来源 ${cam.sourceShotRef} 声称已解析，但缺少${missing.join("、")}；` +
          `不能只凭「已解析」这个声明当作事实。`,
        shotId: shot.shotId,
      });
    }

    if (resolvedCam.coverage && resolvedCam.coverageBasis) {
      const neededSec =
        cam.timeBasis === "presentation"
          ? manhuaPresentationDurationSec(shot.timeMap)
          : shot.timeMap.sourceDurationSec;
      if (resolvedCam.coverageBasis !== cam.timeBasis) {
        // 不换算——换算要靠 timeMap，这里如实说无法断言，不猜
        issues.push({
          code: "camera_coverage_gap",
          severity: gate(),
          messageZh:
            `相机覆盖按${basisZh(resolvedCam.coverageBasis)}给出，而绑定声明按` +
            `${basisZh(cam.timeBasis)}，两者不是同一条时间轴，无法断言是否盖得住。`,
          shotId: shot.shotId,
        });
      } else if (
        resolvedCam.coverage.startSec > 1e-6 ||
        resolvedCam.coverage.endSec - resolvedCam.coverage.startSec + 1e-6 < neededSec
      ) {
        issues.push({
          code: "camera_coverage_gap",
          severity: gate(),
          messageZh:
            `相机覆盖 ${resolvedCam.coverage.startSec}–${resolvedCam.coverage.endSec}s ` +
            `盖不住本镜所需的 0–${neededSec.toFixed(3)}s（${basisZh(cam.timeBasis)}）。`,
          shotId: shot.shotId,
        });
      }
    }

    // 只有离散采样才谈帧率；可连续求值的曲线不必伪造 fps
    if (
      resolvedCam.sampling?.kind === "discrete" &&
      resolvedCam.sampling.fps + 1e-9 < MANHUA_TIMING_FPS
    ) {
      issues.push({
        code: "camera_sampling_fps_low",
        severity: gate(),
        messageZh:
          `相机离散采样 ${resolvedCam.sampling.fps}fps 低于时间映射基准 ${MANHUA_TIMING_FPS}fps，` +
          `变速区间需要更密的采样，或改用可连续求值的曲线。`,
        shotId: shot.shotId,
      });
    }
  }
}

/** 是否存在会拦住执行的绑定问题 */
export function hasBlockingManhuaBindingIssues(issues: ManhuaBindingIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

/**
 * 依赖的落点/相机**引用**是否仍与确认时一致。
 *
 * ⚠️ 这**不是**「能不能执行」的总开关（0915 复审点名）。它只回答一件事：
 * 落点被移动/删除/跨镜/歧义、表面被换、绑定角色变了、相机被改或假称已解析——
 * 这类「引用对不上」是否发生，据以让原先的确认失效（决定四/六）。
 *
 * 「还没填」「二维点缺深度」「相机缺证据」属于**尚未具备执行条件**，不在本函数范围内。
 * 要判断能不能执行，用
 * `validateManhuaActionPlanBindings(plan, ctx, "execution")` ＋ `hasBlockingManhuaBindingIssues`。
 */
export function areManhuaPlanBindingReferencesStillValid(
  plan: ManhuaActionPlan,
  context: ManhuaActionPlanBindingContext,
): boolean {
  const invalidating = new Set<ManhuaBindingIssueCode>([
    "landing_not_found",
    "landing_revision_mismatch",
    "landing_overlay_mismatch",
    "landing_context_ambiguous",
    "landing_shot_binding_mismatch",
    "landing_actor_mismatch",
    "landing_surface_conflict",
    "camera_source_not_found",
    "camera_revision_mismatch",
    "camera_context_ambiguous",
    "camera_timed_samples_overclaimed",
  ]);
  return !validateManhuaActionPlanBindings(plan, context, "draft").some((i) =>
    invalidating.has(i.code),
  );
}
