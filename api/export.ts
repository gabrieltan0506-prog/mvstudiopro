import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exportSnapshotImageToPDF, exportToPDF, exportToWord } from "../server/storyboard-export.js";
import { USAGE_LIMITS, clientIpOf, consumeUsage } from "../server/_core/usageLimits.js";
import { isOwnedResourceUrl, ownedResourcePolicy } from "../server/services/ownedResourceUrl.js";
import { logAndSanitizeUpstreamError } from "../shared/upstreamErrorForClient.js";

/**
 * 分镜 / 报告导出（storyboard-pdf / storyboard-docx / analysis-page-pdf）。
 *
 * 1111 收口：原先匿名可调、服务端代取任意图片地址（SSRF）、写存储、客户端传 isPaidUser 即可去水印。
 * - 须登录（前台唯一调用点 /workflow「分镜导出」，用户本来就在登录态下使用）
 * - 用量闸门 USAGE_LIMITS.storyboardExport
 * - 图片地址只留本站与自有存储（ownedResourceUrl），其他略过不代取；跳转逐跳复核（storyboard-export）
 * - 水印只按服务端会员权益判定（resolveWatermark：付费 / 监管 / 已审核订单免水印），忽略客户端 isPaidUser
 * - 场次、图片数、文本长度设上限；失败不回上游原文
 */

export const EXPORT_MAX_SCENES = 60;
export const EXPORT_MAX_IMAGES_PER_SCENE = 8;
export const EXPORT_MAX_TEXT_CHARS = 4000;
export const EXPORT_MAX_SNAPSHOT_DATA_URL_CHARS = 20 * 1024 * 1024;

function jparse(t: string): any { try { return JSON.parse(t); } catch { return null; } }
function getBody(req: VercelRequest): any {
  const b: any = (req as any).body;
  if (!b) return {};
  if (typeof b === "string") return jparse(b) ?? {};
  return b;
}
function s(v: any): string { if (v == null) return ""; if (Array.isArray(v)) return String(v[0] ?? ""); return String(v); }
function cap(v: any, max = EXPORT_MAX_TEXT_CHARS): string { return s(v).trim().slice(0, max); }

async function resolveExportUser(req: VercelRequest): Promise<{ userId: number; role: string } | "unavailable" | null> {
  try {
    const { sdk } = await import("../server/_core/sdk.js");
    const user = await sdk.authenticateRequest(req as any, { silentMissing: true });
    const userId = Number((user as any)?.id);
    if (!Number.isFinite(userId) || userId <= 0) return null;
    return { userId, role: String((user as any)?.role || "") };
  } catch (error) {
    return Number((error as any)?.statusCode) >= 500 ? "unavailable" : null;
  }
}

