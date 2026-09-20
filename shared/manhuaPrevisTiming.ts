/**
 * previs 时序桥（PR-2）：白模脚本消费**同一份**可执行镜头 + timeMap，不复制第四份镜头时间。
 *
 * 口径（决定五）：
 *   - Blender/previs 只认**源时间**（物理因果：接触、水花、受力）；输出 durationSec/frame 都是源时间。
 *   - 慢看（timeMap 变速）不进 Blender：白模按源时间常速渲染，呈现变速在组装期按同一 timeMap 重定时。
 *     这里把变速段换算成「相对本可执行镜头源起点」的区间，供组装期直接用，避免二次推算。
 *   - previs 规格的 durationSec 是整数秒（2–30）：源区间不足整秒**向上取整**并如实登记 padSec，
 *     不把 5.3 秒说成 5 秒；超过 30 秒是能力上限，报 issue，不静默截断。
 */
import type { ManhuaExecutableShot } from "./manhuaActionPlanSplit";
import { MANHUA_TIMING_FPS, manhuaSourceToPresentationSec } from "./manhuaActionPlanTiming";
import type { ManhuaResolvedCameraSource } from "./manhuaActionPlanBindings";

export const PREVIS_SPEC_MIN_SEC = 2;
export const PREVIS_SPEC_MAX_SEC = 30;

export type ManhuaPrevisContactCue = {
  eventId: string;
  actorId: string;
  targetActorId?: string;
  kind: ManhuaExecutableShot["events"][number]["kind"];
  /** 相对本可执行镜头源起点（秒） */
  contactSec: number;
  windupStartSec: number;
  recoverEndSec: number;
  slowMotionIntent: boolean;
};

export type ManhuaPrevisTimingIssue = {
  code: "span_exceeds_previs_max" | "camera_coverage_incomplete" | "camera_timing_unavailable" | "cue_outside_span";
  messageZh: string;
  eventId?: string;
};

