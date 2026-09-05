import { z } from "zod";
import type { ManhuaDirectorStrategyId } from "./manhuaDirectorStrategy.js";
import {
  COMPILER_ENGINE_LIMITS,
  isReadyCompilerEngineId,
  normalizeCompilerEngineId,
  type CompilerDialect,
  type CompilerEngineId,
  type CompilerEngineProfile,
  type CompilerReferenceLimits,
} from "./manhuaShotIR.js";

export const MANHUA_CREATIVE_ADVISOR_CONTEXT_LIMITS = {
  seriesTitleChars: 200,
  episodeTitleChars: 240,
  videoModelChars: 80,
  directorStrategyRevisionChars: 120,
  episodeBodyChars: 24_000,
  assetSummaryChars: 6_000,
  shotSummaryChars: 6_000,
  blockers: 20,
  blockerChars: 500,
  historyItems: 8,
  historyMessageChars: 1_500,
  /** 用户直接输入的问题；不得用前端附加上下文后的包装长度代替。 */
  questionChars: 1_200,
  /** 与 askPlatformSkillQa 路由的 question 上限保持一致；超限显式拒绝。 */
  wrappedQuestionChars: 4_000,
} as const;

export const manhuaCreativeAdvisorStageSchema = z.enum([
  "outline",
  "assets",
  "storyboard",
  "edit",
  "final",
]);

/** 浏览器只拿批准 ID；具体投影与来源审计字段由服务端注册表派生。 */
export const MANHUA_CREATIVE_ADVISOR_STRATEGY_IDS = [
  "information_causality",
  "emotion_space",
  "character_action",
  "audience_discovery",
  "embodied_world",
  "relational_action",
] as const satisfies readonly ManhuaDirectorStrategyId[];

const FORBIDDEN_CONTEXT_VALUE_PATTERNS = [
  { label: "URL", pattern: /(?:https?|ftp):\/\/|(?:gs|data|blob):\/\//i },
  {
    label: "凭证值",
    pattern:
      /\bbearer\s+[a-z0-9._~+/=-]{12,}|\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization)\s*[:=]\s*[^\s]{8,}|\bsk-[a-z0-9_-]{12,}/i,
  },
] as const;

function contextText(maxChars: number, label: string, requireContent = false) {
  const base = z.string().trim().max(maxChars, `${label}超过 ${maxChars} 字符上限`);
  const schema = requireContent ? base.min(1, `${label}不能为空`) : base;
  return schema.superRefine((value, ctx) => {
    for (const entry of FORBIDDEN_CONTEXT_VALUE_PATTERNS) {
      if (!entry.pattern.test(value)) continue;
      ctx.addIssue({
        code: "custom",
        message: `${label}不得包含${entry.label}`,
      });
    }
  });
}

export const manhuaCreativeAdvisorHistoryMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: contextText(
      MANHUA_CREATIVE_ADVISOR_CONTEXT_LIMITS.historyMessageChars,
      "历史消息",
      true,
    ),
  })
  .strict();

export const manhuaCreativeAdvisorContextSchema = z
  .object({
    seriesTitle: contextText(
      MANHUA_CREATIVE_ADVISOR_CONTEXT_LIMITS.seriesTitleChars,
      "剧名",
      true,
    ),
    episodeIndex: z.number().int().min(1).max(9_999),
    episodeTitle: contextText(
      MANHUA_CREATIVE_ADVISOR_CONTEXT_LIMITS.episodeTitleChars,
      "本集标题",
    ),
    stage: manhuaCreativeAdvisorStageSchema,
    videoModel: contextText(
      MANHUA_CREATIVE_ADVISOR_CONTEXT_LIMITS.videoModelChars,
      "成片引擎",
      true,
    ),
    writerConfirmed: z.boolean(),
    episodeBody: contextText(
      MANHUA_CREATIVE_ADVISOR_CONTEXT_LIMITS.episodeBodyChars,
      "本集正文",
    ),
    assetSummary: contextText(
      MANHUA_CREATIVE_ADVISOR_CONTEXT_LIMITS.assetSummaryChars,
      "资产摘要",
    ),
    shotSummary: contextText(
      MANHUA_CREATIVE_ADVISOR_CONTEXT_LIMITS.shotSummaryChars,
      "分镜摘要",
    ),
    blockers: z
      .array(
        contextText(
          MANHUA_CREATIVE_ADVISOR_CONTEXT_LIMITS.blockerChars,
          "阻断项",
          true,
        ),
      )
      .max(MANHUA_CREATIVE_ADVISOR_CONTEXT_LIMITS.blockers),
    directorStrategyId: z.enum(MANHUA_CREATIVE_ADVISOR_STRATEGY_IDS).optional(),
    /** 来自项目 Bible 冻结合同；服务端必须与 ID 成对验真，不能按当前库重算。 */
    directorStrategyRevision: contextText(
      MANHUA_CREATIVE_ADVISOR_CONTEXT_LIMITS.directorStrategyRevisionChars,
      "导演策略修订",
      true,
    ).optional(),
    history: z
      .array(manhuaCreativeAdvisorHistoryMessageSchema)
      .max(MANHUA_CREATIVE_ADVISOR_CONTEXT_LIMITS.historyItems)
      .optional(),
  })
  .strict();

