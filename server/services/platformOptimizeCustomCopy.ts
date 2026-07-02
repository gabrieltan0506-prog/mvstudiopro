import { extractFirstChoicePlainText, invokeLLM } from "../_core/llm";
import { getPlatformStage2OpenAiModel } from "../config/platformSwitches";

export type OptimizeCustomCopyInput = {
  sourceText: string;
  optimizationBrief?: string;
};

export type OptimizeCustomCopyResult = {
  summary: string;
  optimizedMarkdown: string;
  titles: string[];
  hooks: string[];
  platformNotes: Array<{ platform: string; angle: string; copySnippet: string }>;
  storyboardNotes?: string;
  coverNotes?: string;
};

const SYSTEM_PROMPT = `你是 mvstudiopro 平台页的资深内容顾问，专门帮创作者把「已有封面文案、分镜脚本、商业背景」深度改写成可直接发布的版本。

硬性要求：
1. **必须紧扣用户原文**：人物、场景、专业背景、产品卖点、情绪主线不得被替换成无关模板（例如电竞、京剧、泛化「爆款指数」套话）。
2. **禁止**输出与用户素材无关的示例标题；禁止「首先其次综上所述」公文腔；禁止空泛平台话术堆砌。
3. 若用户提到封面 / 分镜 / 八格 / 2×4，分别给出可执行的优化建议（主标、副标、各格叙事节奏、口播/字幕要点）。
4. 输出 JSON，字段见 schema；optimizedMarkdown 为完整可读 Markdown（含分段标题，便于复制到生图或发布）。

JSON schema:
{
  "summary": "一句话说明本次优化重点",
  "optimizedMarkdown": "完整优化稿（Markdown）",
  "titles": ["主标题候选1", "主标题候选2", "主标题候选3"],
  "hooks": ["开场钩子1", "开场钩子2"],
  "platformNotes": [
    { "platform": "小红书|抖音|B站|快手", "angle": "该平台切入角度", "copySnippet": "该平台可直接用的短文案片段" }
  ],
  "storyboardNotes": "若涉及分镜/八格：逐格或分段优化建议（可选）",
  "coverNotes": "若涉及封面：主视觉/主标/副标/信息层级建议（可选）"
}`;

export async function optimizeCustomCopy(input: OptimizeCustomCopyInput): Promise<OptimizeCustomCopyResult> {
  const sourceText = String(input.sourceText || "").trim();
  const brief = String(input.optimizationBrief || "").trim();
  if (sourceText.length < 10) {
    throw new Error("请至少提供 10 字以上的待优化文案");
  }

  const userBlock = [
    "【待优化原文】",
    sourceText,
    brief ? "\n【用户优化要求】\n" + brief : "",
  ].join("\n");

  const response = await invokeLLM({
    modelName: getPlatformStage2OpenAiModel(),
    reasoningEffort: "medium",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userBlock },
    ],
    response_format: { type: "json_object" },
  });

  const raw = extractFirstChoicePlainText(response).trim();
  if (!raw) {
    throw new Error("模型未返回有效内容，请稍后重试");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("模型返回格式异常，请稍后重试");
  }

  const optimizedMarkdown = String(parsed.optimizedMarkdown || parsed.markdown || "").trim();
  if (!optimizedMarkdown) {
    throw new Error("优化结果为空，请补充更具体的原文或要求后重试");
  }

  const titles = Array.isArray(parsed.titles)
    ? parsed.titles.map((t) => String(t).trim()).filter(Boolean).slice(0, 5)
    : [];
  const hooks = Array.isArray(parsed.hooks)
    ? parsed.hooks.map((t) => String(t).trim()).filter(Boolean).slice(0, 5)
    : [];
  const platformNotes = Array.isArray(parsed.platformNotes)
    ? parsed.platformNotes
        .map((row) => {
          const r = row as Record<string, unknown>;
          return {
            platform: String(r.platform || "").trim(),
            angle: String(r.angle || "").trim(),
            copySnippet: String(r.copySnippet || "").trim(),
          };
        })
        .filter((r) => r.platform || r.angle || r.copySnippet)
        .slice(0, 6)
    : [];

  return {
    summary: String(parsed.summary || "已完成深度优化").trim(),
    optimizedMarkdown,
    titles,
    hooks,
    platformNotes,
    storyboardNotes: parsed.storyboardNotes ? String(parsed.storyboardNotes).trim() : undefined,
    coverNotes: parsed.coverNotes ? String(parsed.coverNotes).trim() : undefined,
  };
}
