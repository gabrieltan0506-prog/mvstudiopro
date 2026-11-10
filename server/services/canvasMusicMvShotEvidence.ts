/**
 * MV 镜头成片任务的供应商回执永久证据（1109）。
 *
 * 规则（product-guardrails §视频/模型 JSON 永久证据）：提交回执与终态回执都在解析前先落原始 JSON，
 * 解析后另存；只增不删，失败/拒收/重试/重启不触发清理。
 * 对象路径：canvas-music-mv/evidence/<userId>/<planRequestId>/shots/<shotId>/<taskId>/{submit,terminal}-<provider>-{raw,parsed}.json
 *（BytePlus 拒后回落 EvoLink 时两家回执各自保留，不覆盖）。
 * （与分镜证据同前缀，`server/routers/canvasMusicMv.ts#prefix` 的 `canvas-music-mv/evidence/<userId>/<requestId>`）。
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { getGcsBucketName, uploadBufferToGcsIfAbsent } from "./gcs";

export const mvShotTaskIdentitySchema = z
  .object({
    planRequestId: z.string().uuid(),
    shotId: z.string().trim().min(1).max(100),
    /** 参考含真人实拍：通道直走不挡脸的供应商（kb/channels.md 视频节）。 */
    hasRealPerson: z.boolean().optional(),
    referenceCounts: z
      .object({ image: z.number().int().min(0), video: z.number().int().min(0), audio: z.number().int().min(0) })
      .strict()
      .optional(),
  })
  .strict();
export type MvShotTaskIdentity = z.infer<typeof mvShotTaskIdentitySchema>;

export function parseMvShotTaskIdentity(raw: unknown): MvShotTaskIdentity | undefined {
  if (raw == null) return undefined;
  const parsed = mvShotTaskIdentitySchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export type MvShotEvidenceObject = { objectName: string; bytes: number; sha256: string };
export type MvShotEvidencePair = { raw: MvShotEvidenceObject; parsed: MvShotEvidenceObject };

export type MvShotEvidenceDeps = {
  bucket: () => string;
  upload: (input: { bucket: string; objectName: string; buffer: Buffer; contentType: string }) => Promise<unknown>;
};

const realDeps: MvShotEvidenceDeps = {
  bucket: getGcsBucketName,
  upload: ({ bucket, objectName, buffer, contentType }) =>
    uploadBufferToGcsIfAbsent({ bucket, objectName, buffer, contentType }),
};

export function mvShotEvidencePrefix(userId: number | string, identity: MvShotTaskIdentity, taskId: string) {
  if (!/^[0-9]+$/.test(String(userId))) throw new Error("账号无法确认，请重新登录");
  const safeTask = String(taskId).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120);
  return `canvas-music-mv/evidence/${userId}/${identity.planRequestId}/shots/${identity.shotId}/${safeTask}`;
}

/**
 * 原始先落（body 原文不解析），再另存解析件；JSON 解析失败也落 `{invalidJson:true}` 不丢证据。
 * 同名对象已存在时不覆盖（uploadBufferToGcsIfAbsent），重复调用幂等。
 */
export async function persistMvShotReceipt(
  input: {
    userId: number | string;
    taskId: string;
    identity: MvShotTaskIdentity;
    phase: "submit" | "terminal";
    provider: string;
    receipt: { status: number; body: string };
  },
  deps: MvShotEvidenceDeps = realDeps,
): Promise<MvShotEvidencePair> {
  const prefix = mvShotEvidencePrefix(input.userId, input.identity, input.taskId);
  const bucket = deps.bucket();
  const write = async (name: string, value: unknown): Promise<MvShotEvidenceObject> => {
    const buffer = Buffer.from(JSON.stringify(value));
    await deps.upload({ bucket, objectName: name, buffer, contentType: "application/json" });
    return { objectName: name, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") };
  };
  const provider = String(input.provider).replace(/[^a-z0-9_-]/gi, "_") || "provider";
  const raw = await write(`${prefix}/${input.phase}-${provider}-raw.json`, {
    taskId: input.taskId,
    planRequestId: input.identity.planRequestId,
    shotId: input.identity.shotId,
    provider: input.provider,
    status: input.receipt.status,
    body: input.receipt.body,
    recordedAt: new Date().toISOString(),
  });
  let response: unknown;
  try {
    response = JSON.parse(input.receipt.body);
  } catch {
    response = { invalidJson: true };
  }
  const parsed = await write(`${prefix}/${input.phase}-${provider}-parsed.json`, {
    taskId: input.taskId,
    planRequestId: input.identity.planRequestId,
    shotId: input.identity.shotId,
    provider: input.provider,
    status: input.receipt.status,
    response,
    referenceCounts: input.identity.referenceCounts,
  });
  return { raw, parsed };
}
