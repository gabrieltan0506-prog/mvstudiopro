/**
 * Creations & Favorites Router
 * 
 * Unified system for:
 * - Auto-recording all generations (idol, music, 3D, video, kling)
 * - User favorites/bookmarks management
 * - Retention policy enforcement
 * - Expiry reminders
 * - Interactive HTML export (单文件离线 + echarts.min.js inline，>10MB 自动 zip)
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { userCreations, userFavorites } from "../../drizzle/schema-creations";
import { eq, and, desc, sql, lt, lte, isNull, or, inArray } from "drizzle-orm";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

// ─── Types ────────────────────────────────────────────

const creationTypeSchema = z.enum([
  "idol_image", "idol_3d", "music", "video", "storyboard",
  "kling_video", "kling_lipsync", "kling_motion", "kling_image",
  // PR-3 新增：企业专属智能体（AaaS）每次推演调用记一条
  // 让客户在「我的作品」页能回溯历史 agent session
  "enterprise_agent_session",
]);

export type CreationType = z.infer<typeof creationTypeSchema>;

// ─── Retention Policy ─────────────────────────────────

/** Returns expiry date based on user plan */
export function getExpiryDate(plan: string): Date {
  const now = new Date();
  switch (plan) {
    case "enterprise":
      return new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000); // 6 months
    case "pro":
      return new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);  // 3 months
    default:
      return new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);  // 10 days
  }
}

/** Returns reminder threshold (days before expiry to remind) */
function getReminderThreshold(plan: string): number {
  switch (plan) {
    case "enterprise": return 30; // 30 days before
    case "pro": return 14;        // 14 days before
    default: return 8;            // 8 days (= 2 days after creation for 10-day retention)
  }
}

// ─── Helper: Record a creation ────────────────────────

export async function recordCreation(params: {
  userId: number;
  type: CreationType;
  title?: string;
  outputUrl?: string;
  secondaryUrl?: string;
  thumbnailUrl?: string;
  metadata?: Record<string, unknown>;
  quality?: string;
  creditsUsed?: number;
  plan?: string;
  status?: "pending" | "completed" | "failed";
  expiresAt?: Date;
}): Promise<number> {
  const expiresAt = params.expiresAt ?? getExpiryDate(params.plan ?? "free");
  const database = await db();
  const [row] = await database.insert(userCreations).values({
    userId: params.userId,
    type: params.type,
    title: params.title ?? null,
    outputUrl: params.outputUrl ?? null,
    secondaryUrl: params.secondaryUrl ?? null,
    thumbnailUrl: params.thumbnailUrl ?? null,
    metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    quality: params.quality ?? null,
    creditsUsed: params.creditsUsed ?? 0,
    status: params.status ?? "completed",
    expiresAt,
    expiryReminded: false,
  }).returning({ id: userCreations.id });
  return row?.id ?? 0;
}

// ─── Filename Sanitizer (HTML/zip 导出用) ───────────────
//
// 把 title 里的中英文 / 数字 / 横线 / 下划线保留，其余非法字符（路径分隔、
// 控制字符、emoji 等）全部替换成 -；最长截到 80。
function sanitizeFilename(name: string): string {
  return String(name || "report")
    // 1) 控制字符 + 路径非法字符（Win/Mac/Linux 公约最严格集）
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*\r\n\t]/g, "-")
    // 2) emoji（高低代理对）+ ZWJ + VS16，避免文件名乱码
    //    用 surrogate pair 正则，避免 u 标志（项目 tsconfig 没设 target，默认 ES3 不支持）
    .replace(/[\uD83C-\uDBFF][\uDC00-\uDFFF]/g, "")
    .replace(/[\u200d\ufe0f]/g, "")
    // 3) 空白 → -, 多个 - 折叠成一个，去头尾 .-
    .replace(/[\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80) || "report";
}

