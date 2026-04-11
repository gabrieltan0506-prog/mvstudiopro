import {
  type GrowthAnalysisScores,
  type GrowthCampModel,
  growthPremiumRemixAssetsSchema,
  growthPremiumRemixSchema,
} from "@shared/growth";
import { invokeLLM } from "../_core/llm";
import { generateGeminiImage } from "../gemini-image";
import { generateVideo } from "../veo";
import { buildCharacterLockPrompt } from "../workflow/prompts/characterLockPrompt";
import { resolveGrowthCampStrategistModel } from "./extractorPipeline";

type BuildPremiumRemixInput = {
  context?: string;
  transcript?: string;
  analysis: GrowthAnalysisScores;
  modelName?: GrowthCampModel;
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
  const title = primaryAngle?.title || input.analysis.titleSuggestions?.[0] || "优质视频二创";
  const visualSummary = input.analysis.visualSummary || "保留参考视频的景别节奏、口播推进和结果前置结构。";
  const sceneA = keyFrames[0];
  const sceneB = keyFrames[1];
  const sceneC = keyFrames[2];
  const sceneD = keyFrames[3];

  return growthPremiumRemixSchema.parse({
    title: "优质视频二创",
    sourceSummary: `${title}，核心可借鉴的是节奏、镜头推进和商业承接，而不是照搬原内容。`,
    visualDnaSummary: visualSummary,
    contentRebuildSummary: primaryAngle?.whyItFits || input.analysis.summary || "将参考视频的高留存结构重写为符合当前赛道的商业短视频脚本。",
    personaFit: input.context || "围绕用户当前身份、人设和赛道，重构成更可执行的二创版本。",
    performanceDirection: "保留高留存镜头节奏，但把画面、角色和台词全部改写为自己的商业表达。",
    characterAnchors: [
      {
        id: "host",
        label: "主讲人",
        role: "单人主视角",
        visualPrompt: "cinematic chinese creator, clean studio outfit, high-trust expert, premium lighting, single person, no crowd",
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
        voiceover: sceneA?.commercialUse || "先讲谁最痛、为什么现在要看。",
        performanceNote: "眼神直接看镜头，语速快一点，不铺垫。",
        veoPrompt: "single subject, medium close-up, clean premium background, direct-to-camera hook, subtle push-in, high-trust expert tone, no extra people, no animal",
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
        voiceover: sceneB?.fix || "这里讲具体怎么做，不要空泛。",
        performanceNote: "加入手势或对比道具，避免全程一模一样的站姿。",
        veoPrompt: "single subject, medium shot, clear gesture demonstration, soft key light, practical instruction vibe, no extra person",
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
        voiceover: sceneC?.fix || "告诉用户为什么这个方案可信。",
        performanceNote: "保留 1 到 2 个有证据感的镜头，不要再重复站桩口播。",
        veoPrompt: "single subject with insert shots, premium detail close-ups, before-after evidence, polished commercial lighting, no crowd",
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
        onScreenText: sceneD?.fix || "评论关键词 / 私信 / 预约",
        voiceover: "只保留一个动作，引导咨询、收藏或预约，不要同时塞多个动作。",
        performanceNote: "语气收紧，结尾必须只给一个行动。",
        veoPrompt: "single subject closing call-to-action, subtle push-in, clean premium set, confident gesture, no extra people or animals",
        negativePrompt: "crowd, second person, pet, distorted hands, messy background",
      },
    ],
    loopTrack: {
      plan: {
        title: "32秒自动延展",
        summary: "用 4 段 8 秒视频连续延展，适合单人连续讲解或稳定场景。",
        whyItWorks: "固定节奏最稳，适合把主讲人口播和动作示范串成 32 秒商业短视频。",
      },
      segments: [
        { segmentIndex: 1, startSecond: 0, endSecond: 8, prompt: "建立人物和问题", stabilityPrompt: "保持主讲人脸部、服装和背景绝对一致", referenceHint: "优先用主讲人角色图作为首段参考" },
        { segmentIndex: 2, startSecond: 8, endSecond: 16, prompt: "展开动作示范和解释", stabilityPrompt: "保持主讲人一致，避免任何多人污染", referenceHint: "延用上一段尾帧" },
        { segmentIndex: 3, startSecond: 16, endSecond: 24, prompt: "加入证据和局部特写", stabilityPrompt: "保持风格与主体稳定", referenceHint: "可加入局部特写镜头" },
        { segmentIndex: 4, startSecond: 24, endSecond: 32, prompt: "收束行动引导", stabilityPrompt: "结尾人物和背景保持一致，动作清晰", referenceHint: "结尾留行动引导字幕位" },
      ],
    },
    interpolationTrack: {
      plan: {
        title: "32秒关键帧插值",
        summary: "用 5 个关键节点做 4 段插值，适合时空演化、概念转化或强视觉过渡。",
        whyItWorks: "关键帧锚定能有效避免 Veo 在长段生成里的主体漂移和风格污染。",
      },
      nodes: [
        { nodeId: "A", label: "起始状态", prompt: "主讲人专业开场镜头，干净背景，建立信任" },
        { nodeId: "M1", label: "过渡一", prompt: "加入动作示范或局部对比，画面更具体" },
        { nodeId: "M2", label: "过渡二", prompt: "引入结果证据或案例细节，强化商业可信度" },
        { nodeId: "M3", label: "过渡三", prompt: "准备收束，动作和视线导向行动引导" },
        { nodeId: "B", label: "结束状态", prompt: "结尾行动引导镜头，人物姿态稳定，保留字幕位" },
      ],
    },
    deliveryNotes: [
      "多人互动场景全部改成正反打或单人镜头，避免多角色污染。",
      "动物只可作为背景元素，不可与主角色同镜头正面互动。",
      "Veo 提示词统一要求单主体、固定服装、固定发型、固定背景逻辑。",
    ],
  });
}

