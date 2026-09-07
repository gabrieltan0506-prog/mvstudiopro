import type { ManhuaCloudDraftPayload } from "@shared/manhuaCloudDraft";
import { fingerprintManhuaWriterAssetCanon } from "@shared/manhuaAssetScriptSync";
import { migrateRetiredManhuaLayoutVideoModel } from "@shared/manhuaSeedanceLayout";
import { healManhuaWriterSessionCanonDrift } from "@shared/manhuaWriterSession";
import { cloudDraftBlocksToCanvas } from "./manhuaCloudDraftSync";
import { MANHUA_CUSTOM_ASSET_REFS_MAX } from "@shared/manhuaCustomAssetRefs";

const INVALID_BACKUP_ZH =
  "备份文件内容无法安全恢复，尚未写入图片或替换工作区，请保留原文件";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * 确认和写库前预跑实际同步恢复消费者；不写媒体库、不联网、不发布 UI 状态。
 * 只防已知结构及同步异常，不承诺完整业务 schema 或画质验收。
 * 转换与纠偏结果仅用于预检，不用清洗后的结果覆盖原稿；旧稿只补缺失的 edges。
 */
export function prepareManhuaBackupRestore(
  raw: unknown
): ManhuaCloudDraftPayload {
  if (isRecord(raw)) {
    for (const container of [raw.writerSession, raw.factoryPrefs]) {
      if (
        isRecord(container) &&
        Array.isArray(container.customAssetRefs) &&
        container.customAssetRefs.length > MANHUA_CUSTOM_ASSET_REFS_MAX
      ) {
        throw new Error(
          `备份资产超过当前 ${MANHUA_CUSTOM_ASSET_REFS_MAX} 张容量，尚未写入图片或替换工作区，请保留原文件`
        );
      }
    }
  }
  try {
    if (!isRecord(raw) || !isRecord(raw.writerSession) || !isRecord(raw.canvas))
      throw new Error();
    if (!Array.isArray(raw.canvas.blocks) || !raw.canvas.blocks.every(isRecord))
      throw new Error();
    if (raw.canvas.edges !== undefined && !Array.isArray(raw.canvas.edges))
      throw new Error();
    if (Array.isArray(raw.canvas.edges) && !raw.canvas.edges.every(isRecord))
      throw new Error();
    if (raw.factoryPrefs != null && !isRecord(raw.factoryPrefs))
      throw new Error();
    const sessionRaw = raw.writerSession;
    for (const key of ["projectBible", "writerPack"] as const) {
      if (sessionRaw[key] != null && !isRecord(sessionRaw[key]))
        throw new Error();
    }
    const bible = isRecord(sessionRaw.projectBible)
      ? sessionRaw.projectBible
      : undefined;
    if (bible?.assetCanon != null && !isRecord(bible.assetCanon))
      throw new Error();
    if (bible?.cast != null && !isRecord(bible.cast)) throw new Error();
    const cast = isRecord(bible?.cast) ? bible.cast : undefined;
    // 页面直接 filter／索引后把这些值写入数组状态，不能让字符串或空条目穿透。
    for (const key of [
      "propIds",
      "characterIds",
      "ancientArchetypeIds",
      "wardrobePropContinuityIds",
    ]) {
      const value = cast?.[key];
      if (
        value != null &&
        (!Array.isArray(value) ||
          !value.every(item => typeof item === "string"))
      )
        throw new Error();
    }

    const draft = (raw.canvas.edges === undefined
      ? { ...raw, canvas: { ...raw.canvas, edges: [] } }
      : raw) as unknown as ManhuaCloudDraftPayload;
    const healed = healManhuaWriterSessionCanonDrift(draft.writerSession);
    const session = healed.session ?? draft.writerSession;
    cloudDraftBlocksToCanvas(draft.canvas.blocks, {
      videoModel: migrateRetiredManhuaLayoutVideoModel(session.videoModel),
    });
    // 与页面资产选择作用域同源，覆盖 canon.locations／characters 的真实 map 消费。
    fingerprintManhuaWriterAssetCanon(session.projectBible?.assetCanon);
    return draft;
  } catch {
    throw new Error(INVALID_BACKUP_ZH);
  }
}
