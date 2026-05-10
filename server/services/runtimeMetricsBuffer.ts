/**
 * 單進程環形緩衝：**重啟即清空**，適合運維在 /admin 即時察看，不依賴 Fly 日誌檢索。
 */
export type RuntimeMetricRow = {
  tsMs: number;
  iso: string;
  category: string;
  payload: Record<string, unknown>;
};

const DEFAULT_MAX_ROWS = Number(process.env.RUNTIME_METRICS_BUFFER_MAX ?? "900") || 900;
const rows: RuntimeMetricRow[] = [];
let dropped = 0;
const procStartIso = new Date().toISOString();

export function appendRuntimeMetric(category: string, payload: Record<string, unknown>): void {
  const max = DEFAULT_MAX_ROWS > 40 ? DEFAULT_MAX_ROWS : 400;
  while (rows.length >= max) {
    rows.shift();
    dropped += 1;
  }
  const iso = new Date().toISOString();
  rows.push({
    tsMs: Date.now(),
    iso,
    category: String(category || "unknown"),
    payload: payload && typeof payload === "object" ? payload : { value: payload },
  });
}

/** 運維視圖：最近 N 條（最舊 → 最新） */
export function getRuntimeMetricTail(limit = 400): RuntimeMetricRow[] {
  if (rows.length === 0) return [];
  const lim = Math.max(10, Math.floor(limit));
  return rows.slice(-Math.min(rows.length, lim));
}

export function getRuntimeMetricsMeta(): {
  procStartIso: string;
  totalRows: number;
  dropped: number;
  cap: number;
} {
  const cap = DEFAULT_MAX_ROWS > 40 ? DEFAULT_MAX_ROWS : 400;
  return {
    procStartIso,
    totalRows: rows.length,
    dropped,
    cap,
  };
}

/** 對 platform.pipelineStat / visual.report 等做粗略彙總 */
export function summarizeRuntimeMetrics(rowsIn: RuntimeMetricRow[] = rows): {
  pipelineStatEvents: Record<string, number>;
  compositeSuccessByAttempt: Record<string, number>;
  visualReport: { ok: number; fail: number; byProvider: Record<string, number> };
  gpt54Translate: {
    rounds: number;
    highPressure: number;
    finishStop: number;
    finishLength: number;
    finishOther: number;
  };
} {
  const pipelineStatEvents: Record<string, number> = {};
  const compositeSuccessByAttempt: Record<string, number> = {};
  const visualByProvider: Record<string, number> = {};
  let visualOk = 0;
  let visualFail = 0;
  let g54rounds = 0;
  let g54high = 0;
  let g54stop = 0;
  let g54len = 0;
  let g54other = 0;

  const inc = (m: Record<string, number>, k: string) => {
    m[k] = (m[k] ?? 0) + 1;
  };

  for (const r of rowsIn) {
    const p = r.payload || {};
    if (r.category === "platform.pipelineStat") {
      const ev = String(p.event ?? "unknown");
      inc(pipelineStatEvents, ev);
      if (ev === "composite_sheet_gpt_image2_success" || ev === "composite_sheet_nano_fallback_success") {
        const a = String(p.compositeSheetAttempt ?? "?");
        inc(compositeSuccessByAttempt, a);
      }
      if (String(p.event) === "gpt54_platform_image_translate") {
        g54rounds += 1;
        const pr = typeof p.tokenPressureApprox === "number" ? p.tokenPressureApprox : NaN;
        if (Number.isFinite(pr) && pr >= 0.85) g54high += 1;
        const fr = String(p.finishReason ?? "");
        if (fr === "stop") g54stop += 1;
        else if (fr === "length") g54len += 1;
        else if (fr) g54other += 1;
      }
    }
    if (r.category === "visual.report") {
      const prov = String(p.provider ?? "?");
      inc(visualByProvider, prov);
      if (p.ok === true) visualOk += 1;
      else if (p.ok === false) visualFail += 1;
    }
  }

  return {
    pipelineStatEvents,
    compositeSuccessByAttempt,
    visualReport: {
      ok: visualOk,
      fail: visualFail,
      byProvider: visualByProvider,
    },
    gpt54Translate: {
      rounds: g54rounds,
      highPressure: g54high,
      finishStop: g54stop,
      finishLength: g54len,
      finishOther: g54other,
    },
  };
}
