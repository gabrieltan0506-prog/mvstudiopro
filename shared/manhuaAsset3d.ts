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

export type ManhuaAsset3dCandidate = {
  role?: string;
  reviewStatus?: string;
  url?: string;
  gcsUri?: string;
  claimedAnchorIds?: readonly string[];
  claimedAnchorNamesZh?: readonly string[];
  model3d?: ManhuaAsset3dRef;
};

export type ManhuaAsset3dEligibility = {
  eligible: boolean;
  reasonZh?: string;
  sourceVersion: string;
  /** 仅当 3D 结果确由当前这张图派生时才允许预览，避免换图后继续展示旧模型。 */
  currentModel3d?: ManhuaAsset3dRef;
};

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 3D 是人物当前图的可选辅助层：必须已确认、且明确只认领一个角色。
 * 未认领的手动人物图仍可用；只有显式出现多个角色认领时才拒绝，避免误伤旧草稿。
 */
export function evaluateManhuaAsset3dEligibility(
  input: ManhuaAsset3dCandidate
): ManhuaAsset3dEligibility {
  const sourceImageUrl = String(input.url || "").trim();
  const sourceVersion = String(input.gcsUri || "").trim() || sourceImageUrl;
  if (input.role !== "character") {
    return { eligible: false, reasonZh: "只支持人物参考图", sourceVersion };
  }
  if (input.reviewStatus !== "accepted" && input.reviewStatus !== "converted") {
    return {
      eligible: false,
      reasonZh: "请先确认或标准化这张人物参考图",
      sourceVersion,
    };
  }
  if (!isHttpsUrl(sourceImageUrl)) {
    return { eligible: false, reasonZh: "人物参考图地址不可用", sourceVersion };
  }
  const anchorIds = new Set(
    (input.claimedAnchorIds || [])
      .map(value => String(value || "").trim())
      .filter(Boolean)
  );
  const anchorNames = new Set(
    (input.claimedAnchorNamesZh || [])
      .map(value => String(value || "").trim())
      .filter(Boolean)
  );
  if (anchorIds.size > 1 || (anchorIds.size === 0 && anchorNames.size > 1)) {
    return {
      eligible: false,
      reasonZh: "一张图只能对应一个角色后再建立 3D 参考",
      sourceVersion,
    };
  }
  const currentModel3d =
    input.model3d?.sourceVersion === sourceVersion ? input.model3d : undefined;
  return { eligible: true, sourceVersion, currentModel3d };
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
