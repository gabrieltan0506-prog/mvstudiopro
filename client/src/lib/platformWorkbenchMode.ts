/**
 * Platform 双模式工作台：URL / localStorage 记忆、草稿、预设与漏斗事件。
 * 工作目录：client/src/lib/platformWorkbenchMode.ts
 */

export type PlatformWorkbenchMode = "create" | "trend" | "tools";

export type PlatformCreateStepId =
  | "persona"
  | "skills"
  | "topics"
  | "copy"
  | "output"
  | "result";

export type PlatformOutputType = "single_page" | "storyboard_2x4" | "optimize_article";

export type PlatformStructuredPersona = {
  identity: string;
  domain: string;
  audience: string;
  businessGoal: string;
};

/** 草稿 schema v2：按账号隔离，不含模型推演/完整结果 */
export type PlatformWorkbenchDraft = {
  v: 2;
  userKey: string;
  updatedAt: string;
  mode: PlatformWorkbenchMode;
  /** 序列化结果；若 freeformOverride 则可能与 persona 不一致 */
  focusPrompt: string;
  persona: PlatformStructuredPersona;
  freeformOverride: boolean;
  enabledSkillIds: string[];
  topicShortlistCount: number;
  outputType: PlatformOutputType;
  createStep: PlatformCreateStepId;
};

export type PlatformConfigPreset = {
  id: string;
  name: string;
  savedAt: string;
  enabledSkillIds: string[];
  topicShortlistCount: number;
  outputType: PlatformOutputType;
  persona: PlatformStructuredPersona;
  focusPrompt: string;
};

export type PlatformRecentTask = {
  id: string;
  at: string;
  mode: PlatformWorkbenchMode;
  label: string;
  credits?: number;
};

export type PlatformFunnelEventName =
  | "mode_view"
  | "mode_switch"
  | "cta_click"
  | "cta_disabled"
  | "draft_save"
  | "draft_restore"
  | "preset_save"
  | "preset_apply"
  | "topic_shortlist_start"
  | "topic_shortlist_done"
  | "trend_start"
  | "fullcase_start"
  | "output_type_pick"
  | "skill_toggle"
  | "legacy_tab_mapped";

export type PlatformToolsQueryKey = "htmlPpt" | "matting" | "assets";

/** 旧「视频深度拆解」书签 → 明确映射到素材分析（assets），非静默无关工具 */
export const LEGACY_VIDEO_TAB_ALIASES = ["video", "deep-video", "video-deep"] as const;

const MODE_LS_KEY = "mvs.platform.workbench.mode.v1";
const DRAFT_LS_PREFIX = "mvs.platform.workbench.draft.v2.";
const DRAFT_LS_KEY_LEGACY = "mvs.platform.workbench.draft.v1";
const PRESETS_LS_PREFIX = "mvs.platform.workbench.presets.v2.";
const RECENT_LS_PREFIX = "mvs.platform.workbench.recent.v2.";
const FUNNEL_LS_KEY = "mvs.platform.workbench.funnel.v1";
const DEFAULT_SKILLS_LS_PREFIX = "mvs.platform.workbench.defaultSkills.v2.";

const FUNNEL_PROP_ALLOWLIST = new Set([
  "mode",
  "tool",
  "tab",
  "reason",
  "handler",
  "credits",
  "count",
  "step",
  "outputType",
  "legacy",
  "busy",
  "confirmKind",
]);

export const PLATFORM_CREATE_STEPS: Array<{
  id: PlatformCreateStepId;
  label: string;
  hint: string;
}> = [
  { id: "persona", label: "人物背景", hint: "身份 / 领域 / 受众 / 目标" },
  { id: "skills", label: "Skill", hint: "勾选启用与推荐" },
  { id: "topics", label: "选题初选", hint: "条数与成本同区" },
  { id: "copy", label: "文案 / 分镜", hint: "扩写与脚本" },
  { id: "output", label: "输出形式", hint: "三选一后再配" },
  { id: "result", label: "结果", hint: "原位出卡" },
];

export const EMPTY_STRUCTURED_PERSONA: PlatformStructuredPersona = {
  identity: "",
  domain: "",
  audience: "",
  businessGoal: "",
};

export const LEGACY_VIDEO_TO_ASSETS_HINT =
  "「视频深度拆解」已归入「更多工具 · 素材分析」。已为你打开素材分析。";

export function isPlatformWorkbenchMode(value: unknown): value is PlatformWorkbenchMode {
  return value === "create" || value === "trend" || value === "tools";
}

export function parsePlatformWorkbenchMode(raw: string | null | undefined): PlatformWorkbenchMode | null {
  const v = String(raw || "").trim().toLowerCase();
  if (isPlatformWorkbenchMode(v)) return v;
  return null;
}

