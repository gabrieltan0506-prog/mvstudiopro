/**
 * World Labs Marble（3DGS 世界）HTTP 客户端（PR-8）。合同按 docs.worldlabs.ai 0916 逐页读取：
 *   POST /marble/v1/worlds:generate {display_name, model, world_prompt} → {operation_id, metadata{world_id}}
 *   GET  /marble/v1/operations/{id} → {done, error{code,message}（对象恒在，只有 code/message 非空才失败）, response=World}
 *   GET  /marble/v1/worlds/{id}；POST /marble/v1/worlds/{id}:export {asset_type, format}；DELETE /marble/v1/worlds/{id}
 * 鉴权 header：WLT-Api-Key。钥匙只在 Fly env（WORLDLABS_API_KEY），本文件不打印不回传。
 */
import { SubmitRejectedError, SubmitUnknownError } from "./submitOutcomeErrors.js";

export type MarbleModel = "marble-1.1-plus" | "marble-1.1" | "marble-1.0" | "marble-1.0-draft";
export const MARBLE_MODELS: readonly MarbleModel[] = ["marble-1.1-plus", "marble-1.1", "marble-1.0", "marble-1.0-draft"];
export const MARBLE_MODEL_DEFAULT: MarbleModel = "marble-1.1";
/** 0916 文档价：$1 = 1250 credits；draft 150、1.1 1500、plus 1500–3000 */
export const MARBLE_MODEL_CREDITS: Record<MarbleModel, { min: number; max: number }> = {
  "marble-1.1-plus": { min: 1500, max: 3000 },
  "marble-1.1": { min: 1500, max: 1500 },
  "marble-1.0": { min: 1500, max: 1500 },
  "marble-1.0-draft": { min: 150, max: 150 },
};

export type MarbleWorldPrompt =
  | { type: "text"; textPrompt: string }
  | { type: "image"; imageUrl: string; isPano: boolean | "auto"; textPrompt?: string }
  | { type: "multi-image"; images: Array<{ azimuth: 0 | 90 | 180 | 270; imageUrl: string }>; textPrompt?: string };

export type MarbleGenerateInput = {
  displayName: string;
  model: MarbleModel;
  prompt: MarbleWorldPrompt;
};

export type MarbleWorldAssets = {
  spzUrls: { "100k"?: string; "500k"?: string; full_res?: string };
  metricScaleFactor?: number;
  groundPlaneOffset?: number;
  colliderMeshUrl?: string;
  panoUrl?: string;
  thumbnailUrl?: string;
  caption?: string;
  worldMarbleUrl?: string;
};

export type MarbleOperationSnapshot =
  | { state: "completed"; worldId: string; assets: MarbleWorldAssets }
  | { state: "failed"; error: string }
  | { state: "running"; status: string; worldId?: string }
  | { state: "reconcile"; error: string };

function apiBase(): string {
  return String(process.env.WORLDLABS_API_BASE || "https://api.worldlabs.ai").replace(/\/+$/, "");
}

function apiKey(): string {
  return String(process.env.WORLDLABS_API_KEY || "").trim();
}

export function isWorldlabsMarbleConfigured(): boolean {
  return Boolean(apiKey());
}

function headers(): Record<string, string> {
  return { "WLT-Api-Key": apiKey(), "Content-Type": "application/json" };
}

/** 请求体：纯函数便于测试；URI 必须无鉴权可取（GCS v4 签名链可） */
export function buildMarbleGenerateBody(input: MarbleGenerateInput): Record<string, unknown> {
  const p = input.prompt;
  let worldPrompt: Record<string, unknown>;
  if (p.type === "text") {
    worldPrompt = { type: "text", text_prompt: p.textPrompt };
  } else if (p.type === "image") {
    worldPrompt = {
      type: "image",
      image_prompt: { source: "uri", uri: p.imageUrl, is_pano: p.isPano },
      ...(p.textPrompt ? { text_prompt: p.textPrompt } : {}),
    };
  } else {
    worldPrompt = {
      type: "multi-image",
      multi_image_prompt: p.images.map((img) => ({ azimuth: img.azimuth, content: { source: "uri", uri: img.imageUrl } })),
      ...(p.textPrompt ? { text_prompt: p.textPrompt } : {}),
    };
  }
  return { display_name: input.displayName.slice(0, 120), model: input.model, world_prompt: worldPrompt };
}

