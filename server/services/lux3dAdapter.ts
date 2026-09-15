/**
 * Lux3D（群核科技 / AHOLO 开放平台）任务适配器。
 * 合同来源：https://labs.aholo3d.com/api-docs/en/openapi.json（0915 读取）：
 *   - 鉴权：Header `Authorization: <API key>`，**不加 Bearer**。
 *   - POST /lux3d/v1/generate/img-to-3d/task/create → `{ c:"0", d:<taskid 整数>, m:"", f:null }`
 *   - GET  /lux3d/v1/generate/task/get?taskid=… → `d.status` 0 初始化 / 1 运行中 / 3 成功 / 4 失败 / 6 已取消；
 *     `d.outputs[].content` 为模型文件 URL，**有效期 2 小时**（拿到必须立刻搬进 GCS）。
 *   - 业务码：11003 积分不足、11001 全局限流（HTTP 429）；`c:"-1"` 普通参数错误。
 *
 * 口径：
 *   - 凭证只从 process.env 读（LUX3D_CN_API_KEY / LUX3D_GLOBAL_API_KEY），只在服务端，绝不进日志/argv。
 *   - fetch 可注入，测试用桩；生产用全局 fetch。
 *   - 供应商没有幂等键：本适配器**不自动重发**；提交结果未知（超时/5xx）交给上层记 unverified。
 *   - 轮询语义与 wavespeedTripo3d 对齐：瞬时错误 → running；4xx 无法确认 → reconcile。
 */
import { LUX3D_CREDENTIAL_ENV } from "./manhua3dAssetTask.js";

export type Lux3dRegion = keyof typeof LUX3D_CREDENTIAL_ENV;

export const LUX3D_API_BASE: Record<Lux3dRegion, string> = {
  cn: "https://api.aholo3d.cn",
  international: "https://api.aholo3d.com/global",
};

export const LUX3D_IMG_TO_3D_CREATE_PATH = "/lux3d/v1/generate/img-to-3d/task/create";
export const LUX3D_TASK_GET_PATH = "/lux3d/v1/generate/task/get";
/** 结果 URL 有效期（合同写明 2 小时）；上层据此决定必须在此前搬运 */
export const LUX3D_OUTPUT_URL_TTL_MS = 2 * 60 * 60_000;

export type Lux3dVersion = "G1" | "G1-Turbo";

export type Lux3dImgTo3dInput = {
  /** 单张公开可访问的图片 URL（GCS 签名 URL 即可；不走 OUS 上传） */
  img: string;
  version?: Lux3dVersion;
  /** 10000–300000，默认 300000 */
  faceCount?: number;
  /** G1 固定回 ZIP+GLB；Turbo 按此返回；省略回 ZIP */
  outputFormat?: Array<"glb" | "zip" | "ply" | "obj" | "fbx" | "usdz">;
  /** 仅 Turbo：false = 白模 */
  enablePbr?: boolean;
  aiPredictSize?: boolean;
};

export type Lux3dEnvelope<T> = { c: string; d: T; m?: string; f?: { metaData?: { bizCode?: string }; message?: string } | null };

export type Lux3dSubmitErrorCode = "insufficient_credits" | "rate_limited" | "bad_request" | "unauthorized" | "unknown";

export class Lux3dSubmitError extends Error {
  constructor(
    readonly code: Lux3dSubmitErrorCode,
    message: string,
    readonly bizCode?: string,
  ) {
    super(message);
    this.name = "Lux3dSubmitError";
  }
}

export type Lux3dTaskOutput = { content: string; format?: string };

export type Lux3dPollSnapshot =
  | { state: "running"; status: string }
  | { state: "succeeded"; outputs: Lux3dTaskOutput[]; glbUrl: string; fetchedAtMs: number }
  | { state: "failed"; error: string }
  | { state: "canceled" }
  | { state: "reconcile"; error: string };

export type Lux3dDeps = {
  fetch: typeof fetch;
  /** 显式给 key 只用于测试；生产从 env 读 */
  credential?: { region: Lux3dRegion; key: string } | null;
  now?: () => number;
};

export function resolveLux3dCredential(preferred?: Lux3dRegion): { region: Lux3dRegion; key: string } | null {
  const order: Lux3dRegion[] = preferred ? [preferred, ...(["cn", "international"] as Lux3dRegion[]).filter((r) => r !== preferred)] : ["cn", "international"];
  for (const region of order) {
    const key = String(process.env[LUX3D_CREDENTIAL_ENV[region]] || "").trim();
    if (key) return { region, key };
  }
  return null;
}

