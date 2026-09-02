import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetPlanVoiceRejectMemo,
  synthesizeManhuaDialoguePreferred,
} from "./manhuaDialogueTtsRoute.js";
import {
  TokenPlanDialogueTtsConfigurationError,
  TokenPlanDialogueTtsExplicitRejectionError,
  TokenPlanDialogueTtsUnknownResultError,
} from "./tokenPlanDialogueTts.js";

const gate = { accepted: true as const, durationSeconds: 2, voicedSeconds: 1.5 };

const planResult = {
  audioUrl: "https://signed/plan.mp3",
  gcsUri: "gs://b/plan.mp3",
  bytes: 111,
  voice: "longanlingxin",
  generationId: "",
  region: "singapore" as const,
  voiceGate: gate as any,
};

const orResult = {
  audioUrl: "https://signed/or.mp3",
  gcsUri: "gs://b/or.mp3",
  bytes: 222,
  voice: "qwen-audio-3.0-tts-plus-longcanzhuyue",
  generationId: "gen-1",
  voiceGate: gate as any,
};

const input = {
  input: "台词",
  voice: "qwen-audio-3.0-tts-plus-longcanzhuyue",
  ownerUserId: 7,
};

describe("synthesizeManhuaDialoguePreferred", () => {
  beforeEach(() => resetPlanVoiceRejectMemo());

  it("prefers the token plan route when it succeeds", async () => {
    const synthesizeOpenRouter = vi.fn();
    const result = await synthesizeManhuaDialoguePreferred(input, {
      synthesizeTokenPlan: vi.fn(async () => planResult) as any,
      synthesizeOpenRouter: synthesizeOpenRouter as any,
    });
    expect(result.provider).toBe("token-plan-singapore");
    expect(result.bytes).toBe(111);
    expect(synthesizeOpenRouter).not.toHaveBeenCalled();
  });

  it("falls back to openrouter when the plan is not configured", async () => {
    const result = await synthesizeManhuaDialoguePreferred(input, {
      synthesizeTokenPlan: vi.fn(async () => {
        throw new TokenPlanDialogueTtsConfigurationError("missing");
      }) as any,
      synthesizeOpenRouter: vi.fn(async () => orResult) as any,
    });
    expect(result.provider).toBe("openrouter");
    expect(result.bytes).toBe(222);
  });

  it("falls back to openrouter when every plan region explicitly rejects", async () => {
    const result = await synthesizeManhuaDialoguePreferred(input, {
      synthesizeTokenPlan: vi.fn(async () => {
        throw new TokenPlanDialogueTtsExplicitRejectionError("beijing", 400);
      }) as any,
      synthesizeOpenRouter: vi.fn(async () => orResult) as any,
    });
    expect(result.provider).toBe("openrouter");
  });

  it("remembers engine-rejected voices and skips the plan handshake next time", async () => {
    const synthesizeTokenPlan = vi.fn(async () => {
      throw new TokenPlanDialogueTtsExplicitRejectionError("beijing", 400);
    });
    const deps = {
      synthesizeTokenPlan: synthesizeTokenPlan as any,
      synthesizeOpenRouter: vi.fn(async () => orResult) as any,
    };
    await synthesizeManhuaDialoguePreferred(input, deps);
    const again = await synthesizeManhuaDialoguePreferred(input, deps);
    expect(again.provider).toBe("openrouter");
    // 第二句同音色不再去套餐白握手
    expect(synthesizeTokenPlan).toHaveBeenCalledTimes(1);
  });

  it("does not blacklist a voice on connect-level failures (status 0)", async () => {
    const synthesizeTokenPlan = vi.fn(async () => {
      throw new TokenPlanDialogueTtsExplicitRejectionError("singapore", 0);
    });
    const deps = {
      synthesizeTokenPlan: synthesizeTokenPlan as any,
      synthesizeOpenRouter: vi.fn(async () => orResult) as any,
    };
    await synthesizeManhuaDialoguePreferred(input, deps);
    await synthesizeManhuaDialoguePreferred(input, deps);
    expect(synthesizeTokenPlan).toHaveBeenCalledTimes(2);
  });

  it("does NOT fall back on unknown plan result (double-billing guard)", async () => {
    const synthesizeOpenRouter = vi.fn();
    await expect(
      synthesizeManhuaDialoguePreferred(input, {
        synthesizeTokenPlan: vi.fn(async () => {
          throw new TokenPlanDialogueTtsUnknownResultError("singapore");
        }) as any,
        synthesizeOpenRouter: synthesizeOpenRouter as any,
      })
    ).rejects.toBeInstanceOf(TokenPlanDialogueTtsUnknownResultError);
    expect(synthesizeOpenRouter).not.toHaveBeenCalled();
  });
});
