/**
 * World Labs Marble（3DGS 世界）HTTP 客户端（PR-8）。合同按 docs.worldlabs.ai 0916 逐页读取：
 *   POST /marble/v1/worlds:generate {display_name, model, world_prompt} → {operation_id, metadata{world_id}}
 *   GET  /marble/v1/operations/{id} → {done, error{code,message}（对象恒在，只有 code/message 非空才失败）, response=World}
 *   GET  /marble/v1/worlds/{id}；POST /marble/v1/worlds/{id}:export {asset_type, format}；DELETE /marble/v1/worlds/{id}
 * 鉴权 header：WLT-Api-Key。钥匙只在 Fly env（WORLDLABS_API_KEY），本文件不打印不回传。
 */
import { MANHUA_WORLD_3D_MODEL_CREDITS } from "../../shared/manhuaWorld3d.js";
import { SubmitRejectedError, SubmitUnknownError } from "./submitOutcomeErrors.js";

export type MarbleModel = "marble-1.1-plus" | "marble-1.1" | "marble-1.0" | "marble-1.0-draft";
export const MARBLE_MODELS: readonly MarbleModel[] = ["marble-1.1-plus", "marble-1.1", "marble-1.0", "marble-1.0-draft"];
export const MARBLE_MODEL_DEFAULT: MarbleModel = "marble-1.1";
/** 0916 文档价：$1 = 1250 credits；draft 150、1.1 1500、plus 1500–3000（表在 shared，前端展示同一份） */
export const MARBLE_MODEL_CREDITS: Record<MarbleModel, { min: number; max: number }> = MANHUA_WORLD_3D_MODEL_CREDITS;

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
  | { state: "completed"; worldId: string; assets: MarbleWorldAssets; cost?: MarbleOperationCost }
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
  const cost = pickMarbleOperationCost(json);
  return { state: "completed", worldId, assets: parseMarbleWorldAssets(json.response), ...(cost ? { cost } : {}) };
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

/** Operation.cost（官方：可为空，空≠零费；只原样记账，不做换算） */
export type MarbleOperationCost = { totalCredits?: number; lineItems?: unknown[] };

export function pickMarbleOperationCost(json: unknown): MarbleOperationCost | undefined {
  const c = (json as { cost?: { total_credits?: unknown; line_items?: unknown } } | null)?.cost;
  if (!c || typeof c !== "object") return undefined;
  const total = Number(c.total_credits);
  return { ...(Number.isFinite(total) ? { totalCredits: total } : {}), ...(Array.isArray(c.line_items) ? { lineItems: c.line_items } : {}) };
}

export type MarbleDepthToRgbSnapshot =
  | { state: "completed"; panoUrl: string; cost?: MarbleOperationCost }
  | { state: "failed"; error: string }
  | { state: "running"; status: string }
  | { state: "reconcile"; error: string };

/** 深度图内容引用：Fly 上传后的 media_asset，或无鉴权可取的 https */
export type MarbleContentRef = { source: "uri"; uri: string } | { source: "media_asset"; mediaAssetId: string };

export type MarbleDepthToRgbInput = {
  depth: MarbleContentRef;
  textPrompt: string;
  /** PNG 必填（官方：PNG 归一 [0,1]，靠 z_min/z_max 还原米）；0 < zMin < zMax */
  zMin: number;
  zMax: number;
  seed?: number;
};

function contentRefBody(ref: MarbleContentRef): Record<string, unknown> {
  return ref.source === "media_asset" ? { source: "media_asset", media_asset_id: ref.mediaAssetId } : { source: "uri", uri: ref.uri };
}

/**
 * 请求体（WL-D01，官方 docs.worldlabs.ai/api/reference/pano/depth_to_rgb 0916）：
 *   { depth_pano_image: <content ref>, text_prompt, z_min, z_max, seed? }
 * 字段名是 depth_pano_image（不是 image）；PNG 必带 z_min/z_max，不合格在本地就拒，不打上游。
 */
export function buildMarbleDepthToRgbBody(input: MarbleDepthToRgbInput): Record<string, unknown> {
  const zMin = Number(input.zMin);
  const zMax = Number(input.zMax);
  if (!Number.isFinite(zMin) || !Number.isFinite(zMax) || !(zMin > 0) || !(zMax > zMin)) throw new SubmitRejectedError("marble_depth_invalid_z_range");
  const text = String(input.textPrompt || "").trim().slice(0, 2_000);
  if (!text) throw new SubmitRejectedError("marble_depth_missing_text_prompt");
  return {
    depth_pano_image: contentRefBody(input.depth),
    text_prompt: text,
    z_min: zMin,
    z_max: zMax,
    ...(Number.isInteger(input.seed) ? { seed: input.seed } : {}),
  };
}

/** 结果主合同只有一个：response.pano_url（官方文档）。不再猜别的层级。 */
export function pickMarbleDepthToRgbPanoUrl(response: unknown): string {
  const s = String((response as { pano_url?: unknown } | null)?.pano_url || "").trim();
  return /^https?:\/\//i.test(s) ? s : "";
}

