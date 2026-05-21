/**
 * Gemini API 模型白名单探针：监测 omni / veo 等关键字是否已对 GEMINI_API_KEY 开放。
 * 默认优先从 Fly 生产 secret 读取（fly ssh printenv），失败再回退本地 .env。
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GoogleGenAI } from "@google/genai";

const execFileAsync = promisify(execFile);

export type GeminiApiKeySource = "fly" | "env" | "explicit";

export type GeminiModelInspectionResult = {
  ok: boolean;
  keySource?: GeminiApiKeySource;
  totalModels: number;
  availableModelIds: string[];
  caughtModels: string[];
  monitorKeywords: string[];
  alert: boolean;
  error?: string;
};

/** 接受 Google AI Studio（AIza）与 Fly 常用（AQ.）格式 */
export function normalizeGeminiApiKey(raw: string): string {
  const key = String(raw || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
  if (!key || key.length < 20) {
    throw new Error("GEMINI_API_KEY 无效（长度过短）");
  }
  if (!/^(AIza|AQ\.)/.test(key)) {
    throw new Error("GEMINI_API_KEY 无效（应以 AIza 或 AQ. 开头）");
  }
  for (const ch of key) {
    if (ch.charCodeAt(0) > 255) {
      throw new Error("GEMINI_API_KEY 含非 ASCII 字符，请检查是否误贴中文或注释");
    }
  }
  return key;
}

export function normalizeGeminiApiKeyFromEnv(raw?: string): string {
  return normalizeGeminiApiKey(String(raw || process.env.GEMINI_API_KEY || ""));
}

export function resolveGeminiMonitorFlyApp(): string {
  return String(process.env.GEMINI_MONITOR_FLY_APP || process.env.FLY_APP || "mvstudiopro").trim() || "mvstudiopro";
}

function parseFlyPrintenvOutput(stdout: string): string {
  const lines = String(stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("Connecting to"));
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (/^(AIza|AQ\.)/.test(line) && line.length >= 20) return line;
  }
  return "";
}

/** 经 fly ssh 读取生产机上的 GEMINI_API_KEY（与 Fly secret 一致） */
export async function fetchGeminiApiKeyFromFlySecret(app?: string): Promise<string | null> {
  if (String(process.env.GEMINI_MONITOR_SKIP_FLY || "").trim() === "1") return null;
  const flyApp = app || resolveGeminiMonitorFlyApp();
  try {
    const { stdout } = await execFileAsync(
      "fly",
      ["ssh", "console", "-a", flyApp, "-C", "printenv GEMINI_API_KEY"],
      { timeout: 120_000, maxBuffer: 1024 * 1024 },
    );
    const key = parseFlyPrintenvOutput(String(stdout || ""));
    return key || null;
  } catch {
    return null;
  }
}

/**
 * 解析监测用 API Key：默认 Fly 优先，再本地 env。
 * GEMINI_MONITOR_PREFER_LOCAL=1 时仅用本地。
 */
export async function resolveGeminiApiKeyForMonitor(options?: {
  apiKey?: string;
  preferFly?: boolean;
}): Promise<{ key: string; source: GeminiApiKeySource }> {
  if (options?.apiKey?.trim()) {
    return { key: normalizeGeminiApiKey(options.apiKey), source: "explicit" };
  }

  const preferLocal = String(process.env.GEMINI_MONITOR_PREFER_LOCAL || "").trim() === "1";
  const preferFly = options?.preferFly !== false && !preferLocal;

  if (preferFly) {
    const flyKey = await fetchGeminiApiKeyFromFlySecret();
    if (flyKey) {
      try {
        return { key: normalizeGeminiApiKey(flyKey), source: "fly" };
      } catch {
        /* 继续回退本地 */
      }
    }
  }

  return { key: normalizeGeminiApiKeyFromEnv(), source: "env" };
}

