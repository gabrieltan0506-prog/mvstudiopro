import { createHmac } from "node:crypto";
import {
  makePublicTemplateId,
  type ManhuaViralTemplateCard,
} from "../../shared/manhuaViralTemplateBank.js";

const PERSISTED_PUBLIC_CODE_RE = /^[A-Z0-9]{4,8}$/;

/**
 * 稳定公开句柄：存量随机 publicCode 永远优先；无码卡仅在配置专用密钥后使用 HMAC。
 * 内部 id 不进入返回值，也不能由公开句柄反推。
 */
export function resolveStableManhuaTemplatePublicCode(
  card: Pick<ManhuaViralTemplateCard, "id" | "publicCode">,
  secret = process.env.MANHUA_TEMPLATE_PUBLIC_ID_SECRET,
): string | null {
  const persisted = String(card.publicCode || "").trim().toUpperCase();
  if (PERSISTED_PUBLIC_CODE_RE.test(persisted)) return persisted;
  const normalizedSecret = String(secret || "").trim();
  const internalId = String(card.id || "").trim();
  if (!normalizedSecret || !internalId) return null;
  return createHmac("sha256", normalizedSecret)
    .update(internalId, "utf8")
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
}

export function makeStableManhuaTemplatePublicId(
  card: Pick<ManhuaViralTemplateCard, "id" | "publicCode">,
  secret = process.env.MANHUA_TEMPLATE_PUBLIC_ID_SECRET,
): string | null {
  const code = resolveStableManhuaTemplatePublicCode(card, secret);
  return code ? makePublicTemplateId(code) : null;
}
