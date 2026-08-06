/**
 * 资产包 ZIP 导入：目录名归类 + 显式文件名过滤 + 按内容哈希去重。
 *
 * 只做「计划」这一步的纯函数（不摸 JSZip/GCS）：真正读文件、算哈希、传 GCS
 * 由调用方负责，这里只负责「这个路径该归哪类、要不要跳过、重复的哪张该留」。
 * 之所以拆成纯函数：资产包结构（六个目录 + 剧本 + 命名映射）、.DS_Store 过滤、
 * 去重规则都是可以脱离浏览器/Node 环境单测的确定性逻辑。
 */

export type ManhuaZipEntryCategory =
  | "character"
  | "scene"
  | "prop"
  | "directorBoard"
  | "script"
  | "manifest";

/** 明确跳过：原始拼板副本会重复、系统隐藏文件不是资产 */
export type ManhuaZipEntrySkipReason = "hiddenSystemFile" | "sourceSheetsCopy" | "unrecognized";

export type ManhuaZipEntryClassification =
  | { path: string; skip: false; category: ManhuaZipEntryCategory }
  | { path: string; skip: true; reason: ManhuaZipEntrySkipReason };

/** macOS 打包 ZIP 常见噪音：.DS_Store 与 AppleDouble 的 ._* 影子文件 */
const HIDDEN_SYSTEM_FILE_RE = /(^|\/)(\.DS_Store|\._[^/]*)$/i;

function normalizeZipPath(path: string): string {
  return String(path || "").replace(/^\/+/, "").replace(/\\/g, "/");
}

function dirTop(path: string): string {
  // 目录名可能出现在 zip 内任意层级（如 _asset_pack_xx/assets/characters/...），
  // 按「路径里出现过 characters/ 这一段」判断，不要求它是最外层。
  const parts = normalizeZipPath(path).split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

/**
 * 按目录名归类单条 ZIP entry 路径。六个资产目录 + 剧本目录 + 命名映射 json：
 *   characters/      → character
 *   scenes/          → scene
 *   props/           → prop（拼板走 PR③ 裁切，这里只管归类）
 *   costumes/        → prop（服装已并进 wardrobePropZh 单字段，不单开一栏）
 *   director_boards/ → directorBoard（导入后裁一份仅主画面供垫图，原图留预览）
 *   source_sheets/   → 跳过（原始拼板副本，导进去会与切图重复）
 *   script/          → script（走 PR① 的剧本导入器）
 *   asset_canon.json / manifest.json → manifest（命名映射）
 */
export function classifyManhuaAssetZipEntryPath(rawPath: string): ManhuaZipEntryClassification {
  const path = normalizeZipPath(rawPath);
  const base = path.split("/").pop() || "";

  if (HIDDEN_SYSTEM_FILE_RE.test(`/${base}`) || HIDDEN_SYSTEM_FILE_RE.test(path)) {
    return { path, skip: true, reason: "hiddenSystemFile" };
  }
  if (/(^|\/)(asset_canon|manifest)\.json$/i.test(path)) {
    return { path, skip: false, category: "manifest" };
  }
  const segments = dirTop(path).split("/");
  if (segments.includes("characters")) return { path, skip: false, category: "character" };
  if (segments.includes("scenes")) return { path, skip: false, category: "scene" };
  if (segments.includes("props")) return { path, skip: false, category: "prop" };
  if (segments.includes("costumes")) return { path, skip: false, category: "prop" };
  if (segments.includes("director_boards")) return { path, skip: false, category: "directorBoard" };
  if (segments.includes("source_sheets")) return { path, skip: true, reason: "sourceSheetsCopy" };
  if (segments.includes("script")) return { path, skip: false, category: "script" };
  return { path, skip: true, reason: "unrecognized" };
}

export type ManhuaZipImportPlan = {
  kept: ManhuaZipEntryClassification[];
  skipped: ManhuaZipEntryClassification[];
  byCategory: Record<ManhuaZipEntryCategory, string[]>;
};

/** 批量归类；调用方先拿到 zip 里全部文件路径列表 */
export function planManhuaAssetZipImport(paths: string[]): ManhuaZipImportPlan {
  const kept: ManhuaZipEntryClassification[] = [];
  const skipped: ManhuaZipEntryClassification[] = [];
  const byCategory: Record<ManhuaZipEntryCategory, string[]> = {
    character: [],
    scene: [],
    prop: [],
    directorBoard: [],
    script: [],
    manifest: [],
  };
  for (const raw of paths) {
    const c = classifyManhuaAssetZipEntryPath(raw);
    if (c.skip) {
      skipped.push(c);
      continue;
    }
    kept.push(c);
    byCategory[c.category].push(c.path);
  }
  return { kept, skipped, byCategory };
}

export type ManhuaZipEntryWithHash = {
  path: string;
  category: ManhuaZipEntryCategory;
  sha256: string;
};

export type ManhuaZipDedupeResult = {
  /** 每个内容哈希只留第一次出现的那份 */
  keep: ManhuaZipEntryWithHash[];
  /** 被判为重复、跳过导入的路径（连同它复用的那份 keep 路径） */
  dropped: { path: string; duplicateOfPath: string }[];
};

/**
 * 按图片内容 SHA256 去重：_workflow_run/tiles/、_asset_pack_xx/assets/ 与根目录
 * 常见同一份资产的三份副本。保留顺序里第一次出现的那份（通常是正式目录下的）。
 */
export function dedupeManhuaAssetZipEntriesByHash(
  entries: ManhuaZipEntryWithHash[],
): ManhuaZipDedupeResult {
  const firstPathBySha: Map<string, string> = new Map();
  const keep: ManhuaZipEntryWithHash[] = [];
  const dropped: { path: string; duplicateOfPath: string }[] = [];
  for (const e of entries) {
    const sha = String(e.sha256 || "").trim();
    if (!sha) {
      keep.push(e);
      continue;
    }
    const firstPath = firstPathBySha.get(sha);
    if (!firstPath) {
      firstPathBySha.set(sha, e.path);
      keep.push(e);
    } else {
      dropped.push({ path: e.path, duplicateOfPath: firstPath });
    }
  }
  return { keep, dropped };
}