type MarbleOperationJson = {
  operation_id?: string;
  id?: string;
  name?: string;
  done?: boolean;
  error?: { code?: number | string | null; message?: string | null } | null;
  metadata?: { world_id?: string; progress?: { status?: string; description?: string } };
  response?: MarbleWorldJson;
};

type MarbleWorldJson = {
  world_id?: string;
  id?: string;
  world_marble_url?: string;
  assets?: {
    splats?: { spz_urls?: Record<string, string>; semantics_metadata?: { metric_scale_factor?: number; ground_plane_offset?: number } | null };
    mesh?: { collider_mesh_url?: string };
    imagery?: { pano_url?: string };
    thumbnail_url?: string;
    caption?: string;
  };
  world?: MarbleWorldJson;
};

/** error 对象恒存在，只有 code/message 非空才算失败（0916 探针实证） */
export function marbleOperationHasError(op: Pick<MarbleOperationJson, "error">): string {
  const e = op.error;
  if (!e) return "";
  const code = e.code == null || e.code === "" ? "" : String(e.code);
  const message = String(e.message || "").trim();
  if (!code && !message) return "";
  return `${code ? `[${code}] ` : ""}${message || "unknown_error"}`;
}

export function parseMarbleWorldAssets(world: MarbleWorldJson | undefined | null): MarbleWorldAssets {
  const w = world?.assets ? world : world?.world;
  const a = w?.assets || {};
  const spz = a.splats?.spz_urls || {};
  const semantics = a.splats?.semantics_metadata || null;
  return {
    spzUrls: {
      ...(spz["100k"] ? { "100k": spz["100k"] } : {}),
      ...(spz["500k"] ? { "500k": spz["500k"] } : {}),
      ...(spz.full_res ? { full_res: spz.full_res } : {}),
    },
    ...(typeof semantics?.metric_scale_factor === "number" ? { metricScaleFactor: semantics.metric_scale_factor } : {}),
    ...(typeof semantics?.ground_plane_offset === "number" ? { groundPlaneOffset: semantics.ground_plane_offset } : {}),
    ...(a.mesh?.collider_mesh_url ? { colliderMeshUrl: a.mesh.collider_mesh_url } : {}),
    ...(a.imagery?.pano_url ? { panoUrl: a.imagery.pano_url } : {}),
    ...(a.thumbnail_url ? { thumbnailUrl: a.thumbnail_url } : {}),
    ...(a.caption ? { caption: String(a.caption).slice(0, 600) } : {}),
    ...(w?.world_marble_url ? { worldMarbleUrl: w.world_marble_url } : {}),
  };
}