export function readPlatformModeFromStorage(): PlatformWorkbenchMode | null {
  if (typeof window === "undefined") return null;
  try {
    return parsePlatformWorkbenchMode(window.localStorage.getItem(MODE_LS_KEY));
  } catch {
    return null;
  }
}

export function writePlatformModeToStorage(mode: PlatformWorkbenchMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MODE_LS_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function parsePlatformToolsQuery(raw: string | null | undefined): PlatformToolsQueryKey | null {
  const v = String(raw || "").trim();
  if (v === "htmlPpt" || v === "matting" || v === "assets") return v;
  return null;
}

/** 是否旧视频深度拆解别名（映射到 assets） */
export function isLegacyVideoTabAlias(raw: string | null | undefined): boolean {
  const v = String(raw || "").trim();
  return v === "video" || v === "deep-video" || v === "video-deep";
}

export type PlatformLocationResolved = {
  mode: PlatformWorkbenchMode;
  tool: PlatformToolsQueryKey;
  createTab: "copy" | "topic";
  legacyVideoMapped: boolean;
  /** 非法 mode/tool 是否被纠正 */
  normalized: boolean;
};

/**
 * URL 优先級：`?mode=` > localStorage > create。
 * 非法 mode → create（不读 LS）。
 * 旧 `tab=video|deep-video|video-deep` → tools + assets，并标记 legacyVideoMapped。
 */
export function resolvePlatformLocation(search?: string): PlatformLocationResolved {
  const params = new URLSearchParams(
    search ?? (typeof window !== "undefined" ? window.location.search : ""),
  );
  let normalized = false;
  let legacyVideoMapped = false;

  const modeParam = params.get("mode");
  let mode: PlatformWorkbenchMode;
  if (modeParam != null && String(modeParam).trim() !== "") {
    const parsed = parsePlatformWorkbenchMode(modeParam);
    mode = parsed ?? "create";
    if (!parsed) normalized = true;
  } else {
    const tab = params.get("tab");
    if (isLegacyVideoTabAlias(tab) || tab === "htmlPpt" || tab === "matting" || tab === "assets") {
      mode = "tools";
    } else if (tab === "copy" || tab === "topic") {
      mode = "create";
    } else {
      mode = readPlatformModeFromStorage() ?? "create";
    }
  }

  let tool: PlatformToolsQueryKey = "htmlPpt";
  const toolParam = params.get("tool");
  const tabParam = params.get("tab");
  if (mode === "tools") {
    const fromTool = parsePlatformToolsQuery(toolParam);
    if (fromTool) {
      tool = fromTool;
    } else if (isLegacyVideoTabAlias(toolParam) || isLegacyVideoTabAlias(tabParam)) {
      tool = "assets";
      legacyVideoMapped = true;
      normalized = true;
    } else if (tabParam === "htmlPpt" || tabParam === "matting" || tabParam === "assets") {
      tool = tabParam;
      normalized = Boolean(toolParam && !parsePlatformToolsQuery(toolParam));
    } else if (toolParam != null && String(toolParam).trim() !== "") {
      tool = "htmlPpt";
      normalized = true;
    } else {
      tool = "htmlPpt";
    }
  }

  let createTab: "copy" | "topic" = "copy";
  if (mode === "create") {
    createTab = tabParam === "topic" ? "topic" : "copy";
  }

  return { mode, tool, createTab, legacyVideoMapped, normalized };
}

export function resolveInitialPlatformMode(search?: string): PlatformWorkbenchMode {
  return resolvePlatformLocation(search).mode;
}

export function resolveInitialToolsTab(search?: string): PlatformToolsQueryKey {
  return resolvePlatformLocation(search).tool;
}

export function syncPlatformModeToUrl(
  mode: PlatformWorkbenchMode,
  opts?: {
    tool?: PlatformToolsQueryKey;
    createTab?: "copy" | "topic";
    /** push=用户切换可后退；replace=纠正非法 URL */
    history?: "push" | "replace";
  },
): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("mode", mode);
    if (mode === "tools") {
      const tool = opts?.tool ?? "htmlPpt";
      url.searchParams.set("tool", tool);
      // 规范 tab：assets 不再写 video（旧别名只读兼容）
      url.searchParams.set("tab", tool);
    } else if (mode === "create") {
      url.searchParams.delete("tool");
      url.searchParams.set("tab", opts?.createTab ?? "copy");
    } else {
      url.searchParams.delete("tool");
      url.searchParams.delete("tab");
    }
    const next = `${url.pathname}${url.search}${url.hash}`;
    const method = opts?.history === "push" ? "pushState" : "replaceState";
    window.history[method]({}, "", next);
  } catch {
    /* ignore */
  }
}

