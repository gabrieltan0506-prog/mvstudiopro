/**
 * 漫剧资产 ZIP 导入：JSZip 解压 → 分类/去重 → GCS 上传 → 写 customAssetRefs / 导演板裁切。
 */

import JSZip from "jszip";
import {
  dedupeManhuaAssetZipEntriesByHash,
  planManhuaAssetZipImport,
  type ManhuaZipEntryCategory,
} from "@shared/manhuaAssetZipImportPlan";
import {
  makeManhuaCustomAssetId,
  type ManhuaCustomAssetRef,
  type ManhuaCustomAssetRole,
} from "@shared/manhuaCustomAssetRefs";

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function categoryToRole(cat: ManhuaZipEntryCategory): ManhuaCustomAssetRole | null {
  if (cat === "character") return "character";
  if (cat === "scene") return "scene";
  if (cat === "prop") return "prop";
  return null;
}

function episodeFromDirectorBoardPath(path: string): number | null {
  const m = path.match(/第\s*0*(\d+)\s*集/);
  if (m) return Math.max(1, Number(m[1]));
  const m2 = path.match(/(?:ep|e|episode)[_-]?0*(\d+)/i);
  if (m2) return Math.max(1, Number(m2[1]));
  return null;
}

export type ManhuaAssetZipImportResult = {
  addedRefs: ManhuaCustomAssetRef[];
  directorBoards: Array<{ episodeIndex: number; boardUrl: string; gcsUri?: string }>;
  skippedCount: number;
  droppedDupes: number;
  /**
   * `script/` 目录里的剧本文本，按「能不能撑满一集」从优到劣排好序。
   *
   * 分类器早就把 `script/**` 归成 script 类（见 manhuaAssetZipImportPlan 的注释
   * 「script/ → script（走剧本导入器）」），但这里过去一行 `continue` 全丢掉了，
   * 于是用户明明把剧本打进了包，还要再手动导一次文本——而且先导资产再导剧本
   * 会被换剧逻辑判成「旧资产」清空。把文本带出来，调用方就能先写剧本再挂资产。
   */
  scripts: Array<{ path: string; text: string; charCount: number; dialogueCount: number }>;
};

/**
 * 剧本稿的「够不够拍」评分：正文字数 + 「」对白句数。
 *
 * 与编剧门禁同口径——一个包里常同时躺着梗概版与带对白版（本仓 2026-08-04 的
 * 雁门资产包就是），梗概版会被密度门禁直接拦下。按这个分数排序，让调用方先拿到
 * 真正拍得出来的那份，而不是文件名最像的那份。
 */
function scoreManhuaScriptText(text: string): { charCount: number; dialogueCount: number } {
  return {
    charCount: text.replace(/\s/g, "").length,
    dialogueCount: (text.match(/「[^」]+」/g) || []).length,
  };
}

export async function importManhuaAssetZipFile(opts: {
  file: File;
  getSignedUploadUrl: (input: {
    fileName: string;
    mimeType: string;
    objectName?: string;
  }) => Promise<{ uploadUrl: string; requiredHeaders?: Record<string, string>; gcsUri?: string }>;
  uploadOne: (file: File, index: number) => Promise<{ url: string; gcsUri?: string }>;
}): Promise<ManhuaAssetZipImportResult> {
  const zip = await JSZip.loadAsync(await opts.file.arrayBuffer());
  const paths = Object.keys(zip.files).filter((p) => !zip.files[p]?.dir);
  const plan = planManhuaAssetZipImport(paths);

  const withHash: Array<{
    path: string;
    category: ManhuaZipEntryCategory;
    sha256: string;
    blob: Blob;
  }> = [];

  const scripts: ManhuaAssetZipImportResult["scripts"] = [];

  for (const entry of plan.kept) {
    if (entry.skip) continue;
    if (entry.category === "script") {
      // 分类器早就把 script/ 归好类了，这里过去直接 continue 丢掉，白白让用户再导一次
      if (!/\.(md|txt)$/i.test(entry.path)) continue;
      const zf = zip.file(entry.path);
      if (!zf) continue;
      const text = await zf.async("string");
      if (!text.trim()) continue;
      scripts.push({ path: entry.path, text, ...scoreManhuaScriptText(text) });
      continue;
    }
    if (entry.category === "manifest") continue;
    const zf = zip.file(entry.path);
    if (!zf) continue;
    const buf = await zf.async("arraybuffer");
    const lower = entry.path.toLowerCase();
    if (!/\.(png|jpe?g|webp|gif)$/i.test(lower)) continue;
    const sha256 = await sha256Hex(buf);
    const mime = lower.endsWith(".png")
      ? "image/png"
      : lower.endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";
    withHash.push({
      path: entry.path,
      category: entry.category,
      sha256,
      blob: new Blob([buf], { type: mime }),
    });
  }

  const deduped = dedupeManhuaAssetZipEntriesByHash(
    withHash.map(({ path, category, sha256 }) => ({ path, category, sha256 })),
  );
  const keepSet = new Set(deduped.keep.map((k) => k.path));
  const keepFiles = withHash.filter((w) => keepSet.has(w.path));

  const addedRefs: ManhuaCustomAssetRef[] = [];
  const directorBoards: ManhuaAssetZipImportResult["directorBoards"] = [];
  let index = 0;

  for (const item of keepFiles) {
    const base = item.path.split("/").pop() || "asset.png";
    const file = new File([item.blob], base, { type: item.blob.type || "image/png" });
    const uploaded = await opts.uploadOne(file, index++);
    const url = String(uploaded.url || "").trim();
    if (!/^https?:\/\//i.test(url)) continue;

    if (item.category === "directorBoard") {
      const ep = episodeFromDirectorBoardPath(item.path) || directorBoards.length + 1;
      directorBoards.push({
        episodeIndex: ep,
        boardUrl: url,
        gcsUri: uploaded.gcsUri,
      });
      continue;
    }

    const role = categoryToRole(item.category);
    if (!role) continue;
    addedRefs.push({
      id: makeManhuaCustomAssetId(),
      url,
      gcsUri: uploaded.gcsUri,
      role,
      labelZh: base.replace(/\.[^.]+$/, "").slice(0, 40) || "导入资产",
      source: "upload",
    });
  }

  return {
    addedRefs,
    directorBoards,
    skippedCount: plan.skipped.length,
    droppedDupes: deduped.dropped.length,
    /**
     * 先按「有没有对白」分两档，再按正文长度排。
     *
     * 不能单按 dialogueCount 排：一份极短但含一句「」的文件会压过完整剧本。
     * 密度门禁两条都要过（正文 ≥196 字/集、对白 ≥12 句/集），所以先筛出带对白的，
     * 再在其中取最长的那份——梗概版通常既短又几乎没有「」，自然排到后面。
     */
    scripts: scripts.sort(
      (a, b) =>
        Number(b.dialogueCount > 0) - Number(a.dialogueCount > 0) || b.charCount - a.charCount,
    ),
  };
}
