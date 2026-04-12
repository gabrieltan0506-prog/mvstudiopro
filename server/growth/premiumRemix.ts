import {
  type GrowthAnalysisScores,
  type GrowthCampModel,
  type GrowthHandoff,
  growthPremiumRemixAssetsSchema,
  growthPremiumRemixSchema,
  type GrowthTitleExecution,
  type GrowthAssetAdaptation,
} from "@shared/growth";
import { invokeLLM } from "../_core/llm";
import { generateGeminiImage } from "../gemini-image";
import { generateVideo } from "../veo";
import { buildCharacterLockPrompt } from "../workflow/prompts/characterLockPrompt";
import { resolveGrowthCampStrategistModel } from "./extractorPipeline";

const PREMIUM_REMIX_MODEL: GrowthCampModel = "gemini-3.1-pro-preview";

type PremiumRemixDebugStep = {
  step: string;
  status: "ok" | "failed" | "skipped";
  label?: string;
  promptPreview?: string;
  model?: string;
  location?: string;
  imageUrl?: string;
  videoUrl?: string;
  error?: string;
};

type PremiumRemixBuildDebug = {
  strategistModel: string;
  source: "primary" | "polished" | "fallback";
  promptPreview: string;
  rawPreview: string;
  inputSummary: {
    contextChars: number;
    transcriptChars: number;
    keyFrameCount: number;
    titleExecutionCount: number;
    hasAssetAdaptation: boolean;
    hasGrowthHandoff: boolean;
    hasStoryboardPrompt: boolean;
  };
  qualityIssues: string[];
  hydrationSteps: PremiumRemixDebugStep[];
};

type PremiumRemixAssetsDebug = {
  mode: "loop" | "interpolation";
  referenceSteps: PremiumRemixDebugStep[];
  clipSteps: PremiumRemixDebugStep[];
};

type BuildPremiumRemixInput = {
  context?: string;
  transcript?: string;
  analysis: GrowthAnalysisScores;
  modelName?: GrowthCampModel;
  titleExecutions?: GrowthTitleExecution[];
  assetAdaptation?: GrowthAssetAdaptation;
  growthHandoff?: GrowthHandoff;
  creationStoryboardPrompt?: string;
  dataEvidence?: {
    source: string;
    liveSummary?: string;
    historicalSummary?: string;
    hotTopic?: string;
    recommendationReason?: string;
    personalizedOverview?: {
      summary?: string;
      trendNarrative?: string;
      nextCollectionPlan?: string;
    };
    decisionFramework?: {
      recommendedFormat?: string;
      mainPathTitle?: string;
      mainPathWhyNow?: string;
      mainPathExecution?: string;
      avoidPathTitle?: string;
      avoidPathReason?: string;
      assetAdaptation?: {
        format?: string;
        firstHook?: string;
        structure?: string;
        callToAction?: string;
      };
    };
    platformRows?: Array<{
      platformLabel: string;
      currentTotal: number;
      archivedTotal: number;
      note?: string;
    }>;
    platformSnapshots?: Array<{
      platformLabel: string;
      summary: string;
      fitLabel: string;
      sampleTopics: string[];
      recommendedFormats: string[];
    }>;
    topicLibrary?: Array<{
      platformLabel?: string;
      title: string;
      rationale: string;
    }>;
    platformRecommendations?: Array<{
      platformLabel: string;
      strategy: string;
      action?: string;
      reason?: string;
    }>;
    businessInsights?: Array<{
      title: string;
      detail: string;
    }>;
    growthPlan?: Array<{
      title: string;
      nextStep: string;
    }>;
    referenceExamples?: Array<{
      title: string;
      reason?: string;
    }>;
    authorSummary?: string;
    userEvidence?: {
      strongestPlatforms: string[];
      recurringThemes: string[];
      summaryNote: string;
    } | null;
  };
};

type GeneratePremiumRemixAssetsInput = {
  remix: ReturnType<typeof growthPremiumRemixSchema.parse>;
  mode: "loop" | "interpolation";
};

function stripFence(text: string) {
  return String(text || "").replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
}

function asJsonObject<T>(raw: string): T {
  return JSON.parse(stripFence(raw)) as T;
}

function previewText(text: string, limit = 280) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizeComparableText(text: string) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "")
    .trim();
}

