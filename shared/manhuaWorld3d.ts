/**
 * 场景 3DGS 世界（PR-8）：场景参考图派生的可选 3D 世界（World Labs Marble）。
 * 产物工作副本在 Fly 卷（中国可达，稳定地址），归档 gs://；两者都记，长期身份以 gs:// 为准。
 */
export const MANHUA_WORLD_3D_STATUSES = ["queued", "running", "succeeded", "failed", "reconcile_manual"] as const;
export type ManhuaWorld3dStatus = (typeof MANHUA_WORLD_3D_STATUSES)[number];

export type ManhuaWorld3dModel = "marble-1.1-plus" | "marble-1.1" | "marble-1.0" | "marble-1.0-draft";
export const MANHUA_WORLD_3D_MODELS: readonly ManhuaWorld3dModel[] = ["marble-1.1-plus", "marble-1.1", "marble-1.0", "marble-1.0-draft"];
export const MANHUA_WORLD_3D_MODEL_LABEL_ZH: Record<ManhuaWorld3dModel, string> = {
  "marble-1.1-plus": "1.1 大场景（≈$1.2–2.4）",
  "marble-1.1": "1.1 正式（≈$1.2）",
  "marble-1.0": "1.0（≈$1.2）",
  "marble-1.0-draft": "草稿（≈$0.12，试提示词）",
};

export type ManhuaWorld3dAssets = {
  /** Fly 桥稳定地址（不过期）；键名即文件名 */
  spz500kUrl?: string;
  spzFullUrl?: string;
  colliderGlbUrl?: string;
  panoUrl?: string;
  thumbnailUrl?: string;
  /** 归档 gs://（长期身份） */
  spz500kGcsUri?: string;
  spzFullGcsUri?: string;
  colliderGlbGcsUri?: string;
  panoGcsUri?: string;
  metricScaleFactor?: number;
  groundPlaneOffset?: number;
  caption?: string;
  worldMarbleUrl?: string;
};

export type ManhuaWorld3dRef = {
  status: ManhuaWorld3dStatus;
  taskId: string;
  /** 派生自哪一版场景图（gs:// 优先，否则 https） */
  sourceVersion: string;
  model: ManhuaWorld3dModel;
  worldId?: string;
  assets?: ManhuaWorld3dAssets;
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

function pickHttps(v: unknown): string | undefined {
  const s = String(v || "").trim();
  return isHttpsUrl(s) ? s : undefined;
}
function pickGs(v: unknown): string | undefined {
  const s = String(v || "").trim();
  return /^gs:\/\//i.test(s) ? s : undefined;
}
function pickNum(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function normalizeManhuaWorld3dAssets(raw: unknown): ManhuaWorld3dAssets | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const out: ManhuaWorld3dAssets = {};
  const put = <K extends keyof ManhuaWorld3dAssets>(k: K, v: ManhuaWorld3dAssets[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  put("spz500kUrl", pickHttps(o.spz500kUrl));
  put("spzFullUrl", pickHttps(o.spzFullUrl));
  put("colliderGlbUrl", pickHttps(o.colliderGlbUrl));
  put("panoUrl", pickHttps(o.panoUrl));
  put("thumbnailUrl", pickHttps(o.thumbnailUrl));
  put("spz500kGcsUri", pickGs(o.spz500kGcsUri));
  put("spzFullGcsUri", pickGs(o.spzFullGcsUri));
  put("colliderGlbGcsUri", pickGs(o.colliderGlbGcsUri));
  put("panoGcsUri", pickGs(o.panoGcsUri));
  put("metricScaleFactor", pickNum(o.metricScaleFactor));
  put("groundPlaneOffset", pickNum(o.groundPlaneOffset));
  const caption = String(o.caption || "").trim().slice(0, 600);
  if (caption) out.caption = caption;
  put("worldMarbleUrl", pickHttps(o.worldMarbleUrl));
  return Object.keys(out).length ? out : undefined;
}

export function normalizeManhuaWorld3dRef(raw: unknown): ManhuaWorld3dRef | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Partial<ManhuaWorld3dRef>;
  const status = String(o.status || "") as ManhuaWorld3dStatus;
  const taskId = String(o.taskId || "").trim().slice(0, 100);
  const sourceVersion = String(o.sourceVersion || "").trim().slice(0, 4_096);
  const model = String(o.model || "") as ManhuaWorld3dModel;
  if (!MANHUA_WORLD_3D_STATUSES.includes(status) || !taskId || !sourceVersion || !MANHUA_WORLD_3D_MODELS.includes(model)) return undefined;
  const worldId = String(o.worldId || "").trim().slice(0, 160) || undefined;
  const errorZh = String(o.errorZh || "").trim().slice(0, 300) || undefined;
  const updatedAt = Number(o.updatedAt);
  return {
    status,
    taskId,
    sourceVersion,
    model,
    ...(worldId ? { worldId } : {}),
    ...(normalizeManhuaWorld3dAssets(o.assets) ? { assets: normalizeManhuaWorld3dAssets(o.assets) } : {}),
    ...(errorZh ? { errorZh } : {}),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
  };
}

export type ManhuaWorld3dCandidate = {
  role?: string;
  reviewStatus?: string;
  url?: string;
  gcsUri?: string;
  world3d?: ManhuaWorld3dRef;
};

export type ManhuaWorld3dEligibility = {
  eligible: boolean;
  reasonZh?: string;
  sourceVersion: string;
  /** 仅当世界确由当前这张场景图派生时才展示，换图后不再显示旧世界 */
  currentWorld3d?: ManhuaWorld3dRef;
};

/** 只有已确认的场景参考图能生成世界；与人物 3D 同口径（换图即换版本） */
export function evaluateManhuaWorld3dEligibility(input: ManhuaWorld3dCandidate): ManhuaWorld3dEligibility {
  const sourceImageUrl = String(input.url || "").trim();
  const sourceVersion = String(input.gcsUri || "").trim() || sourceImageUrl;
  if (input.role !== "scene") return { eligible: false, reasonZh: "只支持场景参考图", sourceVersion };
  if (input.reviewStatus !== "accepted" && input.reviewStatus !== "converted") {
    return { eligible: false, reasonZh: "请先确认这张场景参考图", sourceVersion };
  }
  if (!isHttpsUrl(sourceImageUrl)) return { eligible: false, reasonZh: "场景参考图地址不可用", sourceVersion };
  const currentWorld3d = input.world3d?.sourceVersion === sourceVersion ? input.world3d : undefined;
  return { eligible: true, sourceVersion, currentWorld3d };
}

/** 服务端任务视图 → 客户端引用（不带会过期的字段以外都收） */
export function toManhuaWorld3dRef(task: {
  taskId: string;
  sceneRef: string;
  sourceVersion: string;
  model: ManhuaWorld3dModel;
  status: ManhuaWorld3dStatus;
  worldId?: string;
  assets?: ManhuaWorld3dAssets;
  errorZh?: string;
  updatedAt: string;
}): ManhuaWorld3dRef {
  const updated = Date.parse(task.updatedAt);
  return {
    status: task.status,
    taskId: task.taskId,
    sourceVersion: task.sourceVersion,
    model: task.model,
    ...(task.worldId ? { worldId: task.worldId } : {}),
    ...(task.assets ? { assets: task.assets } : {}),
    ...(task.errorZh ? { errorZh: task.errorZh } : {}),
    updatedAt: Number.isFinite(updated) ? updated : Date.now(),
  };
}
