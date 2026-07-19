/**
 * 漫剧成片坞：扫描画布产物 + 浏览器 JSZip 工程包导出（不含长片拼接）。
 */

import JSZip from "jszip";
import {
  getManhuaDemoAssetPublicUrl,
  listManhuaDemoAssetsForSceneTemplate,
} from "@shared/manhuaScenePropDemoCatalog";
import { getManhuaCharacterPreviewUrl } from "@shared/manhuaCharacterAssetLibrary";
import type { CanvasBlock } from "./canvasTypes";
import { getBlockEpisodeIndex, stageKeyFromBlockId, type ManhuaFactoryStageKey } from "./canvasDramaStudio";

export const MANHUA_CLIP_DOCK_STAGES = [
  "recap_card",
  "story",
  "bible",
  "beats",
  "reverse",
  "keyart",
  "clip",
  "omni_edit",
] as const;
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
  bible: { base: "bible", extHint: "md" },
  beats: { base: "beats", extHint: "md" },
  reverse: { base: "reverse", extHint: "md" },
};

const TEXT_EXPORT_STAGES = new Set<ManhuaFactoryStageKey>(["story", "bible", "beats", "reverse"]);

const STAGE_LABEL_DOCK: Partial<Record<ManhuaFactoryStageKey, string>> = {
  recap_card: "前情提要片头",
  story: "故事大纲",
  bible: "角色卡",
  beats: "镜头节拍",
  reverse: "编导分镜/反推",
  keyart: "关键静帧",
  clip: "微动成片",
  omni_edit: "视频改写",
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
    const isTextStage = TEXT_EXPORT_STAGES.has(stage);
    const hasText = Boolean(b.outputText?.trim()) && isTextStage;
    const pendingStory = stage === "story" && includePendingStory && !hasText;
    if (!hasMedia && !hasText && !pendingStory) continue;
    const episodeIndex = getBlockEpisodeIndex(b) ?? 1;
    const baseLabel = STAGE_LABEL_DOCK[stage] || stage;
    items.push({
      blockId: b.id,
      stage,
      episodeIndex,
      episodeTitle: b.episodeTitle,
      label: pendingStory ? "故事链（待跑·可勾选运行）" : baseLabel,
      outputUrl: b.outputUrl || b.outputUrls?.[0],
      outputText: b.outputText,
      kind: b.kind,
    });
  }
  return items.sort((a, b) => a.episodeIndex - b.episodeIndex || a.stage.localeCompare(b.stage));
}

/** 是否有可写入 zip 的产出 */
export function manhuaClipDockItemHasExportableOutput(item: ManhuaClipDockItem): boolean {
  if (TEXT_EXPORT_STAGES.has(item.stage)) return Boolean(item.outputText?.trim());
  return Boolean(item.outputUrl);
}

/** 仅勾选已有可导出产物的项（跳过待跑） */
export function selectExportableDockIds(items: ManhuaClipDockItem[]): string[] {
  return items.filter(manhuaClipDockItemHasExportableOutput).map((i) => i.blockId);
}

/** 成片坞 → 长片合成入参（按集取 clip + keyart） */
export function collectManhuaAssembleClipsFromDock(
  items: ManhuaClipDockItem[],
  opts?: { selectedIds?: Set<string> | string[]; onlySelectedEpisodes?: boolean },
): Array<{
  episodeIndex: number;
  episodeTitle?: string;
  clipUrl?: string;
  keyartUrl?: string;
}> {
  const selected = opts?.selectedIds
    ? opts.selectedIds instanceof Set
      ? opts.selectedIds
      : new Set(opts.selectedIds)
    : null;
  const epFilter = new Set<number>();
  if (opts?.onlySelectedEpisodes && selected?.size) {
    for (const it of items) {
      if (selected.has(it.blockId)) epFilter.add(it.episodeIndex);
    }
  }
  const byEp = new Map<
    number,
    { episodeIndex: number; episodeTitle?: string; clipUrl?: string; keyartUrl?: string }
  >();
  for (const it of items) {
    if (epFilter.size && !epFilter.has(it.episodeIndex)) continue;
    const cur = byEp.get(it.episodeIndex) || {
      episodeIndex: it.episodeIndex,
      episodeTitle: it.episodeTitle,
    };
    if (it.episodeTitle) cur.episodeTitle = it.episodeTitle;
    if (it.stage === "clip" && it.outputUrl) cur.clipUrl = it.outputUrl;
    if ((it.stage === "keyart" || it.stage === "recap_card") && it.outputUrl) {
      cur.keyartUrl = cur.keyartUrl || it.outputUrl;
    }
    byEp.set(it.episodeIndex, cur);
  }
  return Array.from(byEp.values()).sort((a, b) => a.episodeIndex - b.episodeIndex);
}