function uniqueLines(items: Array<string | undefined | null>) {
  const seen = new Set<string>();
  return items
    .map((item) => String(item || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((item) => {
      const key = normalizeComparableText(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function toConciseSeed(text: string, max = 120) {
  return previewText(text, max).replace(/[。！!？?；;]+$/g, "");
}

function hasTooMuchChinese(text: string) {
  const matches = String(text || "").match(/[\u4e00-\u9fff]/g) || [];
  return matches.length >= 10;
}

function buildPremiumRemixBrief(input: BuildPremiumRemixInput) {
  const primaryAngle = input.analysis.commercialAngles?.[0];
  const primaryTitleExecution = input.titleExecutions?.[0];
  const keyFrames = Array.isArray(input.analysis.keyFrames) ? input.analysis.keyFrames.slice(0, 4) : [];
  const dataEvidence = input.dataEvidence;
  const decisionFramework = dataEvidence?.decisionFramework;
  const assetAdaptation = input.assetAdaptation || decisionFramework?.assetAdaptation;

  return {
    persona: toConciseSeed(
      input.context ||
      input.growthHandoff?.brief ||
      dataEvidence?.authorSummary ||
      "专业单人知识型创作者，强调可信度、专业度和商业承接。",
      160,
    ),
    visual: uniqueLines([
      input.analysis.visualSummary,
      input.analysis.openingFrameAssessment,
      input.analysis.sceneConsistency,
      keyFrames[0]?.whatShows,
      dataEvidence?.personalizedOverview?.summary,
    ]).join("；"),
    structure: uniqueLines([
      assetAdaptation?.structure,
      primaryTitleExecution?.videoPlan,
      input.growthHandoff?.storyboardPrompt,
      decisionFramework?.mainPathExecution,
      "按开头钩子、动作解释、证据抬信任、结尾单一行动引导四段推进",
    ]).join("；"),
    hook: uniqueLines([
      assetAdaptation?.firstHook,
      primaryTitleExecution?.openingHook,
      primaryAngle?.hook,
      input.analysis.timestampSuggestions?.[0]?.fix,
      decisionFramework?.mainPathWhyNow,
    ]).join("；"),
    proof: uniqueLines([
      keyFrames[2]?.fix,
      input.growthHandoff?.brief,
      input.analysis.timestampSuggestions?.[1]?.fix,
      dataEvidence?.businessInsights?.[0]?.detail,
      "加入证据、案例、前后对比或资料细节，不要只剩口播",
    ]).join("；"),
    cta: toConciseSeed(
      assetAdaptation?.callToAction ||
      input.growthHandoff?.businessGoal ||
      dataEvidence?.platformRecommendations?.[0]?.action ||
      "结尾只给一个行动引导，导向咨询、预约或私信关键词。",
      100,
    ),
  };
}

function collectRemixQualityIssues(remix: ReturnType<typeof growthPremiumRemixSchema.parse>) {
  const issues: string[] = [];
  const overviewFields = [
    remix.sourceSummary,
    remix.visualDnaSummary,
    remix.contentRebuildSummary,
    remix.personaFit,
    remix.performanceDirection,
    remix.languageExpression,
    remix.emotionalExpression,
    remix.cameraEmotionTension,
    remix.bgmAnalysis,
    remix.musicRecommendation,
  ];

  overviewFields.forEach((field, index) => {
    if (String(field || "").trim().length < 60) {
      issues.push(`概述字段 ${index + 1} 过短`);
    }
  });

  for (let index = 0; index < overviewFields.length; index += 1) {
    for (let inner = index + 1; inner < overviewFields.length; inner += 1) {
      const left = normalizeComparableText(overviewFields[index]);
      const right = normalizeComparableText(overviewFields[inner]);
      if (left && right && (left === right || left.includes(right) || right.includes(left))) {
        issues.push(`概述字段 ${index + 1} 与 ${inner + 1} 发生重复`);
      }
    }
  }

  remix.storyboard.forEach((shot) => {
    if (String(shot.sceneDescription || "").trim().length < 35) {
      issues.push(`镜头 ${shot.shotId} 画面描述过短`);
    }
    if (String(shot.voiceover || "").trim().length < 25) {
      issues.push(`镜头 ${shot.shotId} 画外音过短`);
    }
    if (!shot.referencePrompt || String(shot.referencePrompt).trim().length < 80) {
      issues.push(`镜头 ${shot.shotId} 参考图提示词过短`);
    }
    if (hasTooMuchChinese(shot.referencePrompt)) {
      issues.push(`镜头 ${shot.shotId} 参考图提示词仍含大量中文`);
    }
  });

  const shotPromptKeys = remix.storyboard.map((shot) => normalizeComparableText(shot.referencePrompt));
  if (new Set(shotPromptKeys.filter(Boolean)).size < shotPromptKeys.filter(Boolean).length) {
    issues.push("多个镜头的参考图提示词重复");
  }

  const shotSceneKeys = remix.storyboard.map((shot) => normalizeComparableText(shot.sceneDescription));
  if (new Set(shotSceneKeys.filter(Boolean)).size < shotSceneKeys.filter(Boolean).length) {
    issues.push("多个镜头的画面描述重复");
  }

  const shotVoiceKeys = remix.storyboard.map((shot) => normalizeComparableText(shot.voiceover));
  if (new Set(shotVoiceKeys.filter(Boolean)).size < shotVoiceKeys.filter(Boolean).length) {
    issues.push("多个镜头的画外音重复");
  }

  const loopPromptKeys = remix.loopTrack.segments.map((segment) => normalizeComparableText(segment.prompt));
  if (new Set(loopPromptKeys.filter(Boolean)).size < loopPromptKeys.filter(Boolean).length) {
    issues.push("32 秒延展轨的分段提示词重复");
  }

  const interpolationPromptKeys = remix.interpolationTrack.nodes.map((node) => normalizeComparableText(node.prompt));
  if (new Set(interpolationPromptKeys.filter(Boolean)).size < interpolationPromptKeys.filter(Boolean).length) {
    issues.push("32 秒关键帧插值轨的节点提示词重复");
  }

  return Array.from(new Set(issues));
}

async function polishPremiumRemixPlan(
  strategistModel: string,
  prompt: string,
  remix: ReturnType<typeof growthPremiumRemixSchema.parse>,
  issues: string[],
) {
  const polishPrompt = [
    "你要重写一份低质量的二创 JSON 方案。",
    "要求：",
    "1. 必须保留完全相同的 JSON 字段结构。",
    "2. 所有概述字段必须互不重复，不能反复复制用户上下文。",
    "3. 每个镜头都要写成可以直接拍摄的具体内容，不能写模板套话。",
    "4. referencePrompt 必须是英文，只描述镜头画面、主体、服装、场景、景别、动作、光影、镜头语言，不要夹带中文上下文。",
    "5. 32 秒延展轨和关键帧插值轨的每一段都必须对应不同商业任务，不能只换说法。",
    `当前问题：${issues.join("；")}`,
    `原始输入摘要：${previewText(prompt, 2200)}`,
    `待重写 JSON：${JSON.stringify(remix)}`,
  ].join("\n");

  const response = await invokeLLM({
    model: "pro",
    provider: "vertex",
    modelName: strategistModel,
    messages: [
      { role: "system", content: "你擅长做高质量的短视频逆向重写，并且严格输出 JSON。" },
      { role: "user", content: polishPrompt },
    ],
    response_format: { type: "json_object" },
  });

  return {
    parsed: growthPremiumRemixSchema.parse(asJsonObject(response.choices[0].message.content as string)),
    raw: String(response.choices[0].message.content || ""),
  };
}

async function rewritePremiumRemixCopyFromKeyMoments(
  strategistModel: string,
  input: BuildPremiumRemixInput,
  remix: ReturnType<typeof growthPremiumRemixSchema.parse>,
) {
  const rewritePrompt = [
    "你要基于原视频的关键时间节点、关键帧和转写，再次重写这份二创方案里的文案部分。",
    "这不是润色，也不是简单改写，而是重新创作更有成交力、更具体、更能拍的文案。",
    "必须保留完全相同的 JSON 结构和镜头数量，不允许改字段名。",
    "重点重写这些字段：sourceSummary、visualDnaSummary、contentRebuildSummary、personaFit、performanceDirection、languageExpression、emotionalExpression、cameraEmotionTension、bgmAnalysis、musicRecommendation、sunoPrompt。",
    "同时重写 storyboard 里每个镜头的 sceneDescription、onScreenText、voiceover、performanceNote，确保每个镜头职责不同、文案不同、执行动作不同。",
    "loopTrack 和 interpolationTrack 里的每一段也要重写，必须明确各自承担的商业任务和画面动作。",
    "必须根据关键时间节点重新生成文案，不能只是换同义词。",
    "严禁复读用户背景，严禁把同一段中文塞进多个字段。",
    `关键帧：${(input.analysis.keyFrames || []).map((item) => `${item.timestamp} ${item.whatShows} | 商业用途:${item.commercialUse} | 问题:${item.issue} | 改法:${item.fix}`).join(" | ")}`,
    `时间点改法：${(input.analysis.timestampSuggestions || []).map((item) => `${item.timestamp} ${item.issue} -> ${item.fix}`).join(" | ")}`,
    input.transcript ? `原视频转写：${String(input.transcript).slice(0, 6000)}` : "",
    `待重写 JSON：${JSON.stringify(remix)}`,
  ].filter(Boolean).join("\n");

  const response = await invokeLLM({
    model: "pro",
    provider: "vertex",
    modelName: strategistModel,
    messages: [
      { role: "system", content: "你擅长基于关键时间节点重写商业视频文案，并且严格输出 JSON。" },
      { role: "user", content: rewritePrompt },
    ],
    response_format: { type: "json_object" },
  });

  return {
    parsed: growthPremiumRemixSchema.parse(asJsonObject(response.choices[0].message.content as string)),
    raw: String(response.choices[0].message.content || ""),
  };
}

function buildFallbackRemix(input: BuildPremiumRemixInput) {
  const keyFrames = Array.isArray(input.analysis.keyFrames) ? input.analysis.keyFrames.slice(0, 4) : [];
  const primaryAngle = input.analysis.commercialAngles?.[0];
  const primaryTitleExecution = input.titleExecutions?.[0];
  const assetAdaptation = input.assetAdaptation;
  const growthHandoff = input.growthHandoff;
  const brief = buildPremiumRemixBrief(input);
  const personaContext = brief.persona || "围绕当前账号身份，重构成更可信、更专业的单人商业表达。";
  const title = primaryAngle?.title || input.analysis.titleSuggestions?.[0] || "优质视频二创";
  const visualSummary = brief.visual || input.analysis.visualSummary || "保留参考视频的景别节奏、口播推进和结果前置结构。";
  const sceneA = keyFrames[0];
  const sceneB = keyFrames[1];
  const sceneC = keyFrames[2];
  const sceneD = keyFrames[3];
  const openingHook = brief.hook || assetAdaptation?.firstHook || primaryTitleExecution?.openingHook || primaryAngle?.hook || "前 2 秒先抛最扎心的问题和最直接的结果。";
  const structureLine = brief.structure || assetAdaptation?.structure || primaryTitleExecution?.videoPlan || growthHandoff?.storyboardPrompt || "按问题、动作、证据、行动引导四段推进。";
  const proofLine = brief.proof || growthHandoff?.brief || "加入案例、证据、前后对比或资料细节，抬高可信度。";
  const callToAction = brief.cta || assetAdaptation?.callToAction || growthHandoff?.businessGoal || "只保留一个行动引导，导向咨询、预约或私信关键词。";
  const visualBase = `${personaContext}；${visualSummary}；${structureLine}`;

  return growthPremiumRemixSchema.parse({
    title: "优质视频二创",
    sourceSummary: `${title}，核心可借鉴的是节奏、镜头推进和商业承接，而不是照搬原内容。`,
    visualDnaSummary: visualSummary,
    contentRebuildSummary: primaryAngle?.whyItFits || input.analysis.summary || structureLine || "将参考视频的高留存结构重写为符合当前赛道的商业短视频脚本。",
    personaFit: personaContext,
    performanceDirection: `保留高留存镜头节奏，但把画面、角色和台词全部改写为自己的商业表达。重点执行：${structureLine}`,
    languageExpression: input.analysis.languageExpression || `语言表达必须走“问题先砸下来、方法只讲一个、结果直接翻译成用户收益”的路线。避免知识点堆砌，句子要短，结果句要靠前。`,
    emotionalExpression: input.analysis.emotionalExpression || `情绪要从“专业克制”升级成“克制但有压力感与结果释放感”。开头让用户感到问题正在发生，中段给解释，结尾给安心与行动。`,
    cameraEmotionTension: input.analysis.cameraEmotionTension || `镜头情绪张力用近景钩子、中景动作解释、局部证据特写、结尾轻推近收动作四段推进，不能全程同一个景别。`,
    bgmAnalysis: input.analysis.bgmAnalysis || `配乐不要抢口播。用低频稳定、节拍轻推进、带一点空气感的现代商业底乐，前 2 秒留出钩子空间，中后段逐渐抬起可信度和收束感。`,
    musicRecommendation: input.analysis.musicRecommendation || `适合现代 wellness / premium knowledge / consulting 风格配乐，轻鼓点、柔和 pad、钢琴或拨弦细节，速度中低，避免热血 EDM、大片式史诗鼓点和过于煽情的弦乐。`,
    sunoPrompt: input.analysis.sunoPrompt || "Premium wellness commercial soundtrack, warm ambient pulse, soft piano, subtle percussion, calm confidence, modern feminine energy, supports Mandarin voiceover, no aggressive drops, around 92 BPM.",
    characterAnchors: [
      {
        id: "host",
        label: "主讲人",
        role: personaContext,
        visualPrompt: `cinematic Chinese expert creator, single subject, premium studio lighting, clean set, trustworthy expression, tailored wardrobe, no crowd, no animal, identity brief: ${personaContext}`,
        consistencyRules: [
          "始终保持单人出镜",
          "避免多人同框正面镜头",
          "服装与发型保持稳定",
        ],
      },
    ],
    storyboard: [
      {
        shotId: 1,
        durationSeconds: 8,
        characterId: "host",
        purpose: "前 2 秒抓住用户",
        framing: "中近景特写",
        cameraMovement: "固定机位微推近",
        lighting: "主光清晰、背景简洁",
        pacingRole: "直接抛问题和结果",
        sceneDescription: sceneA?.whatShows || "主讲人正面出镜，先抛出最扎心的问题或最大结果。",
        onScreenText: sceneA?.timestamp ? `${sceneA.timestamp} 对应问题点` : "把最扎心的问题直接打到屏幕上",
        voiceover: sceneA?.commercialUse || openingHook,
        performanceNote: "眼神直接看镜头，语速快一点，不铺垫，第一句必须直接落在痛点或结果上。",
        referencePrompt: `Single Chinese expert creator in a premium clinical or cultural studio, medium close-up, direct eye contact, subtle push-in camera, refined wardrobe, confident posture, dramatic but clean key light, negative space for subtitles, opening hook energy, trustworthy and commercial, no crowd, no animal, no extra limbs.`,
        veoPrompt: `single subject, medium close-up, clean premium background, direct-to-camera hook, subtle push-in, high-trust expert tone, opening hook: ${openingHook}, visual direction: ${visualSummary}`,
        negativePrompt: "multiple people, crowd, extra limbs, animal, distorted face, background clutter",
      },
      {
        shotId: 2,
        durationSeconds: 8,
        characterId: "host",
        purpose: "展开痛点与动作方案",
        framing: "半身中景",
        cameraMovement: "固定机位配手势",
        lighting: "自然柔光",
        pacingRole: "解释动作或方法",
        sceneDescription: sceneB?.whatShows || "主讲人用手势示范动作或解释原理。",
        onScreenText: sceneB?.issue || "只讲一个动作或一个机制",
        voiceover: sceneB?.fix || primaryTitleExecution?.videoPlan || "这里讲具体怎么做，不要空泛。",
        performanceNote: "加入手势、道具或资料画面，动作要服务解释，不要全程站桩。",
        referencePrompt: `Single expert creator in a medium shot, explaining one concrete method with hand gestures and one visible prop or report, clean premium set, realistic body posture, soft key light, detail-rich wardrobe texture, composition designed for practical instruction, no second person, no animal.`,
        veoPrompt: `single subject, medium shot, clear gesture demonstration, soft key light, practical instruction vibe, show one concrete action or method, structure cue: ${structureLine}`,
        negativePrompt: "group shot, duplicated body, extra hands, pet, cluttered decor",
      },
      {
        shotId: 3,
        durationSeconds: 8,
        characterId: "host",
        purpose: "给证据与信任资产",
        framing: "特写与局部切换",
        cameraMovement: "局部特写切换",
        lighting: "高对比但干净",
        pacingRole: "抬信任和可信度",
        sceneDescription: sceneC?.whatShows || "切到局部特写、案例细节或前后对比。",
        onScreenText: sceneC?.commercialUse || "这里放前后对比、案例或服务场景",
        voiceover: sceneC?.fix || growthHandoff?.brief || "告诉用户为什么这个方案可信。",
        performanceNote: "这里必须出现证据感，不要继续空口讲，加入资料、局部特写或对比信息。",
        referencePrompt: `Trust-building evidence shot with a single expert creator, premium detail close-ups of reports, historical material, diagrams, or before-after proof, cinematic inserts, clean composition, high-end commercial lighting, rich texture, visual proof over empty talk, no crowd, no animal.`,
        veoPrompt: `single subject with insert shots, premium detail close-ups, before-after evidence, polished commercial lighting, trust-building visual proof, proof cue: ${proofLine}`,
        negativePrompt: "multi-character frame, random props, inconsistent face, duplicate subject",
      },
      {
        shotId: 4,
        durationSeconds: 8,
        characterId: "host",
        purpose: "强行动引导",
        framing: "中景收束",
        cameraMovement: "轻微前推",
        lighting: "统一稳定",
        pacingRole: "结尾收动作",
        sceneDescription: sceneD?.whatShows || "主讲人收束结论，给出明确行动引导。",
        onScreenText: sceneD?.fix || callToAction,
        voiceover: callToAction,
        performanceNote: "语气收紧，结尾必须只给一个行动，不要同时塞多个动作。",
        referencePrompt: `Closing call-to-action shot, single expert creator in a medium shot, subtle push-in, steady body language, direct confident gaze, premium clean set, one clear action cue, subtitle-safe framing, polished commercial finish, no crowd, no animal, no visual clutter.`,
        veoPrompt: `single subject closing call-to-action, subtle push-in, clean premium set, confident gesture, one clear CTA: ${callToAction}`,
        negativePrompt: "crowd, second person, pet, distorted hands, messy background",
      },
    ],
    loopTrack: {
      plan: {
        title: "32秒自动延展",
        summary: "用 4 段 8 秒视频连续延展，每段都对应一个明确商业任务和画面动作。",
        whyItWorks: "按问题、动作、证据、行动引导四段推进，比空泛口播更容易直接拿去生成与拍摄。",
      },
      segments: [
        { segmentIndex: 1, startSecond: 0, endSecond: 8, prompt: `${openingHook} 开场必须在前 2 秒完成冲击表达，人物单独出镜，镜头轻推近。`, stabilityPrompt: "保持主讲人脸部、服装、发型和背景绝对一致，禁止多人污染", referenceHint: "优先复用镜头 1 的分镜参考图" },
        { segmentIndex: 2, startSecond: 8, endSecond: 16, prompt: `${primaryTitleExecution?.videoPlan || "展示一个具体动作或解释方法"}，画面中必须出现手势、资料或道具，让信息不是空口讲。`, stabilityPrompt: "保持主讲人一致，动作自然，避免任何多人污染", referenceHint: "优先复用镜头 2 的分镜参考图" },
        { segmentIndex: 3, startSecond: 16, endSecond: 24, prompt: `${proofLine}，重点是把可信证据放到画面里，而不是重复解释。`, stabilityPrompt: "保持风格与主体稳定，允许局部特写，但主体身份不能漂移", referenceHint: "优先复用镜头 3 的分镜参考图" },
        { segmentIndex: 4, startSecond: 24, endSecond: 32, prompt: `${callToAction} 结尾镜头收束，人物姿态稳定，只保留一个清晰行动。`, stabilityPrompt: "结尾人物和背景保持一致，动作清晰，字幕位置稳定", referenceHint: "优先复用镜头 4 的分镜参考图" },
      ],
    },
    interpolationTrack: {
      plan: {
        title: "32秒关键帧插值",
        summary: "用 5 个关键节点做 4 段插值，每个节点都对应一个明确商业画面，而不是空泛概念。",
        whyItWorks: "关键帧锚定能有效避免 Veo 在长段生成里的主体漂移和风格污染，也能让过渡更贴合成交逻辑。",
      },
      nodes: [
        { nodeId: "A", label: "起始状态", prompt: `${visualBase} 开场镜头，单人出镜，干净背景，建立信任，直接抛问题。` },
        { nodeId: "M1", label: "过渡一", prompt: `${visualBase} 加入动作示范或资料画面，突出“怎么做”。` },
        { nodeId: "M2", label: "过渡二", prompt: `${visualBase} 引入结果证据、案例细节或前后对比，强化商业可信度。` },
        { nodeId: "M3", label: "过渡三", prompt: `${visualBase} 准备收束，人物视线和手势导向最后的行动引导。` },
        { nodeId: "B", label: "结束状态", prompt: `${visualBase} 结尾行动引导镜头，人物姿态稳定，保留字幕位和行动词。` },
      ],
    },
    deliveryNotes: [
      "多人互动场景全部改成正反打或单人镜头，避免多角色污染。",
      "动物只可作为背景元素，不可与主角色同镜头正面互动。",
      "Veo 提示词统一要求单主体、固定服装、固定发型、固定背景逻辑。",
    ],
  });
}

async function hydratePremiumRemixReferenceImages(remixInput: ReturnType<typeof growthPremiumRemixSchema.parse>) {
  const remix = growthPremiumRemixSchema.parse(remixInput);
  const anchors = [...remix.characterAnchors];
  const steps: PremiumRemixDebugStep[] = [];

  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    if (anchor.referenceImageUrl) {
      steps.push({ step: "anchor-image", status: "skipped", label: anchor.label, imageUrl: anchor.referenceImageUrl });
      continue;
    }
    try {
      const image = await generateGeminiImage({
        prompt: anchor.visualPrompt,
        quality: "1k",
        aspectRatio: "16:9",
      });
      anchors[index] = { ...anchor, referenceImageUrl: image.imageUrl };
      steps.push({
        step: "anchor-image",
        status: "ok",
        label: anchor.label,
        promptPreview: previewText(anchor.visualPrompt),
        model: image.model,
        location: image.location,
        imageUrl: image.imageUrl,
      });
    } catch (error) {
      console.warn("[growth.hydratePremiumRemixReferenceImages] anchor failed:", error);
      steps.push({
        step: "anchor-image",
        status: "failed",
        label: anchor.label,
        promptPreview: previewText(anchor.visualPrompt),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const primaryReference = anchors[0]?.referenceImageUrl;
  const storyboard = [];
  for (const shot of remix.storyboard) {
    let referenceImageUrl = shot.referenceImageUrl;
    if (!referenceImageUrl && shot.referencePrompt) {
      try {
        const image = await generateGeminiImage({
          prompt: shot.referencePrompt,
          quality: "1k",
          aspectRatio: "16:9",
          referenceImageUrl: primaryReference || undefined,
        });
        referenceImageUrl = image.imageUrl;
        steps.push({
          step: "shot-reference-image",
          status: "ok",
          label: `镜头 ${shot.shotId}`,
          promptPreview: previewText(shot.referencePrompt),
          model: image.model,
          location: image.location,
          imageUrl: image.imageUrl,
        });
      } catch (error) {
        console.warn("[growth.hydratePremiumRemixReferenceImages] shot failed:", error);
        steps.push({
          step: "shot-reference-image",
          status: "failed",
          label: `镜头 ${shot.shotId}`,
          promptPreview: previewText(shot.referencePrompt),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (referenceImageUrl) {
      steps.push({ step: "shot-reference-image", status: "skipped", label: `镜头 ${shot.shotId}`, imageUrl: referenceImageUrl });
    }
    storyboard.push({
      ...shot,
      referenceImageUrl: referenceImageUrl || "",
    });
  }

  return {
    remix: growthPremiumRemixSchema.parse({
      ...remix,
      characterAnchors: anchors,
      storyboard,
    }),
    steps,
  };
}

export async function buildPremiumRemixPlan(input: BuildPremiumRemixInput) {
  const strategistModel = resolveGrowthCampStrategistModel(PREMIUM_REMIX_MODEL);
  const transcript = String(input.transcript || "").trim();
  const context = String(input.context || "").trim();
  const analysis = input.analysis;
  const titleExecutions = input.titleExecutions || [];
  const assetAdaptation = input.assetAdaptation;
  const growthHandoff = input.growthHandoff;
  const creationStoryboardPrompt = String(input.creationStoryboardPrompt || "").trim();
  const dataEvidence = input.dataEvidence;

  const brief = buildPremiumRemixBrief(input);
  const decisionFramework = dataEvidence?.decisionFramework;
  const platformRecommendationSummary = (dataEvidence?.platformRecommendations || [])
    .map((item, index) => `平台${index + 1} ${item.platformLabel} | 策略:${item.strategy} | 动作:${item.action || "-"} | 原因:${item.reason || "-"}`)
    .join(" || ");
  const businessInsightSummary = (dataEvidence?.businessInsights || [])
    .map((item, index) => `洞察${index + 1} ${item.title}: ${item.detail}`)
    .join(" || ");
  const growthPlanSummary = (dataEvidence?.growthPlan || [])
    .map((item, index) => `步骤${index + 1} ${item.title}: ${item.nextStep}`)
    .join(" || ");
  const referenceExampleSummary = (dataEvidence?.referenceExamples || [])
    .map((item, index) => `案例${index + 1} ${item.title}${item.reason ? ` | 原因:${item.reason}` : ""}`)
    .join(" || ");
  const prompt = [
    "你是 MVStudioPro 的优质视频逆向工程导演。",
    "任务：把参考视频的成功节奏、镜头语言和商业推进抽离出来，再重写成一个新的二创版本。",
    "重要：你不是重新做一遍泛化分析，而是要把成长营已经得出的成熟判断翻译成可直接拍、可直接生成、可直接卖的二创方案。",
    "二创输出至少要达到成长营交付的执行密度，不能比成长营更空、更短、更模板化。",
    "必须严格输出 JSON，本体只能是 JSON，不允许 markdown 或解释。",
    "输出字段：title/sourceSummary/visualDnaSummary/contentRebuildSummary/personaFit/performanceDirection/languageExpression/emotionalExpression/cameraEmotionTension/bgmAnalysis/musicRecommendation/sunoPrompt/characterAnchors/storyboard/loopTrack/interpolationTrack/deliveryNotes。",
    "规则：",
    "1. title 固定写“优质视频二创”。",
    "2. storyboard 必须精确输出 4 个镜头，每个镜头 8 秒，总计 32 秒。",
    "2.1 每个 storyboard 镜头都必须填写 referencePrompt，内容要能直接用于生成该镜头的分镜参考图。",
    "3. characterAnchors 只允许 1 到 3 个角色锚点，且每个角色都要有 visualPrompt 和 consistencyRules。",
    "4. 所有 veoPrompt 都必须强调单主体，禁止多人同框正面镜头，禁止宠物和动物造成主体污染。",
    "5. loopTrack 必须适合 4 个 8 秒延展段；interpolationTrack 必须输出 5 个关键节点 A/M1/M2/M3/B。",
    "6. 文案与分镜必须可直接用于商业短视频重制，而不是泛泛而谈。",
    "7. 不允许使用“建立人物和问题”“展开动作示范和解释”“加入证据和局部特写”“收束行动引导”这类抽象模板句作为最终内容，必须写成具体场景、具体动作、具体台词目标。",
    "8. 必须尽量复用输入里的 titleExecutions、assetAdaptation、growthHandoff、关键帧、时间点改法，而不是重新发明一套空泛模板。",
    "8.1 如果 dataEvidence 里已经有 decisionFramework / platformRecommendations / businessInsights / growthPlan / referenceExamples，你必须把它们当成上游定论，再转译成二创。",
    "9. 如果用户上下文里有职业、人设、服装、场景、道具要求，必须写进角色锚定和 referencePrompt。",
    "10. sourceSummary/visualDnaSummary/contentRebuildSummary/personaFit/performanceDirection 这五个字段必须各写各的，不允许内容互相重复或改写同一句。",
    "11. 每个镜头的 sceneDescription、voiceover、performanceNote 都必须详细、具体、有拍摄执行感。",
    "12. referencePrompt 必须是英文，至少 80 个英文单词，不要复制中文背景，不要出现泛泛的模板词。",
    "13. languageExpression 必须具体回答这条视频的话术应该怎么说更有成交力，包含句式、口播节奏、结果句和避免的表达。",
    "14. emotionalExpression 必须具体回答这条二创要怎么传达焦虑、希望、释压、信任或权威感，不能空泛写“更有感染力”。",
    "15. cameraEmotionTension 必须把景别、运镜、节奏和情绪推进绑定起来，说明每一类镜头各自负责什么情绪任务。",
    "16. bgmAnalysis 和 musicRecommendation 必须写清楚节奏、氛围、乐器、起伏和适用场景。",
    "17. sunoPrompt 必须是可直接给 Suno 的英文 prompt，强调节奏、乐器、情绪、用途和不要抢口播。",
    "",
    `人物与业务背景：${brief.persona || context || "未提供额外背景，按当前视频分析结果重构。"}`,
    `视觉基调：${brief.visual || "未提供"}`,
    `结构策略：${brief.structure || "未提供"}`,
    `开头钩子：${brief.hook || "未提供"}`,
    `证据策略：${brief.proof || "未提供"}`,
    `结尾动作：${brief.cta || "未提供"}`,
    `视频总结：${analysis.summary || ""}`,
    `视觉总判断：${analysis.visualSummary || ""}`,
    `开头画面判断：${analysis.openingFrameAssessment || ""}`,
    `画面统一性：${analysis.sceneConsistency || ""}`,
    `语言表达：${analysis.languageExpression || ""}`,
    `情感表达：${analysis.emotionalExpression || ""}`,
    `镜头与情绪张力：${analysis.cameraEmotionTension || ""}`,
    `BGM 分析：${analysis.bgmAnalysis || ""}`,
    `配乐建议：${analysis.musicRecommendation || ""}`,
    `Suno 提示词：${analysis.sunoPrompt || ""}`,
    decisionFramework ? `成长营主判断：主路径=${decisionFramework.mainPathTitle || ""} | 为什么现在做=${decisionFramework.mainPathWhyNow || ""} | 执行方式=${decisionFramework.mainPathExecution || ""} | 避免路径=${decisionFramework.avoidPathTitle || ""} | 避免原因=${decisionFramework.avoidPathReason || ""}` : "",
    platformRecommendationSummary ? `成长营推荐平台：${platformRecommendationSummary}` : "",
    businessInsightSummary ? `成长营商业洞察：${businessInsightSummary}` : "",
    growthPlanSummary ? `成长营执行计划：${growthPlanSummary}` : "",
    referenceExampleSummary ? `成长营参考案例：${referenceExampleSummary}` : "",
    dataEvidence?.personalizedOverview ? `成长营总判断概述：summary=${dataEvidence.personalizedOverview.summary || ""} | trendNarrative=${dataEvidence.personalizedOverview.trendNarrative || ""} | nextCollectionPlan=${dataEvidence.personalizedOverview.nextCollectionPlan || ""}` : "",
    dataEvidence ? `后台数据库证据（只可作为判断依据，不要在前端文本里暴露“数据库”“后台”这些字眼）：${JSON.stringify({
      source: dataEvidence.source,
      liveSummary: dataEvidence.liveSummary,
      historicalSummary: dataEvidence.historicalSummary,
      hotTopic: dataEvidence.hotTopic,
      recommendationReason: dataEvidence.recommendationReason,
      platformRows: dataEvidence.platformRows,
      platformSnapshots: dataEvidence.platformSnapshots,
      topicLibrary: dataEvidence.topicLibrary,
      userEvidence: dataEvidence.userEvidence,
    })}` : "",
    `亮点：${(analysis.strengths || []).join(" / ")}`,
    `缺点：${(analysis.improvements || []).join(" / ")}`,
    `时间点改法：${(analysis.timestampSuggestions || []).map((item) => `${item.timestamp} ${item.issue} -> ${item.fix}`).join(" | ")}`,
    `关键帧证据：${(analysis.keyFrames || []).map((item) => `${item.timestamp} ${item.whatShows} | 改法:${item.fix}`).join(" | ")}`,
    `弱帧提醒：${(analysis.weakFrameReferences || []).map((item) => `${item.timestamp} ${item.reason} -> ${item.fix}`).join(" | ")}`,
    titleExecutions.length ? `标题与执行：${titleExecutions.map((item, index) => `标题${index + 1} ${item.title} | 开场:${item.openingHook} | 文案:${item.copywriting} | 视频怎么拍:${item.videoPlan}`).join(" || ")}` : "",
    assetAdaptation ? `资产改编建议：形式=${assetAdaptation.format} | 开头=${assetAdaptation.firstHook} | 结构=${assetAdaptation.structure} | 结尾=${assetAdaptation.callToAction}` : "",
    growthHandoff ? `成长营交接：brief=${growthHandoff.brief} | storyboardPrompt=${growthHandoff.storyboardPrompt} | workflowPrompt=${growthHandoff.workflowPrompt} | recommendedTrack=${growthHandoff.recommendedTrack} | businessGoal=${growthHandoff.businessGoal}` : "",
    creationStoryboardPrompt ? `创作画布分镜提示：${creationStoryboardPrompt}` : "",
    transcript ? `转写：${transcript.slice(0, 8000)}` : "",
  ].filter(Boolean).join("\n");

  const inputSummary = {
    contextChars: context.length,
    transcriptChars: transcript.length,
    keyFrameCount: analysis.keyFrames?.length || 0,
    titleExecutionCount: titleExecutions.length,
    hasAssetAdaptation: Boolean(assetAdaptation),
    hasGrowthHandoff: Boolean(growthHandoff),
    hasStoryboardPrompt: Boolean(creationStoryboardPrompt),
  };

  try {
    const response = await invokeLLM({
      model: "pro",
      provider: "vertex",
      modelName: strategistModel,
      messages: [
        { role: "system", content: "你擅长将参考视频的节奏抽象成可执行的商业二创脚本，并且严格输出 JSON。" },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    });
    const rawPrimary = String(response.choices[0].message.content || "");
    let parsed = growthPremiumRemixSchema.parse(asJsonObject(rawPrimary));
    const rewritten = await rewritePremiumRemixCopyFromKeyMoments(strategistModel, input, parsed);
    parsed = rewritten.parsed;
    let qualityIssues = collectRemixQualityIssues(parsed);
    let source: PremiumRemixBuildDebug["source"] = "primary";
    let rawPreview = rewritten.raw || rawPrimary;

    if (qualityIssues.length) {
      const polished = await polishPremiumRemixPlan(strategistModel, prompt, parsed, qualityIssues);
      const polishedIssues = collectRemixQualityIssues(polished.parsed);
      if (polishedIssues.length <= qualityIssues.length) {
        parsed = polished.parsed;
        qualityIssues = polishedIssues;
        source = "polished";
        rawPreview = polished.raw;
      }
    }

    const hydrated = await hydratePremiumRemixReferenceImages(parsed);
    return {
      remix: hydrated.remix,
      debug: {
        strategistModel,
        source,
        promptPreview: previewText(prompt, 2400),
        rawPreview: previewText(rawPreview, 2400),
        inputSummary,
        qualityIssues,
        hydrationSteps: hydrated.steps,
      } satisfies PremiumRemixBuildDebug,
    };
  } catch (error) {
    console.warn("[growth.buildPremiumRemixPlan] fallback:", error);
    const hydrated = await hydratePremiumRemixReferenceImages(buildFallbackRemix(input));
    return {
      remix: hydrated.remix,
      debug: {
        strategistModel,
        source: "fallback",
        promptPreview: previewText(prompt, 2400),
        rawPreview: error instanceof Error ? error.message : String(error),
        inputSummary,
        qualityIssues: ["主模型输出失败，已切换 fallback 方案"],
        hydrationSteps: hydrated.steps,
      } satisfies PremiumRemixBuildDebug,
    };
  }
}

export async function generatePremiumRemixAssets(input: GeneratePremiumRemixAssetsInput) {
  const remix = growthPremiumRemixSchema.parse(input.remix);
  const mode = input.mode;

  const referenceImages = [];
  const referenceSteps: PremiumRemixDebugStep[] = [];
  for (const character of remix.characterAnchors.slice(0, 3)) {
    try {
      const image = await generateGeminiImage({
        prompt: `${character.visualPrompt}\n${buildCharacterLockPrompt({
          appearance: character.role,
          outfit: "consistent wardrobe",
          hair: "consistent hairstyle",
          optionalReferenceImage: character.referenceImageUrl || "",
        })}`,
        quality: "1k",
        referenceImageUrl: character.referenceImageUrl || undefined,
      });
      referenceImages.push({
        id: character.id,
        label: character.label,
        imageUrl: image.imageUrl,
      });
      referenceSteps.push({
        step: "asset-reference-image",
        status: "ok",
        label: character.label,
        model: image.model,
        location: image.location,
        imageUrl: image.imageUrl,
      });
    } catch (error) {
      referenceSteps.push({
        step: "asset-reference-image",
        status: "failed",
        label: character.label,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const clips = [];
  const clipSteps: PremiumRemixDebugStep[] = [];
  if (mode === "loop") {
    for (const segment of remix.loopTrack.segments.slice(0, 4)) {
      const storyboardShot = remix.storyboard.find((item) => item.shotId === segment.segmentIndex);
      try {
        const video = await generateVideo({
          prompt: `${segment.prompt}. ${segment.stabilityPrompt}. ${storyboardShot?.veoPrompt || ""}`.trim(),
          imageUrl: storyboardShot?.referenceImageUrl || referenceImages[0]?.imageUrl,
          quality: "standard",
          aspectRatio: "16:9",
          resolution: "720p",
          negativePrompt: "multiple people, extra arms, extra legs, animal, pet, distorted face, duplicate subject",
        });
        clips.push({
          label: `${segment.segmentIndex * 8 - 8}-${segment.segmentIndex * 8}秒`,
          videoUrl: video.videoUrl,
        });
        clipSteps.push({
          step: "loop-clip",
          status: "ok",
          label: `${segment.startSecond}-${segment.endSecond}秒`,
          promptPreview: previewText(segment.prompt),
          videoUrl: video.videoUrl,
        });
      } catch (error) {
        clipSteps.push({
          step: "loop-clip",
          status: "failed",
          label: `${segment.startSecond}-${segment.endSecond}秒`,
          promptPreview: previewText(segment.prompt),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } else {
    const nodes = [...remix.interpolationTrack.nodes];
    for (let index = 0; index < nodes.length; index += 1) {
      if (!nodes[index].imageUrl) {
        try {
          const generated = await generateGeminiImage({
            prompt: nodes[index].prompt,
            quality: "1k",
            referenceImageUrl: referenceImages[0]?.imageUrl,
          });
          nodes[index].imageUrl = generated.imageUrl;
          referenceSteps.push({
            step: "interpolation-node-image",
            status: "ok",
            label: nodes[index].label,
            promptPreview: previewText(nodes[index].prompt),
            model: generated.model,
            location: generated.location,
            imageUrl: generated.imageUrl,
          });
        } catch (error) {
          referenceSteps.push({
            step: "interpolation-node-image",
            status: "failed",
            label: nodes[index].label,
            promptPreview: previewText(nodes[index].prompt),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    for (let index = 0; index < nodes.length - 1; index += 1) {
      try {
        const video = await generateVideo({
          prompt: `Smooth cinematic transition from ${nodes[index].label} to ${nodes[index + 1].label}. ${nodes[index + 1].prompt}`,
          imageUrl: nodes[index].imageUrl,
          quality: "standard",
          aspectRatio: "16:9",
          resolution: "720p",
          negativePrompt: "multiple people, animal, extra limbs, duplicate face, identity drift",
        });
        clips.push({
          label: `${nodes[index].label} -> ${nodes[index + 1].label}`,
          videoUrl: video.videoUrl,
        });
        clipSteps.push({
          step: "interpolation-clip",
          status: "ok",
          label: `${nodes[index].label} -> ${nodes[index + 1].label}`,
          promptPreview: previewText(nodes[index + 1].prompt),
          videoUrl: video.videoUrl,
        });
      } catch (error) {
        clipSteps.push({
          step: "interpolation-clip",
          status: "failed",
          label: `${nodes[index].label} -> ${nodes[index + 1].label}`,
          promptPreview: previewText(nodes[index + 1].prompt),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    assets: growthPremiumRemixAssetsSchema.parse({
      mode,
      referenceImages,
      clips,
    }),
    debug: {
      mode,
      referenceSteps,
      clipSteps,
    } satisfies PremiumRemixAssetsDebug,
  };
}
