/**
 * 实拍照「放入人物重绘」（1109 用户新增）：以本人已采用的图库照片为底图，用 GPT Image 2.6 Sunburst
 * 改图（images/edits）把男主（用户人脸）/女主（定妆帧）合成进真实街景，保留底图的透视、材质与光源，
 * 使画面像现实拍摄。流程约定：先评估底图适配度 → 适配才 edit 放人，不适配再纯生成。
 *
 * 参考图顺序（与提交数组同序，指令按序号点名）：
 *   image 1 = 实拍底图（构图/透视/材质/光源以它为准）
 *   image 2.. = 人物参考（男主在前；真人身份照只锁脸与发型，定妆帧锁脸与服装）
 * 纯函数：只做校验与排版，不调用模型、不碰计费。
 */
import { z } from "zod";

export const STOCK_PHOTO_PERSON_EDIT_CAST = ["lead", "partner", "both"] as const;
export type StockPhotoPersonEditCast = (typeof STOCK_PHOTO_PERSON_EDIT_CAST)[number];
export const STOCK_PHOTO_PERSON_EDIT_CAST_LABEL_ZH: Record<StockPhotoPersonEditCast, string> = { lead: "男主", partner: "女主", both: "双人" };
export type StockPhotoPersonEditSlot = "lead" | "partner";

/** 固定模型档：Sunburst 改图精度档（2.6）；只走官方通道，不静默降档。 */
export const STOCK_PHOTO_PERSON_EDIT_MODEL = "gpt-image-2.6-sunburst" as const;

export const stockPhotoPersonEditPersonSchema = z.object({
  slot: z.enum(["lead", "partner"]),
  /** 人物参考图：本人上传或本人任务产物（服务端二次核对归属）。 */
  source: z.string().trim().min(1).max(2048),
  /** true = 真人身份照（只锁脸与发型，不继承原照背景与服装）；false = 定妆帧（锁脸与服装）。 */
  identityPhoto: z.boolean(),
  /** 可选：英文角色称呼（默认 THE LEAD / THE PARTNER）。 */
  roleEn: z.string().trim().min(1).max(60).optional(),
  /** 可选：英文服装设定；不写 = 真人照按场景自然着装、定妆帧沿用定妆服装。 */
  wardrobeEn: z.string().trim().max(400).optional(),
}).strict();
export type StockPhotoPersonEditPerson = z.infer<typeof stockPhotoPersonEditPersonSchema>;

export const stockPhotoPersonEditInputSchema = z.object({
  requestId: z.string().uuid(),
  /** 底图：本人已采用的图库照片 assetId（sf_…），服务端按采用回执取 gcsUri，不信任客户端 URL。 */
  baseAssetId: z.string().regex(/^sf_[0-9a-f]{48}$/, "底图编号无效"),
  cast: z.enum(STOCK_PHOTO_PERSON_EDIT_CAST),
  people: z.array(stockPhotoPersonEditPersonSchema).min(1).max(2),
  /** 一句动作描述（中英文皆可），如「他撑透明伞站在橱窗前开口演唱」。 */
  actionText: z.string().trim().min(2).max(600),
  /** 可选：时间/天气/色调改写（如黄昏改雨夜）；不写则完全保留底图光线。 */
  relightText: z.string().trim().max(400).optional(),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
}).strict().superRefine((v, ctx) => {
  const need: StockPhotoPersonEditSlot[] = v.cast === "both" ? ["lead", "partner"] : [v.cast];
  const got = v.people.map(p => p.slot);
  if (got.length !== need.length || need.some((s, i) => got[i] !== s))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["people"], message: `「${STOCK_PHOTO_PERSON_EDIT_CAST_LABEL_ZH[v.cast]}」需要按顺序提供：${need.map(s => STOCK_PHOTO_PERSON_EDIT_CAST_LABEL_ZH[s]).join("、")}的人物参考` });
});
export type StockPhotoPersonEditInput = z.infer<typeof stockPhotoPersonEditInputSchema>;