export type ManhuaPrevisTiming = {
  executableShotId: string;
  sourceShotId: string;
  /** previs 规格用的整数秒（源时间，向上取整） */
  durationSec: number;
  /** 取整补出来的秒数；0 表示刚好 */
  padSec: number;
  fps: typeof MANHUA_TIMING_FPS;
  frameStart: 1;
  frameEnd: number;
  /** 源区间在整镜里的绝对位置 */
  sourceSpan: { startSec: number; endSec: number };
  contactCues: ManhuaPrevisContactCue[];
  /** 相机在本区间的覆盖（源秒，相对起点）；无时间采样则 null */
  cameraCoverage: { startSec: number; endSec: number } | null;
  /** 组装期重定时用：相对起点的变速段 + 对应呈现时间起止 */
  presentationSpans: Array<{ sourceStartSec: number; sourceEndSec: number; rate: number; presentationStartSec: number; presentationEndSec: number }>;
  issues: ManhuaPrevisTimingIssue[];
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function manhuaPrevisTimingForExecutableShot(
  shot: ManhuaExecutableShot,
  resolvedCamera?: ManhuaResolvedCameraSource | null,
): ManhuaPrevisTiming {
  const issues: ManhuaPrevisTimingIssue[] = [];
  const { startSec, endSec } = shot.sourceSpan;
  const spanSec = Math.max(0, endSec - startSec);
  const rawDuration = Math.max(PREVIS_SPEC_MIN_SEC, Math.ceil(spanSec - 1e-9));
  const durationSec = Math.min(PREVIS_SPEC_MAX_SEC, rawDuration);
  if (rawDuration > PREVIS_SPEC_MAX_SEC) {
    issues.push({
      code: "span_exceeds_previs_max",
      messageZh: `可执行镜头 ${shot.executableShotId} 源区间 ${spanSec.toFixed(1)}s 超过白模单段 ${PREVIS_SPEC_MAX_SEC}s 上限，请回拆镜器再拆`,
    });
  }
  const padSec = r3(durationSec - spanSec);

  const contactCues: ManhuaPrevisContactCue[] = [];
  for (const e of shot.events) {
    const contact = e.phases.find((p) => p.kind === "contact") ?? e.phases.find((p) => p.kind === "burst");
    const first = e.phases[0]!;
    const last = e.phases[e.phases.length - 1]!;
    const contactAbs = contact ? contact.sourceStartSec : first.sourceStartSec;
    if (contactAbs < startSec - 1e-9 || contactAbs > endSec + 1e-9) {
      issues.push({ code: "cue_outside_span", eventId: e.eventId, messageZh: `事件 ${e.eventId} 的接触点 ${contactAbs}s 不在本可执行镜头源区间内`, });
      continue;
    }
    contactCues.push({
      eventId: e.eventId,
      actorId: e.actorId,
      ...(e.kind === "attack" ? { targetActorId: e.targetActorId } : {}),
      kind: e.kind,
      contactSec: r3(contactAbs - startSec),
      windupStartSec: r3(Math.max(0, first.sourceStartSec - startSec)),
      recoverEndSec: r3(Math.min(spanSec, last.sourceEndSec - startSec)),
      slowMotionIntent: e.slowMotionIntent,
    });
  }

  let cameraCoverage: ManhuaPrevisTiming["cameraCoverage"] = null;
  if (!resolvedCamera || !resolvedCamera.timedSamplesAvailable || !resolvedCamera.coverage) {
    issues.push({ code: "camera_timing_unavailable", messageZh: `可执行镜头 ${shot.executableShotId} 没有带时间的相机采样，白模只能用默认机位` });
  } else if (resolvedCamera.coverageBasis !== "source") {
    // 相机按呈现时间给的：不在这里换算（换算要整镜 timeMap 与呈现偏移），如实报未覆盖
    issues.push({ code: "camera_coverage_incomplete", messageZh: `相机覆盖按呈现时间给出，previs 需要源时间覆盖；请在绑定层换算后再交` });
  } else {
    const cs = Math.max(startSec, resolvedCamera.coverage.startSec);
    const ce = Math.min(endSec, resolvedCamera.coverage.endSec);
    if (ce - cs + 1e-9 < spanSec) {
      issues.push({ code: "camera_coverage_incomplete", messageZh: `相机只覆盖源 ${cs.toFixed(1)}–${ce.toFixed(1)}s，本镜需要 ${startSec.toFixed(1)}–${endSec.toFixed(1)}s` });
    }
    if (ce > cs) cameraCoverage = { startSec: r3(cs - startSec), endSec: r3(ce - startSec) };
  }

  // 变速段裁到本区间，并算出呈现时间起止（用整镜 timeMap，保证与组装同源）
  const spans = shot.timeMap.spans.length ? shot.timeMap.spans : [{ sourceStartSec: 0, sourceEndSec: shot.timeMap.sourceDurationSec, rate: 1 }];
  const presentationOrigin = manhuaSourceToPresentationSec(shot.timeMap, startSec);
  const presentationSpans = spans
    .map((s) => ({ a: Math.max(s.sourceStartSec, startSec), b: Math.min(s.sourceEndSec, endSec), rate: s.rate }))
    .filter((s) => s.b > s.a + 1e-9)
    .map((s) => ({
      sourceStartSec: r3(s.a - startSec),
      sourceEndSec: r3(s.b - startSec),
      rate: s.rate,
      presentationStartSec: r3(manhuaSourceToPresentationSec(shot.timeMap, s.a) - presentationOrigin),
      presentationEndSec: r3(manhuaSourceToPresentationSec(shot.timeMap, s.b) - presentationOrigin),
    }));

  return {
    executableShotId: shot.executableShotId,
    sourceShotId: shot.sourceShotId,
    durationSec,
    padSec,
    fps: MANHUA_TIMING_FPS,
    frameStart: 1,
    frameEnd: durationSec * MANHUA_TIMING_FPS,
    sourceSpan: { startSec, endSec },
    contactCues,
    cameraCoverage,
    presentationSpans,
    issues,
  };
}
