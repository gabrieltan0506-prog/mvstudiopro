/**
 * 選題封面可選「企劃大腦」：**Vertex @google/genai · 預設 global** 輸出**中文**高階生圖企劃（JSON），
 * 再交 {@link runPlatformTopicImagePipeline}：**中文直送** → GPT-IMAGE-2 / Nano Banana。**不取代**長任務 Deep Research Interactions。
 *
 * 環境：`PLATFORM_COVER_AGENTIC_BRAIN=1|true` 啟用。
 * `PLATFORM_COVER_STRATEGIST_MODEL`（預設 `gemini-3-flash-preview`）、
 * `PLATFORM_COVER_STRATEGIST_LOCATION`（未設時沿用 {@link resolveVertexFlashTranslationLocation}）。
 */
import { GoogleGenAI } from "@google/genai";
import { extractJsonString } from "../_core/llm.js";
import {
  resolveVertexFlashTranslationLocation,
  resolveVertexFlashThinkingConfigForSdk,
  resolveVertexFlashTranslationMaxOutputTokens,
  resolveVertexFlashTranslationTemperature,
} from "./geminiPlatformCompositeTranslation.js";

export interface TenantProfile {
  industry: string;
  advantage: string;
  flagship: string;
}

export interface CoverTaskInput {
  topicTitle: string;
  baseCopywriting: string;
  format: "短视频" | "图文";
  tenantProfile: TenantProfile;
}

export interface StrategistOutput {
  coverHeadline?: string;
  rawImagePrompt: string;
  designRationale?: string;
}

function resolveVertexProjectIdForGenAi(): string {
  const p = String(
    process.env.GCP_PROJECT_ID || process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "",
  ).trim();
  if (!p) throw new Error("missing_GCP_PROJECT_ID_or_VERTEX_PROJECT_ID");
  return p;
}

