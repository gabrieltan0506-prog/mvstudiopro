import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const vertexMocks = vi.hoisted(() => ({
  getVertexAuthHeaders: vi.fn(async () => ({
    Authorization: "Bearer vertex-test-token",
    "Content-Type": "application/json",
  })),
}));

vi.mock("./services/vertexMedia.js", () => ({
  baseUrlForVertex: (location: string) => location === "global"
    ? "https://aiplatform.googleapis.com"
    : `https://${location}-aiplatform.googleapis.com`,
  getVertexAuthHeaders: vertexMocks.getVertexAuthHeaders,
  getVertexProjectId: () => String(process.env.VERTEX_PROJECT_ID || "").trim(),
}));

import {
  DEFAULT_MANHUA_AUDIO_EVOLINK_MODEL,
  DEFAULT_MANHUA_AUDIO_GEMINI_API_MODEL,
  DEFAULT_MANHUA_AUDIO_OPENROUTER_MODEL,
  DEFAULT_MANHUA_AUDIO_VERTEX_MODEL,
  analyzeManhuaDramaAudioWithFallback,
  analyzeManhuaDramaAudioWithEvolink,
  analyzeManhuaDramaAudioWithGeminiApi,
  analyzeManhuaDramaAudioWithOpenRouter,
  analyzeManhuaDramaAudioWithVertex,
  isManhuaAudioFailureRetryable,
  isManhuaDramaAudioAvailable,
  isManhuaDramaVertexAudioAvailable,
  mapManhuaAudioProviderFailure,
  resolveManhuaAudioEvolinkModelName,
  resolveManhuaAudioGeminiApiModelName,
  resolveManhuaAudioOpenRouterModelName,
  resolveManhuaAudioVertexModelName,
} from "./gemini-audio";

const fetchMock = vi.fn();

