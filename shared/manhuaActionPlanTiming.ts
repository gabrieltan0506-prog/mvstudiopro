/**
 * 镜头时间映射：把**动作源时间**与**成片呈现时间**分成两件事。
 *
 * 为什么必须分开（0915 决定五）：
 * 「接触那一下慢放」不是某个角色的属性。一个 2 秒的动作以 0.5 倍播放会占掉 4 秒成片，
 * 镜长、段内偏移、参考素材长度全都要跟着重算；而攻防双方、武器、水花、火星
 * 必须共用同一条时间映射——否则出现「攻击方 0.2 倍慢放、被打的人仍是常速」
 * 这种物理上不存在的画面。
 *
 * 所以：
 * - 事件上只能标「希望慢看」（intent），**不能各自带播放倍率**；
 * - 真正的变速统一落在镜头的 `timeMap` 上，一镜一条，全员共享；
 * - 接触关联的效果（水花/火星/受力）一律跟**场景时间**（源时间），
 *   相机跟哪一种必须显式声明，不许靠默认。
 *
 * 本模块是纯函数，无 zod 之外的依赖，浏览器与服务端同用。
 */

import { z } from "zod";

/** 全链既有契约：24fps（render-manhua-previs.py / overlay / previs 一致） */
export const MANHUA_TIMING_FPS = 24 as const;

/** 浮点比较容差：1/24 秒的千分之一，足够区分帧又不被浮点误差绊倒 */
const EPS = 1e-6;

/**
 * 一段变速区间。`rate` 是**源时间流逝速度**：
 * rate=1 常速；rate=0.5 表示源里 1 秒要放 2 秒（慢动作）；rate=2 表示快放。
 * 不允许 0（时停是另一种能力，首版不做，见决定五）。
 */
export const manhuaTimeMapSpanSchema = z
  .object({
    sourceStartSec: z.number().finite().min(0),
    sourceEndSec: z.number().finite().min(0),
    rate: z.number().finite().min(0.05).max(8),
  })
  .strict();
export type ManhuaTimeMapSpan = z.infer<typeof manhuaTimeMapSpanSchema>;

/**
 * 镜头时间映射。`spans` 必须按源时间升序、互不重叠、覆盖 [0, sourceDurationSec]。
 * 没有变速时给一条 rate=1 的整段即可（也可以留空数组表示全程常速）。
 */
export const manhuaShotTimeMapSchema = z
  .object({
    /** 动作源时长（秒）——编排时用的时间轴 */
    sourceDurationSec: z.number().finite().positive().max(120),
    spans: z.array(manhuaTimeMapSpanSchema).max(24).default([]),
  })
  .strict();
export type ManhuaShotTimeMap = z.infer<typeof manhuaShotTimeMapSchema>;

export type ManhuaTimeMapIssueCode =
  | "span_reversed"
  | "span_overlap"
  | "span_out_of_source"
  | "span_gap"
  | "span_uncovered_tail";

export type ManhuaTimeMapIssue = { code: ManhuaTimeMapIssueCode; messageZh: string; spanIndex?: number };

/**
 * 校验时间映射自洽。**不静默补齐**——缺口要报出来，
 * 因为「这段到底常速还是漏写了」只有人知道。
 */
export function validateManhuaShotTimeMap(map: ManhuaShotTimeMap): ManhuaTimeMapIssue[] {
  const issues: ManhuaTimeMapIssue[] = [];
  if (!map.spans.length) return issues; // 空 = 全程常速，合法

  let cursor = 0;
  map.spans.forEach((span, i) => {
    if (span.sourceEndSec <= span.sourceStartSec + EPS) {
      issues.push({ code: "span_reversed", messageZh: `第 ${i + 1} 段变速区间首尾颠倒或长度为零`, spanIndex: i });
      return;
    }
    if (span.sourceStartSec < -EPS || span.sourceEndSec > map.sourceDurationSec + EPS) {
      issues.push({
        code: "span_out_of_source",
        messageZh: `第 ${i + 1} 段变速区间超出本镜源时长 ${map.sourceDurationSec} 秒`,
        spanIndex: i,
      });
      return;
    }
    if (span.sourceStartSec < cursor - EPS) {
      issues.push({ code: "span_overlap", messageZh: `第 ${i + 1} 段变速区间与上一段重叠`, spanIndex: i });
      return;
    }
    if (span.sourceStartSec > cursor + EPS) {
      issues.push({
        code: "span_gap",
        messageZh: `第 ${i + 1} 段变速区间之前有 ${(span.sourceStartSec - cursor).toFixed(3)} 秒没写速度——是常速还是漏了，必须写明`,
        spanIndex: i,
      });
    }
    cursor = span.sourceEndSec;
  });

  if (map.spans.length && cursor < map.sourceDurationSec - EPS) {
    issues.push({
      code: "span_uncovered_tail",
      messageZh: `本镜尾部 ${(map.sourceDurationSec - cursor).toFixed(3)} 秒没写速度——是常速还是漏了，必须写明`,
    });
  }
  return issues;
}

