import {
  buildGeminiNativeDeepReadSegmentPrompt,
  buildGeminiNativeDeepReadSegmentRequest,
} from "./manhuaNativeDeepReadRunner";

/** Keep the learning contract intact; append only the user-authorized review task. */
export function buildFilmReviewNativeRequest(input: { uri: string; durationSec: number; hasAudio: boolean; question: string }) {
  const context = { startSec: 0, endSec: input.durationSec, segmentIndex: 0, hasAudio: input.hasAudio };
  const prompt = buildGeminiNativeDeepReadSegmentPrompt({ ...context, episodeDurationSec: input.durationSec, segmentCount: 1, videoFps: 12, hintZh: input.question });
  const request = buildGeminiNativeDeepReadSegmentRequest({ fileUri: input.uri, fps: 12, segmentContext: context,
    prompt: prompt + "\n【本次用途：成片审阅】\n保留上述逐镜、声音、字幕、时间换算和全部原生字段，另填写filmReview。根据同一份真实音画证据，指出本片值得保留的亮点与需要改进的不足，覆盖实际相关的表演、构图、场景、灯光、声音、连续性、字幕和节奏；不为凑数编造问题。每条写明全片累计秒范围、观察证据、保留或修改建议；不确定标需人工核对，解释限制。所有建议时间必须位于本片内，不能把01:03写成103秒。不要用字幕替代听音。该审阅不改变原片，也不生成学习模板。",
  });
  const config = request.generationConfig as Record<string, unknown>;
  const schema = structuredClone(config.responseSchema) as { properties: Record<string, unknown>; required: string[]; propertyOrdering?: string[] };
  schema.properties.filmReview = {
    type: "OBJECT", properties: {
      summary: { type: "STRING", description: "本片整体评价，2000字内" },
      findings: { type: "ARRAY", items: { type: "OBJECT", properties: {
        kind: { type: "STRING", enum: ["亮点", "不足"] },
        atSec: { type: "NUMBER", description: `全片累计秒，0至${input.durationSec}，先按分钟乘60换算` },
        endSec: { type: "NUMBER", description: `全片累计秒，不早于atSec且不超过${input.durationSec}` },
        category: { type: "STRING", enum: ["表演", "构图", "场景", "灯光", "声音", "连续性", "字幕", "节奏"] },
        observation: { type: "STRING", description: "具体观察与对应音画证据，700字内" },
        suggestion: { type: "STRING", description: "最小可执行修改或值得保留的做法，700字内" },
        confidence: { type: "STRING", enum: ["明确", "需人工核对"] },
      }, required: ["kind", "atSec", "endSec", "category", "observation", "suggestion", "confidence"] } },
      limitations: { type: "STRING", description: "实际未能核实的内容；不确定的声音不能当作无声，1500字内" },
    }, required: ["summary", "findings", "limitations"],
  };
  schema.required.push("filmReview");
  if (schema.propertyOrdering) schema.propertyOrdering.push("filmReview");
  return { ...request, contents: request.contents as unknown[], generationConfig: { ...config, responseSchema: schema } };
}