/** 将非法 / 旧别名 URL 规范为 mode+tool，保留其它业务 query */
export function normalizePlatformUrlInPlace(resolved?: PlatformLocationResolved): PlatformLocationResolved {
  const loc = resolved ?? resolvePlatformLocation();
  if (typeof window === "undefined") return loc;
  syncPlatformModeToUrl(loc.mode, {
    tool: loc.mode === "tools" ? loc.tool : undefined,
    createTab: loc.mode === "create" ? loc.createTab : undefined,
    history: "replace",
  });
  return loc;
}

export function composeFocusPromptFromPersona(persona: PlatformStructuredPersona): string {
  const parts = [
    persona.identity.trim() && `身份：${persona.identity.trim()}`,
    persona.domain.trim() && `领域：${persona.domain.trim()}`,
    persona.audience.trim() && `受众：${persona.audience.trim()}`,
    persona.businessGoal.trim() && `商业目标：${persona.businessGoal.trim()}`,
  ].filter(Boolean);
  return parts.join("\n");
}

export function parsePersonaFromFocusPrompt(focus: string): PlatformStructuredPersona {
  const text = String(focus || "");
  const pick = (label: string) => {
    const re = new RegExp(`${label}[：:]\\s*([^\\n]+)`);
    return text.match(re)?.[1]?.trim() || "";
  };
  const identity = pick("身份");
  const domain = pick("领域");
  const audience = pick("受众");
  const businessGoal = pick("商业目标");
  if (identity || domain || audience || businessGoal) {
    return { identity, domain, audience, businessGoal };
  }
  return { ...EMPTY_STRUCTURED_PERSONA };
}

function assertUserKey(userKey: string): string | null {
  const key = String(userKey || "").trim();
  // 禁止全体匿名共桶；调用方须在 auth hydration 后传入稳定 user.id
  if (!key || key === "anon") return null;
  return key;
}

function draftStorageKey(userKey: string): string {
  return `${DRAFT_LS_PREFIX}${userKey}`;
}

function namespaceKey(prefix: string, userKey: string): string {
  return `${prefix}${userKey}`;
}

