/**
 * 示范封面 2×2 拼图：一次文生 → 裁成四张，约省 4× 积分。
 * 整图仍用 9:16（四格各 9:16 拼成仍是 9:16）。
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  MANHUA_CONTENT_LANE_LABEL_ZH,
  type ManhuaDemoAsset,
} from "./manhuaScenePropDemoCatalog.js";

export const MANHUA_DEMO_SHEET_SLOT_LABELS = ["左上", "右上", "左下", "右下"] as const;

export function chunkDemoAssetsFor2x2(batch: ManhuaDemoAsset[]): {
  sheets: ManhuaDemoAsset[][];
  singles: ManhuaDemoAsset[];
} {
  const scenes = batch.filter((a) => a.kind === "scene");
  const props = batch.filter((a) => a.kind === "prop");
  const sheets: ManhuaDemoAsset[][] = [];
  const singles: ManhuaDemoAsset[] = [];

  const pack = (list: ManhuaDemoAsset[]) => {
    let i = 0;
    while (i + 4 <= list.length) {
      sheets.push(list.slice(i, i + 4));
      i += 4;
    }
    if (i < list.length) singles.push(...list.slice(i));
  };
  pack(scenes);
  pack(props);
  return { sheets, singles };
}

export function buildDemoCellBrief(a: ManhuaDemoAsset): string {
  const lane = MANHUA_CONTENT_LANE_LABEL_ZH[a.lane];
  const core = a.promptZh.replace(/\s+/g, " ").trim().slice(0, 160);
  return `${a.nameZh}（${lane}）：${core}`;
}

export function buildDemoSheet2x2Prompt(cells: ManhuaDemoAsset[]): string {
  if (cells.length !== 4) {
    throw new Error(`2x2 sheet needs exactly 4 cells, got ${cells.length}`);
  }
  const kind = cells[0]!.kind === "prop" ? "道具特写" : "场景空镜";
  const lines = cells.map((a, i) => {
    const label = MANHUA_DEMO_SHEET_SLOT_LABELS[i]!;
    return `${i + 1}. ${label}：${buildDemoCellBrief(a)}`;
  });
  return [
    `【AI漫剧示范·2×2拼图】一张图严格均分为 2 行 × 2 列共四格，格子等大、边界清晰（细暗线分隔即可），禁止跨格融合。`,
    `每格独立完整的${kind}，竖构图内容填满该格；整张画布比例 9:16。`,
    `四格内容（互不重复）：`,
    ...lines,
    "",
    "硬规则：原创示范资产；禁止名人/可识别人脸特写；禁止可读文字/水印/Logo/二维码/角标/格号数字；",
    cells[0]!.kind === "scene"
      ? "每格以环境层次与电影光影为主，角色最多极远剪影。"
      : "每格道具居中棚拍感，无手无模特脸。",
    "禁止把四格画成同一连续大场景；禁止白边海报纸排版。",
  ].join("\n");
}

/** 2×2 拼图裁四张 jpg；依赖本机 python3 + Pillow */
export function cropImage2x2ToFiles(
  sheetPath: string,
  outPaths: [string, string, string, string],
): void {
  if (!fs.existsSync(sheetPath)) throw new Error(`sheet missing: ${sheetPath}`);
  for (const p of outPaths) fs.mkdirSync(path.dirname(p), { recursive: true });
  const py = `
from PIL import Image
import sys
src, a, b, c, d = sys.argv[1:6]
im = Image.open(src).convert("RGB")
w, h = im.size
cw, ch = w // 2, h // 2
quads = [
  (0, 0, cw, ch),
  (cw, 0, w, ch),
  (0, ch, cw, h),
  (cw, ch, w, h),
]
outs = [a, b, c, d]
for box, out in zip(quads, outs):
  im.crop(box).save(out, "JPEG", quality=90, optimize=True)
print("ok", w, h, cw, ch)
`.trim();
  const r = spawnSync(
    "python3",
    ["-c", py, sheetPath, outPaths[0], outPaths[1], outPaths[2], outPaths[3]],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    throw new Error(`crop 2x2 failed: ${r.stderr || r.stdout || `exit ${r.status}`}`);
  }
  for (const p of outPaths) {
    if (!fs.existsSync(p) || fs.statSync(p).size < 200) {
      throw new Error(`crop output invalid: ${p}`);
    }
  }
}
