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
  };
};
export type AutoRigAdoptedModel = Omit<ManhuaAsset3dRef, "updatedAt"> & {
  assetRef: string;
  updatedAt: string;
};
