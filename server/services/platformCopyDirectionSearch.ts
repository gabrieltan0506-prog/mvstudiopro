import type { GrowthPlatform } from "@shared/growth";
import {
  buildPlatformCopyDirectionPromptBlock,
  listPlatformCopyDirectionBundles,
} from "../content/platformCopyDirectionDatabase.js";
import { callGemini35FlashCopywriting } from "./gemini35FlashRuntime.js";

const PLATFORM_LABELS: Record<string, string> = {
  xiaohongshu: "小红书",
  douyin: "抖音",
  bilibili: "B站",
  kuaishou: "快手",
};

function copyDirectionGoogleSearchEnabled(): boolean {
  const v = String(process.env.PLATFORM_COPY_DIRECTION_GOOGLE_SEARCH ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off" && v !== "no";
}

/**
 * 用 Gemini + googleSearch 检索各平台近期可核验热点，对齐资料库选题方向。
 * 失败时返回空字符串，不阻断 Stage2。
 */
export async function enrichPlatformCopyDirectionWithGoogleSearch(opts: {
  platforms: GrowthPlatform[];
  userContext?: string;
  abortSignal?: AbortSignal;
}): Promise<{ brief: string; usedGoogleSearch: boolean; error?: string }> {
  if (!copyDirectionGoogleSearchEnabled()) {
    return { brief: "", usedGoogleSearch: false, error: "disabled_by_env" };
  }
  if (!String(process.env.GEMINI_API_KEY || "").trim()) {
    return { brief: "", usedGoogleSearch: false, error: "missing_GEMINI_API_KEY" };
  }

  const platforms = opts.platforms.filter((p) => listPlatformCopyDirectionBundles([p]).length > 0);
  if (platforms.length === 0) {
    return { brief: "", usedGoogleSearch: false, error: "no_platform_bundles" };
  }

  const dbBlock = buildPlatformCopyDirectionPromptBlock({
    platforms,
    userContext: opts.userContext,
  });

  const platformList = platforms.map((p) => PLATFORM_LABELS[p] || p).join("、");

  const systemInstruction = `你是多平台内容策略研究员。必须用 Google 搜索各平台近期公开讨论与可核验趋势。
只输出简体中文纯文本（不要 JSON / markdown 代码块），结构：
【搜索摘要】
- ${platformList}：各 2-3 条可追热点或搜索词 + 1 条避坑
【候选池增补】
- 结合资料库「候选池 / 本周选题包」与人设，各平台补充 2 条可拍选题（带角度）
【标题灵感】
- 各平台 2 条标题示例（遵守 15 字内、含核心关键词、可组合标题技巧与爆款词）
禁止编造具体数据；搜不到则写「暂无可靠公开信号」并给保守方向。`;

  const userText = `${dbBlock}\n\n请搜索并输出上述结构，优先服务账号人设，不要脱离 context 硬套健身模板。`;

  try {
    const brief = await callGemini35FlashCopywriting({
      taskSystemInstruction: systemInstruction,
      userText,
      responseMimeType: "text/plain",
      maxOutputTokens: 8192,
      abortSignal: opts.abortSignal,
    });
    return { brief: String(brief || "").trim(), usedGoogleSearch: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[platformCopyDirectionSearch] googleSearch 失败:", msg.slice(0, 240));
    return { brief: "", usedGoogleSearch: false, error: msg };
  }
}
