/**
 * 全案分析冒烟：Stage1 看板 + Stage2 专属文案。
 *
 * 用法：
 *   pnpm run platform:fullcase-smoke
 *   REMOTE=1 STAGE=full pnpm run platform:fullcase-smoke   # 打 Fly（本机无法直连 OpenAI 时用）
 *   STAGE=dashboard|content|full
 *
 * 本地模式：从 .vercel/.env.production.local 加载合法 sk-；拒绝假占位与快照兜底。
 * 远程模式：POST https://api.mvstudiopro.com/api/trpc/...（用服务端密钥，无需本机 OpenAI 出网）。
 */
import { config as loadDotenv } from "dotenv";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sampleGrowthSignals } from "../server/growth/growthSchema.js";

function loadSmokeEnv() {
  const root = process.cwd();
  const files = [
    join(root, ".vercel", ".env.production.local"),
    join(root, ".env.local"),
    join(root, ".env"),
  ];
  for (const path of files) {
    if (!existsSync(path)) continue;
    loadDotenv({ path, override: true });
  }
  const raw = String(process.env.OPENAI_API_KEY || "").trim();
  if (raw && !/^sk-[A-Za-z0-9]/.test(raw)) {
    delete process.env.OPENAI_API_KEY;
  }
}

loadSmokeEnv();

const STAGE = (process.env.STAGE || "full").toLowerCase();
const REMOTE = process.env.REMOTE === "1" || process.env.SMOKE_REMOTE === "1";
const FLY_TRPC =
  String(process.env.SMOKE_FLY_TRPC || "https://api.mvstudiopro.com/api/trpc").replace(/\/+$/, "");
const WINDOW_DAYS = Number(process.env.WINDOW_DAYS || 7) as 3 | 7 | 15 | 30 | 45;
const CONTEXT =
  process.env.SMOKE_CONTEXT ||
  "生命科学研究者，兴趣历史与城市漫步，想在小红书做可收藏的生活化科普，避免说教。";
const OUT_DIR = process.env.SMOKE_OUT_DIR || join(process.cwd(), ".cache", "platform-fullcase-smoke");

async function trpcMutationRemote<T>(path: string, input: unknown, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${FLY_TRPC}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: input }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`tRPC ${path} non-JSON HTTP ${res.status}: ${text.slice(0, 240)}`);
    }
    if (!res.ok) {
      throw new Error(`tRPC ${path} HTTP ${res.status}: ${text.slice(0, 400)}`);
    }
    const data = parsed?.result?.data?.json ?? parsed?.result?.data ?? parsed;
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

function hasObjectObject(value: unknown, path = ""): string[] {
  const hits: string[] = [];
  if (typeof value === "string") {
    if (value.includes("[object Object]")) hits.push(path || "(root)");
    return hits;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...hasObjectObject(v, `${path}[${i}]`)));
    return hits;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      hits.push(...hasObjectObject(v, path ? `${path}.${k}` : k));
    }
  }
  return hits;
}

