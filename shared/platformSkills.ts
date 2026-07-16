/**
 * /platform 可挂载 Skill：内置 md + 用户上传，勾选后注入生成 Prompt。
 */

import { buildMedicalResourcePromptBlock } from "./medicalResourceLibrary.js";

export type PlatformSkillMeta = {
  id: string;
  name: string;
  description: string;
  version?: string;
  defaultEnabled: boolean;
  /** builtin | user */
  source: "builtin" | "user";
  /** 用户上传时的公网/存储 URL（可选） */
  url?: string;
  updatedAt?: string;
};

export type PlatformSkillRecord = PlatformSkillMeta & {
  /** 完整 markdown 正文（含或不含 frontmatter） */
  body: string;
};

/** 创作者提示词 / 创作诉求 与 Skill 冲突时的优先级（UI 气泡与 Prompt 共用）。 */
export const PLATFORM_USER_PROMPT_OVERRIDES_SKILLS_RULE = `【创作者提示词优先·硬规则】
1. Skill 可自由勾选 / 取消，不是强制模板。
2. 若「人物背景与创作诉求 / 自定义提示词 / 用户明确要求」与已挂载 Skill 冲突：**一律以创作者提示词为准**，Skill 仅作不冲突处的辅助参考。
3. 只要提示词里写了具体要求（题材、时长、页数、口吻、禁区、平台、人物等），生成时优先兑现这些要求，不得被 Skill 默认设定覆盖。`;

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const text = String(raw || "").replace(/^\uFEFF/, "");
  const m = text.match(FRONTMATTER_RE);
  if (!m) return { meta: {}, body: text.trim() };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    meta[key] = val;
  }
  return { meta, body: m[2].trim() };
}

export function parsePlatformSkillMarkdown(
  raw: string,
  fallback: { id: string; source: "builtin" | "user"; url?: string },
): PlatformSkillRecord {
  const { meta, body } = parseFrontmatter(raw);
  const id = String(meta.id || fallback.id || "skill")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 64);
  const defaultEnabled =
    meta.defaultEnabled === undefined
      ? true
      : /^(1|true|yes|on)$/i.test(String(meta.defaultEnabled));
  return {
    id: id || fallback.id,
    name: String(meta.name || id || "未命名 Skill").trim().slice(0, 80),
    description: String(meta.description || "").trim().slice(0, 200),
    version: meta.version ? String(meta.version).trim().slice(0, 40) : undefined,
    defaultEnabled,
    source: fallback.source,
    url: fallback.url,
    body: body || String(raw || "").trim(),
  };
}

/** 将已启用 Skill 拼成一段可注入 system/user 的硬约束块 */
export function composePlatformSkillsPromptBlock(
  skills: PlatformSkillRecord[],
  opts?: { topicHint?: string },
): string {
  const list = (skills || []).filter((s) => s && String(s.body || "").trim());
  if (list.length === 0) return PLATFORM_USER_PROMPT_OVERRIDES_SKILLS_RULE;
  const parts = list.map((s, i) => {
    const head = `### Skill ${i + 1}: ${s.name}（id=${s.id} · ${s.source}）`;
    return `${head}\n${String(s.body).trim()}`;
  });
  let block = `【Platform 挂载 Skill·强制遵守（但创作者提示词优先）】
以下 Skill 由用户在 /platform 勾选启用。生成选题、文案、分镜、灯光、运镜、图文笔记时**默认**遵守；与旧有软建议冲突时，以本块为准。
${PLATFORM_USER_PROMPT_OVERRIDES_SKILLS_RULE}
成稿仍禁止堆导演名/片名致敬（若启用了导演手法 Skill）。

${parts.join("\n\n---\n\n")}`;
  if (list.some((s) => s.id === "medical-resource-library")) {
    block += `\n\n---\n\n${buildMedicalResourcePromptBlock({ topic: opts?.topicHint })}`;
  }
  return block;
}

/** /platform 内置池（不含 Canvas-only：Seedance/漫剧/反推/场景资产） */
export const PLATFORM_BUILTIN_SKILL_IDS = [
  "director-craft",
  "json-director-middleware",
  "xhs-virtual-goods",
  "cultural-diversity",
  "lifestyle-diversity",
  "hook-solution-cta",
  "platform-native",
  "review-safe-voice",
  "cover-stop-scroll",
  "blue-ocean-natural",
  "batch-arc-engagement",
  "graphic-note-rhythm",
  "xhs-collectible-note",
  "contrast-reversal-climax",
  "crossover-popsci",
  "medical-resource-library",
  "vivid-anti-boring",
  "4season-fmcg-popsci",
  "label-debunk-copy",
  "authority-cite-endorsement",
  "fmcg-popsci-monetize",
  "forensic-life-lens",
] as const;

export type PlatformBuiltinSkillId = (typeof PLATFORM_BUILTIN_SKILL_IDS)[number];

export {
  CANVAS_ONLY_SKILL_IDS,
  isCanvasOnlySkillId,
  groupPlatformSkillsByCategory,
  resolvePlatformSkillCategory,
  PLATFORM_SKILL_CATEGORY_ORDER,
  type CanvasOnlySkillId,
} from "./platformSkillCategories.js";