export type ManhuaCreativeAdvisorStage = z.infer<
  typeof manhuaCreativeAdvisorStageSchema
>;
export type ManhuaCreativeAdvisorHistoryMessage = z.infer<
  typeof manhuaCreativeAdvisorHistoryMessageSchema
>;
export type ManhuaCreativeAdvisorContext = z.infer<
  typeof manhuaCreativeAdvisorContextSchema
>;

export type ManhuaCreativeAdvisorEngineFacts =
  | {
      recognized: false;
      requestedVideoModel: string;
      reasonZh: string;
    }
  | {
      recognized: true;
      requestedVideoModel: string;
      engineId: CompilerEngineId;
      dialect: CompilerDialect;
      minSegmentSec: number;
      maxSegmentSec: number;
      references: CompilerReferenceLimits;
      maxPromptChars: number | null;
      requiresIntegerSegmentSec: boolean;
      referenceSyntaxZh: string;
      formatRulesZh: readonly string[];
    };

const REFERENCE_MARKER_BY_DIALECT: Record<
  CompilerDialect,
  Record<"image" | "video" | "audio", string>
> = {
  seedance: { image: "@图N", video: "@视频N", audio: "@音频N" },
  h3: { image: "Image N", video: "Video N", audio: "Audio N" },
  wan: {
    image: "Reference image N",
    video: "Reference video N",
    audio: "Reference audio N",
  },
};

const FORMAT_RULES_BY_DIALECT: Record<CompilerDialect, readonly string[]> = {
  seedance: [
    "媒体职责使用 @图N／@视频N／@音频N，与实际数组顺序一致",
    "对白使用花括号标记，音效使用尖括号标记",
  ],
  h3: [
    "使用自然语言分镜，图片职责写作 Image N",
    "对白使用中文引号，不使用 Seedance 的 @标签、花括号、尖括号或方头括号协议",
  ],
  wan: [
    "使用中文自然语言分镜，媒体职责写作 Reference image／video／audio N",
    "对白使用中文引号，不使用 Seedance 的 @标签、花括号或方头括号协议",
  ],
};

/** 顾问只读取生产编译器当前 profile；未知输入关闭式返回，不猜引擎能力。 */
export function resolveManhuaCreativeAdvisorEngineFacts(
  rawVideoModel: unknown,
): ManhuaCreativeAdvisorEngineFacts {
  const requestedVideoModel = String(rawVideoModel || "").trim();
  const engineId = normalizeCompilerEngineId(requestedVideoModel);
  if (!engineId || !isReadyCompilerEngineId(engineId)) {
    return {
      recognized: false,
      requestedVideoModel,
      reasonZh: "当前值不在生产编译器已接通白名单；不得推测时长、引用能力或提示词方言",
    };
  }

  const profile: CompilerEngineProfile = COMPILER_ENGINE_LIMITS[engineId];
  const markers = REFERENCE_MARKER_BY_DIALECT[profile.dialect];
  const referenceSyntaxZh = (
    [
      ["图片", "image"],
      ["视频", "video"],
      ["音频", "audio"],
    ] as const
  )
    .filter(([, kind]) => profile.references[kind] > 0)
    .map(([label, kind]) => `${label}=${markers[kind]}`)
    .join("；");
  return {
    recognized: true,
    requestedVideoModel,
    engineId,
    dialect: profile.dialect,
    minSegmentSec: profile.minSegmentSec,
    maxSegmentSec: profile.maxSegmentSec,
    references: { ...profile.references },
    maxPromptChars: profile.maxPromptChars ?? null,
    requiresIntegerSegmentSec: profile.requiresIntegerSegmentSec === true,
    referenceSyntaxZh,
    formatRulesZh: FORMAT_RULES_BY_DIALECT[profile.dialect],
  };
}
