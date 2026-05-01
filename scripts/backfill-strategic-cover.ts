/**
 * 一次性 backfill：为 thumbnailUrl=NULL 的战略报告**重新生成 3:4 杂志封面**。
 *
 * 用户决策（2026-05-01，方案 A）：
 *   - 之前用 flash 模型 42% 失败率（11/26 报告 thumbnailUrl=NULL）
 *   - 不接受场景图（16:9）兜底 — 塞 3:4 卡片会被拉伸丑掉
 *   - 这个脚本重新调 Nano Banana Pro (gemini-3-pro-image-preview) 在 3:4 比例
 *     生成新封面，质感跟新报告一致
 *   - 成本约 11 × $0.05 ≈ ¥4，跑一次就够
 *
 * 使用：
 *   pnpm tsx scripts/backfill-strategic-cover.ts --dry-run   # 看会改哪些
 *   pnpm tsx scripts/backfill-strategic-cover.ts             # 真改 DB
 *
 * 在 fly 上跑（推荐，因为 GCS 凭证 + GEMINI_API_KEY 都在 fly）：
 *   flyctl ssh console -a mvstudiopro
 *   cd /app && node --import tsx scripts/backfill-strategic-cover.ts
 */
import "dotenv/config";
import { eq, and, isNull } from "drizzle-orm";

const COVER_PROMPT_TEMPLATE = (lighthouseTitle: string) =>
  `Luxury dark-gold business magazine cover, cinematic editorial photography, dramatic lighting, sophisticated typography overlay, vertical format. Topic: ${lighthouseTitle}`;

async function generateCoverViaVertex(prompt: string): Promise<string | undefined> {
  const vercelBaseUrl = String(process.env.VERCEL_APP_URL || "https://mvstudiopro.vercel.app").replace(/\/$/, "");
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(`${vercelBaseUrl}/api/google?op=nanoImage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, tier: "pro", aspectRatio: "3:4" }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`vertex_http_${res.status}: ${errText.slice(0, 200)}`);
      }
      const j: any = await res.json();
      if (!j?.imageUrl) throw new Error(`vertex_empty_imageUrl`);
      return String(j.imageUrl);
    } catch (e: any) {
      console.warn(`    Vertex 第 ${i}/3 次失败：${e?.message ?? e}`);
      if (i < 3) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return undefined;
}

async function generateCoverViaGeminiApiKey(prompt: string): Promise<string | undefined> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    console.warn("    GEMINI_API_KEY 未配置，跳过 Gemini API key 路径");
    return undefined;
  }
  const model = "gemini-3-pro-image-preview";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig: { aspectRatio: "3:4" },
          },
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`gemini_http_${res.status}: ${errText.slice(0, 200)}`);
      }
      const json: any = await res.json();
      const parts = json?.candidates?.[0]?.content?.parts;
      const inlineData = Array.isArray(parts)
        ? parts.find((p: any) => p?.inlineData?.data)?.inlineData
        : null;
      if (!inlineData?.data) throw new Error(`gemini_no_image`);
      const buffer = Buffer.from(String(inlineData.data), "base64");
      const mimeType = String(inlineData.mimeType || "image/png");
      const ext = mimeType.includes("jpeg") ? "jpg" : "png";
      const fileKey = `gemini-api-images/${model}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { storagePut } = await import("../server/storage");
      const { url: imageUrl } = await storagePut(fileKey, buffer, mimeType);
      return imageUrl;
    } catch (e: any) {
      console.warn(`    Gemini API key 第 ${i}/3 次失败：${e?.message ?? e}`);
      if (i < 3) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return undefined;
}

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
  let failCount = 0;

  for (const r of rows) {
    let meta: any = {};
    try {
      meta = JSON.parse(String(r.metadata || "{}"));
    } catch {}
    const lighthouseTitle: string = String(meta.lighthouseTitle || meta.topic || r.title || "战略情报报告").slice(0, 80);

    console.log(`\n  [${r.id}] ${lighthouseTitle.slice(0, 40)}`);
    const prompt = COVER_PROMPT_TEMPLATE(lighthouseTitle);

    let coverUrl = await generateCoverViaVertex(prompt);
    if (!coverUrl) coverUrl = await generateCoverViaGeminiApiKey(prompt);

    if (!coverUrl) {
      console.error(`  [fail] ${r.id} 6 次全失败`);
      failCount += 1;
      continue;
    }

    const preview = coverUrl.startsWith("data:")
      ? `data-uri(${coverUrl.length}b)`
      : coverUrl.slice(0, 80);
    if (dryRun) {
      console.log(`  [dry] ${r.id} → ${preview}`);
    } else {
      await db.update(userCreations).set({ thumbnailUrl: coverUrl }).where(eq(userCreations.id, r.id));
      console.log(`  [ok]  ${r.id} → ${preview}`);
    }
    okCount += 1;
  }

  console.log(
    `\n[backfill-cover] 完成 — 成功 ${okCount} / 失败 ${failCount} / 总 ${rows.length}${dryRun ? "（dry-run，没真改 DB）" : ""}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e: any) => {
    console.error("[backfill-cover] 失败:", e?.message ?? e);
    process.exit(1);
  });