function assertOk(label: string, cond: boolean, detail?: string) {
  if (!cond) {
    console.error(`[fullcase] FAIL · ${label}${detail ? ` · ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`[fullcase] PASS · ${label}${detail ? ` · ${detail}` : ""}`);
}

function looksLikeSnapshotFallback(dashboard: Record<string, unknown> | null): string | null {
  if (!dashboard) return "dashboard null";
  const headline = String(dashboard.headline || "").trim();
  if (headline === "你的多平台成长看板") return "headline 为默认兜底文案";
  const persona = String(dashboard.personaSummary || "").trim();
  const actions = Array.isArray(dashboard.actionCards) ? dashboard.actionCards.length : 0;
  const signals = Array.isArray(dashboard.topSignals) ? dashboard.topSignals.length : 0;
  // 真 LLM 看板通常有人设摘要或动作卡/信号；纯快照兜底常三者皆空
  if (!persona && actions === 0 && signals === 0) {
    return "personaSummary/actionCards/topSignals 皆空（疑似快照兜底）";
  }
  return null;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const started = Date.now();
  console.log(
    `[fullcase] start · mode=${REMOTE ? "remote-fly" : "local"} · stage=${STAGE} · windowDays=${WINDOW_DAYS}`,
  );

  let localCaller: Awaited<ReturnType<typeof import("../server/routers.js")>["appRouter"]["createCaller"]> | null =
    null;
  if (!REMOTE) {
    const { getOfficialOpenAiApiKey } = await import("../server/services/gpt56CopywritingGateway.js");
    const { getOpenRouterApiKey } = await import("../server/services/openrouterGptImage2.js");
    const official = Boolean(getOfficialOpenAiApiKey());
    const openrouter = Boolean(getOpenRouterApiKey());
    console.log(`[fullcase] local keys · openaiOfficial=${official} · openrouter=${openrouter}`);
    assertOk(
      "已配置可用 GPT-5.6 文案密钥（或改用 REMOTE=1）",
      official || openrouter,
      "本机无合法密钥且未设 REMOTE=1",
    );
    // 本机若无法出网 OpenAI，提前提示改走远程
    try {
      const probe = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: { Authorization: `Bearer ${getOfficialOpenAiApiKey()}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (!probe.ok) console.warn(`[fullcase] warn · OpenAI models HTTP ${probe.status}`);
    } catch {
      console.warn("[fullcase] warn · 本机无法直连 api.openai.com，建议 REMOTE=1 打 Fly");
    }
    const { appRouter } = await import("../server/routers.js");
    localCaller = appRouter.createCaller({
      user: null,
      req: { protocol: "https", headers: {} } as any,
      res: { clearCookie: () => {} } as any,
      clientDisconnected: undefined,
    });
  }

  const snapshot = sampleGrowthSignals as unknown as Record<string, unknown>;

  let dashboard: Record<string, unknown> | null = null;
  let platformMenu: unknown[] = [];

  if (STAGE === "dashboard" || STAGE === "full") {
    const t0 = Date.now();
    console.log("[fullcase] Stage1 getPlatformDashboard …");
    const dashRes = REMOTE
      ? await trpcMutationRemote<{
          platformDashboard?: Record<string, unknown> | null;
          success?: boolean;
          debug?: { error?: string | null };
        }>(
          "mvAnalysis.getPlatformDashboard",
          {
            context: CONTEXT,
            windowDays: WINDOW_DAYS,
            snapshotSummary: snapshot,
            copyLlmMode: "openai",
            requestedPlatforms: ["xiaohongshu"],
          },
          12 * 60_000,
        )
      : await localCaller!.mvAnalysis.getPlatformDashboard({
          context: CONTEXT,
          windowDays: WINDOW_DAYS,
          snapshotSummary: snapshot,
          copyLlmMode: "openai",
          requestedPlatforms: ["xiaohongshu"],
        });
    dashboard = (dashRes as { platformDashboard?: Record<string, unknown> })?.platformDashboard ?? null;
    const remoteErr = String((dashRes as { debug?: { error?: string | null } })?.debug?.error || "");
    if (REMOTE && remoteErr) {
      assertOk("Stage1 remote debug.error 为空", false, remoteErr.slice(0, 240));
    }
    const elapsed = Date.now() - t0;
    writeFileSync(join(OUT_DIR, "stage1-dashboard.json"), JSON.stringify(dashRes, null, 2));
    assertOk("Stage1 返回看板", Boolean(dashboard), `${elapsed}ms`);
    const fallbackReason = looksLikeSnapshotFallback(dashboard);
    assertOk("Stage1 为真 LLM 产出（非快照兜底）", !fallbackReason, fallbackReason || undefined);
    const headline = String(dashboard?.headline || "").trim();
    assertOk("Stage1 headline 非空", headline.length > 0, headline.slice(0, 80));
    platformMenu = Array.isArray(dashboard?.platformMenu) ? (dashboard!.platformMenu as unknown[]) : [];
    assertOk("Stage1 platformMenu 非空", platformMenu.length > 0, `n=${platformMenu.length}`);
    const oo1 = hasObjectObject(dashboard);
    assertOk("Stage1 无 [object Object]", oo1.length === 0, oo1.slice(0, 5).join(", ") || undefined);
  }

  if (STAGE === "content" || STAGE === "full") {
    if (!dashboard) {
      dashboard = {
        headline: "烟雾测试看板·生命科学城市漫步",
        subheadline: "先做可收藏科普",
        personaSummary: CONTEXT.slice(0, 120),
        platformMenu: [
          {
            platform: "xiaohongshu",
            displayName: "小红书",
            whyNow: "适合先做可收藏科普",
            nextMove: "先发一条生活化清单笔记",
            recommendedFormat: "图文",
            trafficBoosters: ["#城市漫步指南"],
          },
        ],
        topSignals: [{ title: "收藏优先", detail: "清单+资源链" }],
        hotTopics: [],
        actionCards: [{ title: "发一条清单笔记", detail: "封面大数字+末页资源" }],
        conversationStarters: [],
      };
      platformMenu = dashboard.platformMenu as unknown[];
    }

    const t0 = Date.now();
    console.log("[fullcase] Stage2 getPlatformContent（同步，可能数分钟）…");
    const contentRes = REMOTE
      ? await trpcMutationRemote<{
          platformContent?: Record<string, unknown> | null;
          stage2TimedOut?: boolean;
          stage2Error?: string | null;
        }>(
          "mvAnalysis.getPlatformContent",
          {
            context: CONTEXT,
            windowDays: WINDOW_DAYS,
            snapshotSummary: snapshot,
            platformMenu,
            strategicDashboard: dashboard,
            stage2LlmMode: "openai",
          },
          25 * 60_000,
        )
      : await localCaller!.mvAnalysis.getPlatformContent({
          context: CONTEXT,
          windowDays: WINDOW_DAYS,
          snapshotSummary: snapshot,
          platformMenu,
          strategicDashboard: dashboard,
          stage2LlmMode: "openai",
        });
    const elapsed = Date.now() - t0;
    writeFileSync(join(OUT_DIR, "stage2-content.json"), JSON.stringify(contentRes, null, 2));

    const content = (contentRes as { platformContent?: Record<string, unknown> | null })?.platformContent;
    const timedOut = Boolean((contentRes as { stage2TimedOut?: boolean })?.stage2TimedOut);
    const stage2Error = String((contentRes as { stage2Error?: string | null })?.stage2Error || "");
    assertOk("Stage2 未超时", !timedOut, stage2Error || `${elapsed}ms`);
    assertOk("Stage2 无 stage2Error", !stage2Error, stage2Error.slice(0, 200) || undefined);
    assertOk("Stage2 返回 platformContent", Boolean(content), `${elapsed}ms`);

    const blueprints = Array.isArray(content?.contentBlueprints)
      ? (content!.contentBlueprints as unknown[])
      : [];
    assertOk("Stage2 contentBlueprints ≥1", blueprints.length >= 1, `n=${blueprints.length}`);

    const oo2 = hasObjectObject(content);
    assertOk("Stage2 无 [object Object]", oo2.length === 0, oo2.slice(0, 8).join(", ") || undefined);

    for (const [i, bp] of blueprints.slice(0, 3).entries()) {
      const row = bp as Record<string, unknown>;
      const title = String(row.title || "").trim();
      const copy = String(row.copywriting || "").trim();
      assertOk(`Blueprint[${i}] title`, title.length > 0 && !title.includes("[object Object]"));
      assertOk(`Blueprint[${i}] copywriting`, copy.length > 40 && !copy.includes("[object Object]"));
    }
  }

  const summary = {
    ok: true,
    stage: STAGE,
    windowDays: WINDOW_DAYS,
    elapsedMs: Date.now() - started,
    at: new Date().toISOString(),
  };
  writeFileSync(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`[fullcase] ALL PASS · ${summary.elapsedMs}ms · out=${OUT_DIR}`);
}

main().catch((e) => {
  console.error("[fullcase] ERROR:", e instanceof Error ? e.stack || e.message : e);
  try {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(
      join(OUT_DIR, "summary.json"),
      JSON.stringify(
        {
          ok: false,
          stage: STAGE,
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
