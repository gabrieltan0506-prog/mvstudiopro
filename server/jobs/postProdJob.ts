/**
 * 后期工坊异步任务(蓝图二①):action 分派到 postProduction 三件套。
 * envelope 形如 { action: "concat" | "bgm_mount" | "loudness_check", params: {...} }。
 */
import {
  concatClips,
  loudnessCheck,
  mountBgm,
  type BgmMountInput,
  type ConcatInput,
  type LoudnessCheckInput,
} from "../services/postProduction";

type Envelope = { action?: string; params?: Record<string, unknown> };

function asEnvelope(raw: unknown): Envelope {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Envelope;
  return {};
}

export async function processPostProdJob(
  inputRaw: unknown,
  userId: string,
): Promise<{ output: unknown; provider: string }> {
  const input = asEnvelope(inputRaw);
  const params = input.params ?? {};
  switch (input.action) {
    case "concat": {
      const output = await concatClips(params as ConcatInput, userId);
      return { output, provider: "ffmpeg-post-prod" };
    }
    case "bgm_mount": {
      const output = await mountBgm(params as BgmMountInput, userId);
      return { output, provider: "ffmpeg-post-prod" };
    }
    case "loudness_check": {
      const output = await loudnessCheck(params as LoudnessCheckInput);
      return { output, provider: "ffmpeg-post-prod" };
    }
    default:
      throw new Error(`Unsupported post_prod action: ${String(input.action)}`);
  }
}