export async function submitMarbleGenerate(input: MarbleGenerateInput): Promise<{ operationId: string; worldId?: string }> {
  if (!isWorldlabsMarbleConfigured()) throw new SubmitRejectedError("marble_not_configured");
  let response: Response;
  try {
    response = await fetch(`${apiBase()}/marble/v1/worlds:generate`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(buildMarbleGenerateBody(input)),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    // 网络断：任务可能已建成，不能当作没建
    throw new SubmitUnknownError(`marble_submit_network:${error instanceof Error ? error.name : "unknown"}`);
  }
  const text = await response.text().catch(() => "");
  if (response.status >= 400 && response.status < 500) {
    throw new SubmitRejectedError(`marble_submit_rejected_${response.status}:${text.slice(0, 200)}`);
  }
  if (!response.ok) throw new SubmitUnknownError(`marble_submit_http_${response.status}`);
  let json: MarbleOperationJson = {};
  try {
    json = JSON.parse(text) as MarbleOperationJson;
  } catch {
    throw new SubmitUnknownError("marble_submit_bad_json");
  }
  const operationId = String(json.operation_id || json.id || json.name || "").trim();
  if (!operationId) throw new SubmitUnknownError("marble_submit_missing_operation_id");
  const worldId = String(json.metadata?.world_id || "").trim() || undefined;
  return { operationId, ...(worldId ? { worldId } : {}) };
}

export async function pollMarbleOperationOnce(operationId: string): Promise<MarbleOperationSnapshot> {
  if (!isWorldlabsMarbleConfigured()) return { state: "reconcile", error: "3D 世界查询通道未配置" };
  let response: Response;
  try {
    response = await fetch(`${apiBase()}/marble/v1/operations/${encodeURIComponent(operationId)}`, {
      headers: headers(),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    return { state: "running", status: `transient_fetch_error:${error instanceof Error ? error.name : "unknown"}` };
  }
  if (response.status === 429 || response.status >= 500) return { state: "running", status: `transient_http_${response.status}` };
  if ([400, 401, 403, 404, 422].includes(response.status)) {
    await response.text().catch(() => "");
    return { state: "reconcile", error: `3D 世界任务状态无法确认（HTTP ${response.status}）` };
  }
  const json = (await response.json().catch(() => ({}))) as MarbleOperationJson;
  if (!response.ok) return { state: "running", status: `transient_http_${response.status}` };
  const error = marbleOperationHasError(json);
  if (error) return { state: "failed", error };
  const worldId = String(json.metadata?.world_id || json.response?.world_id || json.response?.id || "").trim();
  if (!json.done) {
    return { state: "running", status: String(json.metadata?.progress?.status || "pending").slice(0, 80), ...(worldId ? { worldId } : {}) };
  }
  if (!worldId) return { state: "reconcile", error: "3D 世界已完成但没有 world_id" };
  return { state: "completed", worldId, assets: parseMarbleWorldAssets(json.response) };
}

export async function getMarbleWorld(worldId: string): Promise<MarbleWorldAssets | null> {
  if (!isWorldlabsMarbleConfigured()) return null;
  const response = await fetch(`${apiBase()}/marble/v1/worlds/${encodeURIComponent(worldId)}`, {
    headers: headers(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return null;
  return parseMarbleWorldAssets((await response.json().catch(() => null)) as MarbleWorldJson | null);
}

export async function exportMarbleWorld(
  worldId: string,
  asset: { assetType: "splats" | "mesh"; format: "ply" | "glb" },
): Promise<{ operationId: string }> {
  if (!isWorldlabsMarbleConfigured()) throw new SubmitRejectedError("marble_not_configured");
  const response = await fetch(`${apiBase()}/marble/v1/worlds/${encodeURIComponent(worldId)}:export`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ asset_type: asset.assetType, format: asset.format }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) throw new SubmitRejectedError(`marble_export_http_${response.status}:${text.slice(0, 200)}`);
  let json: MarbleOperationJson = {};
  try {
    json = JSON.parse(text) as MarbleOperationJson;
  } catch {
    throw new SubmitUnknownError("marble_export_bad_json");
  }
  const operationId = String(json.operation_id || json.id || json.name || "").trim();
  if (!operationId) throw new SubmitUnknownError("marble_export_missing_operation_id");
  return { operationId };
}

export async function deleteMarbleWorld(worldId: string): Promise<boolean> {
  if (!isWorldlabsMarbleConfigured()) return false;
  const response = await fetch(`${apiBase()}/marble/v1/worlds/${encodeURIComponent(worldId)}`, {
    method: "DELETE",
    headers: headers(),
    signal: AbortSignal.timeout(30_000),
  });
  return response.ok || response.status === 404;
}

/* ─────────────── PR-11 布局可控：深度全景 → RGB 全景（pano:depth_to_rgb） ─────────────── */

export type MarbleDepthToRgbSnapshot =
  | { state: "completed"; panoUrl: string }
  | { state: "failed"; error: string }
  | { state: "running"; status: string }
  | { state: "reconcile"; error: string };

/** 请求体：文档 `POST /marble/v1/pano:depth_to_rgb` {image, text_prompt}；image 走 uri 来源 */
export function buildMarbleDepthToRgbBody(input: { depthPanoUrl: string; textPrompt: string }): Record<string, unknown> {
  return { image: { source: "uri", uri: input.depthPanoUrl }, text_prompt: String(input.textPrompt || "").slice(0, 2_000) };
}

/**
 * 结果字段：文档只写「→ 操作 → pano_url」，没定死挂在哪层。
 * 同时接受 response.pano_url 与 response.imagery.pano_url（测试固定两种），都没有再兜 response.assets.imagery.pano_url。
 */
export function pickMarbleDepthToRgbPanoUrl(response: unknown): string {
  const r = (response || {}) as { pano_url?: unknown; imagery?: { pano_url?: unknown }; assets?: { imagery?: { pano_url?: unknown } } };
  const candidates = [r.pano_url, r.imagery?.pano_url, r.assets?.imagery?.pano_url];
  for (const c of candidates) {
    const s = String(c || "").trim();
    if (/^https?:\/\//i.test(s)) return s;
  }
  return "";
}

export async function submitMarbleDepthToRgb(input: { depthPanoUrl: string; textPrompt: string }): Promise<{ operationId: string }> {
  if (!isWorldlabsMarbleConfigured()) throw new SubmitRejectedError("marble_not_configured");
  let response: Response;
  try {
    response = await fetch(`${apiBase()}/marble/v1/pano:depth_to_rgb`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(buildMarbleDepthToRgbBody(input)),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new SubmitUnknownError(`marble_depth_submit_network:${error instanceof Error ? error.name : "unknown"}`);
  }
  const text = await response.text().catch(() => "");
  if (response.status >= 400 && response.status < 500) {
    throw new SubmitRejectedError(`marble_depth_submit_rejected_${response.status}:${text.slice(0, 200)}`);
  }
  if (!response.ok) throw new SubmitUnknownError(`marble_depth_submit_http_${response.status}`);
  let json: MarbleOperationJson = {};
  try {
    json = JSON.parse(text) as MarbleOperationJson;
  } catch {
    throw new SubmitUnknownError("marble_depth_submit_bad_json");
  }
  const operationId = String(json.operation_id || json.id || json.name || "").trim();
  if (!operationId) throw new SubmitUnknownError("marble_depth_submit_missing_operation_id");
  return { operationId };
}

/** 轮询同一个 operations 接口，只是结果取 pano_url */
export async function pollMarbleDepthToRgbOnce(operationId: string): Promise<MarbleDepthToRgbSnapshot> {
  if (!isWorldlabsMarbleConfigured()) return { state: "reconcile", error: "3D 世界查询通道未配置" };
  let response: Response;
  try {
    response = await fetch(`${apiBase()}/marble/v1/operations/${encodeURIComponent(operationId)}`, {
      headers: headers(),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    return { state: "running", status: `transient_fetch_error:${error instanceof Error ? error.name : "unknown"}` };
  }
  if (response.status === 429 || response.status >= 500) return { state: "running", status: `transient_http_${response.status}` };
  if ([400, 401, 403, 404, 422].includes(response.status)) {
    await response.text().catch(() => "");
    return { state: "reconcile", error: `深度全景上色任务状态无法确认（HTTP ${response.status}）` };
  }
  const json = (await response.json().catch(() => ({}))) as MarbleOperationJson & { response?: unknown };
  if (!response.ok) return { state: "running", status: `transient_http_${response.status}` };
  const error = marbleOperationHasError(json);
  if (error) return { state: "failed", error };
  if (!json.done) return { state: "running", status: String(json.metadata?.progress?.status || "pending").slice(0, 80) };
  const panoUrl = pickMarbleDepthToRgbPanoUrl(json.response);
  if (!panoUrl) return { state: "reconcile", error: "深度全景上色已完成但没有 pano_url" };
  return { state: "completed", panoUrl };
}