export function isLux3dConfigured(): boolean {
  return resolveLux3dCredential() !== null;
}

const defaultDeps = (): Lux3dDeps => ({ fetch: globalThis.fetch.bind(globalThis) });

/** 只做形状与范围校验；不猜默认（version 由调用方定，省略时供应商用默认版本） */
export function buildLux3dImgTo3dBody(input: Lux3dImgTo3dInput): Record<string, unknown> {
  const img = String(input.img || "").trim();
  if (!/^https:\/\//i.test(img)) throw new Lux3dSubmitError("bad_request", "img 必须是 https 公开地址");
  const body: Record<string, unknown> = { img };
  if (input.version) body.version = input.version;
  if (input.faceCount !== undefined) {
    if (!Number.isInteger(input.faceCount) || input.faceCount < 10_000 || input.faceCount > 300_000) {
      throw new Lux3dSubmitError("bad_request", "faceCount 取值范围 10000–300000");
    }
    body.faceCount = input.faceCount;
  }
  if (input.outputFormat?.length) body.outputFormat = input.outputFormat;
  if (input.enablePbr !== undefined) body.enablePbr = input.enablePbr;
  if (input.aiPredictSize !== undefined) body.aiPredictSize = input.aiPredictSize;
  return body;
}

function bizCodeOf(env: Lux3dEnvelope<unknown> | null | undefined): string | undefined {
  return env?.f?.metaData?.bizCode ? String(env.f.metaData.bizCode) : undefined;
}

function classifySubmitFailure(httpStatus: number, env: Lux3dEnvelope<unknown> | null): Lux3dSubmitError {
  const biz = bizCodeOf(env);
  const msg = String(env?.m || env?.f?.message || "").trim();
  if (biz === "11003") return new Lux3dSubmitError("insufficient_credits", `Lux3D 积分不足${msg ? `：${msg}` : ""}`, biz);
  if (biz === "11001" || httpStatus === 429) return new Lux3dSubmitError("rate_limited", `Lux3D 全局限流${msg ? `：${msg}` : ""}`, biz);
  if (httpStatus === 401 || httpStatus === 403) return new Lux3dSubmitError("unauthorized", "Lux3D 凭证无效或无权限", biz);
  if (httpStatus === 400 || env?.c === "-1") return new Lux3dSubmitError("bad_request", `Lux3D 参数错误${msg ? `：${msg}` : ""}`, biz);
  return new Lux3dSubmitError("unknown", `Lux3D 提交失败（HTTP ${httpStatus}${msg ? `，${msg}` : ""}）`, biz);
}

/**
 * 提交图生 3D。供应商无幂等键：网络超时/5xx 时**结果未知**，抛 `Lux3dSubmitError("unknown")`，
 * 上层应记 unverified 并靠 task/list 或人工核对，**不得自动重发**。
 */
export async function submitLux3dImgTo3d(
  input: Lux3dImgTo3dInput,
  deps: Partial<Lux3dDeps> = {},
): Promise<{ taskId: string; region: Lux3dRegion }> {
  const d = { ...defaultDeps(), ...deps };
  const cred = d.credential === undefined ? resolveLux3dCredential() : d.credential;
  if (!cred) throw new Lux3dSubmitError("unauthorized", "服务端未配置 Lux3D 凭证");
  const body = buildLux3dImgTo3dBody(input);
  let response: Response;
  try {
    response = await d.fetch(`${LUX3D_API_BASE[cred.region]}${LUX3D_IMG_TO_3D_CREATE_PATH}`, {
      method: "POST",
      headers: { Authorization: cred.key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new Lux3dSubmitError("unknown", `Lux3D 提交结果未知：${error instanceof Error ? error.name : "fetch_error"}`);
  }
  const env = (await response.json().catch(() => null)) as Lux3dEnvelope<number | null> | null;
  if (!response.ok || !env || env.c !== "0" || env.d === null || env.d === undefined) {
    throw classifySubmitFailure(response.status, env);
  }
  return { taskId: String(env.d), region: cred.region };
}

export function selectLux3dGlbOutput(outputs: Lux3dTaskOutput[]): string {
  const real = outputs.filter((o) => o.content && o.content !== "NOT_REQUESTED");
  return real.find((o) => /\.glb(?:$|[?#])/i.test(o.content) || /glb/i.test(o.format || ""))?.content || "";
}

export async function pollLux3dTaskOnce(
  taskId: string,
  region: Lux3dRegion,
  deps: Partial<Lux3dDeps> = {},
): Promise<Lux3dPollSnapshot> {
  const d = { ...defaultDeps(), ...deps };
  const cred = d.credential === undefined ? resolveLux3dCredential(region) : d.credential;
  if (!cred) return { state: "reconcile", error: "Lux3D 查询通道未配置" };
  let response: Response;
  try {
    response = await d.fetch(`${LUX3D_API_BASE[cred.region]}${LUX3D_TASK_GET_PATH}?taskid=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: cred.key },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    return { state: "running", status: `transient_fetch_error:${error instanceof Error ? error.name : "unknown"}` };
  }
  if (response.status === 429 || response.status >= 500) return { state: "running", status: `transient_http_${response.status}` };
  if ([400, 401, 403, 404, 422].includes(response.status)) {
    await response.text().catch(() => "");
    return { state: "reconcile", error: `Lux3D 任务状态无法确认（HTTP ${response.status}）` };
  }
  const env = (await response.json().catch(() => null)) as Lux3dEnvelope<{ taskId?: number; status?: number; outputs?: Lux3dTaskOutput[] } | null> | null;
  if (!env || env.c !== "0" || !env.d) return { state: "reconcile", error: `Lux3D 返回不合合同（c=${env?.c ?? "?"}）` };
  const outputs = (env.d.outputs ?? []).filter((o) => o && typeof o.content === "string");
  switch (env.d.status) {
    case 0:
    case 1:
      return { state: "running", status: env.d.status === 0 ? "initialized" : "running" };
    case 3: {
      const glbUrl = selectLux3dGlbOutput(outputs);
      if (!glbUrl) return { state: "reconcile", error: "Lux3D 任务成功但没有 GLB 产物（可能只请求了 ZIP/PLY）" };
      return { state: "succeeded", outputs, glbUrl, fetchedAtMs: (d.now ?? Date.now)() };
    }
    case 4:
      return { state: "failed", error: String(env.m || env.f?.message || "Lux3D 任务失败") };
    case 6:
      return { state: "canceled" };
    default:
      return { state: "reconcile", error: `Lux3D 未知状态 ${String(env.d.status)}` };
  }
}

/** task/list：提交结果未知时的恢复手段——按创建时间窗找回自己账号的任务，不重发 */
export type Lux3dTaskListItem = { taskId: string; status: 0 | 1 | 3 | 4 | 6; createdMs: number; lastModifiedMs: number };

export async function listLux3dTasks(
  query: { page?: number; pageSize?: number; status?: 0 | 1 | 3 | 4; startMs?: number; endMs?: number },
  region: Lux3dRegion,
  deps: Partial<Lux3dDeps> = {},
): Promise<{ items: Lux3dTaskListItem[]; total: number } | { error: string }> {
  const d = { ...defaultDeps(), ...deps };
  const cred = d.credential === undefined ? resolveLux3dCredential(region) : d.credential;
  if (!cred) return { error: "Lux3D 查询通道未配置" };
  const qs = new URLSearchParams();
  qs.set("page", String(Math.max(1, Math.floor(query.page ?? 1))));
  qs.set("pagesize", String(Math.min(100, Math.max(1, Math.floor(query.pageSize ?? 50)))));
  if (query.status !== undefined) qs.set("status", String(query.status));
  if (query.startMs !== undefined) qs.set("starttime", String(Math.floor(query.startMs)));
  if (query.endMs !== undefined) qs.set("endtime", String(Math.floor(query.endMs)));
  let response: Response;
  try {
    response = await d.fetch(`${LUX3D_API_BASE[cred.region]}/lux3d/v1/generate/task/list?${qs.toString()}`, {
      headers: { Authorization: cred.key },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    return { error: `Lux3D 列表请求失败：${error instanceof Error ? error.name : "fetch_error"}` };
  }
  const env = (await response.json().catch(() => null)) as Lux3dEnvelope<{ items?: Array<{ taskId?: number; status?: number; created?: number; lastModified?: number }>; total?: number } | null> | null;
  if (!response.ok || !env || env.c !== "0" || !env.d) return { error: `Lux3D 列表返回不合合同（HTTP ${response.status}，c=${env?.c ?? "?"}）` };
  const items: Lux3dTaskListItem[] = [];
  for (const it of env.d.items ?? []) {
    const status = Number(it.status);
    if (it.taskId === undefined || ![0, 1, 3, 4, 6].includes(status)) continue;
    items.push({ taskId: String(it.taskId), status: status as Lux3dTaskListItem["status"], createdMs: Number(it.created) || 0, lastModifiedMs: Number(it.lastModified) || 0 });
  }
  return { items, total: Number(env.d.total) || items.length };
}