async function shouldWatermark(userId: number, role: string): Promise<boolean> {
  const isAdminUser = role === "admin" || role === "supervisor";
  if (isAdminUser) return false;
  try {
    const { resolveWatermark } = await import("../server/services/tier-provider-routing.js");
    return await resolveWatermark(userId, false);
  } catch (error) {
    console.warn("[export] 会员权益查询失败，按有水印处理", error);
    return true;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const q: any = req.query || {};
    const b = getBody(req);
    const op = s(q.op || b.op).trim().toLowerCase();
    if (op !== "storyboard-pdf" && op !== "storyboard-docx" && op !== "analysis-page-pdf") {
      return res.status(400).json({ ok: false, error: "unsupported_op" });
    }

    const viewer = await resolveExportUser(req);
    if (viewer === "unavailable") return res.status(503).json({ ok: false, error: "service_unavailable", message: "服务暂时不可用，请稍后重试" });
    if (!viewer) return res.status(401).json({ ok: false, error: "authentication_required", message: "请先登录后再导出" });

    const usage = consumeUsage(USAGE_LIMITS.storyboardExport, [`u:${viewer.userId}`, `ip:${clientIpOf(req as any)}`]);
    if (!usage.ok) {
      res.setHeader("Retry-After", String(usage.retryAfterSec));
      return res.status(429).json({ ok: false, error: "rate_limited", message: usage.message });
    }

    if (op === "analysis-page-pdf") {
      const title = cap(b.title, 200) || "MV Analysis Export";
      const imageDataUrl = s(b.imageDataUrl).trim();
      if (!imageDataUrl) return res.status(400).json({ ok: false, error: "image_data_required" });
      if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(imageDataUrl)) {
        return res.status(400).json({ ok: false, error: "image_data_invalid", message: "只接受页面截图数据" });
      }
      if (imageDataUrl.length > EXPORT_MAX_SNAPSHOT_DATA_URL_CHARS) {
        return res.status(413).json({ ok: false, error: "image_data_too_large", message: "截图过大，请缩小后重试" });
      }
      const result = await exportSnapshotImageToPDF({ title, imageDataUrl });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=\"creator-growth-camp-analysis.pdf\"`);
      return res.status(200).send(result.buffer);
    }

    const scenesInput = Array.isArray(b.scenes) ? b.scenes : [];
    if (!scenesInput.length) return res.status(400).json({ ok: false, error: "scenes are required" });
    if (scenesInput.length > EXPORT_MAX_SCENES) {
      return res.status(400).json({ ok: false, error: "too_many_scenes", message: `单次最多导出 ${EXPORT_MAX_SCENES} 个场次` });
    }

    const policy = ownedResourcePolicy();
    let skippedImages = 0;
    const ownedImages = (raw: unknown): string[] => {
      const list = (Array.isArray(raw) ? raw : []).map((value: any) => s(value).trim()).filter(Boolean).slice(0, EXPORT_MAX_IMAGES_PER_SCENE);
      const kept = list.filter((url) => isOwnedResourceUrl(url, policy));
      skippedImages += list.length - kept.length;
      return kept;
    };

    const storyboard = {
      title: cap(b.title, 200) || "Storyboard Export",
      musicInfo: {
        bpm: Number(b.musicBpm || 110) || 110,
        emotion: cap(b.musicMood, 120) || "cinematic",
        style: cap(b.musicStyle, 120) || "trailer",
        key: cap(b.musicKey, 40) || "C minor",
      },
      scenes: scenesInput.map((scene: any, idx: number) => {
        const imageUrls = ownedImages(scene?.imageUrls);
        const duration = Number(scene?.duration || 8) || 8;
        return {
          sceneNumber: Number(scene?.sceneIndex || idx + 1),
          timestamp: `Scene ${Number(scene?.sceneIndex || idx + 1)}`,
          duration: `${duration}s`,
          description: cap(scene?.scenePrompt || scene?.description),
          cameraMovement: cap(scene?.camera || scene?.cameraMovement, 200) || "medium",
          mood: cap(scene?.mood, 200) || "cinematic",
          visualElements: [
            cap(scene?.character, 1000),
            cap(scene?.environment, 1000),
            cap(scene?.action, 1000),
            cap(scene?.lighting, 1000),
          ].filter(Boolean),
          transition: cap(scene?.transition, 200) || undefined,
          previewImageUrl: imageUrls[0] || null,
          previewImageUrls: imageUrls,
        };
      }),
      summary: cap(b.script, 20_000) || "Storyboard export generated from workflow.",
    };
    if (skippedImages > 0) console.warn(`[export] user=${viewer.userId} 略过 ${skippedImages} 张站外图片地址（不代取）`);

    // 水印只看服务端会员权益；客户端 isPaidUser 一律忽略
    const addWatermark = await shouldWatermark(viewer.userId, viewer.role);
    const result = op === "storyboard-docx"
      ? await exportToWord(storyboard, { addWatermark })
      : await exportToPDF(storyboard, { addWatermark });

    return res.status(200).json({
      ok: true,
      url: result.url,
      message: skippedImages > 0 ? `${result.message || "导出完成"}（${skippedImages} 张站外图片未纳入）` : result.message,
      skippedImages,
    });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: "export_failed", message: logAndSanitizeUpstreamError("api/export", error, { fallback: "导出失败，请稍后重试" }) });
  }
}
