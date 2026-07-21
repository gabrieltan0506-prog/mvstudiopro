/**
 * 漫剧模板学习 · 关键帧视觉（GPT-5.6 Terra · reasoning=high）。
 * 供 Fly `manhuaTemplateFrameScan` 与本机学习脚本调用。
 */
import { invokeLLM, extractJsonString } from "./_core/llm.js";
import {
  MANHUA_TEMPLATE_FRAME_VISION_MAX_FRAMES,
  MANHUA_TEMPLATE_FRAME_VISION_MODEL,
  MANHUA_TEMPLATE_FRAME_VISION_REASONING,
  buildManhuaTemplateFrameVisionSystemPrompt,
  buildManhuaTemplateFrameVisionUserText,
  parseManhuaTemplateFrameVisionJson,
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

export async function analyzeManhuaTemplateFramesWithTerra(
  input: AnalyzeManhuaTemplateFramesInput,
): Promise<ManhuaTemplateFrameVisionResult> {
  const selected = selectFramesForVisionAnalysis(
    input.frames.filter((f) => f && (f.dataUrl || f.gcsUri || f.url)),
    MANHUA_TEMPLATE_FRAME_VISION_MAX_FRAMES,
  );
  if (!selected.length) throw new Error("missing_frames");

  const resolved: Array<{ atSec: number; dataUrl: string }> = [];
  for (const frame of selected) {
    resolved.push(await resolveFrameDataUrl(frame));
  }

  const response = await invokeLLM({
    model: "pro",
    provider: "openai",
    modelName: MANHUA_TEMPLATE_FRAME_VISION_MODEL,
    reasoningEffort: MANHUA_TEMPLATE_FRAME_VISION_REASONING,
    max_tokens: 16_384,
    temperature: 0.3,
    response_format: { type: "json_object" },
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
              url: item.dataUrl,
              detail: (index < 4 || item.atSec <= 5 ? "high" : "auto") as "high" | "auto",
            },
          })),
        ],
      },
    ],
  });

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
    model: MANHUA_TEMPLATE_FRAME_VISION_MODEL,
    reasoningEffort: MANHUA_TEMPLATE_FRAME_VISION_REASONING,
  };
}
