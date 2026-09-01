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

export async function synthesizeManhuaDialoguePreferred(
  input: ManhuaDialogueTtsRouteInput,
  dependencies: ManhuaDialogueTtsRouteDependencies = {}
): Promise<ManhuaDialogueTtsRouteResult> {
  const synthesizeTokenPlan =
    dependencies.synthesizeTokenPlan || synthesizeTokenPlanDialogueWs;
  const synthesizeOpenRouter =
    dependencies.synthesizeOpenRouter || synthesizeQwenDialogue;

  try {
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
    console.error(
      "[manhua-tts-route] token plan unavailable, falling back to openrouter:",
      error instanceof Error ? error.message : String(error)
    );
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
