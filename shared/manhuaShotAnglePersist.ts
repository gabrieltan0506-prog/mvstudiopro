/**
 * 工作台机位选定 / 粗剪序：持久化键 + 写回反推文本的「机位选定」表。
 */

import {
  MANHUA_CAMERA_ANGLE_BANK,
  getManhuaCameraAngle,
  type ManhuaCameraAngleId,
} from "./manhuaCameraAngleBank.js";
import {
  parseFineCutByShot,
  type ManhuaFineCutByShot,
} from "./manhuaEditFineCut.js";
import { getMotionPromptById } from "./motionPromptBank.js";
import type { ManhuaWorkbenchShot } from "./manhuaScriptWorkbench.js";

const ANGLE_SECTION = "## 机位选定";

export function manhuaWorkbenchBPersistKey(topic: string, episode: number): string {
  const t = String(topic || "manhua")
    .trim()
    .slice(0, 48)
    .replace(/\s+/g, "_");
  return `manhua-wb-b:v1:${t}:e${Math.max(1, episode)}`;
}

export type ManhuaWorkbenchBPersist = {
  shotAngleByIndex: Record<number, ManhuaCameraAngleId>;
  roughShotOrder: number[];
  /** 细剪进出点（相对源片秒） */
  fineCutByShot?: ManhuaFineCutByShot;
  /** 字幕轨开关：只生成轨数据，默认不烧字 */
  subtitleEnabled?: boolean;
  /** 包装动效 id（motionPromptBank） */
  motionPromptIds?: string[];
};

export function loadManhuaWorkbenchBPersist(key: string): ManhuaWorkbenchBPersist | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ManhuaWorkbenchBPersist;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      shotAngleByIndex: (parsed.shotAngleByIndex || {}) as Record<number, ManhuaCameraAngleId>,
      roughShotOrder: Array.isArray(parsed.roughShotOrder)
        ? parsed.roughShotOrder.map(Number).filter((n) => Number.isFinite(n) && n >= 1)
        : [],
      fineCutByShot: parseFineCutByShot(parsed.fineCutByShot),
      subtitleEnabled: Boolean(parsed.subtitleEnabled),
      motionPromptIds: Array.isArray(parsed.motionPromptIds)
        ? parsed.motionPromptIds
            .map(String)
            .filter((id) => Boolean(getMotionPromptById(id)))
            .slice(0, 2)
        : [],
    };
  } catch {
    return null;
  }
}

export function saveManhuaWorkbenchBPersist(key: string, data: ManhuaWorkbenchBPersist): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    /* ignore quota */
  }
}

/** 从反推/节拍正文解析机位选定表 → 写入 shot.cameraAngleId */
export function applyShotAnglesFromText(
  shots: ManhuaWorkbenchShot[],
  text: string,
): ManhuaWorkbenchShot[] {
  const map = parseShotAngleTable(text);
  if (!Object.keys(map).length) return shots;
  return shots.map((s) => {
    const id = map[s.index];
    return id ? { ...s, cameraAngleId: id } : s;
  });
}

export function parseShotAngleTable(text: string): Record<number, ManhuaCameraAngleId> {
  const out: Record<number, ManhuaCameraAngleId> = {};
  const body = String(text || "");
  const section = body.match(/##\s*机位选定\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/i);
  const chunk = section?.[1] || "";
  if (!chunk.trim()) return out;
  for (const line of chunk.split(/\r?\n/)) {
    const m = line.match(/^\|\s*(\d{1,2})\s*\|\s*([^|]+)\|/);
    if (!m?.[1] || !m[2]) continue;
    const idx = Math.max(1, parseInt(m[1], 10));
    const cell = m[2].trim();
    const byId = getManhuaCameraAngle(cell);
    if (byId) {
      out[idx] = byId.id;
      continue;
    }
    const hit = MANHUA_CAMERA_ANGLE_BANK.find(
      (e) => e.nameZh === cell || cell.includes(e.nameZh),
    );
    if (hit) out[idx] = hit.id;
  }
  return out;
}

/** 把机位 map 合并进反推/节拍正文（替换旧「机位选定」段） */
export function upsertShotAngleSection(
  text: string,
  angles: Record<number, string>,
): string {
  const base = String(text || "")
    .replace(/\n*##\s*机位选定\s*\n[\s\S]*?(?=\n##\s|\n*$)/i, "")
    .trimEnd();
  const rows = Object.entries(angles)
    .map(([k, v]) => ({ index: Number(k), id: v }))
    .filter((r) => Number.isFinite(r.index) && r.index >= 1 && getManhuaCameraAngle(r.id))
    .sort((a, b) => a.index - b.index);
  if (!rows.length) return base;
  const lines = [
    ANGLE_SECTION,
    "",
    "| 镜号 | 机位 |",
    "| --- | --- |",
    ...rows.map((r) => {
      const ang = getManhuaCameraAngle(r.id)!;
      return `| ${r.index} | ${ang.id} |`;
    }),
  ];
  return `${base}\n\n${lines.join("\n")}\n`;
}
