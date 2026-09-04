export const MANHUA_ASSET_3D_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "reconcile_manual",
] as const;

export type ManhuaAsset3dStatus = (typeof MANHUA_ASSET_3D_STATUSES)[number];

/** 人物参考图派生的可选 3D 资产；GLB 长期身份以 gs:// 为准，HTTPS 只用于当前预览。 */
export type ManhuaAsset3dRef = {
  status: ManhuaAsset3dStatus;
  taskId: string;
  sourceImageUrl: string;
  sourceVersion: string;
  predictionId?: string;
  glbGcsUri?: string;
  glbUrl?: string;
  errorZh?: string;
  updatedAt: number;
};

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeManhuaAsset3dRef(
  raw: unknown
): ManhuaAsset3dRef | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const input = raw as Partial<ManhuaAsset3dRef>;
  const status = String(input.status || "") as ManhuaAsset3dStatus;
  const taskId = String(input.taskId || "")
    .trim()
    .slice(0, 100);
  const sourceImageUrl = String(input.sourceImageUrl || "").trim();
  const sourceVersion = String(input.sourceVersion || "")
    .trim()
    .slice(0, 4_096);
  if (
    !MANHUA_ASSET_3D_STATUSES.includes(status) ||
    !taskId ||
    !sourceVersion ||
    !isHttpsUrl(sourceImageUrl)
  ) {
    return undefined;
  }

  const predictionId =
    String(input.predictionId || "")
      .trim()
      .slice(0, 160) || undefined;
  const glbGcsUriRaw = String(input.glbGcsUri || "").trim();
  const glbUrlRaw = String(input.glbUrl || "").trim();
  const glbGcsUri = /^gs:\/\//i.test(glbGcsUriRaw) ? glbGcsUriRaw : undefined;
  const glbUrl = isHttpsUrl(glbUrlRaw) ? glbUrlRaw : undefined;
  const updatedAt = Math.max(0, Math.floor(Number(input.updatedAt) || 0));

  // 成功态必须同时保留长期对象身份与当前可读地址，避免只保存会过期的上游 URL。
  if (status === "succeeded" && (!glbGcsUri || !glbUrl)) return undefined;

  return {
    status,
    taskId,
    sourceImageUrl,
    sourceVersion,
    predictionId,
    glbGcsUri,
    glbUrl,
    errorZh:
      String(input.errorZh || "")
        .trim()
        .slice(0, 160) || undefined,
    updatedAt,
  };
}
