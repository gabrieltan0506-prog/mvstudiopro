/**
 * 换新剧门禁：旧剧本 / 人物场景造型多为付费生成，必须先备份再清空。
 * 产品常驻流程，不依赖 Agent 手操。
 */

import JSZip from "jszip";
import type { ManhuaCustomAssetRef } from "@shared/manhuaCustomAssetRefs";
import {
  formatManhuaWriterPackMarkdown,
  type ManhuaWriterPack,
} from "@shared/manhuaWriterRoom";
import type { CanvasBlock } from "./canvasTypes";
import {
  isManhuaSeriesAssetBlockId,
  manhuaBlockHasPaidOutput,
} from "./canvasDramaStudio";
import {
  collectManhuaClipDockItems,
  downloadManhuaProjectZip,
  selectExportableDockIds,
  type ExportManhuaProjectZipOpts,
} from "./manhuaProjectExport";

export type ManhuaSeriesSwitchRisk = {
  seriesTitle: string;
  hasWriterPack: boolean;
  paidSeriesAssetCount: number;
  paidFactoryOutputCount: number;
  customRefCount: number;
  /** 有任一旧资产/剧本即须走备份门禁 */
  needsBackup: boolean;
  summaryZh: string;
};

function slugPart(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/[^\w\u4e00-\u9fff-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function stampBackupSuffix(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * 备份文件名只用「先前专案」名，禁止用正要开的新剧名。
 * 优先：显式 previousSeriesTitle → 旧 writerPack 标题 → topic（且都不得等于 incoming）。
 */
export function resolveManhuaBackupSeriesLabel(opts: {
  previousSeriesTitle?: string | null;
  writerPack?: ManhuaWriterPack | null;
  topic?: string | null;
  /** 正要换上的新剧名：禁止用作备份名 */
  incomingSeriesTitle?: string | null;
}): string {
  const incoming = String(opts.incomingSeriesTitle || "").trim();
  const candidates = [
    String(opts.previousSeriesTitle || "").trim(),
    String(opts.writerPack?.seriesTitle || "").trim(),
    String(opts.topic || "").trim(),
  ].filter(Boolean);
  for (const c of candidates) {
    if (!incoming || c !== incoming) return c;
  }
  return candidates[0] || "先前专案";
}

/**
 * 让用户确认/改写「先前剧名」；若与新剧名相同则重问。
 * 返回 null = 用户取消。
 */
export function askManhuaPreviousSeriesBackupLabel(
  defaultLabel: string,
  incomingSeriesTitle?: string | null,
): string | null {
  const incoming = String(incomingSeriesTitle || "").trim();
  const fallback = String(defaultLabel || "").trim() || "先前专案";
  const hint = incoming
    ? `请填写「先前专案」备份名（勿填正要开的新剧「${incoming}」）`
    : "请填写「先前专案」备份名（勿填正要开的新剧名）";
  const raw = window.prompt(hint, fallback);
  if (raw === null) return null;
  const name = String(raw || "").trim() || fallback;
  if (incoming && name === incoming) {
    window.alert(`备份名不能与新剧「${incoming}」相同，请改用先前剧名`);
    return askManhuaPreviousSeriesBackupLabel(fallback, incoming);
  }
  return name;
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

async function fetchAsArrayBuffer(url: string): Promise<ArrayBuffer> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.arrayBuffer();
}

function guessExt(url: string, fallback = "jpg"): string {
  const m = String(url || "").match(/\.([a-z0-9]{2,5})(?:\?|#|$)/i);
  return m?.[1]?.toLowerCase() || fallback;
}

export function inspectManhuaSeriesSwitchRisk(input: {
  writerPack?: ManhuaWriterPack | null;
  blocks?: CanvasBlock[] | null;
  customAssetRefs?: ManhuaCustomAssetRef[] | null;
}): ManhuaSeriesSwitchRisk {
  const pack = input.writerPack || null;
  const blocks = input.blocks || [];
  const refs = input.customAssetRefs || [];
  const seriesTitle =
    String(pack?.seriesTitle || "").trim() ||
    blocks.find((b) => String(b.episodeTitle || "").trim())?.episodeTitle ||
    "未命名专案";
  const hasWriterPack = Boolean(
    pack &&
      (String(pack.rawMarkdown || "").trim().length >= 40 ||
        (pack.episodes || []).length > 0),
  );
  const paidSeriesAssetCount = blocks.filter(
    (b) => isManhuaSeriesAssetBlockId(b.id) && manhuaBlockHasPaidOutput(b),
  ).length;
  const paidFactoryOutputCount = blocks.filter(
    (b) =>
      !isManhuaSeriesAssetBlockId(b.id) &&
      !b.archivedFromPreviousScript &&
      manhuaBlockHasPaidOutput(b),
  ).length;
  const customRefCount = refs.filter((r) => String(r.url || "").trim()).length;
  const needsBackup =
    hasWriterPack ||
    paidSeriesAssetCount > 0 ||
    paidFactoryOutputCount > 0 ||
    customRefCount > 0;
  const bits = [
    hasWriterPack ? "剧本" : null,
    paidSeriesAssetCount > 0 ? `人物/场景/道具设定 ${paidSeriesAssetCount} 张` : null,
    paidFactoryOutputCount > 0 ? `分镜/成片 ${paidFactoryOutputCount} 个` : null,
    customRefCount > 0 ? `上传参考 ${customRefCount} 张` : null,
  ].filter(Boolean);
  return {
    seriesTitle,
    hasWriterPack,
    paidSeriesAssetCount,
    paidFactoryOutputCount,
    customRefCount,
    needsBackup,
    summaryZh: bits.length
      ? `旧专案「${seriesTitle}」含：${bits.join(" · ")}（多为付费生成，清空后无法自动找回）`
      : `旧专案「${seriesTitle}」`,
  };
}

/** 换剧确认文案（第一步：是否下载备份） */
export function manhuaSeriesSwitchBackupConfirmZh(risk: ManhuaSeriesSwitchRisk): string {
  return [
    risk.summaryZh,
    "",
    "换新剧是基础操作：必须先把旧剧本与人物/场景/造型备份到本机，再清空，最后才导入或扩写新剧。",
    "备份文件请用「先前剧名」命名，不要用正要开的新剧名。",
    "",
    "确定 = 填写先前剧名并下载备份",
    "取消 = 先不换剧",
  ].join("\n");
}

/** 备份完成后：是否清空旧设定再继续 */
export function manhuaSeriesSwitchClearConfirmZh(): string {
  return [
    "备份已开始下载到本机。",
    "",
    "接下来将清空旧人物/场景/道具设定与工厂链，再继续换剧，避免新旧资产混在一起。",
    "是否继续？",
  ].join("\n");
}

export type DownloadManhuaSeriesSwitchBackupOpts = {
  writerPack?: ManhuaWriterPack | null;
  topic?: string;
  /** 显式先前剧名（优先；备份 zip / README 只用这个口径） */
  previousSeriesTitle?: string | null;
  /** 正要开的新剧名：不得用作备份文件名 */
  incomingSeriesTitle?: string | null;
  /** 默认 true：弹出「先前专案名」确认，避免误用正剧名 */
  askPreviousTitle?: boolean;
  blocks: CanvasBlock[];
  customAssetRefs?: ManhuaCustomAssetRef[] | null;
  characterIds?: string[];
  artStyleId?: string;
  sceneId?: string;
  demoAssetIds?: string[];
};

export type DownloadManhuaSeriesSwitchBackupResult = {
  filename: string;
  okCount: number;
  failCount: number;
};

/**
 * 换剧专用备份：编剧包 + 人物/场景/道具设定图 + 上传参考 +（若有）成片坞可导出项。
 */
export async function downloadManhuaSeriesSwitchBackup(
  opts: DownloadManhuaSeriesSwitchBackupOpts,
): Promise<DownloadManhuaSeriesSwitchBackupResult> {
  const suggested = resolveManhuaBackupSeriesLabel({
    previousSeriesTitle: opts.previousSeriesTitle,
    writerPack: opts.writerPack,
    topic: opts.topic,
    incomingSeriesTitle: opts.incomingSeriesTitle,
  });
  const ask = opts.askPreviousTitle !== false;
  const seriesTitle = ask
    ? askManhuaPreviousSeriesBackupLabel(suggested, opts.incomingSeriesTitle)
    : suggested;
  if (!seriesTitle) {
    throw new Error("已取消备份（未填写先前专案名）");
  }
  const writerMd = formatManhuaWriterPackMarkdown(opts.writerPack);
  const dockItems = collectManhuaClipDockItems(opts.blocks, { includePendingStory: false });
  const exportableIds = selectExportableDockIds(dockItems);

  let dockOk = 0;
  let dockFail = 0;
  if (exportableIds.length > 0) {
    const dockOpts: ExportManhuaProjectZipOpts = {
      items: dockItems,
      selectedIds: exportableIds,
      topic: opts.topic,
      // 坞工程包文件名也跟先前专案名，避免被新剧名盖掉
      seriesTitle,
      characterIds: opts.characterIds,
      artStyleId: opts.artStyleId,
      sceneId: opts.sceneId,
      demoAssetIds: opts.demoAssetIds,
      writerPackMarkdown: writerMd || undefined,
    };
    try {
      const dock = await downloadManhuaProjectZip(dockOpts);
      dockOk = dock.okCount;
      dockFail = dock.failCount;
    } catch {
      // 坞导出失败时仍打专案资产包，避免整段中断
      dockOk = 0;
      dockFail = exportableIds.length;
    }
  }

  const zip = new JSZip();
  let okCount = 0;
  let failCount = 0;
  if (writerMd.trim()) {
    zip.file("writer-pack.md", writerMd.trim());
    okCount += 1;
  }
  zip.file(
    "README.md",
    [
      `# ${seriesTitle} · 先前专案备份`,
      "",
      `导出时间：${new Date().toISOString()}`,
      `备份专案名（先前剧名）：${seriesTitle}`,
      opts.incomingSeriesTitle
        ? `正要开的新剧（勿与备份混淆）：${String(opts.incomingSeriesTitle).trim()}`
        : "",
      "",
      "本包含：剧本（writer-pack.md）、人物/场景/道具设定图（series-assets/）、上传参考（custom-refs/）。",
      "若同时导出了成片坞工程包，那是另一份 zip，请一并保管。",
      "",
      "换新剧正确顺序：① 下载本备份（用先前剧名）→ ② 清空旧设定 → ③ 再导入/扩写新剧。",
    ]
      .filter((line) => line !== undefined)
      .join("\n"),
  );

  const seriesBlocks = opts.blocks.filter(
    (b) => isManhuaSeriesAssetBlockId(b.id) && manhuaBlockHasPaidOutput(b),
  );
  for (const b of seriesBlocks) {
    const url = String(b.outputUrl || b.outputUrls?.[0] || "").trim();
    if (!url) continue;
    try {
      const buf = await fetchAsArrayBuffer(url);
      const ext = guessExt(url, "jpg");
      zip.file(`series-assets/${b.id}.${ext}`, buf);
      okCount += 1;
    } catch {
      failCount += 1;
    }
  }

  const refs = opts.customAssetRefs || [];
  for (const r of refs) {
    const url = String(r.url || "").trim();
    if (!url) continue;
    try {
      const buf = await fetchAsArrayBuffer(url);
      const ext = guessExt(url, "jpg");
      const role = String(r.role || "ref").slice(0, 24);
      zip.file(`custom-refs/${role}-${r.id}.${ext}`, buf);
      okCount += 1;
    } catch {
      failCount += 1;
    }
  }

  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        format: "mv-manhua-series-switch-backup-v1",
        /** 备份专案名 = 先前剧名，不是新剧名 */
        seriesTitle,
        previousSeriesTitle: seriesTitle,
        incomingSeriesTitle: String(opts.incomingSeriesTitle || "").trim() || undefined,
        topic: String(opts.topic || "").trim(),
        exportedAt: new Date().toISOString(),
        writerPack: Boolean(writerMd.trim()),
        seriesAssetIds: seriesBlocks.map((b) => b.id),
        customRefIds: refs.map((r) => r.id),
        dockExportableCount: exportableIds.length,
      },
      null,
      2,
    ),
  );

  if (okCount === 0 && !writerMd.trim() && seriesBlocks.length === 0 && refs.length === 0) {
    throw new Error("没有可备份的剧本或资产");
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const filename = `mv-manhua-backup-${slugPart(seriesTitle) || "先前专案"}-${stampBackupSuffix()}.zip`;
  triggerDownload(blob, filename);
  return {
    filename,
    okCount: okCount + dockOk,
    failCount: failCount + dockFail,
  };
}

/**
 * 换剧门禁：有旧资产时必须先备份；备份成功后再确认清空。
 * @returns true = 用户同意并已备份（或无需备份）；false = 中止
 */
export async function confirmManhuaSeriesSwitchWithBackup(input: {
  risk: ManhuaSeriesSwitchRisk;
  download: () => Promise<DownloadManhuaSeriesSwitchBackupResult>;
  confirmBackup?: (message: string) => boolean;
  confirmClear?: (message: string) => boolean;
  onBackupOk?: (result: DownloadManhuaSeriesSwitchBackupResult) => void;
  onBackupFail?: (message: string) => void;
}): Promise<boolean> {
  if (!input.risk.needsBackup) return true;
  const askBackup = input.confirmBackup || ((m) => window.confirm(m));
  const askClear = input.confirmClear || ((m) => window.confirm(m));
  if (!askBackup(manhuaSeriesSwitchBackupConfirmZh(input.risk))) return false;
  try {
    const result = await input.download();
    input.onBackupOk?.(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "备份失败";
    input.onBackupFail?.(msg);
    return false;
  }
  return askClear(manhuaSeriesSwitchClearConfirmZh());
}
