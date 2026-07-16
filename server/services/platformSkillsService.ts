import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  composePlatformSkillsPromptBlock,
  isCanvasOnlySkillId,
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
      // Canvas 专用 md 留在目录供文档，但不进 /platform 内置池
      if (isCanvasOnlySkillId(id)) continue;
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
 * - `enabledSkillIds === null/undefined`：池 = 全部 defaultEnabled
 * - `[]`：不注入任何 Skill（用户全取消勾选）
 * - 非空数组：池 = 所列 id
 * - `skillRouteMode` 默认 `auto`：按 routeContext 从池中挑子集；`all` = 旧行为全量注入池内全部
 */
export async function resolvePlatformSkillsPrompt(params: {
  userId: number | string;
  enabledSkillIds?: string[] | null;
  /** UI 开关：默认 false = 禁止空壳「博主/创作者」 */
  allowBloggerTitle?: boolean;
  /** 选题/标题/人设等，供自动路由打分 */
  routeContext?: string | null;
  sheetKind?: "graphic" | "video" | "unknown" | null;
  skillRouteMode?: "auto" | "all" | null;
}): Promise<string> {
  const all = await listAllPlatformSkillsForUser(params.userId);
  const { resolveSkillPoolIds, routePlatformSkillIds } = await import(
    "../../shared/platformSkillRouter.js"
  );

  const fallbackPoolIds =
    params.enabledSkillIds == null ? all.filter((s) => s.defaultEnabled).map((s) => s.id) : [];
  const poolIds = resolveSkillPoolIds({
    enabledSkillIds: params.enabledSkillIds,
    fallbackPoolIds,
  });

  if (poolIds.length === 0) {
    const { composeBloggerTitlePolicyPrompt } = await import("../../shared/platformNativeVariants.js");
    const { PLATFORM_USER_PROMPT_OVERRIDES_SKILLS_RULE } = await import("../../shared/platformSkills.js");
    return [PLATFORM_USER_PROMPT_OVERRIDES_SKILLS_RULE, composeBloggerTitlePolicyPrompt(Boolean(params.allowBloggerTitle))]
      .filter(Boolean)
      .join("\n\n");
  }

  const mode = params.skillRouteMode === "all" ? "all" : "auto";
  let selectedIds = poolIds;
  if (mode === "auto") {
    const routed = routePlatformSkillIds({
      poolIds,
      context: params.routeContext || "",
      sheetKind: params.sheetKind || "unknown",
    });
    selectedIds = routed.selectedIds;
    console.info(
      `[platformSkills] route mode=auto lane=${routed.primaryLane} selected=${selectedIds.join(",") || "(none)"} reasons=${routed.reasons.slice(0, 6).join(" | ")}`,
    );
  } else {
    console.info(`[platformSkills] route mode=all count=${selectedIds.length}`);
  }

  const byId = new Map(all.map((s) => [s.id, s]));
  const selected = selectedIds.map((id) => byId.get(id)).filter(Boolean) as typeof all;
  const skills = composePlatformSkillsPromptBlock(selected);
  const { composeBloggerTitlePolicyPrompt } = await import("../../shared/platformNativeVariants.js");
  const blogger = composeBloggerTitlePolicyPrompt(Boolean(params.allowBloggerTitle));
  return [skills, blogger].filter(Boolean).join("\n\n");
}

/**
 * Stage2 六维：为每条 blueprint 生成**不同赛道**的 Skill Prompt。
 */
export async function resolveDiverseDimensionSkillsPrompts(params: {
  userId: number | string;
  enabledSkillIds?: string[] | null;
  allowBloggerTitle?: boolean;
  routeContext?: string | null;
  dimensions: Array<{ dimIndex: number; dimName: string; seedText?: string | null }>;
  sheetKindForDim?: (dimIndex: number) => "graphic" | "video" | "unknown";
}): Promise<{
  poolIds: string[];
  plans: Array<{
    dimIndex: number;
    dimName: string;
    lane: string;
    selectedIds: string[];
    prompt: string;
  }>;
}> {
  const all = await listAllPlatformSkillsForUser(params.userId);
  const { resolveSkillPoolIds, planDiverseBlueprintSkillRoutes } = await import(
    "../../shared/platformSkillRouter.js"
  );
  const { composeBloggerTitlePolicyPrompt } = await import("../../shared/platformNativeVariants.js");
  const blogger = composeBloggerTitlePolicyPrompt(Boolean(params.allowBloggerTitle));

  const fallbackPoolIds =
    params.enabledSkillIds == null ? all.filter((s) => s.defaultEnabled).map((s) => s.id) : [];
  const poolIds = resolveSkillPoolIds({
    enabledSkillIds: params.enabledSkillIds,
    fallbackPoolIds,
  });

  if (poolIds.length === 0) {
    const { PLATFORM_USER_PROMPT_OVERRIDES_SKILLS_RULE } = await import("../../shared/platformSkills.js");
    const emptyPrompt = [PLATFORM_USER_PROMPT_OVERRIDES_SKILLS_RULE, blogger].filter(Boolean).join("\n\n");
    return {
      poolIds: [],
      plans: params.dimensions.map((d) => ({
        dimIndex: d.dimIndex,
        dimName: d.dimName,
        lane: "default",
        selectedIds: [],
        prompt: emptyPrompt,
      })),
    };
  }

  const routes = planDiverseBlueprintSkillRoutes({
    poolIds,
    baseContext: params.routeContext || "",
    dimensions: params.dimensions,
    sheetKindForDim: params.sheetKindForDim,
  });

  const byId = new Map(all.map((s) => [s.id, s]));
  const plans = routes.map((r) => {
    const selected = r.selectedIds.map((id) => byId.get(id)).filter(Boolean) as typeof all;
    const skills = composePlatformSkillsPromptBlock(selected);
    const prompt = [skills, blogger].filter(Boolean).join("\n\n");
    console.info(
      `[platformSkills] diverse dim=${r.dimIndex + 1} lane=${r.lane} skills=${r.selectedIds.join(",")}`,
    );
    return {
      dimIndex: r.dimIndex,
      dimName: r.dimName,
      lane: r.lane,
      selectedIds: r.selectedIds,
      prompt,
    };
  });

  return { poolIds, plans };
}

export { composePlatformSkillsPromptBlock };
