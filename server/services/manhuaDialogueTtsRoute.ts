/**
 * 对白 TTS 路由：套餐优先（新加坡→北京，走 WebSocket 正门），OpenRouter 兜底。
 *
 * 0902 用户拍板：token plan 到期归零，不用白不用——只有在套餐「未配置 /
 * 明确拒绝 / 未开始合成就失败」时才允许落到 OpenRouter 按量；套餐侧一旦
 * task-started 之后结果未知，直接报错停手，禁止再发第二发（防重复计费）。
 * 音频不合格（验声门禁拒收）同样不换路——换供应商洗不掉坏文本。
 */
import type { ManhuaDialogueVoiceGateResult } from "../../shared/manhuaDialogueVoiceGate.js";
import { synthesizeQwenDialogue } from "./qwenDialogueTts.js";
import {
  TokenPlanDialogueTtsConfigurationError,
  TokenPlanDialogueTtsExplicitRejectionError,
} from "./tokenPlanDialogueTts.js";
import { synthesizeTokenPlanDialogueWs } from "./tokenPlanDialogueTtsWs.js";

export type ManhuaDialogueTtsRouteResult = {
  audioUrl: string;
  gcsUri: string;
  bytes: number;
  voice: string;
  generationId: string;
  /** 实际走的路，透传给面板/账单描述 */
  provider: "token-plan-singapore" | "token-plan-beijing" | "openrouter";
  voiceGate: ManhuaDialogueVoiceGateResult;
};

export type ManhuaDialogueTtsRouteInput = {
  input: string;
  voice: string;
  ownerUserId: number;
  seed?: number;
  signal?: AbortSignal;
};

export type ManhuaDialogueTtsRouteDependencies = {
  synthesizeTokenPlan?: typeof synthesizeTokenPlanDialogueWs;
  synthesizeOpenRouter?: typeof synthesizeQwenDialogue;
};

function isTokenPlanFallbackAllowed(error: unknown): boolean {
  return (
    error instanceof TokenPlanDialogueTtsConfigurationError ||
    error instanceof TokenPlanDialogueTtsExplicitRejectionError
  );
}

/**
 * 音色拒绝记忆（0902 实弹：longcanzhuyue 两区套餐引擎都报 cosyvoice 411，
 * 系统音色 longanlingxin 秒过）。同一音色被套餐明确拒过就直接走 OpenRouter，
 * 免得每句都白握手两区各一次。只记引擎级拒绝（http>=400），连接失败不记。
 */
const PLAN_VOICE_REJECT_TTL_MS = 6 * 3600_000;
const planVoiceRejectedAt = new Map<string, number>();

export function notePlanVoiceRejected(voice: string, nowMs = Date.now()): void {
  planVoiceRejectedAt.set(voice, nowMs);
}

export function isPlanVoiceRecentlyRejected(
  voice: string,
  nowMs = Date.now()
): boolean {
  const at = planVoiceRejectedAt.get(voice);
  if (at == null) return false;
  if (nowMs - at > PLAN_VOICE_REJECT_TTL_MS) {
    planVoiceRejectedAt.delete(voice);
    return false;
  }
  return true;
}

/** 测试用：清空音色拒绝记忆 */
export function resetPlanVoiceRejectMemo(): void {
  planVoiceRejectedAt.clear();
}

export async function synthesizeManhuaDialoguePreferred(
  input: ManhuaDialogueTtsRouteInput,
  dependencies: ManhuaDialogueTtsRouteDependencies = {}
): Promise<ManhuaDialogueTtsRouteResult> {
  const synthesizeTokenPlan =
    dependencies.synthesizeTokenPlan || synthesizeTokenPlanDialogueWs;
  const synthesizeOpenRouter =
    dependencies.synthesizeOpenRouter || synthesizeQwenDialogue;

  const skipPlan = isPlanVoiceRecentlyRejected(input.voice);
  try {
    if (skipPlan) throw new TokenPlanDialogueTtsConfigurationError(
      "token_plan_voice_recently_rejected"
    );
    const planResult = await synthesizeTokenPlan({
      input: input.input,
      voice: input.voice,
      ownerUserId: input.ownerUserId,
      signal: input.signal,
    });
    return {
      audioUrl: planResult.audioUrl,
      gcsUri: planResult.gcsUri,
      bytes: planResult.bytes,
      voice: planResult.voice,
      generationId: planResult.generationId,
      provider:
        planResult.region === "singapore"
          ? "token-plan-singapore"
          : "token-plan-beijing",
      voiceGate: planResult.voiceGate,
    };
  } catch (error) {
    if (!isTokenPlanFallbackAllowed(error)) throw error;
    if (
      error instanceof TokenPlanDialogueTtsExplicitRejectionError &&
      error.status >= 400
    ) {
      notePlanVoiceRejected(input.voice);
    }
    if (!skipPlan) {
      console.error(
        "[manhua-tts-route] token plan unavailable, falling back to openrouter:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  const orResult = await synthesizeOpenRouter({
    input: input.input,
    voice: input.voice,
    seed: input.seed,
  });
  return {
    audioUrl: orResult.audioUrl,
    gcsUri: orResult.gcsUri,
    bytes: orResult.bytes,
    voice: orResult.voice,
    generationId: orResult.generationId,
    provider: "openrouter",
    voiceGate: orResult.voiceGate,
  };
}
