/**
 * 漫剧模板学习 · 关键帧视觉。
 * 默认 GPT-5.6 Terra（reasoning=high）；env MANHUA_TEMPLATE_LEARN_LLM_PROVIDER=claude
 * 切 claude-opus-5（A/B 拍板，帧走 GCS 签名 URL 绝不 base64）。
 * 供 Fly `manhuaTemplateFrameScan` 与本机学习脚本调用。
 */
import { createHash } from "node:crypto";
import { invokeLLM, extractJsonString } from "./_core/llm.js";
import {
  MANHUA_TEMPLATE_FRAME_VISION_MAX_FRAMES,
  MANHUA_TEMPLATE_FRAME_VISION_MODEL,
  MANHUA_TEMPLATE_FRAME_VISION_REASONING,
  MANHUA_TEMPLATE_LEARN_CLAUDE_MODEL,
  buildManhuaTemplateFrameVisionSystemPrompt,
  buildManhuaTemplateFrameVisionUserText,
  parseManhuaTemplateFrameVisionJson,
  resolveManhuaTemplateLearnLlmProvider,
  selectFramesForVisionAnalysis,
  type ManhuaTemplateFrameVisionInputFrame,
  type ManhuaTemplateFrameVisionResult,
} from "../shared/manhuaTemplateLearnFrameVision.js";
import type { ManhuaViralTemplateLane } from "../shared/manhuaViralTemplateBank.js";

export type AnalyzeManhuaTemplateFramesInput = {
  frames: ManhuaTemplateFrameVisionInputFrame[];
  titleHint?: string;
  durationSec?: number;
  transcriptPreview?: string;
  climaxNotes?: string[];
  fallbackLane?: ManhuaViralTemplateLane | string;
};