export async function buildPremiumRemixPlan(input: BuildPremiumRemixInput) {
  const strategistModel = resolveGrowthCampStrategistModel(input.modelName);
  const transcript = String(input.transcript || "").trim();
  const context = String(input.context || "").trim();
  const analysis = input.analysis;

  const prompt = [
    "你是 MVStudioPro 的优质视频逆向工程导演。",
    "任务：把参考视频的成功节奏、镜头语言和商业推进抽离出来，再重写成一个新的二创版本。",
    "必须严格输出 JSON，本体只能是 JSON，不允许 markdown 或解释。",
    "输出字段：title/sourceSummary/visualDnaSummary/contentRebuildSummary/personaFit/performanceDirection/characterAnchors/storyboard/loopTrack/interpolationTrack/deliveryNotes。",
    "规则：",
    "1. title 固定写“优质视频二创”。",
    "2. storyboard 必须精确输出 4 个镜头，每个镜头 8 秒，总计 32 秒。",
    "3. characterAnchors 只允许 1 到 3 个角色锚点，且每个角色都要有 visualPrompt 和 consistencyRules。",
    "4. 所有 veoPrompt 都必须强调单主体，禁止多人同框正面镜头，禁止宠物和动物造成主体污染。",
    "5. loopTrack 必须适合 4 个 8 秒延展段；interpolationTrack 必须输出 5 个关键节点 A/M1/M2/M3/B。",
    "6. 文案与分镜必须可直接用于商业短视频重制，而不是泛泛而谈。",
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
    transcript ? `转写：${transcript.slice(0, 14000)}` : "",
  ].filter(Boolean).join("\n");

  try {
    const response = await invokeLLM({
      model: strategistModel,
      temperature: strategistModel.includes("3.1") ? 0.75 : 0.45,
      messages: [
        { role: "system", content: "你擅长将参考视频的节奏抽象成可执行的商业二创脚本，并且严格输出 JSON。" },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    });
    const parsed = growthPremiumRemixSchema.parse(asJsonObject(response.choices[0].message.content as string));
    return parsed;
  } catch (error) {
    console.warn("[growth.buildPremiumRemixPlan] fallback:", error);
    return buildFallbackRemix(input);
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
      const video = await generateVideo({
        prompt: `${segment.prompt}. ${segment.stabilityPrompt}.`,
        imageUrl: referenceImages[0]?.imageUrl,
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
