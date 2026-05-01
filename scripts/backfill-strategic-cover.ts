/**
 * 一次性 backfill：为 thumbnailUrl=NULL 的战略报告补封面（**零 API 调用**）。
 *
 * 用户决策（2026-05-01，方案 A）：
 *   - 之前 flash 模型 cover gen 失败率 42%（11/26 报告 thumbnailUrl=NULL）
 *   - 这些报告的 metadata.reportMarkdown 里**已经有 5-7 张场景图**（base64 / GCS URL）
 *     存在 Neon 里，已经付过一次场景图 gen 费 — 直接拿来当封面就好
 *   - 不调任何外部图片 API：抓 metadata 第一张图 → 直接 update thumbnailUrl
 *   - 缺点：场景图是 16:9 横版，塞进 9:16 竖版卡片会被裁切/letterbox（视觉
 *     不如 Nano Banana Pro 9:16 杂志封面统一）。但比 NULL 强，零成本。
 *   - 新报告仍走 Nano Banana Pro 9:16 + 6 次重试，所以以后增量数据是一致的，
 *     这个脚本只影响历史 11 条。
 *
 * 使用：
 *   pnpm tsx scripts/backfill-strategic-cover.ts --dry-run   # 看会改哪些
 *   pnpm tsx scripts/backfill-strategic-cover.ts             # 真改 DB
 *
 * 在 fly 上跑（DB 凭证已经在 fly secrets）：
 *   flyctl ssh console -a mvstudiopro
 *   cd /app && node --import tsx scripts/backfill-strategic-cover.ts
 */
import "dotenv/config";
import { eq, and, isNull } from "drizzle-orm";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const { getDb } = await import("../server/db");
  const { userCreations } = await import("../drizzle/schema-creations");
  const db = await getDb();
  if (!db) throw new Error("DB 不可用 — 检查 DATABASE_URL");

  const rows = await db
    .select({
      id: userCreations.id,
      title: userCreations.title,
      metadata: userCreations.metadata,
    })
    .from(userCreations)
    .where(and(isNull(userCreations.thumbnailUrl), eq(userCreations.type, "deep_research_report")));

  console.log(`[backfill-cover] 找到 ${rows.length} 条 thumbnailUrl=NULL 的战略报告`);

  let okCount = 0;
  let skipCount = 0;

  for (const r of rows) {
    let meta: any = {};
    try {
      meta = JSON.parse(String(r.metadata || "{}"));
    } catch {}
    const md = String(meta.reportMarkdown || meta.draftMarkdown || "");
    if (!md) {
      console.warn(`  [skip] ${r.id} 无 reportMarkdown`);
      skipCount += 1;
      continue;
    }

    // 抓第一张图（场景图通常 base64 data URI 或 GCS https URL）
    // 优先 markdown 标准 ![alt](url) 语法
    let imageUrl: string | undefined;
    const mdImg = md.match(/!\[[^\]]*\]\((data:image\/[^)]+|https?:\/\/[^)\s]+)\)/);
    if (mdImg) imageUrl = mdImg[1];
    // 退一步：抓 raw <img src="..."> （ReportRenderer 透传的 raw HTML）
    if (!imageUrl) {
      const htmlImg = md.match(/<img[^>]+src=["'](data:image\/[^"']+|https?:\/\/[^"'\s]+)["']/);
      if (htmlImg) imageUrl = htmlImg[1];
    }

    if (!imageUrl) {
      console.warn(`  [skip] ${r.id} (${String(r.title).slice(0, 30)}) 整篇无图片 URL`);
      skipCount += 1;
      continue;
    }

    const preview = imageUrl.startsWith("data:")
      ? `data-uri(${imageUrl.length}b)`
      : imageUrl.slice(0, 80);
    if (dryRun) {
      console.log(`  [dry] ${r.id} → ${preview}`);
    } else {
      await db.update(userCreations).set({ thumbnailUrl: imageUrl }).where(eq(userCreations.id, r.id));
      console.log(`  [ok]  ${r.id} → ${preview}`);
    }
    okCount += 1;
  }

  console.log(
    `\n[backfill-cover] 完成 — 已 backfill ${okCount} 条，跳过 ${skipCount} 条${dryRun ? "（dry-run，没真改 DB）" : ""}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e: any) => {
    console.error("[backfill-cover] 失败:", e?.message ?? e);
    process.exit(1);
  });
