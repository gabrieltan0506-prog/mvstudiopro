import { createHash } from "node:crypto";
import { z } from "zod";
import {
  MANHUA_VIRAL_TEMPLATE_LANE_ORDER,
  MANHUA_VIRAL_TEMPLATE_OPTIMIZE_FIELDS,
  parseManhuaViralTemplateCard,
  type ManhuaViralTemplateCard,
  type ManhuaViralTemplateChangeReason,
  type ManhuaViralTemplateOptimizeField,
  type ManhuaViralTemplateOptimizeModel,
  isNativeVideoLearnedTemplate,
  type ManhuaViralTemplateBeat,
} from "../../shared/manhuaViralTemplateBank.js";
import {
  extractFirstChoicePlainText,
  extractJsonString,
  invokeLLM,
  type InvokeParams,
  type InvokeResult,
} from "../_core/llm.js";

type OptimizeModelConfig = {
  id: ManhuaViralTemplateOptimizeModel;
  labelZh: string;
  provider: NonNullable<InvokeParams["provider"]>;
  modelName: string;
  reasoningEffort: "medium" | "high" | "max";
  maxTokens: number;
  responseFormat?: InvokeParams["response_format"];
  openRouterProviderPreferences?: InvokeParams["openRouterProviderPreferences"];
};

export const MANHUA_VIRAL_TEMPLATE_OPTIMIZE_MODELS: readonly OptimizeModelConfig[] = [
  {
    id: "terra_high",
    labelZh: "GPT-5.6 Terra · High",
    provider: "openai",
    modelName: "gpt-5.6-terra",
    reasoningEffort: "high",
    maxTokens: 32_768,
    responseFormat: { type: "json_object" },
  },
  {
    id: "kimi_k3_max",
    labelZh: "Kimi K3 · Max",
    provider: "openai",
    modelName: "moonshotai/kimi-k3",
    reasoningEffort: "max",
    maxTokens: 32_768,
    responseFormat: { type: "json_object" },
  },
  {
    id: "claude_opus_5_high",
    labelZh: "Claude Opus 5 · High",
    provider: "anthropic",
    modelName: "claude-opus-5",
    reasoningEffort: "high",
    maxTokens: 32_768,
  },
  {
    id: "deepseek_v4_0813_high",
    labelZh: "DeepSeek V4 Pro 0813 · High",
    provider: "openai",
    modelName: "deepseek/deepseek-v4-pro-0813",
    reasoningEffort: "high",
    maxTokens: 65_536,
    responseFormat: { type: "json_object" },
    openRouterProviderPreferences: { require_parameters: true },
  },
] as const;

const optionalTrimmed = (max: number) => z.string().trim().min(1).max(max).optional();

/** 原生逐镜证据对旧抽帧卡可选；一旦原卡存在，优化门禁逐镜禁止丢失。 */
const beatSchema = z.object({
  atSec: z.number().int().min(0).max(3_600),
  endSec: z.number().int().min(1).max(3_600).optional(),
  conflictZh: z.string().trim().min(1).max(40),
  visualZh: z.string().trim().min(1).max(280),
  unitTypeZh: z.enum(["剪辑镜头", "拆分镜证据段"]).optional(),
  shotSizeZh: optionalTrimmed(32),
  angleZh: optionalTrimmed(32),
  compositionZh: optionalTrimmed(160),
  cameraMoveZh: optionalTrimmed(220),
  blockingZh: optionalTrimmed(220),
  bodyActionZh: optionalTrimmed(220),
  limbPropActionZh: optionalTrimmed(220),
  microExpressionZh: optionalTrimmed(220),
  gazeBreathZh: optionalTrimmed(180),
  relationshipReactionZh: optionalTrimmed(200),
  lightingZh: optionalTrimmed(220),
  transitionInZh: optionalTrimmed(140),
}).strict();

const candidateSchema = z.object({
  nameZh: z.string().trim().min(1).max(32),
  laneZh: z.enum(MANHUA_VIRAL_TEMPLATE_LANE_ORDER),
  summaryZh: z.string().trim().min(1).max(120),
  hook3sZh: z.string().trim().min(1).max(200),
  // 正式证据层不设固定镜头上限；输出截断会整次失败，绝不能先裁成 128 再冒充成功。
  beatGrid: z.array(beatSchema).min(1),
  reusableZh: optionalTrimmed(600),
  genPromptHintZh: optionalTrimmed(600),
  scenePoolHints: z.array(z.string().trim().min(1).max(80)),
  castShape: z.object({
    leadDesireZh: z.string().trim().min(1).max(80),
    pressureZh: z.string().trim().min(1).max(80),
    foilZh: z.string().trim().max(80).optional(),
  }).strict(),
  densityHints: z.object({
    minBodyChars: z.number().int().min(80).max(20_000),
    minDialogueLines: z.number().int().min(2).max(500),
    minLocationHits: z.number().int().min(1).max(100),
  }).strict(),
}).strict();