export function resolveGeminiMonitorKeywords(): string[] {
  const raw = String(process.env.GEMINI_MONITOR_KEYWORDS || "omni,veo").trim();
  return raw
    .split(/[,;\s]+/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
}

async function listAllModelIds(ai: GoogleGenAI): Promise<string[]> {
  const pager = await ai.models.list();
  const ids: string[] = [];
  for await (const model of pager) {
    const name = String(model.name || "").trim();
    if (name) ids.push(name);
  }
  return ids;
}

/** 可选 Webhook：设置 GEMINI_MONITOR_WEBHOOK_URL 后，发现新模型时 POST JSON */
async function notifyWebhook(caughtModels: string[], availableModelIds: string[]) {
  const url = String(process.env.GEMINI_MONITOR_WEBHOOK_URL || "").trim();
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "gemini_model_unlocked",
        caughtModels,
        totalModels: availableModelIds.length,
        at: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.warn("[gemini-monitor] Webhook 发送失败:", (e as Error)?.message || e);
  }
}

export async function runModelInspectionPipeline(options?: {
  apiKey?: string;
  keywords?: string[];
  quiet?: boolean;
  preferFly?: boolean;
}): Promise<GeminiModelInspectionResult> {
  const log = (line: string) => {
    if (!options?.quiet) console.log(line);
  };

  let apiKey = "";
  let keySource: GeminiApiKeySource = "env";
  try {
    const resolved = await resolveGeminiApiKeyForMonitor({
      apiKey: options?.apiKey,
      preferFly: options?.preferFly,
    });
    apiKey = resolved.key;
    keySource = resolved.source;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!options?.quiet) {
      console.error(`❌ [核心错误] ${msg}`);
      console.error("   提示：默认优先 Fly secret；可设 GEMINI_MONITOR_SKIP_FLY=1 仅用本地 .env");
    }
    return {
      ok: false,
      keySource,
      totalModels: 0,
      availableModelIds: [],
      caughtModels: [],
      monitorKeywords: resolveGeminiMonitorKeywords(),
      alert: false,
      error: msg,
    };
  }

  const sourceLabel =
    keySource === "fly"
      ? `Fly · ${resolveGeminiMonitorFlyApp()}`
      : keySource === "explicit"
        ? "显式传入"
        : "本地 .env";
  log(`🔑 [凭据] ${sourceLabel} · 前缀 ${apiKey.slice(0, 6)}…`);

  const monitorKeywords = (options?.keywords || resolveGeminiMonitorKeywords()).map((k) =>
    k.toLowerCase(),
  );

  log("🔍 [探针启动] 正在向 Google API 网关拉取最新模型白名单...");

  const ai = new GoogleGenAI({ apiKey });

  try {
    const availableModelIds = await listAllModelIds(ai);

    if (!availableModelIds.length) {
      log("⚠️ 警告：成功连线但回传模型清单为空，请检查金钥状态。");
      return {
        ok: true,
        keySource,
        totalModels: 0,
        availableModelIds: [],
        caughtModels: [],
        monitorKeywords,
        alert: false,
        error: "empty_model_list",
      };
    }

    log(`📊 探测完毕：当前您的金钥可调用 ${availableModelIds.length} 个模型端点。`);

    const caughtModels = availableModelIds.filter((modelId) =>
      monitorKeywords.some((keyword) => modelId.toLowerCase().includes(keyword)),
    );

    if (caughtModels.length > 0) {
      log("\n🚨🚨🚨 [重大发现] 发现新世代模型已对您的帐号解封！ 🚨🚨🚨");
      caughtModels.forEach((modelId) => log(`🔥 【解封目标】: ${modelId}`));
      log("\n💡 提示：请立刻部署 Omni / Veo 顶配影片流水线，并在 TestLab 验证 generateVideos。");
      await notifyWebhook(caughtModels, availableModelIds);
    } else {
      log("\n💤 监控报告：关键字（omni/veo）未命中任何模型 ID。");
      log("📌 当前可用之主力模型摘要（前 5 项）：");
      availableModelIds.slice(0, 5).forEach((modelId) => log(`  - ${modelId}`));
    }

    return {
      ok: true,
      keySource,
      totalModels: availableModelIds.length,
      availableModelIds,
      caughtModels,
      monitorKeywords,
      alert: caughtModels.length > 0,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!options?.quiet) {
      console.error("✖ [连线失败] 无法读取 ModelService，可能是网关壅塞或金钥失效:", error);
    }
    return {
      ok: false,
      keySource,
      totalModels: 0,
      availableModelIds: [],
      caughtModels: [],
      monitorKeywords,
      alert: false,
      error: msg,
    };
  }
}
