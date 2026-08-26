import { describe, expect, it, vi } from "vitest";
import type { ManhuaDialogueVoiceGateResult } from "../../shared/manhuaDialogueVoiceGate";
import {
  TOKEN_PLAN_DIALOGUE_TTS_BEIJING_ENDPOINT,
  TOKEN_PLAN_DIALOGUE_TTS_MODEL,
  TOKEN_PLAN_DIALOGUE_TTS_SG_ENDPOINT,
  TokenPlanDialogueTtsConfigurationError,
  TokenPlanDialogueTtsUnknownResultError,
  assertBeijingTokenPlanBase,
  buildTokenPlanDialogueObjectName,
  buildTokenPlanDialogueTtsRequest,
  inspectTokenPlanDialogueAudio,
  resolveTokenPlanDialogueTtsRoutes,
  resolveTokenPlanDialogueAudioReference,
  synthesizeTokenPlanDialogue,
  type TokenPlanDialogueTtsDependencies,
} from "./tokenPlanDialogueTts";

const acceptedGate: Extract<ManhuaDialogueVoiceGateResult, { accepted: true }> =
  {
    accepted: true,
    durationSeconds: 2,
    voicedSeconds: 1.5,
    voicedRatio: 0.75,
    voiceRegions: [{ start: 0.25, end: 1.75 }],
  };

function audioResponse(extraHeaders: Record<string, string> = {}): Response {
  return new Response(Buffer.alloc(512, 1), {
    status: 200,
    headers: { "Content-Type": "audio/mpeg", ...extraHeaders },
  });
}

function successDependencies(overrides: TokenPlanDialogueTtsDependencies = {}) {
  const uploadAudio = vi.fn(async () => ({
    bucket: "test-bucket",
    objectName: "dialogue.mp3",
    gcsUri: "gs://test-bucket/dialogue.mp3",
  }));
  return {
    dependencies: {
      env: { DASHSCOPE_SG_PLAN_KEY: "sg-test-key" },
      fetchImpl: vi.fn(async () => audioResponse()) as unknown as typeof fetch,
      inspectAudio: vi.fn(async () => acceptedGate),
      uploadAudio,
      signAudioUrl: vi.fn(() => "https://signed.example/dialogue.mp3"),
      now: () => new Date("2026-08-26T00:00:00.000Z"),
      createId: () => "fixed-id",
      ...overrides,
    } satisfies TokenPlanDialogueTtsDependencies,
    uploadAudio,
  };
}

describe("Token Plan 端点与五字段契约", () => {
  it("请求体严格只有五字段，模型不是 OpenRouter slug", () => {
    const request = buildTokenPlanDialogueTtsRequest({
      input: " [sad] 别走。 ",
      voice: "longanlingxin",
      ownerUserId: 42,
      seed: 4.9,
    });
    expect(Object.keys(request)).toEqual([
      "model",
      "input",
      "voice",
      "response_format",
      "seed",
    ]);
    expect(request).toEqual({
      model: TOKEN_PLAN_DIALOGUE_TTS_MODEL,
      input: "[sad] 别走。",
      voice: "longanlingxin",
      response_format: "mp3",
      seed: 4,
    });
    expect(request.model).toBe("qwen-audio-3.0-tts-plus");
    expect(request.model).not.toContain("/");
  });

  it("新加坡固定优先，北京只用既有 Token Plan 配置", () => {
    expect(
      resolveTokenPlanDialogueTtsRoutes({
        DASHSCOPE_SG_PLAN_KEY: "sg",
        WAN_PLAN_API_KEY: "bj",
        WAN_PLAN_BASE:
          "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/",
      })
    ).toEqual([
      {
        region: "singapore",
        endpoint: TOKEN_PLAN_DIALOGUE_TTS_SG_ENDPOINT,
        apiKey: "sg",
      },
      {
        region: "beijing",
        endpoint: TOKEN_PLAN_DIALOGUE_TTS_BEIJING_ENDPOINT,
        apiKey: "bj",
      },
    ]);
  });

  it("北京 base 严格锁域，工作空间/按量与同域错误路径都 fail closed", () => {
    expect(() =>
      assertBeijingTokenPlanBase("https://dashscope.aliyuncs.com")
    ).toThrow(TokenPlanDialogueTtsConfigurationError);
    expect(() =>
      assertBeijingTokenPlanBase(
        "https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/workspaces/demo"
      )
    ).toThrow(TokenPlanDialogueTtsConfigurationError);
    expect(() =>
      assertBeijingTokenPlanBase(
        "http://token-plan.cn-beijing.maas.aliyuncs.com"
      )
    ).toThrow(TokenPlanDialogueTtsConfigurationError);
  });

  it("TTS 真源按用户分前缀，提交视频时只现签本人 GCS 音频", () => {
    expect(
      buildTokenPlanDialogueObjectName(
        42,
        "longanlingxin",
        new Date("2026-08-26T00:00:00.000Z"),
        "fixed-id"
      )
    ).toBe(
      "manhua-dialogue-tts/token-plan/u42/20260826/longanlingxin-fixed-id.mp3"
    );
    const sign = vi.fn(() => "https://signed.example/fresh.mp3");
    expect(
      resolveTokenPlanDialogueAudioReference({
        reference:
          "gs://test-bucket/manhua-dialogue-tts/token-plan/u42/20260826/dialogue.mp3",
        ownerUserId: 42,
        bucketName: "test-bucket",
        sign,
      })
    ).toBe("https://signed.example/fresh.mp3");
    expect(sign).toHaveBeenCalledWith(
      "gs://test-bucket/manhua-dialogue-tts/token-plan/u42/20260826/dialogue.mp3",
      24 * 3600
    );
    expect(() =>
      resolveTokenPlanDialogueAudioReference({
        reference:
          "gs://test-bucket/manhua-dialogue-tts/token-plan/u7/20260826/dialogue.mp3",
        ownerUserId: 42,
        bucketName: "test-bucket",
        sign,
      })
    ).toThrow("token_plan_tts_reference_forbidden");
  });
});

