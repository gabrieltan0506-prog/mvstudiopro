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

type BuildPremiumRemixInput = {
  context?: string;
  transcript?: string;
  analysis: GrowthAnalysisScores;
  modelName?: GrowthCampModel;
  titleExecutions?: GrowthTitleExecution[];
  assetAdaptation?: GrowthAssetAdaptation;
  growthHandoff?: GrowthHandoff;
  creationStoryboardPrompt?: string;
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

function buildFallbackRemix(input: BuildPremiumRemixInput) {
  const keyFrames = Array.isArray(input.analysis.keyFrames) ? input.analysis.keyFrames.slice(0, 4) : [];
  const primaryAngle = input.analysis.commercialAngles?.[0];
  const primaryTitleExecution = input.titleExecutions?.[0];
  const assetAdaptation = input.assetAdaptation;
  const growthHandoff = input.growthHandoff;
  const personaContext = input.context || "围绕当前账号身份，重构成更可信、更专业的单人商业表达。";
  const title = primaryAngle?.title || input.analysis.titleSuggestions?.[0] || "优质视频二创";
  const visualSummary = input.analysis.visualSummary || "保留参考视频的景别节奏、口播推进和结果前置结构。";
  const sceneA = keyFrames[0];
  const sceneB = keyFrames[1];
  const sceneC = keyFrames[2];
  const sceneD = keyFrames[3];
  const openingHook = assetAdaptation?.firstHook || primaryTitleExecution?.openingHook || primaryAngle?.hook || "前 2 秒先抛最扎心的问题和最直接的结果。";
  const structureLine = assetAdaptation?.structure || primaryTitleExecution?.videoPlan || growthHandoff?.storyboardPrompt || "按问题、动作、证据、行动引导四段推进。";
  const callToAction = assetAdaptation?.callToAction || growthHandoff?.businessGoal || "只保留一个行动引导，导向咨询、预约或私信关键词。";
  const visualBase = [
    personaContext,
    visualSummary,
    structureLine,
  ].filter(Boolean).join(" ");

  return growthPremiumRemixSchema.parse({
    title: "优质视频二创",
    sourceSummary: `${title}，核心可借鉴的是节奏、镜头推进和商业承接，而不是照搬原内容。`,
    visualDnaSummary: visualSummary,
    contentRebuildSummary: primaryAngle?.whyItFits || input.analysis.summary || structureLine || "将参考视频的高留存结构重写为符合当前赛道的商业短视频脚本。",
    personaFit: personaContext,
    performanceDirection: `保留高留存镜头节奏，但把画面、角色和台词全部改写为自己的商业表达。重点执行：${structureLine}`,
    characterAnchors: [
      {
        id: "host",
        label: "主讲人",
        role: personaContext,
        visualPrompt: `${personaContext} cinematic chinese creator, clean studio outfit, high-trust expert, premium lighting, single person, no crowd, no animal`,
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
        referencePrompt: `${visualBase} 开场镜头，单人出镜，中近景，直接看镜头，抛出核心问题与结果，专业可信，高级布光，留字幕位。`,
        veoPrompt: `${visualBase} single subject, medium close-up, clean premium background, direct-to-camera hook, subtle push-in, high-trust expert tone, opening hook: ${openingHook}`,
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
        referencePrompt: `${visualBase} 中景讲解镜头，单人手势示范或展示资料，道具清楚，动作服务解释，画面干净，专业场景。`,
        veoPrompt: `${visualBase} single subject, medium shot, clear gesture demonstration, soft key light, practical instruction vibe, show one concrete action or method`,
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
        referencePrompt: `${visualBase} 证据镜头，单人主体配资料细节或前后对比，局部特写，高级商业布光，强调可信度与专业度。`,
        veoPrompt: `${visualBase} single subject with insert shots, premium detail close-ups, before-after evidence, polished commercial lighting, trust-building visual proof`,
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
        referencePrompt: `${visualBase} 收束镜头，单人中景，轻推近，眼神坚定，明确行动引导，保留字幕与行动词位置。`,
        veoPrompt: `${visualBase} single subject closing call-to-action, subtle push-in, clean premium set, confident gesture, one clear CTA: ${callToAction}`,
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
        { segmentIndex: 1, startSecond: 0, endSecond: 8, prompt: `${openingHook} 单人中近景，直接看镜头，镜头轻推近，背景干净，专业可信。`, stabilityPrompt: "保持主讲人脸部、服装、发型和背景绝对一致，禁止多人污染", referenceHint: "优先复用镜头 1 的分镜参考图" },
        { segmentIndex: 2, startSecond: 8, endSecond: 16, prompt: `${primaryTitleExecution?.videoPlan || "展示一个具体动作或解释方法"}，加入手势或资料道具，强调做法与原理。`, stabilityPrompt: "保持主讲人一致，动作自然，避免任何多人污染", referenceHint: "优先复用镜头 2 的分镜参考图" },
        { segmentIndex: 3, startSecond: 16, endSecond: 24, prompt: `${growthHandoff?.brief || "加入案例、证据或前后对比"}，让可信度明显抬升，保留局部细节特写。`, stabilityPrompt: "保持风格与主体稳定，允许局部特写，但主体身份不能漂移", referenceHint: "优先复用镜头 3 的分镜参考图" },
        { segmentIndex: 4, startSecond: 24, endSecond: 32, prompt: `${callToAction} 结尾镜头收束，人物姿态稳定，给出唯一行动引导。`, stabilityPrompt: "结尾人物和背景保持一致，动作清晰，字幕位置稳定", referenceHint: "优先复用镜头 4 的分镜参考图" },
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

  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    if (anchor.referenceImageUrl) continue;
    try {
      const image = await generateGeminiImage({
        prompt: anchor.visualPrompt,
        quality: "1k",
        aspectRatio: "16:9",
      });
      anchors[index] = { ...anchor, referenceImageUrl: image.imageUrl };
    } catch (error) {
      console.warn("[growth.hydratePremiumRemixReferenceImages] anchor failed:", error);
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
      } catch (error) {
        console.warn("[growth.hydratePremiumRemixReferenceImages] shot failed:", error);
      }
    }
    storyboard.push({
      ...shot,
      referenceImageUrl: referenceImageUrl || "",
    });
  }

  return growthPremiumRemixSchema.parse({
    ...remix,
    characterAnchors: anchors,
    storyboard,
  });
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

  const prompt = [
    "你是 MVStudioPro 的优质视频逆向工程导演。",
    "任务：把参考视频的成功节奏、镜头语言和商业推进抽离出来，再重写成一个新的二创版本。",
    "必须严格输出 JSON，本体只能是 JSON，不允许 markdown 或解释。",
    "输出字段：title/sourceSummary/visualDnaSummary/contentRebuildSummary/personaFit/performanceDirection/characterAnchors/storyboard/loopTrack/interpolationTrack/deliveryNotes。",
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
    "9. 如果用户上下文里有职业、人设、服装、场景、道具要求，必须写进角色锚定和 referencePrompt。",
    "",
    `上下文：${context || "未提供额外背景，按当前视频分析结果重构。"}`,
    `视频总结：${analysis.summary || ""}`,
    `视觉总判断：${analysis.visualSummary || ""}`,
    `开头画面判断：${analysis.openingFrameAssessment || ""}`,
    `画面统一性：${analysis.sceneConsistency || ""}`,
    `亮点：${(analysis.strengths || []).join(" / ")}`,
    `缺点：${(analysis.improvements || []).join(" / ")}`,
    `时间点改法：${(analysis.timestampSuggestions || []).map((item) => `${item.timestamp} ${item.issue} -> ${item.fix}`).join(" | ")}`,
    `关键帧证据：${(analysis.keyFrames || []).map((item) => `${item.timestamp} ${item.whatShows} | 改法:${item.fix}`).join(" | ")}`,
    `弱帧提醒：${(analysis.weakFrameReferences || []).map((item) => `${item.timestamp} ${item.reason} -> ${item.fix}`).join(" | ")}`,
    titleExecutions.length ? `标题与执行：${titleExecutions.map((item, index) => `标题${index + 1} ${item.title} | 开场:${item.openingHook} | 文案:${item.copywriting} | 视频怎么拍:${item.videoPlan}`).join(" || ")}` : "",
    assetAdaptation ? `资产改编建议：形式=${assetAdaptation.format} | 开头=${assetAdaptation.firstHook} | 结构=${assetAdaptation.structure} | 结尾=${assetAdaptation.callToAction}` : "",
    growthHandoff ? `成长营交接：brief=${growthHandoff.brief} | storyboardPrompt=${growthHandoff.storyboardPrompt} | workflowPrompt=${growthHandoff.workflowPrompt} | recommendedTrack=${growthHandoff.recommendedTrack} | businessGoal=${growthHandoff.businessGoal}` : "",
    creationStoryboardPrompt ? `创作画布分镜提示：${creationStoryboardPrompt}` : "",
    transcript ? `转写：${transcript.slice(0, 14000)}` : "",
  ].filter(Boolean).join("\n");

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
    const parsed = growthPremiumRemixSchema.parse(asJsonObject(response.choices[0].message.content as string));
    return await hydratePremiumRemixReferenceImages(parsed);
  } catch (error) {
    console.warn("[growth.buildPremiumRemixPlan] fallback:", error);
    return await hydratePremiumRemixReferenceImages(buildFallbackRemix(input));
  }
}

export async function generatePremiumRemixAssets(input: GeneratePremiumRemixAssetsInput) {
  const remix = growthPremiumRemixSchema.parse(input.remix);
  const mode = input.mode;

  const referenceImages = [];
  for (const character of remix.characterAnchors.slice(0, 3)) {
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
  }

  const clips = [];
  if (mode === "loop") {
    for (const segment of remix.loopTrack.segments.slice(0, 4)) {
      const storyboardShot = remix.storyboard.find((item) => item.shotId === segment.segmentIndex);
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
    }
  } else {
    const nodes = [...remix.interpolationTrack.nodes];
    for (let index = 0; index < nodes.length; index += 1) {
      if (!nodes[index].imageUrl) {
        const generated = await generateGeminiImage({
          prompt: nodes[index].prompt,
          quality: "1k",
          referenceImageUrl: referenceImages[0]?.imageUrl,
        });
        nodes[index].imageUrl = generated.imageUrl;
      }
    }
    for (let index = 0; index < nodes.length - 1; index += 1) {
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
    }
  }

  return growthPremiumRemixAssetsSchema.parse({
    mode,
    referenceImages,
    clips,
  });
}
