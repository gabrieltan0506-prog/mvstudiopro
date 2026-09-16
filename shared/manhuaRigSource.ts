/**
 * 绑骨模型来源（0916）：一个人物的绑骨/白模模型不一定挂在当前锁脸图上——
 * 原定妆是垂臂/持物姿势时，绑骨用的是另出的 A-pose 候选图（原定妆与高模保留，A-pose 只是绑骨生产资产）。
 * 这里按同一人物（claimedAnchorIds 有交集）的所有 ref 解析「绑骨用哪张图的模型」：
 *   锁脸图上钉选了 rigSourceRefId 且那张图有就绪模型 → 用它（用户点过「改用 X 绑骨」）；
 *   否则 锁脸图自己有就绪模型 → 用它；否则 → 第一张有就绪模型的候选图；都没有 → 无。
 * 纯函数，UI（3D 模型工作台 / 白模 / 场景预览）与 riggedIds 统一用这一份口径。
 */
import { evaluateManhuaAsset3dEligibility, type ManhuaAsset3dRef } from "./manhuaAsset3d.js";
import type { ManhuaCustomAssetRef } from "./manhuaCustomAssetRefs.js";

export type ManhuaRigSource = {
  /** 模型所在 ref（绑骨编辑器 / 任务列表都按它） */
  refId: string;
  labelZh: string;
  thumbUrl?: string;
  /** 就绪模型（status succeeded） */
  model: ManhuaAsset3dRef;
  /** 是否来自候选图（不是当前锁脸图） */
  isCandidate: boolean;
};

export type ManhuaRigSourceResolution = {
  source?: ManhuaRigSource;
  /** source 是否来自锁脸图上的钉选 */
  pinned: boolean;
  /** 所有有就绪模型的同人物 ref（锁脸图在前） */
  options: ManhuaRigSource[];
};

function anchorsOf(ref: Pick<ManhuaCustomAssetRef, "claimedAnchorIds">): Set<string> {
  return new Set((ref.claimedAnchorIds || []).map((v) => String(v || "").trim()).filter(Boolean));
}

function readyModelOf(ref: ManhuaCustomAssetRef): ManhuaAsset3dRef | undefined {
  const e = evaluateManhuaAsset3dEligibility(ref);
  return e.eligible && e.currentModel3d?.status === "succeeded" ? e.currentModel3d : undefined;
}

/** 同一人物的候选 ref：人物图、与锁脸图认领的角色有交集、不是锁脸图本身 */
export function listManhuaSameCharacterRefs(primary: ManhuaCustomAssetRef, refs: readonly ManhuaCustomAssetRef[]): ManhuaCustomAssetRef[] {
  const anchors = anchorsOf(primary);
  if (!anchors.size) return [];
  return refs.filter((r) => r.id !== primary.id && r.role === "character" && Array.from(anchorsOf(r)).some((a) => anchors.has(a)));
}

export function resolveManhuaRigSource(primary: ManhuaCustomAssetRef | undefined, refs: readonly ManhuaCustomAssetRef[]): ManhuaRigSourceResolution {
  if (!primary) return { options: [], pinned: false };
  const options: ManhuaRigSource[] = [];
  const own = readyModelOf(primary);
  if (own) options.push({ refId: primary.id, labelZh: primary.labelZh || primary.id, thumbUrl: primary.url, model: own, isCandidate: false });
  for (const r of listManhuaSameCharacterRefs(primary, refs)) {
    const m = readyModelOf(r);
    if (m) options.push({ refId: r.id, labelZh: r.labelZh || r.id, thumbUrl: r.url, model: m, isCandidate: true });
  }
  const pin = String(primary.rigSourceRefId || "").trim();
  const pinned = pin ? options.find((o) => o.refId === pin) : undefined;
  return { source: pinned ?? options[0], options, pinned: Boolean(pinned) };
}