describe("跨区状态机", () => {
  it("新加坡成功时不触碰北京，并按原样发送五字段", async () => {
    const calls: Array<{
      url: string;
      body: Record<string, unknown>;
      authorization: string;
    }> = [];
    const { dependencies, uploadAudio } = successDependencies({
      env: {
        DASHSCOPE_SG_PLAN_KEY: "sg-test-key",
        WAN_PLAN_API_KEY: "bj-test-key",
        WAN_PLAN_BASE: "https://token-plan.cn-beijing.maas.aliyuncs.com",
      },
      fetchImpl: (async (url, init) => {
        calls.push({
          url: String(url),
          body: JSON.parse(String(init?.body || "{}")),
          authorization: new Headers(init?.headers).get("authorization") || "",
        });
        return audioResponse({ "x-request-id": "sg-request" });
      }) as typeof fetch,
    });

    const result = await synthesizeTokenPlanDialogue(
      {
        input: "回来。",
        voice: "longanlingxin",
        ownerUserId: 42,
        seed: 7,
      },
      dependencies
    );

    expect(result).toMatchObject({
      region: "singapore",
      generationId: "sg-request",
      bytes: 512,
      voiceGate: { accepted: true },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TOKEN_PLAN_DIALOGUE_TTS_SG_ENDPOINT);
    expect(calls[0].authorization).toBe("Bearer sg-test-key");
    expect(Object.keys(calls[0].body)).toEqual([
      "model",
      "input",
      "voice",
      "response_format",
      "seed",
    ]);
    expect(calls[0].url).not.toContain("openrouter");
    expect(uploadAudio).toHaveBeenCalledTimes(1);
  });

  it("只有明确 4xx 拒绝才从新加坡换北京", async () => {
    const calls: string[] = [];
    const { dependencies } = successDependencies({
      env: {
        DASHSCOPE_SG_PLAN_KEY: "sg-test-key",
        WAN_PLAN_API_KEY: "bj-test-key",
        WAN_PLAN_BASE: "https://token-plan.cn-beijing.maas.aliyuncs.com",
      },
      fetchImpl: (async url => {
        calls.push(String(url));
        return calls.length === 1
          ? new Response(null, { status: 403 })
          : audioResponse({ "x-request-id": "bj-request" });
      }) as typeof fetch,
    });
    await expect(
      synthesizeTokenPlanDialogue(
        {
          input: "回来。",
          voice: "longanlingxin",
          ownerUserId: 42,
        },
        dependencies
      )
    ).resolves.toMatchObject({
      region: "beijing",
      generationId: "bj-request",
    });
    expect(calls).toEqual([
      TOKEN_PLAN_DIALOGUE_TTS_SG_ENDPOINT,
      TOKEN_PLAN_DIALOGUE_TTS_BEIJING_ENDPOINT,
    ]);
  });

  it("5xx 是结果未知：立刻停，不请求北京", async () => {
    const calls: string[] = [];
    const { dependencies, uploadAudio } = successDependencies({
      env: {
        DASHSCOPE_SG_PLAN_KEY: "sg-test-key",
        WAN_PLAN_API_KEY: "bj-test-key",
        WAN_PLAN_BASE: "https://token-plan.cn-beijing.maas.aliyuncs.com",
      },
      fetchImpl: (async url => {
        calls.push(String(url));
        return new Response(null, { status: 503 });
      }) as typeof fetch,
    });
    await expect(
      synthesizeTokenPlanDialogue(
        {
          input: "回来。",
          voice: "longanlingxin",
          ownerUserId: 42,
        },
        dependencies
      )
    ).rejects.toBeInstanceOf(TokenPlanDialogueTtsUnknownResultError);
    expect(calls).toEqual([TOKEN_PLAN_DIALOGUE_TTS_SG_ENDPOINT]);
    expect(uploadAudio).not.toHaveBeenCalled();
  });

  it("网络异常是结果未知：立刻停，不请求北京", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("socket reset");
    }) as unknown as typeof fetch;
    const { dependencies, uploadAudio } = successDependencies({
      env: {
        DASHSCOPE_SG_PLAN_KEY: "sg-test-key",
        WAN_PLAN_API_KEY: "bj-test-key",
        WAN_PLAN_BASE: "https://token-plan.cn-beijing.maas.aliyuncs.com",
      },
      fetchImpl,
    });
    await expect(
      synthesizeTokenPlanDialogue(
        {
          input: "回来。",
          voice: "longanlingxin",
          ownerUserId: 42,
        },
        dependencies
      )
    ).rejects.toBeInstanceOf(TokenPlanDialogueTtsUnknownResultError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(uploadAudio).not.toHaveBeenCalled();
  });
});