const optimizeOutputSchema = z.object({
  candidate: candidateSchema,
  reasons: z.array(z.object({
    field: z.enum(MANHUA_VIRAL_TEMPLATE_OPTIMIZE_FIELDS),
    reasonZh: z.string().trim().min(2).max(240),
  }).strict()).min(1).max(MANHUA_VIRAL_TEMPLATE_OPTIMIZE_FIELDS.length),
}).strict();

type InvokeLike = (params: InvokeParams) => Promise<InvokeResult>;

function modelConfig(id: ManhuaViralTemplateOptimizeModel): OptimizeModelConfig {
  const found = MANHUA_VIRAL_TEMPLATE_OPTIMIZE_MODELS.find((item) => item.id === id);
  if (!found) throw new Error("不支持的模板优化模型");
  return found;
}

function comparableValue(card: ManhuaViralTemplateCard, field: ManhuaViralTemplateOptimizeField) {
  return card[field];
}

export function diffManhuaViralTemplateFields(
  original: ManhuaViralTemplateCard,
  candidate: ManhuaViralTemplateCard,
): ManhuaViralTemplateOptimizeField[] {
  return MANHUA_VIRAL_TEMPLATE_OPTIMIZE_FIELDS.filter(
    (field) => JSON.stringify(comparableValue(original, field)) !== JSON.stringify(comparableValue(candidate, field)),
  );
}

/** 原生逐镜证据：抽帧给不出，一旦丢失无法重建。 */
const NATIVE_BEAT_FIELDS = [
  "endSec",
  "unitTypeZh",
  "shotSizeZh",
  "angleZh",
  "compositionZh",
  "cameraMoveZh",
  "blockingZh",
  "bodyActionZh",
  "limbPropActionZh",
  "microExpressionZh",
  "gazeBreathZh",
  "relationshipReactionZh",
  "lightingZh",
  "transitionInZh",
] as const satisfies readonly (keyof ManhuaViralTemplateBeat)[];

/**
 * 原生精读模板的防丢门禁。
 *
 * ⚠️ 只比镜头数量拦不住：实测上游会返回相同镜头数、却把角色调度与表演证据整体省略，
 * 还给出一条 beatGrid 的修改理由，于是修订「成功」而数据已经没了。
 * 所以必须逐镜比对——原来有的字段，改完不能变成 undefined。
 */
function assertNativeBeatMetadataNotDropped(
  original: ManhuaViralTemplateCard,
  candidate: ManhuaViralTemplateCard,
): void {
  if (!isNativeVideoLearnedTemplate(original)) return;

  if (candidate.beatGrid.length !== original.beatGrid.length) {
    throw new Error(
      `原生精读镜头数量发生变化（原 ${original.beatGrid.length} → 新 ${candidate.beatGrid.length}），未生成待审修订`,
    );
  }

  for (let index = 0; index < original.beatGrid.length; index += 1) {
    const before = original.beatGrid[index]!;
    const after = candidate.beatGrid[index]!;
    for (const field of NATIVE_BEAT_FIELDS) {
      if (before[field] !== undefined && after[field] === undefined) {
        throw new Error(`原生精读第 ${index + 1} 镜缺少 ${field}，未生成待审修订`);
      }
    }
  }
}

function buildOptimizePrompt(card: ManhuaViralTemplateCard, promptZh: string): string {
  const protectedSource = {
    id: card.id,
    nameZh: card.nameZh,
    laneZh: card.laneZh,
    summaryZh: card.summaryZh,
    hook3sZh: card.hook3sZh,
    beatGrid: card.beatGrid,
    reusableZh: card.reusableZh,
    genPromptHintZh: card.genPromptHintZh,
    scenePoolHints: card.scenePoolHints,
    castShape: card.castShape,
    densityHints: card.densityHints,
    sourceRefs: card.sourceRefs,
    provenance: card.provenance,
  };
  return `你是爆款 AI 漫剧节奏模板的私有优化器。原模板是用户从真实爆款内容中蒸馏得到的高价值资产，必须把它作为主依据；不要改写成与你收到的模板无关的新模板。

用户优化要求：
${promptZh}

原模板：
${JSON.stringify(protectedSource)}

输出规则：
1. 只输出一个 JSON 对象，顶层只能有 candidate、reasons。
2. candidate 只能有 nameZh,laneZh,summaryZh,hook3sZh,beatGrid,reusableZh,genPromptHintZh,scenePoolHints,castShape,densityHints；字段结构与原模板一致。
2.1 若原模板的 beatGrid 带 endSec/unitTypeZh/shotSizeZh/angleZh/compositionZh/cameraMoveZh/blockingZh/bodyActionZh/limbPropActionZh/microExpressionZh/gazeBreathZh/relationshipReactionZh/lightingZh/transitionInZh（原生精读产出），必须逐镜原样带回，**镜头条数一条都不能少**；这些字段是原始视听差分证据，丢了无法重建。
3. 禁止输出或改写 id、publicCode、status、sourceRefs、provenance、approvedAt、updatedAt。
4. 只借鉴结构和中性手法；禁止复制来源剧名、原台词、商标或无法从原模板和用户要求得到的事实。
5. reasons 必须覆盖每个实际变更的顶层字段；field 只能从 ${MANHUA_VIRAL_TEMPLATE_OPTIMIZE_FIELDS.join(",")} 中选，reasonZh 说明该字段为何按用户要求优化。
6. 没必要修改的字段原样保留；不得为了显得改动多而改动。
7. 输出前逐字段自查长度、结构、理由和实际变更一致；JSON 首字符为 {，尾字符为 }。`;
}

