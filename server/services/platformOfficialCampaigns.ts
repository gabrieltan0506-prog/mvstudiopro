/**
 * 官方活动策展：ensure 表 + 种子 upsert + 供趋势报表 / 选题读取。
 */

import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { platformOfficialCampaigns } from "../../drizzle/schema-platform-official-campaigns";
import {
  ALL_OFFICIAL_CAMPAIGN_SEEDS,
  formatCampaignForReport,
  formatCampaignTopicExamples,
  type OfficialCampaignSeed,
} from "../../shared/platformOfficialCampaigns";

let seedPromise: Promise<void> | null = null;

export async function ensurePlatformOfficialCampaignsTable(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "platform_official_campaigns" (
        "id" serial PRIMARY KEY,
        "campaignKey" varchar(80) NOT NULL UNIQUE,
        "platform" varchar(32) NOT NULL,
        "name" text NOT NULL,
        "kind" varchar(32) NOT NULL DEFAULT 'topic_challenge',
        "category" varchar(48) NOT NULL DEFAULT 'summer_lifestyle',
        "featured" boolean NOT NULL DEFAULT true,
        "personaFit" text NOT NULL DEFAULT '',
        "topicHooksJson" text NOT NULL DEFAULT '[]',
        "laneHintsJson" text NOT NULL DEFAULT '[]',
        "summary" text NOT NULL DEFAULT '',
        "status" varchar(16) NOT NULL DEFAULT 'active',
        "reviewedAt" varchar(32) NOT NULL DEFAULT '',
        "sourceNote" text NOT NULL DEFAULT '',
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "platform_official_campaigns_platform_featured_idx"
        ON "platform_official_campaigns" ("platform", "featured", "status")
    `);
  } catch (e) {
    console.warn(
      "[Database] ensure platform_official_campaigns (non-fatal):",
      e instanceof Error ? e.message.slice(0, 200) : e,
    );
  }
}

function rowToSeed(row: typeof platformOfficialCampaigns.$inferSelect): OfficialCampaignSeed {
  let topicHooks: string[] = [];
  let laneHints: OfficialCampaignSeed["laneHints"] = ["default"];
  try {
    topicHooks = JSON.parse(row.topicHooksJson || "[]");
  } catch {
    topicHooks = [];
  }
  try {
    laneHints = JSON.parse(row.laneHintsJson || "[]");
  } catch {
    laneHints = ["default"];
  }
  return {
    id: row.campaignKey,
    platform: row.platform as OfficialCampaignSeed["platform"],
    name: row.name,
    kind: row.kind as OfficialCampaignSeed["kind"],
    category: row.category as OfficialCampaignSeed["category"],
    featured: Boolean(row.featured),
    personaFit: row.personaFit || "",
    topicHooks: Array.isArray(topicHooks) ? topicHooks : [],
    laneHints: Array.isArray(laneHints) && laneHints.length ? laneHints : ["default"],
    summary: row.summary || "",
    status: (row.status as OfficialCampaignSeed["status"]) || "active",
    sourceNote: row.sourceNote || "",
    reviewedAt: row.reviewedAt || "",
  };
}

export async function upsertOfficialCampaignSeeds(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  await ensurePlatformOfficialCampaignsTable();
  let n = 0;
  for (const seed of ALL_OFFICIAL_CAMPAIGN_SEEDS) {
    const payload = {
      campaignKey: seed.id,
      platform: seed.platform,
      name: seed.name,
      kind: seed.kind,
      category: seed.category,
      featured: seed.featured,
      personaFit: seed.personaFit,
      topicHooksJson: JSON.stringify(seed.topicHooks),
      laneHintsJson: JSON.stringify(seed.laneHints),
      summary: seed.summary,
      status: seed.status,
      sourceNote: seed.sourceNote,
      reviewedAt: seed.reviewedAt,
      updatedAt: new Date(),
    };
    const existing = await db
      .select({ id: platformOfficialCampaigns.id })
      .from(platformOfficialCampaigns)
      .where(eq(platformOfficialCampaigns.campaignKey, seed.id))
      .limit(1);
    if (existing[0]) {
      await db
        .update(platformOfficialCampaigns)
        .set(payload)
        .where(eq(platformOfficialCampaigns.campaignKey, seed.id));
    } else {
      await db.insert(platformOfficialCampaigns).values(payload);
    }
    n += 1;
  }
  return n;
}

/** 幂等：进程内只 seed 一次 */
export async function ensureOfficialCampaignSeedsLoaded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = (async () => {
      try {
        await upsertOfficialCampaignSeeds();
      } catch (e) {
        console.warn(
          "[officialCampaigns] seed failed (non-fatal):",
          e instanceof Error ? e.message.slice(0, 200) : e,
        );
      }
    })();
  }
  await seedPromise;
}

export async function listOfficialCampaigns(opts?: {
  platform?: string;
  featuredOnly?: boolean;
  activeOnly?: boolean;
}): Promise<OfficialCampaignSeed[]> {
  await ensureOfficialCampaignSeedsLoaded();
  const db = await getDb();
  if (!db) {
    // DB 不可用时回退内存种子
    return ALL_OFFICIAL_CAMPAIGN_SEEDS.filter((c) => {
      if (opts?.platform && c.platform !== opts.platform) return false;
      if (opts?.featuredOnly && !c.featured) return false;
      if (opts?.activeOnly !== false && c.status !== "active") return false;
      return true;
    });
  }
  const rows = await db.select().from(platformOfficialCampaigns);
  return rows
    .map(rowToSeed)
    .filter((c) => {
      if (opts?.platform && c.platform !== opts.platform) return false;
      if (opts?.featuredOnly && !c.featured) return false;
      if (opts?.activeOnly !== false && c.status !== "active") return false;
      return true;
    });
}

export async function listOfficialCampaignLinesForReport(platforms: string[]): Promise<{
  byPlatform: Record<string, string[]>;
  globalTrafficSupport: string[];
  topicExamples: ReturnType<typeof formatCampaignTopicExamples>;
}> {
  const byPlatform: Record<string, string[]> = {};
  const global: string[] = [];
  for (const p of platforms) {
    const cams = await listOfficialCampaigns({ platform: p, featuredOnly: true });
    byPlatform[p] = cams.map(formatCampaignForReport);
    for (const c of cams.slice(0, 2)) {
      global.push(`${c.platform} · ${formatCampaignForReport(c)}`);
    }
  }
  return {
    byPlatform,
    globalTrafficSupport: global.slice(0, 6),
    topicExamples: formatCampaignTopicExamples(8),
  };
}

export async function pickLinkedCampaignsForTopic(params: {
  platform?: string;
  lane?: string;
  title?: string;
  formatHint?: string;
  limit?: number;
}): Promise<string[]> {
  const cams = await listOfficialCampaigns({
    platform: params.platform || "xiaohongshu",
    featuredOnly: true,
  });
  const lane = String(params.lane || "default");
  const title = `${params.title || ""}`;
  const scored = cams
    .map((c) => {
      let score = c.laneHints.includes(lane as never) ? 3 : 1;
      if (/暑假|暑期|夏日|清凉|余地|旅游|旅行|录取/.test(title) && c.category === "summer_lifestyle") score += 3;
      if (/漫步|展|博物|市集|城市|旅游|旅行/.test(title) && c.category === "city_walk") score += 3;
      if (/好物|测评|零食|冰|糖|防晒|冻门|下酒|雪糕/.test(title) && c.category === "fmcg_goods") score += 3;
      if (/读书|书单|书店|莎士比亚|罗琳|反调/.test(title) && c.category === "culture_reading") score += 2;
      if (/运动|散步|力量|HYROX|皮质醇|变多强|户外/.test(title) && c.category === "wellness_sport") score += 2;
      if (/主角感|法式|设计|毕业展/.test(title) && c.category === "aesthetics_design") score += 2;
      if (/美食|掌门|谐音|市集/.test(title) && c.category === "food_local") score += 2;
      if (params.formatHint === "短视频" && c.kind === "traffic_support" && /中长视频|视频激励|视频作者|好视频/.test(c.name)) {
        score += 2;
      }
      return { name: c.name, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, params.limit ?? 2).map((s) => s.name);
}
