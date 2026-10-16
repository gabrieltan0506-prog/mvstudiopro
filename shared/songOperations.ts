import { z } from "zod";
import { canvasMusicCandidateSchema } from "./canvasMusicMedia";

export const SONG_OPERATION_LABELS = {
  cover: "参考改编",
  extend: "续写歌曲",
  replace: "局部修歌",
  persona: "保存演唱风格",
  align: "歌词对齐",
  stems: "分轨与混音",
} as const;
export const songOperationKindSchema = z.enum(["cover", "extend", "replace", "persona", "align", "stems"]);
export type SongOperationKind = z.infer<typeof songOperationKindSchema>;
const seconds = z.number().finite().nonnegative().max(3600);
const weight = z.number().finite().min(0).max(1);

/** 只表达用户已审阅的编辑决定，供应商歌曲身份必须在服务端核回。 */
export const songOperationDraftSchema = z.object({
  operation: songOperationKindSchema,
  source: canvasMusicCandidateSchema,
  sourceOperationId: z.string().uuid().optional(),
  sourceVariantIndex: z.number().int().nonnegative().optional(),
  title: z.string().trim().min(1).max(80).optional(),
  prompt: z.string().max(5000).optional(),
  style: z.string().max(1000).optional(),
  negativeTags: z.string().max(200).optional(),
  instrumental: z.boolean().optional(),
  duration: z.number().int().min(10).max(360).optional(),
  audioWeight: weight.optional(),
  styleWeight: weight.optional(),
  weirdnessConstraint: weight.optional(),
  continueAt: seconds.optional(),
  startSec: seconds.optional(),
  endSec: seconds.optional(),
  personaName: z.string().trim().min(1).max(100).optional(),
  personaDescription: z.string().max(2000).optional(),
  personaRequestId: z.string().uuid().optional(),
}).strict().superRefine((value, ctx) => {
  const issue = (field: string, message: string) => ctx.addIssue({code: "custom", path: [field], message});
  if (["cover", "extend", "replace"].includes(value.operation)) {
    if (!value.title?.trim()) issue("title", "请填写歌曲标题");
    if (!value.prompt?.trim()) issue("prompt", "请填写本次歌词或器乐结构");
    if (!value.style?.trim()) issue("style", "请填写本次音乐风格");
  }
  if (value.operation === "extend" && (value.continueAt == null || value.continueAt >= value.source.durationSec))
    issue("continueAt", "续写位置须在原音频时长内");
  if (value.operation === "replace" || value.operation === "persona") {
    if (value.startSec == null || value.endSec == null || value.endSec <= value.startSec || value.endSec > value.source.durationSec)
      issue("endSec", "请选择原歌曲内的有效起止区间");
  }
  if (value.operation === "persona" && !value.personaName) issue("personaName", "请为演唱风格命名");
  if (value.operation !== "cover" && value.instrumental !== undefined) issue("instrumental", "只有参考改编可指定纯器乐；其他操作沿用原歌曲类型");
  if ((value.sourceOperationId == null) !== (value.sourceVariantIndex == null))
    issue("sourceOperationId", "编辑来源及变体编号须同时提供");
});
export type SongOperationDraft = z.infer<typeof songOperationDraftSchema>;
export const songOperationPrepareSchema = z.object({requestId: z.string().uuid(), draft: songOperationDraftSchema}).strict();
export const songOperationConfirmSchema = z.object({requestId: z.string().uuid(), inputDigest: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true)}).strict();
export const songAlignedWordSchema = z.object({text: z.string().min(1), startSec: seconds, endSec: seconds}).strict()
  .refine(word => word.endSec > word.startSec, "歌词结束时间须晚于开始时间");
export const songOperationVariantSchema = z.object({
  index: z.number().int().nonnegative(), musicId: z.string().min(1).optional(),
  gcsUri: z.string().startsWith("gs://"), url: z.string().url().optional(),
  durationSec: z.number().finite().positive().max(3600), title: z.string().optional(), stem: z.string().optional(),
}).strict();
export const songOperationReceiptSchema = z.object({
  requestId: z.string().uuid(), operation: songOperationKindSchema, sourceId: z.string(),
  status: z.enum(["prepared", "submitting", "pending", "processing", "succeeded", "failed", "reconcile_required", "payment_pending"]),
  inputDigest: z.string(), createdAt: z.string(), creditsCost: z.number().int().nonnegative().nullable(),
  draft: songOperationDraftSchema,
  variants: z.array(songOperationVariantSchema),
  persona: z.object({id: z.string().min(1), name: z.string().min(1), description: z.string().optional()}).strict().optional(),
  alignment: z.object({words: z.array(songAlignedWordSchema).min(1), srt: z.string().min(1)}).strict().optional(),
  error: z.string().optional(),
}).strict();
export type SongOperationReceipt = z.infer<typeof songOperationReceiptSchema>;
export const songOperationSessionSchema = z.object({requestId: z.string().uuid(), operation: songOperationKindSchema, sourceId: z.string(), receipt: songOperationReceiptSchema.optional()}).strict();
export type SongOperationSession = z.infer<typeof songOperationSessionSchema>;

export function songOperationIsActive(status: SongOperationReceipt["status"]) {
  return ["submitting", "pending", "processing"].includes(status);
}