async function resolveFrameDataUrl(frame: ManhuaTemplateFrameVisionInputFrame): Promise<{
  atSec: number;
  dataUrl: string;
}> {
  const atSec = Math.max(0, Number(frame.atSec) || 0);
  const mime = String(frame.mimeType || "image/jpeg").trim() || "image/jpeg";
  const dataUrl = String(frame.dataUrl || "").trim();
  if (dataUrl.startsWith("data:")) return { atSec, dataUrl };

  const gcsUri = String(frame.gcsUri || "").trim();
  if (gcsUri.startsWith("gs://")) {
    const { downloadGcsObject, signGsUriV4ReadUrl } = await import("./services/gcs.js");
    try {
      const obj = await downloadGcsObject({ gcsUri });
      const b64 = obj.buffer.toString("base64");
      return { atSec, dataUrl: `data:${mime};base64,${b64}` };
    } catch {
      const signed = signGsUriV4ReadUrl(gcsUri, 3600);
      const res = await fetch(signed);
      if (!res.ok) throw new Error(`frame_gcs_fetch_failed:${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return { atSec, dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
    }
  }

  const url = dataUrl || String(frame.url || "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("frame_missing_data");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`frame_url_fetch_failed:${res.status}`);
  const ct = res.headers.get("content-type") || mime;
  const buf = Buffer.from(await res.arrayBuffer());
  return { atSec, dataUrl: `data:${ct};base64,${buf.toString("base64")}` };
}

/** Claude 拉取用签名 URL 时长：给足 2 小时，防长队列里签名过期（拍板要求） */
const FRAME_SIGNED_URL_TTL_SEC = 2 * 3600;

/**
 * Claude 路径：帧一律转成可拉取的 https URL，绝不 base64 进请求体（2026-08-10 拍板，
 * 防请求体膨胀；与 Seedance 侧 64MB 约束同源）。
 * dataUrl 形态 → 帧上传 GCS（frames-tmp/，按内容哈希去重）→ V4 签名 URL；
 * gs:// 形态 → 直接签名（Claude 拉不动 gs://）。
 */
async function resolveFrameHttpsUrl(frame: ManhuaTemplateFrameVisionInputFrame): Promise<{
  atSec: number;
  url: string;
  /** 本次为发请求临时上传的 frames-tmp 对象（用后清理）；直连已有 URL/gcsUri 时为空 */
  tmpObjectName?: string;
}> {
  const atSec = Math.max(0, Number(frame.atSec) || 0);
  const direct = String(frame.url || "").trim();
  if (/^https?:\/\//i.test(direct)) return { atSec, url: direct };

  const gcsUri = String(frame.gcsUri || "").trim();
  if (gcsUri.startsWith("gs://")) {
    const { signGsUriV4ReadUrl } = await import("./services/gcs.js");
    return { atSec, url: signGsUriV4ReadUrl(gcsUri, FRAME_SIGNED_URL_TTL_SEC) };
  }

  const dataUrl = String(frame.dataUrl || "").trim();
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!match) throw new Error("frame_missing_data");
  const mime = match[1] || "image/jpeg";
  const buffer = Buffer.from(match[2]!, "base64");
  const ext = /png/i.test(mime) ? "png" : /webp/i.test(mime) ? "webp" : "jpg";
  const hash = createHash("sha1").update(buffer).digest("hex").slice(0, 20);
  const { uploadBufferToGcs, signGsUriV4ReadUrl } = await import("./services/gcs.js");
  const objectName = `manhua-template-learn/frames-tmp/${hash}.${ext}`;
  const uploaded = await uploadBufferToGcs({
    objectName,
    buffer,
    contentType: mime,
  });
  return {
    atSec,
    url: signGsUriV4ReadUrl(uploaded.gcsUri, FRAME_SIGNED_URL_TTL_SEC),
    tmpObjectName: objectName,
  };
}

export async function analyzeManhuaTemplateFramesWithTerra(
  input: AnalyzeManhuaTemplateFramesInput,
): Promise<ManhuaTemplateFrameVisionResult> {
  const selected = selectFramesForVisionAnalysis(
    input.frames.filter((f) => f && (f.dataUrl || f.gcsUri || f.url)),
    MANHUA_TEMPLATE_FRAME_VISION_MAX_FRAMES,
  );
  if (!selected.length) throw new Error("missing_frames");

  const learnProvider = resolveManhuaTemplateLearnLlmProvider(
    process.env.MANHUA_TEMPLATE_LEARN_LLM_PROVIDER,
  );
  const isClaude = learnProvider === "claude";

  // GPT 路径帧转 dataUrl 内联；Claude 路径帧一律转 https URL（GCS 签名），绝不 base64
  const resolved: Array<{ atSec: number; imageUrl: string }> = [];
  const tmpFrameObjects: string[] = [];
  for (const frame of selected) {
    if (isClaude) {
      const { atSec, url, tmpObjectName } = await resolveFrameHttpsUrl(frame);
      resolved.push({ atSec, imageUrl: url });
      if (tmpObjectName) tmpFrameObjects.push(tmpObjectName);
    } else {
      const { atSec, dataUrl } = await resolveFrameDataUrl(frame);
      resolved.push({ atSec, imageUrl: dataUrl });
    }
  }
  // frames-tmp 请求后 best-effort 清理（审查建议5）：签名 URL 只在本次请求内有用
  const cleanupTmpFrames = async () => {
    if (!tmpFrameObjects.length) return;
    const { deleteGcsObject } = await import("./services/gcs.js");
    await Promise.all(
      tmpFrameObjects.map((objectName) => deleteGcsObject({ objectName }).catch(() => {})),
    );
  };

  const modelName = isClaude ? MANHUA_TEMPLATE_LEARN_CLAUDE_MODEL : MANHUA_TEMPLATE_FRAME_VISION_MODEL;
  try {
  const response = await invokeLLM({
    model: "pro",
    provider: isClaude ? "anthropic" : "openai",
    modelName,
    reasoningEffort: MANHUA_TEMPLATE_FRAME_VISION_REASONING,
    max_tokens: 16_384,
    // claude-opus-5 不收采样控件与 response_format，仅 GPT 路径带
    ...(isClaude ? {} : { temperature: 0.3, response_format: { type: "json_object" as const } }),
    messages: [
      {
        role: "system",
        content: buildManhuaTemplateFrameVisionSystemPrompt(),
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildManhuaTemplateFrameVisionUserText({
              titleHint: input.titleHint,
              durationSec: input.durationSec,
              transcriptPreview: input.transcriptPreview,
              climaxNotes: input.climaxNotes,
              frames: resolved,
            }),
          },
          ...resolved.map((item, index) => ({
            type: "image_url" as const,
            image_url: {
              url: item.imageUrl,
              detail: (index < 4 || item.atSec <= 5 ? "high" : "auto") as "high" | "auto",
            },
          })),
        ],
      },
    ],
  });

  if (String(response.choices?.[0]?.finish_reason || "") === "max_tokens") {
    throw new Error("frame_vision_truncated");
  }
  const content = String(response.choices?.[0]?.message?.content || "").trim();
  const jsonText = extractJsonString(content);
  let parsedJson: unknown = jsonText;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch {
    parsedJson = content;
  }
  const vision = parseManhuaTemplateFrameVisionJson(
    parsedJson,
    (input.fallbackLane as ManhuaViralTemplateLane) || "爽文逆袭",
  );
  if (!vision) throw new Error("frame_vision_parse_failed");
  return {
    ...vision,
    model: modelName,
    reasoningEffort: MANHUA_TEMPLATE_FRAME_VISION_REASONING,
  };
  } finally {
    await cleanupTmpFrames();
  }
}
