/**
 * Fly / Stdout：設 **`PLATFORM_IMAGE_PIPELINE_STATS=1`** 仍可 grep `[platform.pipelineStat]`；
 * **不论是否开启**，統一寫入 {@link appendRuntimeMetric} `/admin → 運維打點` 緩存。
 */
import { appendRuntimeMetric } from "./runtimeMetricsBuffer.js";

export type PipelineStatPayload = Record<string, string | number | boolean | null | undefined>;

function statsConsoleEnabled(): boolean {
  const v = String(process.env.PLATFORM_IMAGE_PIPELINE_STATS ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** 對外唯一入口（失敗静默，不中斷管線）。 */
export function emitPlatformImagePipelineStat(payload: PipelineStatPayload): void {
  try {
    appendRuntimeMetric("platform.pipelineStat", { ...payload });
  } catch {
    /* ignore */
  }
  if (!statsConsoleEnabled()) return;
  try {
    const row = {
      ts: new Date().toISOString(),
      ...payload,
    };
    console.info("[platform.pipelineStat]", JSON.stringify(row));
  } catch {
    /* ignore */
  }
}