export function summarizeManhuaDockExport(items: ManhuaClipDockItem[]): {
  episodeCount: number;
  exportableCount: number;
  pendingCount: number;
  byEpisode: Array<{ episodeIndex: number; exportable: number; pending: number }>;
} {
  const epMap = new Map<number, { exportable: number; pending: number }>();
  for (const it of items) {
    const cur = epMap.get(it.episodeIndex) || { exportable: 0, pending: 0 };
    if (manhuaClipDockItemHasExportableOutput(it)) cur.exportable += 1;
    else cur.pending += 1;
    epMap.set(it.episodeIndex, cur);
  }
  const byEpisode = Array.from(epMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([episodeIndex, v]) => ({ episodeIndex, ...v }));
  return {
    episodeCount: byEpisode.length,
    exportableCount: byEpisode.reduce((n, e) => n + e.exportable, 0),
    pendingCount: byEpisode.reduce((n, e) => n + e.pending, 0),
    byEpisode,
  };
}

function slugFilenamePart(raw: string | undefined | null): string {
  const s = String(raw || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 24);
  return s || "";
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
  sceneId?: string;
  /** 成片坞合成长片 URL（有则写入） */
  finalVideoUrl?: string;
  /** 库内可复用参考（人物设定卡 / 场景示范图路径） */
  libraryRefs?: Array<{ kind: "character" | "scene_demo" | "prop_demo"; id: string; path: string }>;
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
  /** 工厂主场景 scene_01…；导出时附带已落盘示范图（若可拉取） */
  sceneId?: string;
  /** 额外示范资产 id（道具等） */
  demoAssetIds?: string[];
  /** 默认 true：尝试把人物 sheet / 场景示范打进 library/ */
  includeLibraryRefs?: boolean;
  /** 浏览器同源拉取库图时用；测试可注入 */
  assetBaseUrl?: string;
  /** 编剧室已确认剧情包 Markdown（整包进 zip 根目录） */
  writerPackMarkdown?: string;
  /** 成片坞「合成长片」结果 URL，有则写入 README / manifest */
  finalVideoUrl?: string | null;
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

function resolveAssetUrl(pathOrUrl: string, base?: string): string {
  const raw = String(pathOrUrl || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const origin =
    String(base || "").replace(/\/$/, "") ||
    (typeof window !== "undefined" ? window.location.origin : "");
  if (!origin) return raw;
  return `${origin}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

/** 组装可打进 zip 的库参考清单（路径相对站点根） */
export function listManhuaExportLibraryRefPaths(opts: {
  characterIds?: string[];
  artStyleId?: string;
  sceneId?: string;
  demoAssetIds?: string[];
}): Array<{ kind: "character" | "scene_demo" | "prop_demo"; id: string; publicPath: string }> {
  const out: Array<{ kind: "character" | "scene_demo" | "prop_demo"; id: string; publicPath: string }> =
    [];
  const seen = new Set<string>();
  const push = (
    kind: "character" | "scene_demo" | "prop_demo",
    id: string,
    publicPath: string,
  ) => {
    if (!id || !publicPath || seen.has(publicPath)) return;
    seen.add(publicPath);
    out.push({ kind, id, publicPath });
  };

  for (const id of opts.characterIds || []) {
    const key = String(id || "").trim();
    const publicPath = getManhuaCharacterPreviewUrl(key, { artStyleId: opts.artStyleId });
    if (publicPath) push("character", key, publicPath);
  }
  for (const demo of listManhuaDemoAssetsForSceneTemplate(opts.sceneId)) {
    const publicPath = getManhuaDemoAssetPublicUrl(demo.id);
    if (publicPath) push("scene_demo", demo.id, publicPath);
  }
  for (const id of opts.demoAssetIds || []) {
    const key = String(id || "").trim();
    const publicPath = getManhuaDemoAssetPublicUrl(key);
    if (!publicPath) continue;
    push(key.startsWith("demo_prop_") ? "prop_demo" : "scene_demo", key, publicPath);
  }
  return out;
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
    throw new Error("请先勾选至少一个已有产物（故事/角色卡/节拍/反推/静帧/成片）；仅勾选待跑集不能导出");
  }

  const zip = new JSZip();
  const failed: ManhuaProjectExportManifest["failed"] = [];
  const selectedMeta: ManhuaProjectExportManifest["selected"] = [];
  let okCount = 0;

  for (const it of selected) {
    const epFolder = `ep${String(it.episodeIndex).padStart(2, "0")}`;
    const fileMeta = STAGE_FILE[it.stage];
    if (!fileMeta) continue;

    if (TEXT_EXPORT_STAGES.has(it.stage) && it.outputText?.trim()) {
      const path = `${epFolder}/${fileMeta.base}.md`;
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

  const libraryRefs: NonNullable<ManhuaProjectExportManifest["libraryRefs"]> = [];
  if (opts.includeLibraryRefs !== false) {
    const refs = listManhuaExportLibraryRefPaths({
      characterIds: opts.characterIds,
      artStyleId: opts.artStyleId,
      sceneId: opts.sceneId,
      demoAssetIds: opts.demoAssetIds,
    });
    for (const ref of refs) {
      const zipPath = `library/${ref.kind}/${ref.id}${ref.publicPath.match(/\.[a-z0-9]+$/i)?.[0] || ".jpg"}`;
      try {
        const buf = await fetchAsArrayBuffer(resolveAssetUrl(ref.publicPath, opts.assetBaseUrl));
        zip.file(zipPath, buf);
        libraryRefs.push({ kind: ref.kind, id: ref.id, path: zipPath });
      } catch {
        // 库图未部署或本地缺失时跳过，不阻断工程包
        libraryRefs.push({ kind: ref.kind, id: ref.id, path: ref.publicPath });
      }
    }
  }

  const finalVideoUrl = String(opts.finalVideoUrl || "").trim() || undefined;
  const manifest: ManhuaProjectExportManifest = {
    format: "mv-manhua-project-v1",
    topic: String(opts.topic || "").trim(),
    seriesTitle: opts.seriesTitle,
    exportedAt: new Date().toISOString(),
    note: finalVideoUrl
      ? "本包含分集素材；长片合成链接见 README「合成长片」。library/ 为站点复用资产（人物设定卡/场景道具示范）。"
      : "本包为素材工程包。有成片后可在成片坞一键合成长片（含配乐）；亦可本地按 epXX/clip.* 拼接。library/ 为站点复用资产。",
    characters: opts.characterIds,
    artStyleId: opts.artStyleId,
    sceneId: opts.sceneId,
    finalVideoUrl,
    libraryRefs,
    selected: selectedMeta,
    failed,
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  const writerMd = String(opts.writerPackMarkdown || "").trim();
  if (writerMd) {
    zip.file("writer-pack.md", writerMd);
  }

  const summary = summarizeManhuaDockExport(selected);
  const playlistLines = [
    `# ${opts.seriesTitle || opts.topic || "漫剧工程包"}`,
    "",
    `导出时间：${manifest.exportedAt}`,
    `题材：${manifest.topic || "（未填）"}`,
    `角色：${(opts.characterIds || []).join(", ") || "（未选）"}`,
    `画风：${opts.artStyleId || "（默认）"}`,
    `主场景：${opts.sceneId || "（未选）"}`,
    writerMd ? "编剧包：`writer-pack.md`" : "编剧包：（未附）",
    "",
    "## 分集清单",
    ...summary.byEpisode.map((ep) => {
      const title =
        selected.find((s) => s.episodeIndex === ep.episodeIndex)?.episodeTitle || "";
      const files = selectedMeta
        .filter((s) => s.episodeIndex === ep.episodeIndex && s.path)
        .map((s) => `- \`${s.path}\`（${s.stage}）`)
        .join("\n");
      return [
        `### 第${ep.episodeIndex}集${title ? ` · ${title}` : ""}`,
        files || "- （无文件）",
        "",
      ].join("\n");
    }),
    "",
    "## 库参考 library/",
    libraryRefs.length
      ? libraryRefs.map((r) => `- \`${r.path}\`（${r.kind} · ${r.id}）`).join("\n")
      : "- （无）",
    "",
    "## 合成长片",
    finalVideoUrl
      ? [`- 长片（含配乐）：\`${finalVideoUrl}\``, "- 亦可按 epXX/clip.* 顺序本地再拼接。"].join("\n")
      : "> 尚未合成长片时，可在成片坞点「合成长片（含配乐）」；或按 epXX/clip.* 本地拼接。",
  ];
  zip.file("README.md", playlistLines.join("\n"));
  zip.file(
    "playlist.json",
    JSON.stringify(
      {
        seriesTitle: opts.seriesTitle,
        topic: opts.topic,
        sceneId: opts.sceneId,
        finalVideoUrl: finalVideoUrl || undefined,
        libraryRefs,
        episodes: summary.byEpisode.map((ep) => ({
          episodeIndex: ep.episodeIndex,
          title: selected.find((s) => s.episodeIndex === ep.episodeIndex)?.episodeTitle,
          files: selectedMeta
            .filter((s) => s.episodeIndex === ep.episodeIndex && s.path)
            .map((s) => ({ stage: s.stage, path: s.path })),
        })),
      },
      null,
      2,
    ),
  );

  const blob = await zip.generateAsync({ type: "blob" });
  const firstEp = selected[0]!.episodeIndex;
  const multi = new Set(selected.map((s) => s.episodeIndex)).size > 1;
  const seriesSlug = slugFilenamePart(opts.seriesTitle || opts.topic);
  const filename = multi
    ? `mv-manhua-series${seriesSlug ? `-${seriesSlug}` : ""}.zip`
    : `mv-manhua-ep${String(firstEp).padStart(2, "0")}${seriesSlug ? `-${seriesSlug}` : ""}.zip`;

  return { blob, filename, manifest, okCount, failCount: failed.length };
}

export async function downloadManhuaProjectZip(opts: ExportManhuaProjectZipOpts): Promise<ExportManhuaProjectZipResult> {
  const result = await exportManhuaProjectZip(opts);
  triggerDownload(result.blob, result.filename);
  return result;
}