/** 补齐为「全覆盖」映射：未写的区间按常速填。**显式调用**，不在校验里偷偷做 */
export function fillManhuaShotTimeMap(map: ManhuaShotTimeMap): ManhuaShotTimeMap {
  const spans: ManhuaTimeMapSpan[] = [];
  let cursor = 0;
  for (const span of [...map.spans].sort((a, b) => a.sourceStartSec - b.sourceStartSec)) {
    if (span.sourceStartSec > cursor + EPS) {
      spans.push({ sourceStartSec: cursor, sourceEndSec: span.sourceStartSec, rate: 1 });
    }
    spans.push(span);
    cursor = Math.max(cursor, span.sourceEndSec);
  }
  if (cursor < map.sourceDurationSec - EPS) {
    spans.push({ sourceStartSec: cursor, sourceEndSec: map.sourceDurationSec, rate: 1 });
  }
  if (!spans.length) {
    spans.push({ sourceStartSec: 0, sourceEndSec: map.sourceDurationSec, rate: 1 });
  }
  return { sourceDurationSec: map.sourceDurationSec, spans };
}

/**
 * 成片呈现时长。**这才是排镜长、算段内偏移、比对参考素材长度时该用的数**——
 * 2 秒动作 0.5 倍播放占 4 秒，拿源时长去排就会错 2 秒。
 */
export function manhuaPresentationDurationSec(map: ManhuaShotTimeMap): number {
  const filled = fillManhuaShotTimeMap(map);
  return filled.spans.reduce(
    (sum, s) => sum + (s.sourceEndSec - s.sourceStartSec) / s.rate,
    0,
  );
}

/** 源时间 → 呈现时间。超出源时长按末端截断（调用方应先校验） */
export function manhuaSourceToPresentationSec(map: ManhuaShotTimeMap, sourceSec: number): number {
  const filled = fillManhuaShotTimeMap(map);
  const t = Math.max(0, Math.min(sourceSec, filled.sourceDurationSec));
  let acc = 0;
  for (const span of filled.spans) {
    if (t <= span.sourceStartSec + EPS) break;
    const covered = Math.min(t, span.sourceEndSec) - span.sourceStartSec;
    if (covered > 0) acc += covered / span.rate;
    if (t <= span.sourceEndSec + EPS) break;
  }
  return acc;
}

/** 呈现时间 → 源时间。用于「成片上这一帧对应编排里的哪一刻」 */
export function manhuaPresentationToSourceSec(
  map: ManhuaShotTimeMap,
  presentationSec: number,
): number {
  const filled = fillManhuaShotTimeMap(map);
  const total = manhuaPresentationDurationSec(filled);
  const t = Math.max(0, Math.min(presentationSec, total));
  let acc = 0;
  for (const span of filled.spans) {
    const spanPresentation = (span.sourceEndSec - span.sourceStartSec) / span.rate;
    if (t <= acc + spanPresentation + EPS) {
      return span.sourceStartSec + (t - acc) * span.rate;
    }
    acc += spanPresentation;
  }
  return filled.sourceDurationSec;
}

/** 对齐到 24fps 帧边界（源时间口径） */
export function manhuaSnapToFrameSec(sec: number, fps: number = MANHUA_TIMING_FPS): number {
  return Math.round(sec * fps) / fps;
}

/**
 * 时间口径：谁跟源时间、谁跟呈现时间，**必须显式声明**。
 * 决定五：接触关联效果一律跟场景（源）时间；相机跟哪一种要写明，不许默认。
 */
export const manhuaTimeBasisSchema = z.enum([
  /** 场景/动作源时间——物理因果（接触、水花、火星、受力）只能跟这个 */
  "source",
  /** 成片呈现时间——观众看到的那条时间轴 */
  "presentation",
]);
export type ManhuaTimeBasis = z.infer<typeof manhuaTimeBasisSchema>;
