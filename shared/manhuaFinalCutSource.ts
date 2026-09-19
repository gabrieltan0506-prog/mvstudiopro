/**
 * 长片的「料从哪来」指纹（纯函数）。
 *
 * 对照图 08 点名两件事：**避免未验即完成的显示**、**问题返回镜头不覆盖既有输出**。
 * 现码把第二件做到了（`manhuaFinalVersions` 逐版本留档，新合成不删旧片），
 * 但第一件有个真窟窿：合成完的长片**不记得自己是哪一批镜头合的**。
 * 于是用户重出了第 3 段、或改了成片坞勾选，阶段条上的「终审 ✅」照旧亮着，
 * 点开却是上一批料合出来的片子 —— 这正是「未验即完成」。
 *
 * 这里只做指纹与比对，不改合成流程、不删任何产物：
 * 指纹进版本记录，UI 拿当前这批料再算一次，不一致就说清「差在哪」。
 */
export type ManhuaFinalCutPiece = {
  /** 段落身份：clip 块 id（缺就退回集号+段号，不允许空） */
  blockId?: string;
  episodeIndex?: number;
  segmentIndex?: number;
  /** 实际那条成片的地址：重出会换 url，所以它就是「这段料的版本」 */
  clipUrl?: string;
  trimInSec?: number;
  trimOutSec?: number;
  shotPieces?: Array<{ shotIndex: number; timelineOrder?: number; trimInSec: number; trimOutSec: number; durationSec?: number }>;
};

/** 指纹：段身份 + 该段实际用的成片地址，按身份排序后拼。地址变了就是换了料。 */
export function manhuaFinalCutSourceKey(pieces: readonly ManhuaFinalCutPiece[]): string {
  const rows = pieces
    .filter((piece) => String(piece.clipUrl || "").trim())
    .map((piece) => {
      const id =
        String(piece.blockId || "").trim() ||
        `e${Math.max(0, Math.floor(Number(piece.episodeIndex) || 0))}s${Math.max(
          0,
          Math.floor(Number(piece.segmentIndex) || 0),
        )}`;
      // 保留完整媒体身份；只移除续签参数，不能把不同路径的同名文件视为同一版。
      const rawUrl = String(piece.clipUrl || "").trim();
      let url = rawUrl;
      try {
        const parsed = new URL(rawUrl);
        for (const key of Array.from(parsed.searchParams.keys())) {
          if (/^(x-goog-|x-amz-)/i.test(key) || /^(sig|signature|expires|exp|token|googleaccessid)$/i.test(key)) parsed.searchParams.delete(key);
        }
        parsed.hash = "";
        parsed.searchParams.sort();
        url = parsed.toString();
      } catch { /* 非标准地址仍完整保留，不能静默截尾。 */ }
      const cut = piece.shotPieces?.length
        ? piece.shotPieces.map(p => [p.shotIndex, p.timelineOrder ?? null, p.trimInSec, p.trimOutSec, p.durationSec ?? null])
        : [piece.trimInSec ?? null, piece.trimOutSec ?? null];
      return JSON.stringify([id, piece.episodeIndex ?? null, piece.segmentIndex ?? null, url, cut]);
    })
    .sort();
  return rows.length ? `${rows.length}|v2|${rows.join(",")}` : "";
}

export type ManhuaFinalCutStale = {
  stale: boolean;
  /** 说清差在哪；不 stale 时为空串 */
  reasonZh: string;
};

/**
 * 当前这批料与长片当时那批比。
 *
 * 判不出来（旧长片没存指纹）时**不谎报通过、也不谎报失效**：
 * 说「这条长片没有留下用料记录，无法核对」，让用户自己决定要不要重合成。
 */
export function manhuaFinalCutStaleOf(input: {
  /** 长片版本里记下的指纹 */
  versionSourceKey?: string | null;
  /** 现在这批料算出来的指纹 */
  currentSourceKey: string;
  /** 现在这批料的段数（用于文案） */
  currentCount: number;
}): ManhuaFinalCutStale {
  const recorded = String(input.versionSourceKey || "").trim();
  const current = String(input.currentSourceKey || "").trim();
  if (!current) return { stale: false, reasonZh: "" };
  if (!recorded) {
    return {
      stale: false,
      reasonZh: "这条长片没有留下用料记录，无法核对是不是当前这批镜头合的",
    };
  }
  if (!recorded.includes("|v2|")) return { stale: false, reasonZh: "旧版本只记录媒体，未记录裁切与镜头顺序，无法核对当前剪辑" };
  if (recorded === current) return { stale: false, reasonZh: "" };
  const recordedCount = Number(recorded.split("|")[0] || 0);
  if (recordedCount && recordedCount !== input.currentCount) {
    return {
      stale: true,
      reasonZh: `这条长片是 ${recordedCount} 段合的，现在是 ${input.currentCount} 段 —— 需重合成`,
    };
  }
  return {
    stale: true,
    reasonZh: "有镜头在合成之后重出过或修改了裁切／顺序，这条长片用的是旧料 —— 需重合成（旧片仍保留在版本里）",
  };
}
