import { getDb } from "./db";
import { stripeAuditLogs } from "../drizzle/schema";

/**
 * Stripe 审计日志工具
 * 
 * 记录所有 Stripe 相关操作，用于合规审计和问题排查。
 */

export interface AuditLogEntry {
  userId?: number | null;
  eventType: string;
  eventId?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  action: string;
  status?: "success" | "failed" | "pending";
  amount?: number | null;
  currency?: string;
  metadata?: Record<string, unknown> | null;
  errorMessage?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * 写入审计日志
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    await db.insert(stripeAuditLogs).values({
      userId: entry.userId ?? null,
      eventType: entry.eventType,
      eventId: entry.eventId ?? null,
      stripeCustomerId: entry.stripeCustomerId ?? null,
      stripeSubscriptionId: entry.stripeSubscriptionId ?? null,
      action: entry.action,
      status: entry.status ?? "success",
      amount: entry.amount ?? null,
      currency: entry.currency ?? "usd",
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      errorMessage: entry.errorMessage ?? null,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
    });
  } catch (err) {
    // 审计日志写入失败不应阻塞主流程
    console.error("[audit] Failed to write audit log:", err);
  }
}

/**
 * 批量写入审计日志
 */
export async function writeAuditLogs(entries: AuditLogEntry[]): Promise<void> {
  try {
    const db = await getDb();
    if (!db || entries.length === 0) return;

    await db.insert(stripeAuditLogs).values(
      entries.map((entry) => ({
        userId: entry.userId ?? null,
        eventType: entry.eventType,
        eventId: entry.eventId ?? null,
        stripeCustomerId: entry.stripeCustomerId ?? null,
        stripeSubscriptionId: entry.stripeSubscriptionId ?? null,
        action: entry.action,
        status: entry.status ?? "success",
        amount: entry.amount ?? null,
        currency: entry.currency ?? "usd",
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
        errorMessage: entry.errorMessage ?? null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      }))
    );
  } catch (err) {
    console.error("[audit] Failed to write batch audit logs:", err);
  }
}
