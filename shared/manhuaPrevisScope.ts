import type { ManhuaPrevisSpec, ManhuaPrevisStudio } from "./manhuaPrevis";
import type { ManhuaSegmentReferenceEntry } from "./manhuaSegmentReference";
import type { ManhuaAutoSegmentBinding } from "./manhuaAutoSegment";

type SourceSpec = Pick<ManhuaPrevisSpec, "scriptSource">;
/** 只陈述已保存的原稿来源，不从当前选镜反推历史候选的归属。 */
export function manhuaPrevisSourceLabel(spec?: SourceSpec): string {
  const source = spec?.scriptSource;
  if (!source) return "未记录原镜归属 · 本段共享配置";
  const indexes = source.shots.map(shot => shot.index);
  return `原稿来源：第 ${indexes.join("、")} 镜${source.unmappedShotIndices.length ? `；第 ${source.unmappedShotIndices.join("、")} 镜动作未自动映射` : ""}`;
}

/** motionGuideZh 按既有合同仅由工厂白模产生；普通上传短参考不套用整段覆盖规则。 */
export function manhuaGeneratedPrevisCoverageIssue(input: {
  reference?: ManhuaSegmentReferenceEntry;
  studio?: Pick<ManhuaPrevisStudio, "history">;
  durationSec?: number;
  shotIndexes?: readonly number[];
  autoSegment?: Pick<ManhuaAutoSegmentBinding, "revision">;
}): string | undefined {
  const reference = input.reference;
  if (!reference) return;
  const take = input.studio?.history.find(item =>
    reference.gcsUri && item.gcsUri
      ? reference.gcsUri === item.gcsUri
      : reference.url === item.url
  );
  if (!take && !reference.motionGuideZh?.trim()) return;
  const duration = reference.durationSec ?? take?.durationSec;
  if (input.durationSec != null && Number.isFinite(input.durationSec)) {
    if (duration == null || !Number.isFinite(duration))
      return "系统白模未记录时长，无法确认覆盖本段；请核对原任务，本次不替换参考或提交成片。";
    if (take && Math.abs(take.durationSec - duration) > 0.05)
      return `系统白模参考时长 ${duration} 秒与原任务 ${take.durationSec} 秒不一致；请核对原任务，旧参考保留，本次未提交。`;
    if (Math.abs(duration - input.durationSec) > 0.05) {
      return `系统白模 ${duration} 秒与本段 ${input.durationSec} 秒不一致，不能作为整段秒位参考；请先准备覆盖本段的白模。旧参考与候选保留，本次未提交。`;
    }
  }
  const source = take?.spec.scriptSource;
  if (source && input.shotIndexes?.length) {
    const actual = Array.from(new Set(source.shots.map(shot => shot.index)));
    const expected = Array.from(new Set(input.shotIndexes));
    if (
      actual.length !== expected.length ||
      actual.some((index, position) => expected[position] !== index)
    ) {
      return `系统白模原稿来源为第 ${actual.join("、")} 镜，与本段第 ${expected.join("、")} 镜不一致；不能将别镜候选作为本段参考。旧参考保留。`;
    }
  }
  // 当前分段保留镜内窗口，但历史 scriptSource 只有镜号/时长/动作。
  // 在未保存可核对的窗口身份前，不能把同镜前半段白模误用于后半段。
  if (input.autoSegment) {
    let shots: Array<{ sourceOffsetSec?: number; sourceDurationSec?: number; durationSec?: number }>;
    try {
      const revision = JSON.parse(input.autoSegment.revision);
      if (!Array.isArray(revision.shots) || !revision.shots.length) throw new Error("missing shots");
      shots = revision.shots;
      if (shots.some(shot => !shot || typeof shot !== "object")) throw new Error("invalid shots");
    } catch {
      return "本段原镜窗口身份无法解析，不能确认系统白模覆盖范围；旧参考与候选保留，本次未提交。";
    }
    if (shots.some(shot =>
      (typeof shot.sourceOffsetSec === "number" && shot.sourceOffsetSec > 0) ||
      (typeof shot.sourceDurationSec === "number" && typeof shot.durationSec === "number" && shot.sourceDurationSec > shot.durationSec + 0.000001)
    )) {
      return "本段是长镜的镜内窗口，系统白模历史未保存可核对的镜内起止范围，无法确认属于本窗口；不能仅凭相同镜号和时长采用。旧参考与候选保留，本次未提交。";
    }
  }
}
