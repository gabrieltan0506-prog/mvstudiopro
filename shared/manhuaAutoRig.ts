import { z } from "zod";
import type { ManhuaAsset3dRef } from "./manhuaAsset3d";

/** 校正点采用标准人物坐标：X朝前、Y朝人物左侧、Z朝上，单位米。 */
export const AUTO_RIG_JOINTS = [
  "pelvis",
  "waist",
  "chest",
  "neck",
  "headTop",
  "shoulderL",
  "elbowL",
  "wristL",
  "handTipL",
  "shoulderR",
  "elbowR",
  "wristR",
  "handTipR",
  "hipL",
  "kneeL",
  "ankleL",
  "toeL",
  "hipR",
  "kneeR",
  "ankleR",
  "toeR",
] as const;
export type AutoRigJoint = (typeof AUTO_RIG_JOINTS)[number];
export const AUTO_RIG_LABELS: Record<AutoRigJoint, string> = {
  pelvis: "骨盆底",
  waist: "腰部",
  chest: "胸部",
  neck: "颈部",
  headTop: "头顶",
  shoulderL: "左肩",
  elbowL: "左肘",
  wristL: "左腕",
  handTipL: "左手尖",
  shoulderR: "右肩",
  elbowR: "右肘",
  wristR: "右腕",
  handTipR: "右手尖",
  hipL: "左髋",
  kneeL: "左膝",
  ankleL: "左踝",
  toeL: "左脚尖",
  hipR: "右髋",
  kneeR: "右膝",
  ankleR: "右踝",
  toeR: "右脚尖",
};
export const AUTO_RIG_BONES = {
  pelvis: ["pelvis", "waist"],
  spine: ["waist", "chest"],
  neck: ["chest", "neck"],
  head: ["neck", "headTop"],
  upper_arm1: ["shoulderL", "elbowL"],
  forearm1: ["elbowL", "wristL"],
  hand1: ["wristL", "handTipL"],
  "upper_arm-1": ["shoulderR", "elbowR"],
  "forearm-1": ["elbowR", "wristR"],
  "hand-1": ["wristR", "handTipR"],
  upper_leg1: ["hipL", "kneeL"],
  lower_leg1: ["kneeL", "ankleL"],
  foot1: ["ankleL", "toeL"],
  "upper_leg-1": ["hipR", "kneeR"],
  "lower_leg-1": ["kneeR", "ankleR"],
  "foot-1": ["ankleR", "toeR"],
} as const satisfies Record<string, readonly [AutoRigJoint, AutoRigJoint]>;
export const autoRigPointSchema = z.tuple([
  z.number().finite().min(-10).max(10),
  z.number().finite().min(-10).max(10),
  z.number().finite().min(-10).max(10),
]);
export const autoRigJointsSchema = z
  .object(
    Object.fromEntries(
      AUTO_RIG_JOINTS.map(key => [key, autoRigPointSchema])
    ) as Record<AutoRigJoint, typeof autoRigPointSchema>
  )
  .strict();
export type AutoRigJoints = z.infer<typeof autoRigJointsSchema>;
export const autoRigSettingsSchema = z
  .object({
    pose: z.enum(["A", "T"]),
    forwardAxis: z.enum(["+X", "-X", "+Y", "-Y"]),
    targetHeight: z.number().finite().min(0.5).max(3),
  })
  .strict();
export type AutoRigSettings = z.infer<typeof autoRigSettingsSchema>;
const identity = {
  requestId: z.string().uuid(),
  assetRef: z.string().trim().min(1).max(160),
  sourceJobId: z.string().regex(/^m3d_[a-zA-Z0-9_.-]{1,150}$/),
  settings: autoRigSettingsSchema,
};
export const autoRigRequestSchema = z.discriminatedUnion("stage", [
  z.object({ ...identity, stage: z.literal("inspect") }).strict(),
  z
    .object({
      ...identity,
      stage: z.literal("bind"),
      inspectionRequestId: z.string().uuid(),
      sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
      joints: autoRigJointsSchema,
      singleHuman: z.literal(true),
      landmarksManuallyConfirmed: z.literal(true),
    })
    .strict(),
]);
export type AutoRigRequest = z.infer<typeof autoRigRequestSchema>;
export const autoRigProxyInfoSchema = z
  .object({
    enabled: z.boolean(),
    originalVertices: z.number().int().positive(),
    proxyVertices: z.number().int().positive().optional(),
    decimateRatio: z.number().finite().optional(),
    joinedParts: z.number().int().positive().optional(),
    proxyIslands: z.number().int().positive().optional(),
    proxyDroppedVertices: z.number().int().nonnegative().optional(),
    originalMaterials: z.number().int().nonnegative().optional(),
    originalUvLayers: z.number().int().nonnegative().optional(),
    decimated: z.boolean().optional(),
    remeshed: z.boolean().optional(),
    weldedVertices: z.number().int().nonnegative().optional(),
    voxelSize: z.number().finite().optional(),
  })
  .strict();
export type AutoRigProxyInfo = z.infer<typeof autoRigProxyInfoSchema>;
export const autoRigInspectionSchema = z
  .object({
    version: z.literal(1),
    stage: z.literal("inspect"),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    vertices: z.number().int().min(100).max(50_000),
    bounds: z.tuple([autoRigPointSchema, autoRigPointSchema]),
    joints: autoRigJointsSchema,
    settings: autoRigSettingsSchema,
    limitations: z.array(z.string()).min(1).max(10),
    /** 0916 低模绑骨：原模超限时的代理信息（vertices 记的是代理顶点数） */
    weightTransfer: autoRigProxyInfoSchema.optional(),
    /** 0916 朝向自检：forwardAxis 选反 180° 时合同检查全过但左右骨互换；这里只警告不阻断 */
    orientationCheck: z
      .object({
        suspect: z.boolean(),
        feetForwardMeters: z.number().finite(),
        depthMeters: z.number().finite().nonnegative(),
        widthMeters: z.number().finite().nonnegative(),
        reasons: z.array(z.string()).max(4),
        /** 0917：噪声线与「无法从脚判朝向」提示；旧回执没有这两项 */
        noiseFloorMeters: z.number().finite().nonnegative().optional(),
        notes: z.array(z.string()).max(4).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type AutoRigInspection = z.infer<typeof autoRigInspectionSchema>;
export function autoRigLandmarks(joints: AutoRigJoints) {
  return Object.fromEntries(
    Object.entries(AUTO_RIG_BONES).map(([bone, [head, tail]]) => [
      bone,
      [joints[head], joints[tail]],
    ])
  );
}

export type AutoRigView = {
  jobId: string;
  status: string;
  params: AutoRigRequest;
  error: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  output: null | {
    stage: "inspect" | "bind";
    requestId: string;
    sourceJobId: string;
    assetRef: string;
    sourceSha256: string;
    sourceDigest: string;
    gcsUri: string;
    sha256: string;
    bytes: number;
    url: string;
    inspection?: AutoRigInspection;
    previewUrls?: string[];
    qualityAccepted: false;
    reportGcsUri: string;
    /** 0916 低模绑骨：带骨原模（画质/三视角参考）；model.glb 是白模用的中模 */
    fullGlb?: { gcsUri: string; sha256: string; bytes: number; url?: string };
    weightTransfer?: Record<string, unknown>;
  };
};
export type AutoRigAdoptedModel = Omit<ManhuaAsset3dRef, "updatedAt"> & {
  assetRef: string;
  updatedAt: string;
};