describe("漫剧语音 · OpenRouter Gemini 3.6 Flash", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");
    vi.stubEnv("EVOLINK_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("MANHUA_AUDIO_OPENROUTER_MODEL", "");
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", "");
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
    vi.stubEnv("VERTEX_PROJECT_ID", "");
    vi.stubEnv("MANHUA_AUDIO_VERTEX_MODEL", "");
    vi.stubEnv("MANHUA_AUDIO_EVOLINK_MODEL", "");
    vi.stubEnv("MANHUA_AUDIO_GEMINI_API_MODEL", "");
    vi.stubEnv("MANHUA_AUDIO_VERTEX_LOCATION", "");
    fetchMock.mockReset();
    vertexMocks.getVertexAuthHeaders.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("默认锁定官方 OpenRouter 模型 slug，并允许显式覆盖", () => {
    expect(resolveManhuaAudioOpenRouterModelName()).toBe(
      DEFAULT_MANHUA_AUDIO_OPENROUTER_MODEL,
    );
    expect(DEFAULT_MANHUA_AUDIO_OPENROUTER_MODEL).toBe("google/gemini-3.6-flash");
    vi.stubEnv("MANHUA_AUDIO_OPENROUTER_MODEL", "google/gemini-3.6-flash:exacto");
    expect(resolveManhuaAudioOpenRouterModelName()).toBe("google/gemini-3.6-flash:exacto");
  });

  it("原生 Vertex 默认锁定 gemini-3.6-flash，并允许显式覆盖", () => {
    expect(resolveManhuaAudioVertexModelName()).toBe(DEFAULT_MANHUA_AUDIO_VERTEX_MODEL);
    expect(DEFAULT_MANHUA_AUDIO_VERTEX_MODEL).toBe("gemini-3.6-flash");
    vi.stubEnv("MANHUA_AUDIO_VERTEX_MODEL", "gemini-3.6-flash-custom");
    expect(resolveManhuaAudioVertexModelName()).toBe("gemini-3.6-flash-custom");
  });

  it("EvoLink 与 Gemini API 均锁定原生 gemini-3.6-flash 模型 ID", () => {
    expect(DEFAULT_MANHUA_AUDIO_EVOLINK_MODEL).toBe("gemini-3.6-flash");
    expect(DEFAULT_MANHUA_AUDIO_GEMINI_API_MODEL).toBe("gemini-3.6-flash");
    expect(resolveManhuaAudioEvolinkModelName()).toBe("gemini-3.6-flash");
    expect(resolveManhuaAudioGeminiApiModelName()).toBe("gemini-3.6-flash");
  });

  it("用 input_audio + JSON Schema 提交 MP3，并消费结构化结果", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            language: "zh",
            transcriptSummary: "主角受辱后反击。",
            sections: [{
              name: "开场钩子",
              timeRange: "0:00-0:12",
              mood: "压迫",
              energy: "高",
              lyrics: "你不能进去。",
            }],
          }),
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await analyzeManhuaDramaAudioWithOpenRouter({
      audioBase64: "bXAzLWJ5dGVz",
      mimeType: "audio/mpeg",
    });

    expect(result).toMatchObject({
      model: "google/gemini-3.6-flash",
      language: "zh",
      transcriptSummary: "主角受辱后反击。",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-test-key");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("google/gemini-3.6-flash");
    expect(body.messages[0].content[1]).toEqual({
      type: "input_audio",
      input_audio: { data: "bXAzLWJ5dGVz", format: "mp3" },
    });
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { strict: true },
    });
    expect(body.provider).toEqual({ require_parameters: true });
  });

  it.each([
    [401, "语音分析服务鉴权失败"],
    [402, "语音分析服务余额不足"],
    [404, "语音分析模型暂不可用"],
    [429, "语音分析服务繁忙或限流"],
    [503, "语音分析服务暂时不可用"],
  ])("把 HTTP %s 映射为可诊断且不泄密的错误", async (status, expected) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: { message: "upstream detail must not leak" },
    }), { status }));
    await expect(analyzeManhuaDramaAudioWithOpenRouter({
      audioBase64: "bXAz",
      mimeType: "audio/mpeg",
    })).rejects.toThrow(expected);
    expect(mapManhuaAudioProviderFailure(status)).toBe(expected);
  });

  it("识别 OpenRouter workspace 未放行 Google Provider，并停止无效重试", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        message: "No allowed providers are available for the selected model.",
      },
    }), { status: 404 }));
    await expect(analyzeManhuaDramaAudioWithOpenRouter({
      audioBase64: "bXAz",
    })).rejects.toThrow("语音分析服务尚未放行 Google Provider");
    expect(isManhuaAudioFailureRetryable("语音分析服务尚未放行 Google Provider")).toBe(false);
    expect(isManhuaAudioFailureRetryable("语音分析服务繁忙或限流")).toBe(true);
  });

  it("识别 OpenRouter Provider TOS 拒绝，并交给下一条链路而非原地重试", () => {
    const reason = mapManhuaAudioProviderFailure(403, {
      error: { message: "The request is prohibited due to a violation of provider Terms Of Service." },
    });
    expect(reason).toBe("语音分析服务被 Provider TOS 拒绝");
    expect(isManhuaAudioFailureRetryable(reason)).toBe(false);
  });

  it("缺少 OpenRouter Key 时在发请求前失败", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(isManhuaDramaAudioAvailable()).toBe(false);
    await expect(analyzeManhuaDramaAudioWithOpenRouter({
      audioBase64: "bXAz",
    })).rejects.toThrow("语音分析服务未配置");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("用已配置的原生 Vertex 发送 inlineData 音频并消费结构化结果", async () => {
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", "{\"type\":\"service_account\"}");
    vi.stubEnv("VERTEX_PROJECT_ID", "vertex-test-project");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              language: "zh",
              transcriptSummary: "Vertex 已完成语音分析。",
              sections: [{
                name: "高潮",
                timeRange: "0:10-0:20",
                mood: "紧张",
                energy: "极高",
                lyrics: "反击开始。",
              }],
            }),
          }],
        },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await analyzeManhuaDramaAudioWithVertex({
      audioBase64: "dmVydGV4LWF1ZGlv",
      mimeType: "audio/mpeg",
    });

    expect(result).toMatchObject({
      model: "vertex/gemini-3.6-flash",
      transcriptSummary: "Vertex 已完成语音分析。",
    });
    expect(isManhuaDramaVertexAudioAvailable()).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://aiplatform.googleapis.com/v1/projects/vertex-test-project/locations/global/publishers/google/models/gemini-3.6-flash:generateContent",
    );
    const body = JSON.parse(String(init.body));
    expect(body.contents[0].parts[1]).toEqual({
      inlineData: { data: "dmVydGV4LWF1ZGlv", mimeType: "audio/mpeg" },
    });
    expect(body.generationConfig).toMatchObject({
      audioTimestamp: true,
      responseMimeType: "application/json",
      responseSchema: { type: "OBJECT" },
    });
    expect(vertexMocks.getVertexAuthHeaders).toHaveBeenCalledOnce();
  });

  it("严格按 Vertex → OpenRouter 顺序执行，Vertex 失败后返回 OpenRouter 结果", async () => {
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", "{\"type\":\"service_account\"}");
    vi.stubEnv("VERTEX_PROJECT_ID", "vertex-test-project");
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: "Vertex temporarily unavailable." },
      }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          language: "zh",
          transcriptSummary: "OpenRouter 回退成功。",
          sections: [],
        }) } }],
      }), { status: 200 }));

    const result = await analyzeManhuaDramaAudioWithFallback({
      audioBase64: "b25jZQ==",
      mimeType: "audio/mpeg",
    });

    expect(result.model).toBe("google/gemini-3.6-flash");
    expect(result.transcriptSummary).toBe("OpenRouter 回退成功。");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("aiplatform.googleapis.com");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("openrouter.ai");
  });

  it("EvoLink 使用官方 Google 原生端点、Bearer 与 inlineData 音频", async () => {
    vi.stubEnv("EVOLINK_API_KEY", "sk-evolink-test");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        language: "zh",
        transcriptSummary: "EvoLink 原生语音分析成功。",
        sections: [],
      }) }] } }],
    }), { status: 200 }));

    const result = await analyzeManhuaDramaAudioWithEvolink({
      audioBase64: "ZXZvbGluay1hdWRpbw==",
      mimeType: "audio/mpeg",
    });
    expect(result.model).toBe("evolink/gemini-3.6-flash");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://direct.evolink.ai/v1beta/models/gemini-3.6-flash:generateContent");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-evolink-test");
    const body = JSON.parse(String(init.body));
    expect(body.contents[0].parts[1]).toEqual({
      inlineData: { data: "ZXZvbGluay1hdWRpbw==", mimeType: "audio/mpeg" },
    });
    expect(body.generationConfig).not.toHaveProperty("temperature");
  });

  it("Gemini API 使用 x-goog-api-key，密钥不写入 URL", async () => {
    vi.stubEnv("GEMINI_API_KEY", "AIza-test-key");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        language: "zh",
        transcriptSummary: "Gemini API 最终回退成功。",
        sections: [],
      }) }] } }],
    }), { status: 200 }));

    const result = await analyzeManhuaDramaAudioWithGeminiApi({
      audioBase64: "Z2VtaW5pLWF1ZGlv",
      mimeType: "audio/mpeg",
    });
    expect(result.model).toBe("gemini_api/gemini-3.6-flash");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent");
    expect(url).not.toContain("AIza-test-key");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("AIza-test-key");
  });

  it("前三路失败时只各调用一次，最后回退 Gemini API", async () => {
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", "{\"type\":\"service_account\"}");
    vi.stubEnv("VERTEX_PROJECT_ID", "vertex-test-project");
    vi.stubEnv("EVOLINK_API_KEY", "sk-evolink-test");
    vi.stubEnv("GEMINI_API_KEY", "AIza-test-key");
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          language: "zh",
          transcriptSummary: "第四路成功。",
          sections: [],
        }) }] } }],
      }), { status: 200 }));

    const result = await analyzeManhuaDramaAudioWithFallback({
      audioBase64: "b25jZS1wZXItcHJvdmlkZXI=",
      mimeType: "audio/mpeg",
    });
    expect(result.model).toBe("gemini_api/gemini-3.6-flash");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringContaining("aiplatform.googleapis.com"),
      expect.stringContaining("openrouter.ai"),
      expect.stringContaining("direct.evolink.ai"),
      expect.stringContaining("generativelanguage.googleapis.com"),
    ]);
  });

  it("没有 OpenRouter Key 时可直接使用 Vertex；聚合错误保留可重试语义", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", "{\"type\":\"service_account\"}");
    vi.stubEnv("VERTEX_PROJECT_ID", "vertex-test-project");
    expect(isManhuaDramaAudioAvailable()).toBe(true);
    expect(isManhuaAudioFailureRetryable(
      "语音分析全部链路失败：Vertex（Vertex 语音分析模型暂不可用）；OpenRouter（语音分析服务鉴权失败）",
    )).toBe(false);
    expect(isManhuaAudioFailureRetryable(
      "语音分析全部链路失败：Vertex（Vertex 语音分析服务网络异常）；OpenRouter（语音分析服务鉴权失败）",
    )).toBe(true);
  });
});