export async function submitMarbleDepthToRgb(input: MarbleDepthToRgbInput): Promise<{ operationId: string }> {
  if (!isWorldlabsMarbleConfigured()) throw new SubmitRejectedError("marble_not_configured");
  const body = JSON.stringify(buildMarbleDepthToRgbBody(input));
  let response: Response;
  try {
    response = await fetch(`${apiBase()}/marble/v1/pano:depth_to_rgb`, {
      method: "POST",
      headers: headers(),
      body,
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
  if (!panoUrl) return { state: "reconcile", error: "深度全景上色已完成但没有 response.pano_url" };
  const cost = pickMarbleOperationCost(json);
  return { state: "completed", panoUrl, ...(cost ? { cost } : {}) };
}

/* ─────────────── Media assets（官方 docs.worldlabs.ai/api/reference/media-assets 0916） ───────────────
 *   POST /marble/v1/media-assets:prepare_upload {file_name(≤64), kind:"image"|"video", extension?}
 *     → { media_asset:{media_asset_id,...}, upload_info:{upload_url, upload_method, required_headers} }
 *   按 required_headers PUT 字节；准备上传 ≠ 上传成功，PUT 非 2xx 就不算有 media_asset。
 *   GET /marble/v1/media-assets/{id}
 * 只在 Fly 服务端执行（钥匙不进前端）。
 */

export type MarbleMediaUploadPrepared = { mediaAssetId: string; uploadUrl: string; uploadMethod: string; requiredHeaders: Record<string, string> };

export function parseMarblePrepareUploadResponse(json: unknown): MarbleMediaUploadPrepared {
  const j = (json || {}) as { media_asset?: { media_asset_id?: unknown }; upload_info?: { upload_url?: unknown; upload_method?: unknown; required_headers?: unknown } };
  const mediaAssetId = String(j.media_asset?.media_asset_id || "").trim();
  const uploadUrl = String(j.upload_info?.upload_url || "").trim();
  if (!mediaAssetId || !/^https:\/\//i.test(uploadUrl)) throw new SubmitUnknownError("marble_media_prepare_bad_response");
  const requiredHeaders: Record<string, string> = {};
  const rh = j.upload_info?.required_headers;
  if (rh && typeof rh === "object") for (const [k, v] of Object.entries(rh as Record<string, unknown>)) if (typeof v === "string") requiredHeaders[k] = v;
  const uploadMethod = String(j.upload_info?.upload_method || "PUT").toUpperCase();
  return { mediaAssetId, uploadUrl, uploadMethod, requiredHeaders };
}

/** 文件名 ≤ 64 且只留安全字符（官方限制） */
export function sanitizeMarbleMediaFileName(name: string, extension: string): string {
  const ext = String(extension || "").replace(/^\./, "").toLowerCase().slice(0, 8);
  const base = String(name || "asset").replace(/\.[a-z0-9]+$/i, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64 - ext.length - 1) || "asset";
  return `${base}.${ext}`;
}

export async function prepareMarbleMediaUpload(input: { fileName: string; kind: "image" | "video"; extension: string }): Promise<MarbleMediaUploadPrepared> {
  if (!isWorldlabsMarbleConfigured()) throw new SubmitRejectedError("marble_not_configured");
  let response: Response;
  try {
    response = await fetch(`${apiBase()}/marble/v1/media-assets:prepare_upload`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ file_name: sanitizeMarbleMediaFileName(input.fileName, input.extension), kind: input.kind, extension: input.extension.replace(/^\./, "") }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new SubmitUnknownError(`marble_media_prepare_network:${error instanceof Error ? error.name : "unknown"}`);
  }
  const text = await response.text().catch(() => "");
  if (response.status >= 400 && response.status < 500) throw new SubmitRejectedError(`marble_media_prepare_rejected_${response.status}:${text.slice(0, 200)}`);
  if (!response.ok) throw new SubmitUnknownError(`marble_media_prepare_http_${response.status}`);
  try {
    return parseMarblePrepareUploadResponse(JSON.parse(text));
  } catch (error) {
    if (error instanceof SubmitUnknownError) throw error;
    throw new SubmitUnknownError("marble_media_prepare_bad_json");
  }
}

/** prepare → PUT 字节；返回可作 {source:"media_asset"} 引用的 id。PUT 失败抛 rejected（可重试，没有产生付费） */
export async function uploadMarbleMediaAsset(input: { bytes: Uint8Array; contentType: string; fileName: string; kind: "image" | "video"; extension: string }): Promise<{ mediaAssetId: string }> {
  const prepared = await prepareMarbleMediaUpload({ fileName: input.fileName, kind: input.kind, extension: input.extension });
  let put: Response;
  try {
    put = await fetch(prepared.uploadUrl, {
      method: prepared.uploadMethod,
      headers: { "Content-Type": input.contentType, ...prepared.requiredHeaders },
      body: new Blob([input.bytes.buffer.slice(input.bytes.byteOffset, input.bytes.byteOffset + input.bytes.byteLength) as ArrayBuffer]),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw new SubmitRejectedError(`marble_media_put_network:${error instanceof Error ? error.name : "unknown"}`);
  }
  if (!put.ok) {
    await put.text().catch(() => "");
    throw new SubmitRejectedError(`marble_media_put_http_${put.status}`);
  }
  return { mediaAssetId: prepared.mediaAssetId };
}

export async function getMarbleMediaAsset(mediaAssetId: string): Promise<Record<string, unknown> | null> {
  if (!isWorldlabsMarbleConfigured()) return null;
  const response = await fetch(`${apiBase()}/marble/v1/media-assets/${encodeURIComponent(mediaAssetId)}`, { headers: headers(), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) return null;
  return (await response.json().catch(() => null)) as Record<string, unknown> | null;
}