const defaultRole = (slot: StockPhotoPersonEditSlot) => (slot === "lead" ? "THE LEAD" : "THE PARTNER");

/** 英文改图指令（images/edits 的 prompt）。确定性：同输入同输出。 */
export function buildStockPhotoPersonEditPrompt(input: Pick<StockPhotoPersonEditInput, "people" | "actionText" | "relightText">): string {
  const lines: string[] = [
    "PHOTO EDIT (CRITICAL): Image 1 is a REAL street photograph and is the BASE PLATE. Keep its camera position, lens perspective, horizon, architecture, surfaces and materials, signage shapes, light sources and their direction, reflections and depth of field. The result must look like an unretouched real-life photograph taken at this exact location, not an illustration or a composite.",
    "Remove or replace every existing person in image 1; the only people in the final image are the characters below.",
  ];
  input.people.forEach((p, i) => {
    const n = i + 2;
    const role = p.roleEn || defaultRole(p.slot);
    lines.push(
      p.identityPhoto
        ? `${role} = the real person in image ${n}. FACE LOCK (HARD): preserve the exact facial identity — face shape, bone structure, eyes, nose, lips, skin tone, apparent age and hairstyle — instantly recognizable. Use image ${n} ONLY for face and hair; do NOT copy its background, studio lighting or clothing.${p.wardrobeEn ? ` Wardrobe: ${p.wardrobeEn}.` : " Dress them naturally for the scene."}`
        : `${role} = the character in image ${n} (character card): keep the same face, hairstyle and outfit.${p.wardrobeEn ? ` Wardrobe: ${p.wardrobeEn}.` : ""} Do not copy the card's background or framing.`,
    );
  });
  lines.push(`ACTION: ${input.actionText.trim()}`);
  lines.push("INTEGRATION: match each person's scale to the scene's perspective and ground plane, light them with the base photo's own light sources (same color temperature, direction and falloff), add correct contact shadows, wet-surface reflections and weather interaction, matching grain, sharpness and lens blur.");
  if (input.relightText?.trim()) lines.push(`RELIGHT: ${input.relightText.trim()} Keep the geometry of image 1 unchanged while relighting.`);
  lines.push("No text, no subtitles, no watermark, no added logos.");
  return lines.join("\n");
}

/** 提交给改图接口的参考图数组（底图在前，人物按 slot 顺序）。 */
export function stockPhotoPersonEditReferenceOrder(baseGcsUri: string, people: ReadonlyArray<Pick<StockPhotoPersonEditPerson, "source">>): string[] {
  return [baseGcsUri, ...people.map(p => p.source)];
}

/** 前台「放入人物重绘」可用的人物来源（由业务方传入：MV 演唱者/主锚图、女主定妆帧等）。 */
export type StockPhotoPersonEditCastOption = { slot: StockPhotoPersonEditSlot; source: string; label: string; identityPhoto: boolean; wardrobeEn?: string; roleEn?: string };

/** 按 cast 取人物；缺哪个就返回中文原因（按钮置灰用）。 */
export function pickStockPhotoPersonEditPeople(cast: StockPhotoPersonEditCast, options: ReadonlyArray<StockPhotoPersonEditCastOption>): { people: StockPhotoPersonEditPerson[] } | { missingZh: string } {
  const need: StockPhotoPersonEditSlot[] = cast === "both" ? ["lead", "partner"] : [cast];
  const people: StockPhotoPersonEditPerson[] = [];
  for (const slot of need) {
    const o = options.find(x => x.slot === slot);
    if (!o) return { missingZh: `还没有${STOCK_PHOTO_PERSON_EDIT_CAST_LABEL_ZH[slot]}的人物参考` };
    people.push({ slot, source: o.source, identityPhoto: o.identityPhoto, ...(o.roleEn ? { roleEn: o.roleEn } : {}), ...(o.wardrobeEn ? { wardrobeEn: o.wardrobeEn } : {}) });
  }
  return { people };
}
