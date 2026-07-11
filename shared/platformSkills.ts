/**
 * /platform 可挂载 Skill：内置 md + 用户上传，勾选后注入生成 Prompt。
 */

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
export function composePlatformSkillsPromptBlock(skills: PlatformSkillRecord[]): string {
  const list = (skills || []).filter((s) => s && String(s.body || "").trim());
  if (list.length === 0) return "";
  const parts = list.map((s, i) => {
    const head = `### Skill ${i + 1}: ${s.name}（id=${s.id} · ${s.source}）`;
    return `${head}\n${String(s.body).trim()}`;
  });
  return `【Platform 挂载 Skill·强制遵守】
以下 Skill 由用户在 /platform 勾选启用。生成选题、文案、分镜、灯光、运镜、图文笔记时**必须**遵守；与旧有软建议冲突时，以本块为准。
成稿仍禁止堆导演名/片名致敬（若启用了导演手法 Skill）。

${parts.join("\n\n---\n\n")}`;
}

export const PLATFORM_BUILTIN_SKILL_IDS = [
  "director-craft",
  "cultural-diversity",
  "lifestyle-diversity",
  "hook-solution-cta",
  "platform-native",
  "review-safe-voice",
  "cover-stop-scroll",
  "blue-ocean-natural",
  "batch-arc-engagement",
  "graphic-note-rhythm",
  "contrast-reversal-climax",
] as const;

export type PlatformBuiltinSkillId = (typeof PLATFORM_BUILTIN_SKILL_IDS)[number];