// ─── HTML 离线封面内联（exportInteractiveHtml 用） ──────
//
// 用户决策（2026-05-01）：HTML 下载也要带封面。如果 thumbnailUrl 是 HTTP 签名 URL，
// 离线打开 HTML 时签名会过期。这里把 HTTP URL 抓下来，转成 base64 data URI 内联进去，
// 保证 HTML 文件断网打开封面也能显示。
//
// 失败 fallback：保留原 URL（不会 break 现有行为，最多就是签名过期看不到封面而已）。
// 调用方传 tag 区分来源（exportInteractiveHtml / 其它），方便 fly 日志定位。
// 三态日志（成功 / 失败 / skip）都打 console.log，方便 Bug C 排查。
//
// 注：原 server-side PDF 模板路径 (deepResearch.exportBlackGoldPdf) 已下线，
// 客户端 DOM 快照模式直接渲染 <img>，浏览器自己会处理跨域 / 签名问题。
export async function inlineCoverIfHttp(
  url: string | undefined,
  tag: string = "exportInteractiveHtml",
): Promise<string | undefined> {
  if (!url) {
    console.log(`[${tag}] cover skip: input is empty/undefined`);
    return undefined;
  }
  if (url.startsWith("data:")) {
    console.log(`[${tag}] cover already data-uri (len=${url.length})`);
    return url;
  }
  if (!/^https?:\/\//i.test(url)) {
    console.log(`[${tag}] cover non-http url, kept as-is: ${url.slice(0, 60)}`);
    return url;
  }
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30_000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) {
      console.warn(`[${tag}] cover prefetch ${res.status} url=${url.slice(0, 80)}...`);
      return url;
    }
    const ab = await res.arrayBuffer();
    if (ab.byteLength > 8 * 1024 * 1024) {
      console.warn(`[${tag}] cover too large (${ab.byteLength}), keep URL`);
      return url;
    }
    const ct = res.headers.get("content-type") || "image/jpeg";
    const dataUri = `data:${ct};base64,${Buffer.from(ab).toString("base64")}`;
    console.log(`[${tag}] cover inlined ok bytes=${ab.byteLength} ct=${ct} elapsedMs=${Date.now() - t0}`);
    return dataUri;
  } catch (e: any) {
    console.warn(`[${tag}] cover prefetch error: ${e?.message} url=${url.slice(0, 80)}...`);
    return url;
  }
}

// ─── Router ───────────────────────────────────────────

