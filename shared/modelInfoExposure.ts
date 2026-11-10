/**
 * 前台零技术泄漏（product-guardrails 一）：模型名 / 通道名 / 引擎代号只给监管与管理员看。
 *
 * 只作用于「回给前端的响应对象」——不碰请求、不碰模型选择；存库与日志里的模型名照旧保留（审计需要）。
 */
import { hasSupervisorRole } from "./internalMediaEndpointPolicy";

/** 响应里会直接暴露模型 / 通道身份的字段名。 */
export const MODEL_INFO_RESPONSE_KEYS = [
  "provider",
  "model",
  "modelName",
  "modelUsed",
  "engine",
  "reasoningEffort",
] as const;

export type ModelInfoResponseKey = (typeof MODEL_INFO_RESPONSE_KEYS)[number];

/** 能否在响应里看到模型 / 通道信息：仅 supervisor / admin。 */
export function canViewModelInfo(role: unknown): boolean {
  return hasSupervisorRole(role);
}

/**
 * 普通用户：浅层删掉模型 / 通道字段（默认全集，可传 keys 只删其中几项）；监管 / 管理员：原样返回。
 * 不改入参对象。
 */
export function redactModelInfoForRole<T extends Record<string, unknown>>(
  body: T,
  role: unknown,
  keys: readonly ModelInfoResponseKey[] = MODEL_INFO_RESPONSE_KEYS,
): T {
  if (canViewModelInfo(role)) return body;
  const out: Record<string, unknown> = { ...body };
  for (const key of keys) delete out[key];
  return out as T;
}

/** debug 块只给监管 / 管理员；普通用户拿到 undefined（tRPC 序列化后字段不出现）。 */
export function debugForRole<T>(role: unknown, debug: T): T | undefined {
  return canViewModelInfo(role) ? debug : undefined;
}
