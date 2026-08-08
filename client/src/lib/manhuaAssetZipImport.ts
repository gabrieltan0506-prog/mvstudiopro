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
};

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

  for (const entry of plan.kept) {
    if (entry.skip) continue;
    if (entry.category === "script" || entry.category === "manifest") continue;
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
  };
}