export const creationsRouter = router({

  // ═══════════════════════════════════════════════════
  // List user's creations (with pagination & filtering)
  // ═══════════════════════════════════════════════════

  list: protectedProcedure
    .input(z.object({
      type: creationTypeSchema.optional(),
      status: z.enum(["pending", "completed", "failed", "expired"]).optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const offset = (input.page - 1) * input.pageSize;

      const conditions = [eq(userCreations.userId, userId)];
      if (input.type) conditions.push(eq(userCreations.type, input.type));
      if (input.status) conditions.push(eq(userCreations.status, input.status));

      const database = await db();
      const items = await database
        .select()
        .from(userCreations)
        .where(and(...conditions))
        .orderBy(desc(userCreations.createdAt))
        .limit(input.pageSize)
        .offset(offset);

      const [countResult] = await database
        .select({ count: sql<number>`COUNT(*)` })
        .from(userCreations)
        .where(and(...conditions));

      // Parse metadata JSON
      const parsed = items.map((item: any) => ({
        ...item,
        metadata: item.metadata ? JSON.parse(item.metadata) : null,
      }));

      return {
        items: parsed,
        total: countResult.count,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil(countResult.count / input.pageSize),
      };
    }),

  // ═══════════════════════════════════════════════════
  // Get single creation
  // ═══════════════════════════════════════════════════

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const database = await db();
      const [item] = await database
        .select()
        .from(userCreations)
        .where(and(
          eq(userCreations.id, input.id),
          eq(userCreations.userId, ctx.user.id),
        ));
      if (!item) return null;
      return {
        ...item,
        metadata: item.metadata ? JSON.parse(item.metadata) : null,
      };
    }),

  // ═══════════════════════════════════════════════════
  // Delete creation
  // ═══════════════════════════════════════════════════

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const database = await db();
      // Also remove from favorites
      await database.delete(userFavorites).where(
        and(eq(userFavorites.creationId, input.id), eq(userFavorites.userId, ctx.user.id))
      );
      await database.delete(userCreations).where(
        and(eq(userCreations.id, input.id), eq(userCreations.userId, ctx.user.id))
      );
      return { success: true };
    }),

  // ═══════════════════════════════════════════════════
  // Soft delete creation (failed reports cleanup)
  // ═══════════════════════════════════════════════════
  // 仅把 status 改为 "deleted"（schema 没有 deletedAt 字段，所以走 status 通道）。
  // myReports / list 等查询自动按 status != "deleted" 过滤。误删可由客服恢复。
  // 不物理 delete：保留 metadata 用于事故复盘 / 积分稽核。
  softDelete: protectedProcedure
    .input(z.object({ reportId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const database = await db();
      // ownership 校验：必须是当前用户的记录
      const [existing] = await database
        .select()
        .from(userCreations)
        .where(and(
          eq(userCreations.id, input.reportId),
          eq(userCreations.userId, ctx.user.id),
        ));
      if (!existing) {
        throw new Error("作品不存在或无权限");
      }
      if (existing.status === "deleted") {
        return { success: true, alreadyDeleted: true };
      }
      await database
        .update(userCreations)
        .set({
          status: "deleted",
          updatedAt: new Date(),
        })
        .where(and(
          eq(userCreations.id, input.reportId),
          eq(userCreations.userId, ctx.user.id),
        ));
      return { success: true, alreadyDeleted: false };
    }),

  // ═══════════════════════════════════════════════════
  // Favorites Management
  // ═══════════════════════════════════════════════════

  addFavorite: protectedProcedure
    .input(z.object({
      creationId: z.number(),
      note: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const database = await db();
      try {
        await database.insert(userFavorites).values({
          userId: ctx.user.id,
          creationId: input.creationId,
          note: input.note ?? null,
        });
      } catch (err: any) {
        // Duplicate entry - already favorited
        if (err.code === "ER_DUP_ENTRY") {
          return { success: true, alreadyFavorited: true };
        }
        throw err;
      }
      return { success: true, alreadyFavorited: false };
    }),

  removeFavorite: protectedProcedure
    .input(z.object({ creationId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const database = await db();
      await database.delete(userFavorites).where(
        and(eq(userFavorites.creationId, input.creationId), eq(userFavorites.userId, ctx.user.id))
      );
      return { success: true };
    }),

  listFavorites: protectedProcedure
    .input(z.object({
      type: creationTypeSchema.optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const offset = (input.page - 1) * input.pageSize;

      // Join favorites with creations
      const favConditions = [eq(userFavorites.userId, userId)];

      const database = await db();
      const favorites = await database
        .select({
          favoriteId: userFavorites.id,
          note: userFavorites.note,
          favoritedAt: userFavorites.createdAt,
          creation: userCreations,
        })
        .from(userFavorites)
        .innerJoin(userCreations, eq(userFavorites.creationId, userCreations.id))
        .where(and(
          ...favConditions,
          ...(input.type ? [eq(userCreations.type, input.type)] : []),
        ))
        .orderBy(desc(userFavorites.createdAt))
        .limit(input.pageSize)
        .offset(offset);

      const [countResult] = await database
        .select({ count: sql<number>`COUNT(*)` })
        .from(userFavorites)
        .innerJoin(userCreations, eq(userFavorites.creationId, userCreations.id))
        .where(and(
          ...favConditions,
          ...(input.type ? [eq(userCreations.type, input.type)] : []),
        ));

      return {
        items: favorites.map((f: any) => ({
          ...f,
          creation: {
            ...f.creation,
            metadata: f.creation.metadata ? JSON.parse(f.creation.metadata) : null,
          },
        })),
        total: countResult.count,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  // Check if a creation is favorited
  isFavorited: protectedProcedure
    .input(z.object({ creationId: z.number() }))
    .query(async ({ input, ctx }) => {
      const database = await db();
      const [fav] = await database
        .select()
        .from(userFavorites)
        .where(and(
          eq(userFavorites.creationId, input.creationId),
          eq(userFavorites.userId, ctx.user.id),
        ));
      return { favorited: !!fav };
    }),

  // Batch check favorites
  batchCheckFavorites: protectedProcedure
    .input(z.object({ creationIds: z.array(z.number()) }))
    .query(async ({ input, ctx }) => {
      if (input.creationIds.length === 0) return { favorites: {} };
      const database = await db();
      const favs = await database
        .select({ creationId: userFavorites.creationId })
        .from(userFavorites)
        .where(and(
          eq(userFavorites.userId, ctx.user.id),
          inArray(userFavorites.creationId, input.creationIds),
        ));
      const favMap: Record<number, boolean> = {};
      for (const f of favs) favMap[f.creationId] = true;
      return { favorites: favMap };
    }),

  // ═══════════════════════════════════════════════════
  // Retention & Expiry
  // ═══════════════════════════════════════════════════

  /** Get items that are expiring soon (for frontend banner) */
  getExpiringItems: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;
    const now = new Date();
    const reminderDate = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000); // 8 days from now

      const database = await db();
      const expiring = await database
        .select()
        .from(userCreations)
      .where(and(
        eq(userCreations.userId, userId),
        eq(userCreations.status, "completed"),
        lte(userCreations.expiresAt, reminderDate),
        sql`${userCreations.expiresAt} > NOW()`,
      ))
      .orderBy(userCreations.expiresAt)
      .limit(50);

    return {
      items: expiring.map((item: any) => ({
        ...item,
        metadata: item.metadata ? JSON.parse(item.metadata) : null,
        daysUntilExpiry: Math.ceil((new Date(item.expiresAt!).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
      })),
      count: expiring.length,
    };
  }),

  // ═══════════════════════════════════════════════════
  // 封面补生（PDF v2 客户端快照模式专用）
  // ═══════════════════════════════════════════════════
  //
  // 客户端在 MyReportsPage 进入阅读模式做 DOM 快照前，先调一次此 mutation：
  //   - 已有 thumbnailUrl 直接返回（幂等，避免重复消耗 nano banana 配额）
  //   - 缺失时 on-demand 调 Nano Banana 2 (flash) 补生 9:16 纯封面，写回 DB
  // 这样 React 重渲染后 cover 已经在 DOM 里，PDF 快照立刻包含封面。
  //
  // 与 server-side `exportBlackGoldPdf` 路径里的 ensureCoverForCreation 共用同一函数，
  // 唯一区别是这里通过 tRPC 暴露，并校验作品归属（exportInteractiveHtml 已经校验过）。
  ensureCover: protectedProcedure
    .input(z.object({
      creationId: z.number().int().positive(),
    }))
    .mutation(async ({ input, ctx }) => {
      const database = await db();
      const [row] = await database
        .select()
        .from(userCreations)
        .where(and(
          eq(userCreations.id, input.creationId),
          eq(userCreations.userId, ctx.user.id),
        ))
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "作品不存在或无权访问" });
      }
      let meta: any = {};
      try { meta = JSON.parse(row.metadata || "{}"); } catch {}
      const title = String(meta.lighthouseTitle || row.title || "战略情报报告").slice(0, 80);

      const { ensureCoverForCreation } = await import("../services/deepResearchService");
      const coverUrl = await ensureCoverForCreation(input.creationId, title);
      return {
        coverUrl: coverUrl ?? null,
      };
    }),

  // ═══════════════════════════════════════════════════
  // 交互版 HTML 导出（PDF 之外的第二条下载路径）
  // ═══════════════════════════════════════════════════
  //
  // 用户决策（原话）：
  //   "直接讓用戶下載 PDF 跟 HTML 的選項就好，除非檔案很大，超過 10 MB，
  //   在採用壓縮成 zip 下載。"
  //
  // 行为：
  //   - 取 userCreations 里的 reportMarkdown / title / thumbnail
  //   - 调 generateInteractiveHtml(...) 生成单文件 HTML（含 inline echarts.min.js）
  //   - <= 10 MB：直接返 dataUrl: data:text/html;base64,...
  //   - > 10 MB：jszip 压缩成 zip，返 dataUrl: data:application/zip;base64,...
  //   - 文件名：${title}-${pdfStyle}-${creationId}.html|.zip （去除非法字符）
  exportInteractiveHtml: protectedProcedure
    .input(z.object({
      creationId: z.number().int().positive(),
      pdfStyle: z.enum(["spring-mint", "neon-tech", "sunset-coral", "ocean-fresh", "business-bright"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const database = await db();
      const [row] = await database
        .select()
        .from(userCreations)
        .where(and(
          eq(userCreations.id, input.creationId),
          eq(userCreations.userId, ctx.user.id),
        ))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "作品不存在或无权访问" });
      let meta: any = {};
      try { meta = JSON.parse(row.metadata || "{}"); } catch {}
      const md = String(meta.reportMarkdown || meta.draftMarkdown || "").trim();
      if (!md) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该报告尚未生成 Markdown 内容，无法导出 HTML" });
      }
      const style = input.pdfStyle || "spring-mint";
      const title = String(meta.lighthouseTitle || row.title || "战略情报研报").slice(0, 80);

      try {
        const { generateInteractiveHtml } = await import("../services/htmlReportTemplate");
        // 用户决策（2026-05-01）：HTML 离线打开也要看到封面 → HTTP 签名 URL 在导出时
        // 抓下来内联成 base64 data URI（>8MB 或失败时 fallback 原 URL）
        // 用户决策续（2026-05-01）：thumbnailUrl=NULL（主流程 6 次重试全败）时，
        // 此处 on-demand 调 Nano Banana 2 (flash) 补生 9:16 纯封面再下载，避免封面缺失。
        let resolvedCoverUrl = row.thumbnailUrl || undefined;
        if (!resolvedCoverUrl) {
          const { ensureCoverForCreation } = await import("../services/deepResearchService");
          resolvedCoverUrl = await ensureCoverForCreation(input.creationId, title);
        }
        const inlinedCoverUrl = await inlineCoverIfHttp(resolvedCoverUrl);
        const html = generateInteractiveHtml(md, {
          style: style as any,
          documentTitle: title,
          cover: {
            imageUrl: inlinedCoverUrl,
            title,
            subtitle: "EXCLUSIVE STRATEGIC INTELLIGENCE",
            issue: "战略情报局",
            date: new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" }),
            abstract: meta.summary || undefined,
          },
        });

        const sizeBytes = Buffer.byteLength(html, "utf8");
        const TEN_MB = 10 * 1024 * 1024;
        const safeName = sanitizeFilename(`${title}-${style}-${input.creationId}`);

        if (sizeBytes <= TEN_MB) {
          // 直接返 base64 data URL（前端 <a download> 触发下载）
          const b64 = Buffer.from(html, "utf8").toString("base64");
          return {
            kind: "html" as const,
            filename: `${safeName}.html`,
            sizeBytes,
            dataUrl: `data:text/html;charset=utf-8;base64,${b64}`,
          };
        }

        // > 10 MB：用 jszip 压缩
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        zip.file(`${safeName}.html`, html);
        const zipBuf = await zip.generateAsync({
          type: "nodebuffer",
          compression: "DEFLATE",
          compressionOptions: { level: 6 },
        });
        const zipB64 = zipBuf.toString("base64");
        return {
          kind: "zip" as const,
          filename: `${safeName}.zip`,
          sizeBytes,
          zipBytes: zipBuf.length,
          dataUrl: `data:application/zip;base64,${zipB64}`,
        };
      } catch (e: any) {
        console.error("[creations.exportInteractiveHtml] 导出失败：", e?.message, e?.stack);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: e?.message || "HTML 交互版导出失败，请稍后重试",
        });
      }
    }),

  /** Get creation stats for the user */
  stats: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;
      const database = await db();
      const stats = await database
        .select({
          type: userCreations.type,
          count: sql<number>`COUNT(*)`,
        })
        .from(userCreations)
        .where(and(
          eq(userCreations.userId, userId),
          eq(userCreations.status, "completed"),
        ))
        .groupBy(userCreations.type);

      const favCount = await database
        .select({ count: sql<number>`COUNT(*)` })
        .from(userFavorites)
        .where(eq(userFavorites.userId, userId));

    return {
      byType: Object.fromEntries(stats.map((s: any) => [s.type, s.count])),
      totalCreations: stats.reduce((sum: number, s: any) => sum + s.count, 0),
      totalFavorites: favCount[0]?.count ?? 0,
    };
  }),
});
