/**
 * 漫剧成片坞：扫描画布产物 + 浏览器 JSZip 工程包导出（不含长片拼接）。
 */

import JSZip from "jszip";
import type { CanvasBlock } from "./canvasTypes";
import { getBlockEpisodeIndex, stageKeyFromBlockId, type ManhuaFactoryStageKey } from "./canvasDramaStudio";

export const MANHUA_CLIP_DOCK_STAGES = ["recap_card", "keyart", "clip", "omni_edit", "story"] as const;
export type ManhuaClipDockStage = (typeof MANHUA_CLIP_DOCK_STAGES)[number];

export type ManhuaClipDockItem = {
  blockId: string;
  stage: ManhuaFactoryStageKey;
  episodeIndex: number;
  episodeTitle?: string;
  label: string;
  outputUrl?: string;
  outputText?: string;
  kind: CanvasBlock["kind"];
};

const STAGE_FILE: Partial<Record<ManhuaFactoryStageKey, { base: string; extHint: "jpg" | "mp4" | "md" }>> = {
  recap_card: { base: "recap_card", extHint: "jpg" },
  keyart: { base: "keyart", extHint: "jpg" },
  clip: { base: "clip", extHint: "mp4" },
  omni_edit: { base: "omni_edit", extHint: "mp4" },
  story: { base: "story", extHint: "md" },
};

export type CollectManhuaClipDockItemsOpts = {
  /**
   * 为 true 时，无产出的 story 节点也会进坞（用于「运行范围·坞内勾选集」；导出仍会跳过空产物）。
   * 默认 true。
   */
  includePendingStory?: boolean;
};

export function collectManhuaClipDockItems(
  blocks: CanvasBlock[],
  opts?: CollectManhuaClipDockItemsOpts,
): ManhuaClipDockItem[] {
  const includePendingStory = opts?.includePendingStory !== false;
  const items: ManhuaClipDockItem[] = [];
  for (const b of blocks) {
    const stage = stageKeyFromBlockId(b.id);
    if (!stage || !MANHUA_CLIP_DOCK_STAGES.includes(stage as ManhuaClipDockStage)) continue;
    const hasMedia = Boolean(b.outputUrl || (b.outputUrls && b.outputUrls[0]));
    const hasText = Boolean(b.outputText?.trim()) && stage === "story";
    const pendingStory = stage === "story" && includePendingStory && !hasText;
    if (!hasMedia && !hasText && !pendingStory) continue;
    const episodeIndex = getBlockEpisodeIndex(b) ?? 1;
    items.push({
      blockId: b.id,
      stage,
      episodeIndex,
      episodeTitle: b.episodeTitle,
      label:
        stage === "recap_card"
          ? "前情提要片头"
          : stage === "keyart"
            ? "关键静帧"
            : stage === "clip"
              ? "微动成片"
              : stage === "omni_edit"
                ? "视频改写"
                : pendingStory
                  ? "故事链（待跑·可勾选运行）"
                  : "故事大纲",
      outputUrl: b.outputUrl || b.outputUrls?.[0],
      outputText: b.outputText,
      kind: b.kind,
    });
  }
  return items.sort((a, b) => a.episodeIndex - b.episodeIndex || a.stage.localeCompare(b.stage));
}

/** 是否有可写入 zip 的产出 */
export function manhuaClipDockItemHasExportableOutput(item: ManhuaClipDockItem): boolean {
  if (item.stage === "story") return Boolean(item.outputText?.trim());
  return Boolean(item.outputUrl);
}

export function episodeIndexesFromDockSelection(
  items: ManhuaClipDockItem[],
  selectedIds: Set<string> | string[],
): number[] {
  const set = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  const eps = new Set<number>();
  for (const it of items) {
    if (set.has(it.blockId)) eps.add(it.episodeIndex);
  }
  return Array.from(eps).sort((a, b) => a - b);
}

function guessExt(url: string, hint: "jpg" | "mp4" | "md"): string {
  const path = String(url || "").split("?")[0] || "";
  const m = path.match(/\.([a-z0-9]{2,5})$/i);
  if (m) return m[1]!.toLowerCase();
  return hint;
}

export type ManhuaProjectExportManifest = {
  format: "mv-manhua-project-v1";
  topic: string;
  seriesTitle?: string;
  exportedAt: string;
  note: string;
  characters?: string[];
  artStyleId?: string;
  selected: Array<{
    blockId: string;
    episodeIndex: number;
    episodeTitle?: string;
    stage: string;
    path?: string;
  }>;
  failed: Array<{ blockId: string; url?: string; error: string }>;
};

