/**
 * 漫剧 3D 资产记录（PR-3 · Lux3D 资产链）。
 *
 * 只描述“一个已经落在我们存储里的 GLB 是什么、验到哪一步、有没有被采用”，
 * 不描述生成任务本身：生成/导入任务仍由 server/services/manhua3dTask.ts 负责，
 * 本记录通过 sourceJobId（m3d_*）挂在那条任务上，与 previsRiggedModelSchema.sourceJobId 同源。
 *
 * 铁律：
 * - 单位与轴向只能由用户或元数据显式给出，解析器不猜；缺失即 unverified。
 * - 有 skin 不等于兼容现有绑骨入口；兼容与否按 PREVIS_BODY_BONES 精确比对。
 * - 旧草稿没有该字段时一律视为“无资产”，normalize 返回 undefined。
 */
import { z } from "zod";
import { PREVIS_BODY_BONES } from "./manhuaPrevisRig.js";

export const MANHUA_3D_ASSET_SOURCES = ["lux3d_local", "upload", "unknown"] as const;
export const MANHUA_3D_ASSET_UNITS = ["m", "cm"] as const;
export const MANHUA_3D_ASSET_AXES = ["y_up", "z_up"] as const;
export const MANHUA_3D_ASSET_VERIFICATION_STATUSES = ["unverified", "verified", "rejected"] as const;
export const MANHUA_3D_ASSET_LUX3D_REGIONS = ["cn", "international"] as const;

export type Manhua3dAssetSource = (typeof MANHUA_3D_ASSET_SOURCES)[number];
export type Manhua3dAssetUnits = (typeof MANHUA_3D_ASSET_UNITS)[number];
export type Manhua3dAssetAxis = (typeof MANHUA_3D_ASSET_AXES)[number];
export type Manhua3dAssetVerificationStatus = (typeof MANHUA_3D_ASSET_VERIFICATION_STATUSES)[number];

const ASSET_ID_PATTERN = /^m3da_[a-zA-Z0-9_.-]{1,150}$/;
const SOURCE_JOB_ID_PATTERN = /^m3d_[a-zA-Z0-9_.-]{1,150}$/;
const shortText = z.string().trim().min(1).max(160);
const boneName = z.string().trim().min(1).max(128);
const isoDate = z.string().datetime({ offset: true });

/** GLB 引用：长期身份是 gs://；本地导入路径只用于尚未转存的本机插件产物。 */
export const manhua3dAssetGlbRefSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("gcs"),
      gcsUri: z.string().trim().regex(/^gs:\/\/[^/\s]+\/.+$/, "GLB 引用必须是 gs:// 地址"),
      sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      bytes: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("local_import"),
      path: z.string().trim().min(1).max(1_024),
      sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      bytes: z.number().int().nonnegative().optional(),
    })
    .strict(),
]);

export const manhua3dAssetGeometrySchema = z
  .object({
    nodeCount: z.number().int().nonnegative(),
    meshCount: z.number().int().nonnegative(),
    primitiveCount: z.number().int().nonnegative(),
    animationCount: z.number().int().nonnegative(),
    generator: z.string().trim().max(200).optional(),
    extensionsRequired: z.array(z.string().trim().min(1).max(120)).max(32).default([]),
  })
  .strict();

export const manhua3dAssetSkeletonSchema = z
  .object({
    hasArmature: z.boolean(),
    skinCount: z.number().int().nonnegative(),
    boneNames: z.array(boneName).max(512),
    /** 是否能直接喂给现有 previsRiggedModelSchema 绑骨入口（16 根标准骨全部命中）。 */
    previsRigCompatible: z.boolean(),
    matchedPrevisBones: z.array(z.enum(PREVIS_BODY_BONES)).max(PREVIS_BODY_BONES.length),
    missingPrevisBones: z.array(z.enum(PREVIS_BODY_BONES)).max(PREVIS_BODY_BONES.length),
  })
  .strict();

export const manhua3dAssetMaterialSummarySchema = z
  .object({
    materialCount: z.number().int().nonnegative(),
    textureCount: z.number().int().nonnegative(),
    imageCount: z.number().int().nonnegative(),
    pbrMaterialCount: z.number().int().nonnegative(),
    materialNames: z.array(z.string().trim().max(128)).max(64),
  })
  .strict();

export const manhua3dAssetVerificationSchema = z
  .object({
    status: z.enum(MANHUA_3D_ASSET_VERIFICATION_STATUSES),
    /** rejected 必填；unverified 用于说明缺什么；verified 可省。 */
    reasonZh: z.string().trim().max(400).optional(),
    checkedAt: isoDate.optional(),
  })
  .strict()
  .refine(v => v.status !== "rejected" || Boolean(v.reasonZh), "被拒的资产必须写明原因");

export const manhua3dAssetLux3dRefSchema = z
  .object({
    region: z.enum(MANHUA_3D_ASSET_LUX3D_REGIONS),
    /** 插件合同 task-metadata：taskId 为精确十进制字符串。 */
    taskId: z.string().regex(/^\d{1,40}$/),
  })
  .strict();