export async function optimizeApprovedManhuaViralTemplate(input: {
  card: ManhuaViralTemplateCard;
  model: ManhuaViralTemplateOptimizeModel;
  promptZh: string;
  requestId: string;
  userId: number;
  abortSignal?: AbortSignal;
  invoke?: InvokeLike;
}): Promise<{
  original: ManhuaViralTemplateCard;
  proposal: ManhuaViralTemplateCard;
  changedFields: ManhuaViralTemplateOptimizeField[];
  reasons: ManhuaViralTemplateChangeReason[];
}> {
  if (input.card.status !== "approved") throw new Error("只能优化已批准模板");
  const promptZh = String(input.promptZh || "").trim();
  if (promptZh.length < 2 || promptZh.length > 2_000) throw new Error("优化提示词需为 2–2000 字");
  const requestId = String(input.requestId || "").trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)) throw new Error("优化请求 ID 不合法");
  if (!Number.isInteger(input.userId) || input.userId <= 0) throw new Error("优化用户不合法");

  const config = modelConfig(input.model);
  const call = input.invoke || invokeLLM;
  const result = await call({
    provider: config.provider,
    modelName: config.modelName,
    reasoningEffort: config.reasoningEffort,
    max_tokens: config.maxTokens,
    response_format: config.responseFormat,
    openRouterProviderPreferences: config.openRouterProviderPreferences,
    requestId,
    abortSignal: input.abortSignal,
    messages: [{ role: "user", content: buildOptimizePrompt(input.card, promptZh) }],
  });
  if (result.choices.some((choice) => choice.finish_reason === "length")) {
    throw new Error("模板优化输出被截断，未生成待审修订");
  }
  const plain = extractFirstChoicePlainText(result).trim();
  if (!plain.startsWith("{") || !plain.endsWith("}")) {
    throw new Error("模板优化没有返回完整 JSON，未生成待审修订");
  }
  const parsed = optimizeOutputSchema.parse(JSON.parse(extractJsonString(plain)));
  const candidateBase = parseManhuaViralTemplateCard({
    ...input.card,
    ...parsed.candidate,
    status: "proposed",
    publicCode: undefined,
    approvedAt: undefined,
    updatedAt: new Date().toISOString(),
  });
  if (!candidateBase) throw new Error("模板优化结果未通过卡片校验");
  assertNativeBeatMetadataNotDropped(input.card, candidateBase);
  const changedFields = diffManhuaViralTemplateFields(input.card, candidateBase);
  if (!changedFields.length) throw new Error("优化结果与原模板完全相同，未生成待审修订");
  const reasonByField = new Map(parsed.reasons.map((reason) => [reason.field, reason.reasonZh]));
  const reasons = changedFields.map((field) => ({
    field,
    reasonZh: reasonByField.get(field) || "",
  }));
  if (reasons.some((reason) => !reason.reasonZh)) {
    throw new Error("优化结果缺少对应字段的优化原因，未生成待审修订");
  }

  const revisionId = `tpl_revision_${createHash("sha256")
    .update(`${input.card.id}:${requestId}`)
    .digest("hex")
    .slice(0, 20)}`;
  const proposal = parseManhuaViralTemplateCard({
    ...candidateBase,
    id: revisionId,
    sourceRefs: input.card.sourceRefs,
    provenance: input.card.provenance,
    revision: {
      parentTemplateId: input.card.id,
      requestId,
      model: config.id,
      modelName: config.modelName,
      reasoningEffort: config.reasoningEffort,
      promptZh,
      changedFields,
      reasons,
      createdByUserId: input.userId,
      createdAt: new Date().toISOString(),
    },
  });
  if (!proposal?.revision) throw new Error("模板修订元数据校验失败");
  return { original: input.card, proposal, changedFields, reasons };
}