export type ExportManhuaProjectZipOpts = {
  items: ManhuaClipDockItem[];
  selectedIds: string[];
  topic?: string;
  seriesTitle?: string;
  characterIds?: string[];
  artStyleId?: string;
};

export type ExportManhuaProjectZipResult = {
  blob: Blob;
  filename: string;
  manifest: ManhuaProjectExportManifest;
  okCount: number;
  failCount: number;
};

async function fetchAsArrayBuffer(url: string): Promise<ArrayBuffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.arrayBuffer();
}

function triggerDownload(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

/** 勾选产物 → zip（manifest + epXX/…）；失败项写入 manifest.failed */
export async function exportManhuaProjectZip(
  opts: ExportManhuaProjectZipOpts,
): Promise<ExportManhuaProjectZipResult> {
  const selectedSet = new Set(opts.selectedIds);
  const selected = opts.items.filter(
    (it) => selectedSet.has(it.blockId) && manhuaClipDockItemHasExportableOutput(it),
  );
  if (!selected.length) {
    throw new Error("请先勾选至少一个已有产物的静帧或成片（仅勾选待跑集不能导出）");
  }

  const zip = new JSZip();
  const failed: ManhuaProjectExportManifest["failed"] = [];
  const selectedMeta: ManhuaProjectExportManifest["selected"] = [];
  let okCount = 0;

  for (const it of selected) {
    const epFolder = `ep${String(it.episodeIndex).padStart(2, "0")}`;
    const fileMeta = STAGE_FILE[it.stage];
    if (!fileMeta) continue;

    if (it.stage === "story" && it.outputText?.trim()) {
      const path = `${epFolder}/story.md`;
      zip.file(path, it.outputText.trim());
      selectedMeta.push({
        blockId: it.blockId,
        episodeIndex: it.episodeIndex,
        episodeTitle: it.episodeTitle,
        stage: it.stage,
        path,
      });
      okCount += 1;
      continue;
    }

    const url = it.outputUrl;
    if (!url) {
      failed.push({ blockId: it.blockId, error: "无 outputUrl" });
      selectedMeta.push({
        blockId: it.blockId,
        episodeIndex: it.episodeIndex,
        episodeTitle: it.episodeTitle,
        stage: it.stage,
      });
      continue;
    }

    try {
      const buf = await fetchAsArrayBuffer(url);
      const ext = guessExt(url, fileMeta.extHint);
      const path = `${epFolder}/${fileMeta.base}.${ext}`;
      zip.file(path, buf);
      selectedMeta.push({
        blockId: it.blockId,
        episodeIndex: it.episodeIndex,
        episodeTitle: it.episodeTitle,
        stage: it.stage,
        path,
      });
      okCount += 1;
    } catch (e: unknown) {
      failed.push({
        blockId: it.blockId,
        url,
        error: e instanceof Error ? e.message : "下载失败",
      });
      selectedMeta.push({
        blockId: it.blockId,
        episodeIndex: it.episodeIndex,
        episodeTitle: it.episodeTitle,
        stage: it.stage,
      });
    }
  }

  const manifest: ManhuaProjectExportManifest = {
    format: "mv-manhua-project-v1",
    topic: String(opts.topic || "").trim(),
    seriesTitle: opts.seriesTitle,
    exportedAt: new Date().toISOString(),
    note: "本包为素材工程包，不含自动拼接长片。可本地/桌面工具自行拼接。",
    characters: opts.characterIds,
    artStyleId: opts.artStyleId,
    selected: selectedMeta,
    failed,
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  const blob = await zip.generateAsync({ type: "blob" });
  const firstEp = selected[0]!.episodeIndex;
  const multi = new Set(selected.map((s) => s.episodeIndex)).size > 1;
  const filename = multi
    ? `mv-manhua-series.zip`
    : `mv-manhua-ep${String(firstEp).padStart(2, "0")}.zip`;

  return { blob, filename, manifest, okCount, failCount: failed.length };
}

export async function downloadManhuaProjectZip(opts: ExportManhuaProjectZipOpts): Promise<ExportManhuaProjectZipResult> {
  const result = await exportManhuaProjectZip(opts);
  triggerDownload(result.blob, result.filename);
  return result;
}
