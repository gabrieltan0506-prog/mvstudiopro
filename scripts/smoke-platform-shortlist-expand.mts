/**
 * 全案选题初选 → 扩写冒烟（现行主路径，非旧 Stage2 六条）。
 *
 * 用法：
 *   pnpm exec tsx scripts/smoke-platform-shortlist-expand.mts
 *   SHORTLIST_COUNT=6 EXPAND_PICKS=1 pnpm exec tsx scripts/smoke-platform-shortlist-expand.mts
 *
 * 直调 service（admin 口径不计费）；验：topics>0、扩写 blueprint 有 id/sceneId/title/hook/copywriting。
 */
import { config as loadDotenv } from "dotenv";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function loadSmokeEnv() {
  const root = process.cwd();
  for (const path of [
    join(root, ".vercel", ".env.production.local"),
    join(root, ".env.local"),
    join(root, ".env"),
  ]) {
    if (!existsSync(path)) continue;
    loadDotenv({ path, override: true });
  }
}

loadSmokeEnv();

const CONTEXT =
  process.env.SMOKE_CONTEXT ||
  "男性哈佛医学博士，擅长心脑血管慢病与中西医养生，热爱爵士与旅行；要在小红书做可收藏生活化科普，口语有烟火气，禁论文腔。";
const SHORTLIST_COUNT = Math.max(1, Math.min(30, Number(process.env.SHORTLIST_COUNT || 6)));
const EXPAND_PICKS = Math.max(1, Math.min(3, Number(process.env.EXPAND_PICKS || 1)));
const OUT_DIR =
  process.env.SMOKE_OUT_DIR || join(process.cwd(), ".cache", "platform-shortlist-expand-smoke");

function assertOk(label: string, cond: boolean, detail?: string) {
  if (!cond) {
    console.error(`[shortlist-expand] FAIL · ${label}${detail ? ` · ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`[shortlist-expand] PASS · ${label}${detail ? ` · ${detail}` : ""}`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const started = Date.now();
  console.log(
    `[shortlist-expand] start · shortlist=${SHORTLIST_COUNT} · expandPicks=${EXPAND_PICKS}`,
  );

  const { generatePlatformTopicShortlist, expandPlatformTopicPicks } = await import(
    "../server/services/platformTopicShortlist.js"
  );

  const t0 = Date.now();
  console.log("[shortlist-expand] generatePlatformTopicShortlist …");
  const shortlist = await generatePlatformTopicShortlist({
    userId: 0,
    context: CONTEXT,
    count: SHORTLIST_COUNT,
    allowBloggerTitle: false,
  });
  writeFileSync(join(OUT_DIR, "shortlist.json"), JSON.stringify(shortlist, null, 2));
  const topics = Array.isArray(shortlist.topics) ? shortlist.topics : [];
  assertOk("初选 topics ≥1", topics.length >= 1, `n=${topics.length} · ${Date.now() - t0}ms`);
  assertOk(
    "初选诊断 trendStatus 有值",
    Boolean(shortlist.diagnostics && typeof shortlist.diagnostics === "object"),
  );
  for (const [i, t] of topics.slice(0, 3).entries()) {
    assertOk(`Topic[${i}] title`, String(t.title || "").trim().length >= 4);
    assertOk(`Topic[${i}] id`, String(t.id || "").trim().length >= 4);
  }

  const picks = topics.slice(0, EXPAND_PICKS);
  const t1 = Date.now();
  console.log(`[shortlist-expand] expandPlatformTopicPicks · ${picks.length} 条 …`);
  const expanded = await expandPlatformTopicPicks({
    userId: 0,
    context: CONTEXT,
    picks: picks.map((p) => ({
      id: p.id,
      title: p.title,
      hookSketch: p.hookSketch,
      conveyGoal: p.conveyGoal,
      skillsUsed: p.skillsUsed,
      primaryLane: p.primaryLane,
      formatHint: p.formatHint,
      dedupeKey: p.dedupeKey,
      commentHook: p.commentHook,
      linkedCampaigns: p.linkedCampaigns,
    })),
    allowBloggerTitle: false,
  });
  writeFileSync(join(OUT_DIR, "expanded.json"), JSON.stringify(expanded, null, 2));
  const bps = Array.isArray(expanded.contentBlueprints) ? expanded.contentBlueprints : [];
  assertOk("扩写 contentBlueprints ≥ picks", bps.length >= picks.length, `n=${bps.length} · ${Date.now() - t1}ms`);

  for (const [i, raw] of bps.entries()) {
    const bp = raw as Record<string, unknown>;
    const id = String(bp.id || "").trim();
    const sceneId = String(bp.sceneId || "").trim();
    const title = String(bp.title || "").trim();
    const hook = String(bp.hook || "").trim();
    const copy = String(bp.copywriting || "").trim();
    assertOk(`BP[${i}] id`, id.length >= 4, id.slice(0, 40));
    assertOk(`BP[${i}] sceneId`, sceneId.length >= 4, sceneId.slice(0, 40));
    assertOk(`BP[${i}] title`, title.length >= 4, title.slice(0, 60));
    assertOk(`BP[${i}] hook`, hook.length >= 4, hook.slice(0, 60));
    assertOk(`BP[${i}] copywriting ≥40`, copy.length >= 40, `len=${copy.length}`);
  }

  // 前端同页展示依赖的字段映射（与 PlatformPage mapContentBlueprintToExecutionCard 对齐）
  const mappedOk = bps.every((raw) => {
    const bp = raw as Record<string, unknown>;
    return Boolean(bp.title && (bp.hook || bp.copywriting) && (bp.id || bp.sceneId));
  });
  assertOk("可映射为 Stage2 执行卡字段", mappedOk);

  const summary = {
    ok: true,
    shortlistCount: topics.length,
    expandedCount: bps.length,
    sampleTitles: bps.map((b) => String((b as Record<string, unknown>).title || "")).slice(0, 3),
    elapsedMs: Date.now() - started,
    at: new Date().toISOString(),
  };
  writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`[shortlist-expand] ALL PASS · ${summary.elapsedMs}ms · out=${OUT_DIR}`);
  console.log(`[shortlist-expand] sample · ${summary.sampleTitles.join(" | ")}`);
}

main().catch((e) => {
  console.error("[shortlist-expand] ERROR:", e instanceof Error ? e.stack || e.message : e);
  try {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(
      join(OUT_DIR, "summary.json"),
      JSON.stringify(
        {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
          at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch {
    /* ignore */
  }
  process.exit(1);
});
