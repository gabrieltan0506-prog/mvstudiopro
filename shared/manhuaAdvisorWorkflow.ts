import { z } from "zod";

const id = z.string().trim().min(1).max(200);
const episode = z.number().int().positive();
const point = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);

/** 文字顾问与语音共用；不接受模型传入费用豁免、自动重试或外部素材地址。 */
export const manhuaAdvisorWorkflowVariants = [
  z
    .object({
      action: z.literal("writer"),
      operation: z.enum(["inspect", "configure", "trial", "expand", "confirm"]),
      topic: z.string().trim().min(1).max(500).optional(),
      brief: z.string().max(2000).optional(),
      templateId: id.optional(),
      episodeCount: z.number().int().min(1).max(80).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("asset"),
      operation: z.enum([
        "inspect",
        "regenerate",
        "select",
        "adopt",
        "configure",
        "claim",
        "primary",
        "acceptReview",
      ]),
      anchorId: id.optional(),
      assetId: id.optional(),
      libraryId: id.optional(),
      anchorIds: z.array(id).max(24).optional(),
      duty: z.enum(["identity", "look"]).optional(),
      metadata: z
        .object({
          labelZh: z.string().trim().min(1).max(40).optional(),
          role: z.enum(["character", "scene", "prop", "wardrobe"]).optional(),
          refDuty: z
            .enum([
              "identity",
              "look",
              "space",
              "motion",
              "first_frame",
              "last_frame",
              "style",
            ])
            .optional(),
        })
        .strict()
        .optional(),
      question: z.string().trim().min(1).max(1200).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("modelControl"),
      operation: z.enum([
        "inspect",
        "multiview",
        "multiviewSubmit",
        "rigInspect",
        "rigSubmit",
        "rigAdopt",
        "rigRestore",
      ]),
      assetId: id,
      requestId: id.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("worldControl"),
      operation: z.enum(["inspect", "exportFrame", "adoptFrame", "clearFrame"]),
      assetId: id.optional(),
      clipId: id.optional(),
      shotId: id.optional(),
      frameId: id.optional(),
      camera: z
        .object({
          position: point,
          target: point,
          fov: z.number().min(15).max(100),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("generate"),
      operation: z.enum(["keyart", "clip", "retake", "selectVersion"]),
      episode,
      blockId: id.optional(),
      versionIndex: z.number().int().min(0).optional(),
      variable: z
        .enum([
          "camera",
          "performance",
          "lighting",
          "reference",
          "duration",
          "framing",
        ])
        .optional(),
      question: z.string().trim().min(1).max(1200).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("audio"),
      operation: z.enum([
        "inspect",
        "addCue",
        "configureCue",
        "generateDialogue",
        "adoptTake",
        "selectMusic",
        "selectSource",
        "trim",
        "premix",
        "previewMix",
        "resume",
      ]),
      clipId: id,
      cueId: id.optional(),
      sourceId: id.optional(),
      kind: z.enum(["dialogue", "bgm", "sfx"]).optional(),
      takeId: id.optional(),
      jobId: id.optional(),
      variantIndex: z.number().int().min(0).optional(),
      patch: z
        .object({
          textZh: z.string().max(2000).optional(),
          labelZh: z.string().max(200).optional(),
          shotZh: z.string().max(2000).optional(),
          speakerId: id.optional(),
          speakerZh: z.string().max(100).optional(),
          voice: id.optional(),
          emotion: z.string().max(80).optional(),
          startSec: z.number().finite().min(0).optional(),
          endSec: z.number().finite().positive().optional(),
          sourceStartSec: z.number().finite().min(0).optional(),
          sourceEndSec: z.number().finite().positive().optional(),
          volume: z.number().finite().min(0).max(1).optional(),
          fadeInSec: z.number().finite().min(0).max(30).optional(),
          fadeOutSec: z.number().finite().min(0).max(30).optional(),
          mix: z
            .object({
              duckUnderDialogue: z.boolean(),
              duckVolume: z.number().min(0).max(1),
              silenceWindows: z
                .array(
                  z
                    .object({
                      startSec: z.number().min(0),
                      endSec: z.number().min(0),
                    })
                    .strict()
                )
                .max(20),
            })
            .strict()
            .optional(),
          enabled: z.boolean().optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("scoring"),
      operation: z.enum([
        "inspect",
        "configure",
        "analyze",
        "applyAdvice",
        "submit",
      ]),
      clipId: id.optional(),
      musicId: id.optional(),
      sourceKey: z.string().min(1).max(160).optional(),
      question: z.string().trim().min(1).max(2000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("edit"),
      operation: z.enum(["inspect", "reorder", "trim", "transition"]),
      episode,
      order: z.array(z.number().int().positive()).min(1).max(200).optional(),
      shotIndex: z.number().int().positive().optional(),
      inSec: z.number().finite().min(0).optional(),
      outSec: z.number().finite().positive().optional(),
      transition: z.enum(["cut", "fade"]).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("deliver"),
      operation: z.enum([
        "inspect",
        "assemble",
        "subtitle",
        "selectVersion",
        "export",
      ]),
      episode,
      clipIds: z.array(id).min(1).max(100).optional(),
      versionIndex: z.number().int().min(0).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("storyboardRecovery"),
      operation: z.enum(["inspect", "recover", "archive"]),
      episode,
    })
    .strict(),
] as const;

export const MANHUA_ADVISOR_OPERATION_REQUEST = "【工作流操作】";
export const MANHUA_ADVISOR_WORKFLOW_HELP = `工作流动作：writer(inspect/configure/trial/expand/confirm，topic/brief/templateId/episodeCount)；asset(inspect/regenerate/select/adopt/configure/claim/primary/acceptReview，anchorId/assetId/libraryId/question/anchorIds/duty/metadata)；modelControl(inspect/multiview/multiviewSubmit/rigInspect/rigSubmit/rigAdopt/rigRestore，assetId/requestId)；worldControl(inspect/exportFrame/adoptFrame/clearFrame，assetId/clipId/shotId/frameId/camera)；generate(keyart/clip/retake/selectVersion，episode/blockId/versionIndex/question)；audio(inspect/addCue/configureCue/generateDialogue/adoptTake/selectMusic/selectSource/trim/premix/previewMix/resume，clipId/cueId/takeId/jobId/variantIndex/patch)；scoring(inspect/configure/analyze/applyAdvice/submit，clipId/musicId/question/sourceKey，submit必须原样携带本次scoring inspect的sourceKey；改素材或参数后重新inspect和准备方案，使用已采用配乐与原正式视频混音入口)；edit(inspect/reorder/trim/transition，episode/order/shotIndex/inSec/outSec/transition，沿原剪辑台保存)；deliver(inspect/assemble/subtitle/selectVersion/export，episode/clipIds/versionIndex)；storyboardRecovery(inspect/recover/archive，episode)。ID及候选编号只能从当前工作区实际清单取得，不接受外部素材URL。执行生成仍须原页面确认；inspect不改作品。缺少目标或参数时说明缺少什么，不猜测、不开任务。`;