export const manhua3dAssetRecordSchema = z
  .object({
    assetId: z.string().regex(ASSET_ID_PATTERN),
    revision: z.number().int().min(1),
    source: z.enum(MANHUA_3D_ASSET_SOURCES),
    /** 挂靠的既有 3D 任务（生成或导入），是现有绑骨入口认的身份。 */
    sourceJobId: z.string().regex(SOURCE_JOB_ID_PATTERN).optional(),
    assetRef: shortText.optional(),
    lux3d: manhua3dAssetLux3dRefSchema.optional(),
    glb: manhua3dAssetGlbRefSchema,
    /** 显式给出才有；不猜。 */
    units: z.enum(MANHUA_3D_ASSET_UNITS).optional(),
    axis: z.enum(MANHUA_3D_ASSET_AXES).optional(),
    geometry: manhua3dAssetGeometrySchema.optional(),
    skeleton: manhua3dAssetSkeletonSchema.optional(),
    materials: manhua3dAssetMaterialSummarySchema.optional(),
    verification: manhua3dAssetVerificationSchema,
    adoptedAt: isoDate.optional(),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict()
  .superRefine((record, ctx) => {
    if (record.source === "lux3d_local" && !record.lux3d) {
      ctx.addIssue({ code: "custom", path: ["lux3d"], message: "来源为 Lux3D 时必须带 region 与 taskId" });
    }
    if (record.verification.status === "verified") {
      if (!record.units) ctx.addIssue({ code: "custom", path: ["units"], message: "已验证资产必须显式单位" });
      if (!record.axis) ctx.addIssue({ code: "custom", path: ["axis"], message: "已验证资产必须显式轴向" });
      if (!record.geometry) ctx.addIssue({ code: "custom", path: ["geometry"], message: "已验证资产必须有几何统计" });
    }
    if (record.adoptedAt && record.verification.status !== "verified") {
      ctx.addIssue({ code: "custom", path: ["adoptedAt"], message: "只有已验证的资产才能被采用" });
    }
  });

export type Manhua3dAssetGlbRef = z.infer<typeof manhua3dAssetGlbRefSchema>;
export type Manhua3dAssetGeometry = z.infer<typeof manhua3dAssetGeometrySchema>;
export type Manhua3dAssetSkeleton = z.infer<typeof manhua3dAssetSkeletonSchema>;
export type Manhua3dAssetMaterialSummary = z.infer<typeof manhua3dAssetMaterialSummarySchema>;
export type Manhua3dAssetVerification = z.infer<typeof manhua3dAssetVerificationSchema>;
export type Manhua3dAssetRecord = z.infer<typeof manhua3dAssetRecordSchema>;

/**
 * 按 PREVIS_BODY_BONES 精确比对骨名。只有 16 根全部命中才算兼容；
 * 大小写或前缀差异一律算缺失——映射是人做的事，不在这里猜。
 */
export function evaluatePrevisRigCompatibility(boneNames: readonly string[]): Pick<
  Manhua3dAssetSkeleton,
  "previsRigCompatible" | "matchedPrevisBones" | "missingPrevisBones"
> {
  const present = new Set(boneNames.map(v => String(v || "").trim()).filter(Boolean));
  const matched = PREVIS_BODY_BONES.filter(b => present.has(b));
  const missing = PREVIS_BODY_BONES.filter(b => !present.has(b));
  return {
    previsRigCompatible: missing.length === 0,
    matchedPrevisBones: [...matched],
    missingPrevisBones: [...missing],
  };
}

/** 旧草稿 / 坏数据一律返回 undefined，即“无资产”；绝不构造半个资产。 */
export function normalizeManhua3dAssetRecord(raw: unknown): Manhua3dAssetRecord | undefined {
  const parsed = manhua3dAssetRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Lux3D 服务端能力：不可用是真实状态，带原因码；可用时也只表示“能续查”，不表示可提交付费任务。 */
export const MANHUA_3D_LUX3D_UNAVAILABLE_REASONS = [
  "no_server_credentials",
  "adapter_not_wired",
] as const;
export type Manhua3dLux3dUnavailableReason = (typeof MANHUA_3D_LUX3D_UNAVAILABLE_REASONS)[number];

export const manhua3dLux3dCapabilitySchema = z.discriminatedUnion("available", [
  z
    .object({
      available: z.literal(false),
      reasonCode: z.enum(MANHUA_3D_LUX3D_UNAVAILABLE_REASONS),
      reasonZh: z.string().trim().min(1).max(200),
      importFallback: z.literal(true),
    })
    .strict(),
  z
    .object({
      available: z.literal(true),
      regions: z.array(z.enum(MANHUA_3D_ASSET_LUX3D_REGIONS)).min(1),
      /** 只承诺续查已有任务；新生成需单独授权，不在本能力里表达。 */
      canResumeTasks: z.literal(true),
      canSubmitGeneration: z.literal(false),
      importFallback: z.literal(true),
    })
    .strict(),
]);
export type Manhua3dLux3dCapability = z.infer<typeof manhua3dLux3dCapabilitySchema>;
