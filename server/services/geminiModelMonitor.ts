/**
 * Gemini API 模型白名单探针：监测 omni / veo 等关键字是否已对当前 GEMINI_API_KEY 开放。
 */
import { GoogleGenAI } from "@google/genai";

export type GeminiModelInspectionResult = {
  ok: boolean;
  totalModels: number;
  availableModelIds: string[];
  caughtModels: string[];
  monitorKeywords: string[];
  alert: boolean;
  error?: string;
};

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
}): Promise<GeminiModelInspectionResult> {
  const log = (line: string) => {
    if (!options?.quiet) console.log(line);
  };

  const apiKey = String(options?.apiKey || process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    const msg = "未侦测到环境变量 GEMINI_API_KEY，监控终止。";
    if (!options?.quiet) console.error(`❌ [核心错误] ${msg}`);
    return {
      ok: false,
      totalModels: 0,
      availableModelIds: [],
      caughtModels: [],
      monitorKeywords: resolveGeminiMonitorKeywords(),
      alert: false,
      error: msg,
    };
  }

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
      log("\n💤 监控报告：Omni/Veo 影片模型目前尚未对此 API Key 开放。");
      log("📌 当前可用之主力模型摘要（前 5 项）：");
      availableModelIds.slice(0, 5).forEach((modelId) => log(`  - ${modelId}`));
    }

    return {
      ok: true,
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
      totalModels: 0,
      availableModelIds: [],
      caughtModels: [],
      monitorKeywords,
      alert: false,
      error: msg,
    };
  }
}
