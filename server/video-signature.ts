/**
 * Video Signature Service
 * 为 MV Studio 平台生成的视频嵌入 Hash 签名，用于 PK 评分时验证视频来源。
 *
 * 签名方案：
 * - 使用 HMAC-SHA256 对 (userId + videoUrl + timestamp + platformSecret) 生成签名
 * - 签名存储在数据库 video_signatures 表中
 * - PK 评分时通过 videoUrl 查询签名记录来验证来源
 *
 * 来源类型：
 * - original: 平台「分镜转视频」直接生成的视频
 * - remix: 外来视频在平台上进行二次创作后的视频
 */

import crypto from "crypto";
import { getDb } from "./db";
import { videoSignatures } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

const PLATFORM_SECRET = process.env.JWT_SECRET || "mvstudio-platform-secret";

/** 生成视频签名 Hash */
export function generateSignatureHash(userId: number, videoUrl: string): string {
  const payload = `${userId}:${videoUrl}:${Date.now()}:mvstudio-pro`;
  return crypto.createHmac("sha256", PLATFORM_SECRET).update(payload).digest("hex");
}

/** 为平台原创视频注册签名 */
export async function registerOriginalVideo(
  userId: number,
  videoUrl: string,
  videoGenerationId?: number
): Promise<{ signatureHash: string }> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const signatureHash = generateSignatureHash(userId, videoUrl);

  await db.insert(videoSignatures).values({
    userId,
    videoUrl,
    signatureHash,
    source: "original",
    videoGenerationId: videoGenerationId ?? null,
  });

  return { signatureHash };
}

/** 为二次创作视频注册签名 */
export async function registerRemixVideo(
  userId: number,
  videoUrl: string,
  originalVideoUrl?: string
): Promise<{ signatureHash: string }> {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  const signatureHash = generateSignatureHash(userId, videoUrl);

  await db.insert(videoSignatures).values({
    userId,
    videoUrl,
    signatureHash,
    source: "remix",
    originalVideoUrl: originalVideoUrl ?? null,
  });

  return { signatureHash };
}

/** 验证视频是否为平台视频（原创或二次创作） */
export async function verifyVideoSignature(
  videoUrl: string
): Promise<{
  verified: boolean;
  source?: "original" | "remix";
  userId?: number;
  signatureHash?: string;
}> {
  const db = await getDb();
  if (!db) return { verified: false };

  const records = await db
    .select()
    .from(videoSignatures)
    .where(eq(videoSignatures.videoUrl, videoUrl))
    .limit(1);

  if (records.length === 0) {
    return { verified: false };
  }

  const record = records[0];
  return {
    verified: true,
    source: record.source,
    userId: record.userId,
    signatureHash: record.signatureHash,
  };
}

/** 根据用户 ID 获取该用户所有已签名视频 */
export async function getUserSignedVideos(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(videoSignatures)
    .where(eq(videoSignatures.userId, userId))
    .orderBy(videoSignatures.createdAt);
}
