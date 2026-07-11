import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  composePlatformSkillsPromptBlock,
  parsePlatformSkillMarkdown,
  PLATFORM_BUILTIN_SKILL_IDS,
  type PlatformSkillRecord,
} from "../../shared/platformSkills.js";
import { storagePut, storageRead } from "../storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 仓库内置 Skill 目录：docs/2026Jul11/skill */
export function resolveBuiltinSkillsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "docs/2026Jul11/skill"),
    path.resolve(__dirname, "../../docs/2026Jul11/skill"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[0]!;
}

function localUserSkillsRoot(userId: number | string): string {
  return path.resolve(process.cwd(), ".data/platform-skills", String(userId));
}

let builtinCache: PlatformSkillRecord[] | null = null;

export function loadBuiltinPlatformSkills(forceReload = false): PlatformSkillRecord[] {
  if (builtinCache && !forceReload) return builtinCache;
  const dir = resolveBuiltinSkillsDir();
  const out: PlatformSkillRecord[] = [];
  for (const id of PLATFORM_BUILTIN_SKILL_IDS) {
    const filePath = path.join(dir, `${id}.md`);
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, "utf8");
    out.push(parsePlatformSkillMarkdown(raw, { id, source: "builtin" }));
  }
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".md") || /^readme\.md$/i.test(name)) continue;
      const id = name.replace(/\.md$/i, "");
      if (PLATFORM_BUILTIN_SKILL_IDS.includes(id as (typeof PLATFORM_BUILTIN_SKILL_IDS)[number])) continue;
      if (out.some((s) => s.id === id)) continue;
      const raw = fs.readFileSync(path.join(dir, name), "utf8");
      out.push(parsePlatformSkillMarkdown(raw, { id, source: "builtin" }));
    }
  } catch {
    /* ignore */
  }
  builtinCache = out;
  return out;
}

type UserSkillsManifest = {
  skills: Array<{
    id: string;
    name: string;
    description: string;
    version?: string;
    defaultEnabled: boolean;
    storageKey: string;
    updatedAt: string;
  }>;
};

function manifestKey(userId: number | string): string {
  return `platform-skills/${userId}/manifest.json`;
}

function skillObjectKey(userId: number | string, skillId: string): string {
  return `platform-skills/${userId}/${skillId}.md`;
}