describe("音频上限、人声门禁与正式存储顺序", () => {
  it("2xx 音频无有效人声时拒收，不换区也不上传", async () => {
    const fetchImpl = vi.fn(async () =>
      audioResponse()
    ) as unknown as typeof fetch;
    const { dependencies, uploadAudio } = successDependencies({
      env: {
        DASHSCOPE_SG_PLAN_KEY: "sg-test-key",
        WAN_PLAN_API_KEY: "bj-test-key",
        WAN_PLAN_BASE: "https://token-plan.cn-beijing.maas.aliyuncs.com",
      },
      fetchImpl,
      inspectAudio: vi.fn(async () => ({
        accepted: false as const,
        reason: "no_effective_voice" as const,
        durationSeconds: 2,
        voicedSeconds: 0,
        voicedRatio: 0,
        voiceRegions: [],
      })),
    });
    await expect(
      synthesizeTokenPlanDialogue(
        {
          input: "回来。",
          voice: "longanlingxin",
          ownerUserId: 42,
        },
        dependencies
      )
    ).rejects.toMatchObject({
      reason: "no_effective_voice",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(uploadAudio).not.toHaveBeenCalled();
  });

  it("缺 Content-Length 也按实际流量截断，超限后不验声、不上传", async () => {
    const inspectAudio = vi.fn(async () => acceptedGate);
    const { dependencies, uploadAudio } = successDependencies({
      maxAudioBytes: 300,
      fetchImpl: vi.fn(async () => audioResponse()) as unknown as typeof fetch,
      inspectAudio,
    });
    await expect(
      synthesizeTokenPlanDialogue(
        {
          input: "回来。",
          voice: "longanlingxin",
          ownerUserId: 42,
        },
        dependencies
      )
    ).rejects.toMatchObject({
      reason: "audio_too_large",
    });
    expect(inspectAudio).not.toHaveBeenCalled();
    expect(uploadAudio).not.toHaveBeenCalled();
  });

  it("实际 ffprobe + silencedetect 参数闭合，完整日志才进入纯门禁", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const executeFile = vi.fn(
      async (command: "ffprobe" | "ffmpeg", args: string[]) => {
        calls.push({ command, args });
        return command === "ffprobe"
          ? { stdout: "2.0\n", stderr: "" }
          : {
              stdout: "",
              stderr: [
                "silence_start: 0",
                "silence_end: 0.25 | silence_duration: 0.25",
                "silence_start: 1.75",
                "silence_end: 2.0 | silence_duration: 0.25",
              ].join("\n"),
            };
      }
    );
    await expect(
      inspectTokenPlanDialogueAudio(Buffer.alloc(512), {
        executeFile,
      })
    ).resolves.toMatchObject({
      accepted: true,
      durationSeconds: 2,
      voicedSeconds: 1.5,
    });
    expect(calls.map(call => call.command)).toEqual(["ffprobe", "ffmpeg"]);
    const ffmpegArgs = calls[1].args;
    expect(ffmpegArgs[ffmpegArgs.indexOf("-af") + 1]).toBe(
      "silencedetect=noise=-40dB:d=0.12"
    );
    expect(ffmpegArgs).toContain("-nostdin");
  });

  it("ffmpeg 虽退出 0 但没有任何检测日志时 fail closed", async () => {
    const executeFile = vi.fn(async (command: "ffprobe" | "ffmpeg") =>
      command === "ffprobe"
        ? { stdout: "2.0\n", stderr: "" }
        : { stdout: "", stderr: "" }
    );
    await expect(
      inspectTokenPlanDialogueAudio(Buffer.alloc(512), { executeFile })
    ).rejects.toMatchObject({ reason: "silencedetect_evidence_missing" });
  });
});