export function readWorkbenchDraft(userKey: string): PlatformWorkbenchDraft | null {
  if (typeof window === "undefined") return null;
  const key = assertUserKey(userKey);
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(draftStorageKey(key));
    if (!raw) {
      // 迁移：忽略跨账号遗留 v1（不自动搬进当前账号）
      try {
        window.localStorage.removeItem(DRAFT_LS_KEY_LEGACY);
      } catch {
        /* ignore */
      }
      return null;
    }
    const parsed = JSON.parse(raw) as PlatformWorkbenchDraft;
    if (parsed?.v !== 2) return null;
    if (parsed.userKey && parsed.userKey !== key) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeWorkbenchDraft(
  userKey: string,
  draft: Omit<PlatformWorkbenchDraft, "v" | "updatedAt" | "userKey">,
): void {
  if (typeof window === "undefined") return;
  const key = assertUserKey(userKey);
  if (!key) return;
  try {
    const payload: PlatformWorkbenchDraft = {
      ...draft,
      v: 2,
      userKey: key,
      updatedAt: new Date().toISOString(),
    };
    // 仅存配置与背景，不写生成结果 / 推演日志
    window.localStorage.setItem(draftStorageKey(key), JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function clearWorkbenchDraft(userKey: string): void {
  if (typeof window === "undefined") return;
  const key = assertUserKey(userKey);
  if (!key) return;
  try {
    window.localStorage.removeItem(draftStorageKey(key));
  } catch {
    /* ignore */
  }
}

export function readConfigPresets(userKey: string): PlatformConfigPreset[] {
  if (typeof window === "undefined") return [];
  const key = assertUserKey(userKey);
  if (!key) return [];
  try {
    const raw = window.localStorage.getItem(namespaceKey(PRESETS_LS_PREFIX, key));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PlatformConfigPreset[];
    return Array.isArray(parsed) ? parsed.slice(0, 12) : [];
  } catch {
    return [];
  }
}

export function writeConfigPresets(userKey: string, presets: PlatformConfigPreset[]): void {
  if (typeof window === "undefined") return;
  const key = assertUserKey(userKey);
  if (!key) return;
  try {
    window.localStorage.setItem(
      namespaceKey(PRESETS_LS_PREFIX, key),
      JSON.stringify(presets.slice(0, 12)),
    );
  } catch {
    /* ignore */
  }
}

export function readRecentTasks(userKey: string): PlatformRecentTask[] {
  if (typeof window === "undefined") return [];
  const key = assertUserKey(userKey);
  if (!key) return [];
  try {
    const raw = window.localStorage.getItem(namespaceKey(RECENT_LS_PREFIX, key));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PlatformRecentTask[];
    return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function pushRecentTask(userKey: string, task: Omit<PlatformRecentTask, "id" | "at">): void {
  if (typeof window === "undefined") return;
  const key = assertUserKey(userKey);
  if (!key) return;
  try {
    const next: PlatformRecentTask = {
      ...task,
      id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at: new Date().toISOString(),
    };
    const prev = readRecentTasks(key).filter((x) => x.label !== next.label);
    window.localStorage.setItem(
      namespaceKey(RECENT_LS_PREFIX, key),
      JSON.stringify([next, ...prev].slice(0, 20)),
    );
  } catch {
    /* ignore */
  }
}

export function readDefaultSkillIds(userKey: string): string[] | null {
  if (typeof window === "undefined") return null;
  const key = assertUserKey(userKey);
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(namespaceKey(DEFAULT_SKILLS_LS_PREFIX, key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeDefaultSkillIds(userKey: string, ids: string[]): void {
  if (typeof window === "undefined") return;
  const key = assertUserKey(userKey);
  if (!key) return;
  try {
    window.localStorage.setItem(
      namespaceKey(DEFAULT_SKILLS_LS_PREFIX, key),
      JSON.stringify(ids.slice(0, 64)),
    );
  } catch {
    /* ignore */
  }
}

function sanitizeFunnelProps(
  props?: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!props) return out;
  for (const [k, v] of Object.entries(props)) {
    if (!FUNNEL_PROP_ALLOWLIST.has(k)) continue;
    if (v === undefined) continue;
    if (typeof v === "string") {
      // 拒绝疑似正文
      if (v.length > 64) continue;
      if (/身份：|领域：|受众：|商业目标：/.test(v)) continue;
      out[k] = v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

const FUNNEL_EVENT_ALLOWLIST = new Set<string>([
  "mode_view",
  "mode_switch",
  "cta_click",
  "cta_disabled",
  "draft_save",
  "draft_restore",
  "preset_save",
  "preset_apply",
  "topic_shortlist_start",
  "topic_shortlist_done",
  "trend_start",
  "fullcase_start",
  "output_type_pick",
  "skill_toggle",
  "legacy_tab_mapped",
]);

function funnelDedupeKey(
  name: string,
  props: Record<string, string | number | boolean>,
): string {
  // 事件名 + 关键维度，避免不同 CTA/模式被误合并
  const dims = ["mode", "tool", "tab", "handler", "reason", "step", "outputType", "legacy", "confirmKind"]
    .map((k) => `${k}=${props[k] ?? ""}`)
    .join("|");
  return `${name}|${dims}|credits=${props.credits ?? ""}|count=${props.count ?? ""}`;
}

export function trackPlatformFunnel(
  name: PlatformFunnelEventName,
  props?: Record<string, string | number | boolean | undefined>,
): void {
  if (typeof window === "undefined") return;
  // 运行时白名单（不只依赖 TypeScript）
  if (!FUNNEL_EVENT_ALLOWLIST.has(name)) return;
  try {
    const safeProps = sanitizeFunnelProps(props);
    const entry = {
      name,
      at: new Date().toISOString(),
      props: safeProps,
    };
    const raw = window.localStorage.getItem(FUNNEL_LS_KEY);
    let list: unknown[] = [];
    try {
      const prev = raw ? JSON.parse(raw) : [];
      list = Array.isArray(prev) ? prev : [];
    } catch {
      list = [];
    }
    const key = funnelDedupeKey(name, safeProps);
    const last = list[list.length - 1] as { name?: string; at?: string; props?: Record<string, string | number | boolean> } | undefined;
    if (
      last?.name &&
      last.at &&
      funnelDedupeKey(last.name, (last.props || {}) as Record<string, string | number | boolean>) === key &&
      Date.now() - Date.parse(last.at) < 5000
    ) {
      return;
    }
    list.push(entry);
    window.localStorage.setItem(FUNNEL_LS_KEY, JSON.stringify(list.slice(-200)));
    window.dispatchEvent(new CustomEvent("mvs:platform-funnel", { detail: entry }));
  } catch {
    /* ignore — 超额/解析失败不影响页面 */
  }
}

export function toolsTabFromMode(
  mode: PlatformWorkbenchMode,
  current: "copy" | "topic" | "matting" | "assets" | "htmlPpt",
): "copy" | "topic" | "matting" | "assets" | "htmlPpt" {
  if (mode === "create") {
    return current === "copy" || current === "topic" ? current : "copy";
  }
  if (mode === "tools") {
    return current === "htmlPpt" || current === "matting" || current === "assets" ? current : "htmlPpt";
  }
  return current;
}