function buildGoogleGenAiAuthOptionsFromEnv(): { credentials: { client_email: string; private_key: string } } | undefined {
  const raw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
  if (!raw || raw === "{}") return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const email = parsed.client_email;
    const pk = parsed.private_key;
    if (typeof email === "string" && typeof pk === "string") {
      return { credentials: { client_email: email, private_key: pk.replace(/\\n/g, "\n") } };
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/** 將 IP 長文拆成三欄（無結構時整段放 advantage）。 */
export function deriveTenantProfileFromCoverPersona(
  coverPersona: string,
  topicTitle: string,
): TenantProfile {
  const raw = String(coverPersona || "").trim();
  if (!raw) {
    return { industry: "未提供", advantage: "", flagship: String(topicTitle || "").slice(0, 200) };
  }
  let industry = "";
  let advantage = "";
  let flagship = "";
  for (const line of raw.split("\n")) {
    const L = line.trim();
    const m =
      /^[【\[]?\s*(行业|领域|类目|赛道)\s*[】\]:：]\s*(.+)$/i.exec(L) ||
      /^[【\[]?\s*(优势|長板|壁垒|背景)\s*[】\]:：]\s*(.+)$/i.exec(L) ||
      /^[【\[]?\s*(风格|视觉|主轴)\s*[】\]:：]\s*(.+)$/i.exec(L);
    if (m) {
      const val = String(m[2] || "").trim();
      if (/行业|域|类目|赛道/.test(L)) industry = val;
      else if (/优|壁|背景/.test(L)) advantage = advantage ? `${advantage}；${val}` : val;
      else if (/风|视|主轴/.test(L)) flagship = val;
    }
  }
  if (!industry && !advantage && !flagship) {
    return { industry: "综合", advantage: raw.slice(0, 1200), flagship: String(topicTitle || "").slice(0, 200) };
  }
  return {
    industry: industry || "综合",
    advantage: advantage || raw.slice(0, 800),
    flagship: flagship || String(topicTitle || "").slice(0, 200),
  };
}

export function buildCoverTaskInputFromPipeline(params: {
  topicHook: string;
  format?: "短视频" | "图文";
  context?: string;
  coverPersonaContext?: string;
}): CoverTaskInput {
  const topicTitle = String(params.topicHook || "").trim().slice(0, 300);
  const baseCopywriting = [
    String(params.coverPersonaContext || "").trim()
      ? `【身份美学锚点】\n${String(params.coverPersonaContext).trim()}`
      : "",
    "【人物造型】配合场景的高雅/高贵时装；VOGUE / ELLE / Harper's Bazaar / 好莱坞时尚编辑气质；皮肤纹理真实、妆发高级；配饰可点缀勿硬配。",
    String(params.context || "").trim(),
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 8000);

  const tenantProfile = deriveTenantProfileFromCoverPersona(
    String(params.coverPersonaContext || "").trim(),
    topicTitle,
  );

  const format: "短视频" | "图文" = params.format === "图文" ? "图文" : "短视频";

  return {
    topicTitle,
    baseCopywriting: baseCopywriting || topicTitle,
    format,
    tenantProfile,
  };
}

export function isPlatformCoverAgenticBrainEnabled(): boolean {
  const v = String(process.env.PLATFORM_COVER_AGENTIC_BRAIN || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Vertex Gemini · JSON · 附帶 Google Search（失敗則無工具重試）。 */
export async function runAgenticCoverStrategist(
  input: CoverTaskInput,
  flowLog?: string[],
): Promise<StrategistOutput | null> {
  const log = (s: string) => {
    void flowLog?.push(`${new Date().toISOString()}  [企划大脑·Vertex] ${s}`);
  };

  try {
    const project = resolveVertexProjectIdForGenAi();
    const location =
      String(process.env.PLATFORM_COVER_STRATEGIST_LOCATION || "").trim() || resolveVertexFlashTranslationLocation();
    const model =
      String(process.env.PLATFORM_COVER_STRATEGIST_MODEL || "").trim() || "gemini-3-flash-preview";
    const authOpts = buildGoogleGenAiAuthOptionsFromEnv();
    const tp = input.tenantProfile;

    log(`開始 · model=${model} · location=${location}`);
    const ai = new GoogleGenAI({
      vertexai: true,
      project,
      location,
      ...(authOpts ? { googleAuthOptions: authOpts } : {}),
    });

    const systemInstruction = [
      `你是拥有顶级审美与隐喻转译能力的 ${input.format} 信息流「封面视觉艺术总监」（抖音/小红书式竖封缩略图）。你必须将租户的「职业、身份、专长」提炼为高级的视觉思想，拒绝廉价复杂的模板感，禁止泛化博主风。`,
      `即使无外部检索，也须凭顶尖专业直觉进行概念设计；不建议编造虚假外部链接。`,
      `仅输出合法 JSON，包含三键：` +
        `"coverHeadline"（≤12字简体大字，必须绝对突出，一击致命）、` +
        `"rawImagePrompt"（**简体中文**概念企划：包含核心隐喻·视觉层级·电影级布光·构图张力·色彩系统。**场景必须自适应词义并极度多元化**，**室内外皆可**，强硬拒绝无脑依赖书房书桌或重复客厅沙发；可大胆调用宏大自然、工业废墟、精密室内或极简棚拍等）、` +
        `"designRationale"（≤200字，阐述隐喻逻辑与CTR视觉冲击力来源）。`,
      `不建议使用 Markdown、不建议在 JSON 外附加文字。`,
    ].join("");

    const userText = [
      `【创作者 IP】行业：${tp.industry}；优势：${tp.advantage}；风格主轴：${tp.flagship}`,
      `【选题】${input.topicTitle}`,
      `【基础文案】\n${input.baseCopywriting.slice(0, 6000)}`,
      `请输出 JSON（竖版 9:16 单主视觉；不建議写成宽幅 2×4 八格表）。`,
    ].join("\n\n");

    const thinking = resolveVertexFlashThinkingConfigForSdk();
    const maxOut = Math.min(8192, resolveVertexFlashTranslationMaxOutputTokens());
    const temperature = Math.min(0.95, resolveVertexFlashTranslationTemperature());

    type GenCfg = Record<string, unknown>;
    const baseCfg: GenCfg = {
      systemInstruction,
      responseMimeType: "application/json",
      temperature,
      maxOutputTokens: maxOut,
      ...(thinking.thinkingConfig ? thinking : {}),
    };

    let response: unknown;
    try {
      response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: userText }] }],
        config: { ...baseCfg, tools: [{ googleSearch: {} }] } as any,
      });
    } catch {
      log(`带 googleSearch 失败 → 降级无工具重试`);
      response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: userText }] }],
        config: baseCfg as any,
      });
    }

    const raw = String((response as { text?: string })?.text ?? "").trim();
    if (!raw) {
      log(`空响应 → skip`);
      return null;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(extractJsonString(raw)) as Record<string, unknown>;
    } catch {
      log(`JSON 解析失败 → skip`);
      return null;
    }
    const rawImagePrompt = String(parsed.rawImagePrompt ?? parsed.raw_image_prompt ?? "").trim();
    if (!rawImagePrompt || rawImagePrompt.length < 20) {
      log(`rawImagePrompt 过短 → skip`);
      return null;
    }
    const coverHeadline = String(parsed.coverHeadline ?? "").trim() || undefined;
    const designRationale = String(parsed.designRationale ?? "").trim() || undefined;
    log(`完成 · promptLen=${rawImagePrompt.length}`);
    return {
      coverHeadline,
      rawImagePrompt,
      designRationale,
    };
  } catch (e: any) {
    const msg = e?.message || String(e);
    void flowLog?.push(
      `${new Date().toISOString()}  [企划大脑·Vertex] 異常（主链路降级）: ${msg.slice(0, 520)}`,
    );
    console.warn("[agenticCoverWorkflow] strategist failed:", msg);
    return null;
  }
}
