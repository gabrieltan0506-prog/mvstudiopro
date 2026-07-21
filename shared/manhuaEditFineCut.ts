/**
 * 细剪进出点（秒级）：在粗剪时长内收紧 in/out，供多轨与字幕对齐。
 */

export type ManhuaFineCutTrim = {
  /** 相对源片起点，含该秒 */
  inSec: number;
  /** 相对源片起点，不含该秒（开区间右端） */
  outSec: number;
};

export function defaultFineCut(durationSec: number): ManhuaFineCutTrim {
  const d = Math.max(1, Number(durationSec) || 1);
  return { inSec: 0, outSec: d };
}

/** 钳制进出点：步进 0.5s，有效时长至少 0.5s */
export function clampFineCut(
  durationSec: number,
  trim: Partial<ManhuaFineCutTrim> | null | undefined,
): ManhuaFineCutTrim {
  const d = Math.max(1, Number(durationSec) || 1);
  const snap = (n: number) => Math.round(Math.max(0, n) * 2) / 2;
  let inSec = snap(Number(trim?.inSec) || 0);
  let outSec = snap(Number(trim?.outSec) || d);
  if (outSec > d) outSec = d;
  if (inSec < 0) inSec = 0;
  if (outSec - inSec < 0.5) {
    if (inSec + 0.5 <= d) outSec = inSec + 0.5;
    else {
      outSec = d;
      inSec = Math.max(0, d - 0.5);
    }
  }
  return { inSec, outSec };
}

export function fineCutEffectiveSec(
  durationSec: number,
  trim?: Partial<ManhuaFineCutTrim> | null,
): number {
  const c = clampFineCut(durationSec, trim);
  return Math.round((c.outSec - c.inSec) * 10) / 10;
}

export type ManhuaFineCutByShot = Record<number, ManhuaFineCutTrim>;

export function parseFineCutByShot(raw: unknown): ManhuaFineCutByShot {
  if (!raw || typeof raw !== "object") return {};
  const out: ManhuaFineCutByShot = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const idx = Number(k);
    if (!Number.isFinite(idx) || idx < 1) continue;
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    out[idx] = clampFineCut(999, {
      inSec: Number(o.inSec),
      outSec: Number(o.outSec),
    });
  }
  return out;
}
