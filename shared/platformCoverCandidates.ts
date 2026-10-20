/** 封面候选与已采用封面分离，刷新和旧任务恢复共用此契约。 */
export const COVER_CANDIDATE_COUNT = 3;
export const COVER_DESIGNS = [
  { id: "story", label: "故事现场", direction: "以内容中实际发生的动作和环境叙事为主，环境中景、自然抓拍、人物松弛；标题留在真实负空间，不做僵硬证件照。", grade: "natural" },
  { id: "subject", label: "主体细节", direction: "以视频真实主角或商品的关键细节为视觉中心，近中景、前景引导与柔和侧光；标题靠空白侧排列，不遮脸和商品。", grade: "soft" },
  { id: "space", label: "空间氛围", direction: "以视频真实场景的空间层次为主，较宽环境构图、前中后景与有动机的明暗；主体仍可辨认，标题融入画面留白。", grade: "cinematic" },
] as const;
export type CoverGradeStyle = typeof COVER_DESIGNS[number]["grade"];
export type CoverCandidate = {
  id: string;
  label: string;
  status: "pending" | "generating" | "grading" | "ready" | "failed" | "uncertain";
  originalUrl?: string;
  imageUrl?: string;
  receiptUrl?: string;
  error?: string;
  billing?: "pending" | "charged" | "settled" | "refunded" | "refund_pending";
};
export type CoverCandidateSet = {
  version: 1;
  jobId: string;
  sceneId: string;
  candidates: CoverCandidate[];
  selectedId: string | null;
};

export function readCoverCandidateSet(value: unknown): CoverCandidateSet | null {
  if (!value || typeof value !== "object") return null;
  const v = value as CoverCandidateSet;
  if (v.version !== 1 || typeof v.jobId !== "string" || typeof v.sceneId !== "string" || !Array.isArray(v.candidates)) return null;
  if (v.candidates.length !== 3 || new Set(v.candidates.map(c => c.id)).size !== 3) return null;
  if (v.candidates.some(c => !COVER_DESIGNS.some(d => d.id === c.id) || !["pending", "generating", "grading", "ready", "failed", "uncertain"].includes(c.status))) return null;
  return v;
}

export function selectedCoverCandidate(set: CoverCandidateSet): CoverCandidate | null {
  return set.candidates.find(c => c.id === set.selectedId && c.status === "ready" && c.imageUrl && c.originalUrl && c.receiptUrl) ?? null;
}