async function readTextObject(key: string, userId: number | string): Promise<string | null> {
  try {
    const buf = await storageRead(key);
    if (buf && buf.length > 0) return buf.toString("utf8");
  } catch {
    /* fall through */
  }
  const localName = key.replace(/^platform-skills\/[^/]+\//, "");
  const localPath = path.join(localUserSkillsRoot(userId), localName);
  try {
    if (fs.existsSync(localPath)) return fs.readFileSync(localPath, "utf8");
  } catch {
    /* ignore */
  }
  return null;
}

async function writeTextObject(
  key: string,
  userId: number | string,
  text: string,
  contentType: string,
): Promise<string | undefined> {
  const body = Buffer.from(text, "utf8");
  try {
    const { url } = await storagePut(key, body, contentType);
    if (url && !url.startsWith("data:")) return url;
  } catch {
    /* local fallback */
  }
  const dir = localUserSkillsRoot(userId);
  fs.mkdirSync(dir, { recursive: true });
  const localName = key.replace(/^platform-skills\/[^/]+\//, "");
  const localPath = path.join(dir, localName);
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  fs.writeFileSync(localPath, body);
  return `file://${localPath}`;
}

export async function listUserPlatformSkills(userId: number | string): Promise<PlatformSkillRecord[]> {
  const raw = await readTextObject(manifestKey(userId), userId);
  if (!raw) return [];
  let manifest: UserSkillsManifest;
  try {
    manifest = JSON.parse(raw) as UserSkillsManifest;
  } catch {
    return [];
  }
  const out: PlatformSkillRecord[] = [];
  for (const row of manifest.skills || []) {
    const bodyRaw = await readTextObject(row.storageKey || skillObjectKey(userId, row.id), userId);
    if (!bodyRaw) continue;
    const parsed = parsePlatformSkillMarkdown(bodyRaw, {
      id: row.id,
      source: "user",
    });
    out.push({
      ...parsed,
      name: row.name || parsed.name,
      description: row.description || parsed.description,
      updatedAt: row.updatedAt,
    });
  }
  return out;
}

export async function listAllPlatformSkillsForUser(userId: number | string): Promise<PlatformSkillRecord[]> {
  const builtin = loadBuiltinPlatformSkills();
  const user = await listUserPlatformSkills(userId);
  const map = new Map<string, PlatformSkillRecord>();
  for (const s of builtin) map.set(s.id, s);
  for (const s of user) map.set(s.id, s);
  return Array.from(map.values());
}

export async function saveUserPlatformSkill(params: {
  userId: number | string;
  markdown: string;
  filenameHint?: string;
}): Promise<PlatformSkillRecord> {
  const hintId =
    String(params.filenameHint || "")
      .replace(/\.md$/i, "")
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .slice(0, 48) || `user-${Date.now().toString(36)}`;
  const parsed = parsePlatformSkillMarkdown(params.markdown, {
    id: hintId,
    source: "user",
  });
  const id = PLATFORM_BUILTIN_SKILL_IDS.includes(parsed.id as (typeof PLATFORM_BUILTIN_SKILL_IDS)[number])
    ? `user-${parsed.id}`
    : parsed.id.startsWith("user-")
      ? parsed.id
      : `user-${parsed.id}`;
  const record: PlatformSkillRecord = { ...parsed, id, source: "user", updatedAt: new Date().toISOString() };
  const key = skillObjectKey(params.userId, id);
  const mdToStore = `---\nid: ${id}\nname: ${JSON.stringify(record.name)}\ndescription: ${JSON.stringify(record.description)}\nversion: ${JSON.stringify(record.version || "")}\ndefaultEnabled: ${record.defaultEnabled}\n---\n\n${record.body}\n`;
  record.url = await writeTextObject(key, params.userId, mdToStore, "text/markdown; charset=utf-8");

  const existing = await listUserPlatformSkills(params.userId);
  const others = existing.filter((s) => s.id !== id);
  const manifest: UserSkillsManifest = {
    skills: [
      ...others.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        version: s.version,
        defaultEnabled: s.defaultEnabled,
        storageKey: skillObjectKey(params.userId, s.id),
        updatedAt: s.updatedAt || new Date().toISOString(),
      })),
      {
        id,
        name: record.name,
        description: record.description,
        version: record.version,
        defaultEnabled: record.defaultEnabled,
        storageKey: key,
        updatedAt: record.updatedAt!,
      },
    ],
  };
  await writeTextObject(
    manifestKey(params.userId),
    params.userId,
    JSON.stringify(manifest, null, 2),
    "application/json",
  );
  return record;
}

export async function deleteUserPlatformSkill(userId: number | string, skillId: string): Promise<boolean> {
  const id = String(skillId || "").trim();
  if (!id || !id.startsWith("user-")) return false;
  const existing = await listUserPlatformSkills(userId);
  const next = existing.filter((s) => s.id !== id);
  if (next.length === existing.length) return false;
  const manifest: UserSkillsManifest = {
    skills: next.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      version: s.version,
      defaultEnabled: s.defaultEnabled,
      storageKey: skillObjectKey(userId, s.id),
      updatedAt: s.updatedAt || new Date().toISOString(),
    })),
  };
  await writeTextObject(
    manifestKey(userId),
    userId,
    JSON.stringify(manifest, null, 2),
    "application/json",
  );
  try {
    const localPath = path.join(localUserSkillsRoot(userId), `${id}.md`);
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
  } catch {
    /* ignore */
  }
  return true;
}

/**
 * 按启用 id 列表解析并拼 Prompt。
 * - `enabledSkillIds === null/undefined`：用全部 defaultEnabled
 * - `[]`：不注入任何 Skill（用户全取消勾选）
 * - 非空数组：仅注入所列 id
 */
export async function resolvePlatformSkillsPrompt(params: {
  userId: number | string;
  enabledSkillIds?: string[] | null;
  /** UI 开关：默认 false = 禁止空壳「博主/创作者」 */
  allowBloggerTitle?: boolean;
}): Promise<string> {
  const all = await listAllPlatformSkillsForUser(params.userId);
  const enabledIds = Array.isArray(params.enabledSkillIds)
    ? params.enabledSkillIds.map(String).filter(Boolean)
    : null;
  const selected =
    enabledIds === null
      ? all.filter((s) => s.defaultEnabled)
      : all.filter((s) => enabledIds.includes(s.id));
  const skills = composePlatformSkillsPromptBlock(selected);
  const { composeBloggerTitlePolicyPrompt } = await import("../../shared/platformNativeVariants.js");
  const blogger = composeBloggerTitlePolicyPrompt(Boolean(params.allowBloggerTitle));
  return [skills, blogger].filter(Boolean).join("\n\n");
}

export { composePlatformSkillsPromptBlock };
