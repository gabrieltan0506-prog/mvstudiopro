/** 标准带骨模型只能按本人已保存的3D任务读取；客户端不传下载地址或本地路径。 */
import { z } from "zod";
export const PREVIS_BODY_BONES = [
  "pelvis",
  "spine",
  "neck",
  "head",
  "upper_arm-1",
  "forearm-1",
  "hand-1",
  "upper_arm1",
  "forearm1",
  "hand1",
  "upper_leg-1",
  "lower_leg-1",
  "foot-1",
  "upper_leg1",
  "lower_leg1",
  "foot1",
] as const;
const name = z.string().trim().min(1).max(128);
const expression = z
  .record(name, z.number().finite().min(0).max(1))
  .refine(
    value =>
      Object.keys(value).length > 0 &&
      Object.keys(value).length <= 16 &&
      Object.values(value).some(n => n > 0),
    "每种表情须映射1至16个真实形变且不能全部为零"
  );
export const previsControllerSchema = z
  .object({
    eyeBones: z
      .object({ left: name, right: name })
      .strict()
      .refine(v => v.left !== v.right, "左右眼骨不能相同"),
    expressions: z
      .object({ calm: expression, tense: expression, surprised: expression })
      .strict(),
  })
  .strict();
export const previsPerformanceCueSchema = z
  .object({
    startSec: z.number().finite().min(0).max(30),
    endSec: z.number().finite().positive().max(30),
    gazeTarget: z.tuple([
      z.number().finite().min(-30).max(30),
      z.number().finite().min(-30).max(30),
      z.number().finite().min(-30).max(30),
    ]),
    headYawDeg: z.number().finite().min(-35).max(35),
    headPitchDeg: z.number().finite().min(-20).max(20),
    breathAmplitude: z.number().finite().min(0).max(0.03),
    breathHz: z.number().finite().min(0.1).max(0.6),
    expression: z.enum(["calm", "tense", "surprised"]),
    intensity: z.number().finite().min(0).max(1),
  })
  .strict();
export const previsRiggedModelSchema = z
  .object({
    sourceJobId: z.string().regex(/^m3d_[a-zA-Z0-9_.-]{1,150}$/),
    forwardAxis: z.enum(["+X", "-X", "+Y", "-Y"]),
    targetHeight: z.number().finite().min(0.5).max(3),
    boneMap: z.partialRecord(z.enum(PREVIS_BODY_BONES), name).optional(),
    performance: z
      .object({
        controller: previsControllerSchema,
        cues: z.array(previsPerformanceCueSchema).min(1).max(24),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PrevisRiggedModel = z.infer<typeof previsRiggedModelSchema>;
