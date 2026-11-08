/**
 * 营销口播配音声线挑选：系统声线按用途 + 性别筛选（纯函数，界面只负责展示）。
 * 用途映射到 qwenTtsVoiceCatalog 的 sceneZh（场景）与 traitZh（音色特质）；只列中文声线。
 * 声线 id 与现有下拉一致（plus 模型），不改 TTS 路由与计价。
 */
import { QWEN_TTS_VOICE_CATALOG, buildQwenTtsVoiceId, type QwenTtsVoiceEntry } from "./qwenTtsVoiceCatalog";

export const MARKETING_VOICE_PURPOSES = ["live_sales", "knowledge", "news", "companion", "late_night", "audiobook"] as const;
export type MarketingVoicePurpose = (typeof MARKETING_VOICE_PURPOSES)[number];

export const MARKETING_VOICE_PURPOSE_LABEL: Record<MarketingVoicePurpose, string> = {
  live_sales: "直播带货",
  knowledge: "知识讲解",
  news: "新闻播报",
  companion: "温暖陪伴",
  late_night: "深夜电台",
  audiobook: "有声书",
};

/** 每个用途：场景完全匹配或包含关键词，或音色特质包含关键词，即算命中。 */
const PURPOSE_RULES: Record<MarketingVoicePurpose, { scenes: string[]; sceneWords: string[]; traitWords: string[] }> = {
  live_sales: { scenes: ["电商直播", "新品推荐型客服"], sceneWords: ["直播"], traitWords: ["直播带货", "直播讲解", "激动振奋"] },
  knowledge: { scenes: ["知识分享", "讲解引导型客服", "商务汇报", "演讲朗诵"], sceneWords: ["知识", "讲解"], traitWords: ["专业解说", "温柔知性", "客观冷静", "平稳陈述", "直播讲解"] },
  news: { scenes: ["新闻播报", "体育解说"], sceneWords: ["播报"], traitWords: ["标准播音", "沉稳大气", "专业解说"] },
  companion: { scenes: ["情感陪伴"], sceneWords: ["陪伴"], traitWords: ["温暖", "暖男", "温柔贴心", "知心", "治愈"] },
  late_night: { scenes: ["深夜电台"], sceneWords: ["电台"], traitWords: ["电台质感", "磁性"] },
  audiobook: { scenes: ["有声阅读", "有声书配音", "古风有声书"], sceneWords: ["有声"], traitWords: ["叙事沉浸"] },
};

export type MarketingSystemVoice = {
  id: string;
  nameZh: string;
  gender: QwenTtsVoiceEntry["gender"];
  age: number | null;
  traitZh: string;
  sceneZh: string;
  purposes: MarketingVoicePurpose[];
};

export function marketingVoicePurposes(entry: Pick<QwenTtsVoiceEntry, "sceneZh" | "traitZh">): MarketingVoicePurpose[] {
  return MARKETING_VOICE_PURPOSES.filter(purpose => {
    const rule = PURPOSE_RULES[purpose];
    return rule.scenes.includes(entry.sceneZh)
      || rule.sceneWords.some(word => entry.sceneZh.includes(word))
      || rule.traitWords.some(word => entry.traitZh.includes(word));
  });
}

/** 中文系统声线全集（与原下拉同一范围与 id）。 */
export const MARKETING_SYSTEM_VOICES: MarketingSystemVoice[] = QWEN_TTS_VOICE_CATALOG
  .filter(row => row.lang.includes("中文"))
  .map(row => ({
    id: buildQwenTtsVoiceId("plus", row.suffix),
    nameZh: row.nameZh,
    gender: row.gender,
    age: row.age,
    traitZh: row.traitZh,
    sceneZh: row.sceneZh,
    purposes: marketingVoicePurposes(row),
  }));

export type MarketingVoiceFilter = { purpose?: MarketingVoicePurpose | "all"; gender?: "男" | "女" | "all" };

/** 按用途 + 性别筛选；顺序：用途场景完全匹配的在前，其余保持目录顺序（确定性，便于复现）。 */
export function filterMarketingSystemVoices(filter: MarketingVoiceFilter, voices: readonly MarketingSystemVoice[] = MARKETING_SYSTEM_VOICES): MarketingSystemVoice[] {
  const purpose = filter.purpose && filter.purpose !== "all" ? filter.purpose : undefined;
  const gender = filter.gender && filter.gender !== "all" ? filter.gender : undefined;
  const hits = voices.filter(v => (!purpose || v.purposes.includes(purpose)) && (!gender || v.gender === gender));
  if (!purpose) return hits;
  const scenes = PURPOSE_RULES[purpose].scenes;
  return [...hits.filter(v => scenes.includes(v.sceneZh)), ...hits.filter(v => !scenes.includes(v.sceneZh))];
}

/** 卡片副标题：性别·年龄·场景。 */
export function marketingVoiceMeta(voice: Pick<MarketingSystemVoice, "gender" | "age" | "sceneZh">): string {
  return [voice.gender, voice.age != null ? `${voice.age} 岁` : "", voice.sceneZh].filter(Boolean).join(" · ");
}

/**
 * 试读文本：取本段口播第一句（不改写，最多 60 字），控制试读计费时长。
 * 空口播返回空串（界面禁用试读）。
 */
export function marketingVoiceTrialText(narration: string, maxChars = 60): string {
  const text = String(narration || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const first = text.match(/^[^。！？!?；;]+[。！？!?；;]?/)?.[0]?.trim() || text;
  return Array.from(first).slice(0, maxChars).join("");
}
