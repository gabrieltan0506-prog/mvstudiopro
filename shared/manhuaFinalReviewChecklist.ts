/**
 * 终审检查清单（对照图 03「质检结果 7/8 项通过」那一格）。
 *
 * 线上现状：终审页信息很多，但**没有成片时仍展示大量不可执行项**（README 原话），
 * 而阶段条只用「有没有长片」判完成。对照图要的是一张清单：每项通过/不通过，
 * 加一句「存在 N 处需处理的问题，才能通过终审」。
 *
 * 这里的硬规矩：**没有证据的项一律 "unknown"（未检），绝不写成「通过」。**
 * 线上那份「智能质检」在没有成片时就是没跑过——那时候写「通过」是骗人。
 */
export type ManhuaFinalCheckState = "pass" | "fail" | "unknown" | "not_required";

export type ManhuaFinalCheckItem = {
  id: "content" | "picture" | "audio" | "subtitle" | "cut_fresh";
  labelZh: string;
  state: ManhuaFinalCheckState;
  /** 说清依据或缺什么；不确定就写为什么不确定 */
  detailZh: string;
};

export type ManhuaFinalReviewChecklist = {
  items: ManhuaFinalCheckItem[];
  passCount: number;
  failCount: number;
  unknownCount: number;
  /** 「4/5 项通过」；有未检项时写「3/5 项通过 · 2 项未检」 */
  summaryZh: string;
  /** 「存在 1 处需处理的问题，才能通过终审」；没问题时为空串 */
  blockingZh: string;
  /** 全部项都通过才为 true —— 未检不算通过 */
  readyForFinal: boolean;
};

export function buildManhuaFinalReviewChecklist(input: {
  /** 本集规划段数 */
  plannedSegments: number;
  /** 已出且质检允许合成的段成片数 */
  readyClips: number;
  /** 关键静帧总数与其中过了垫图锁的数量 */
  keyartTotal: number;
  keyartPixelLocked: number;
  /** 段视频实际质检，静帧锁不等于成片画质。 */
  qualityPassedClips?: number;
  qualityFailedClips?: number;
  /** 有独立音轨（对白已采用 + 有配乐）的段数；没有声音任务时传 0 */
  segmentsWithAudio: number;
  /** 用户是否要求字幕 */
  subtitleRequired: boolean;
  /** 已烧录/已生成的字幕时间轴存在 */
  subtitleReady: boolean;
  /** 长片是否用旧料合的（manhuaFinalCutSource 的判定） */
  finalCutStale: boolean;
  finalCutVerified?: boolean;
  /** 有没有长片 */
  hasFinalVideo: boolean;
}): ManhuaFinalReviewChecklist {
  const planned = Math.max(0, Math.floor(input.plannedSegments) || 0);
  const ready = Math.max(0, Math.floor(input.readyClips) || 0);
  const items: ManhuaFinalCheckItem[] = [];

  items.push(
    planned === 0
      ? { id: "content", labelZh: "内容完整性", state: "unknown", detailZh: "还没有段表，无法核对" }
      : ready >= planned
        ? { id: "content", labelZh: "内容完整性", state: "pass", detailZh: `${ready}/${planned} 段成片已出` }
        : { id: "content", labelZh: "内容完整性", state: "fail", detailZh: `${ready}/${planned} 段成片，缺 ${planned - ready} 段` },
  );

  items.push(
    (input.qualityFailedClips || 0) > 0
      ? { id: "picture", labelZh: "画面质量", state: "fail", detailZh: `${input.qualityFailedClips} 段成片质检未通过，请返回对应片段处理` }
      : planned > 0 && (input.qualityPassedClips || 0) >= planned
        ? { id: "picture", labelZh: "画面质量", state: "pass", detailZh: `${input.qualityPassedClips}/${planned} 段成片质检通过` }
        : { id: "picture", labelZh: "画面质量", state: "unknown", detailZh: `成片质检通过 ${input.qualityPassedClips || 0}/${planned} 段；静帧垫图锁不代表成片画质` },
  );

  items.push(
    planned > 0 && input.segmentsWithAudio >= planned
      ? { id: "audio", labelZh: "音频配乐", state: "pass", detailZh: `${input.segmentsWithAudio} 段有独立音轨` }
      : { id: "audio", labelZh: "音频配乐", state: "unknown", detailZh: "独立音轨尚未齐备，成片声音需试听确认" },
  );

  items.push(
    !input.subtitleRequired
      ? { id: "subtitle", labelZh: "字幕信息", state: "not_required", detailZh: "本片未要求字幕，不作为终审必需项" }
      : input.subtitleReady
        ? { id: "subtitle", labelZh: "字幕信息", state: "pass", detailZh: "字幕时间轴已生成" }
        : { id: "subtitle", labelZh: "字幕信息", state: "fail", detailZh: "要求了字幕但还没有时间轴" },
  );

  items.push(
    !input.hasFinalVideo
      ? { id: "cut_fresh", labelZh: "成片用料", state: "unknown", detailZh: "还没有长片，未检" }
      : input.finalCutStale
        ? { id: "cut_fresh", labelZh: "成片用料", state: "fail", detailZh: "长片是旧料合的，需重合成" }
        : input.finalCutVerified
          ? { id: "cut_fresh", labelZh: "成片用料", state: "pass", detailZh: "长片用的就是当前这批镜头" }
          : { id: "cut_fresh", labelZh: "成片用料", state: "unknown", detailZh: "缺少可核对的用料记录，请确认成片版本" },
  );

  const passCount = items.filter((i) => i.state === "pass").length;
  const failCount = items.filter((i) => i.state === "fail").length;
  const unknownCount = items.filter((i) => i.state === "unknown").length;
  return {
    items,
    passCount,
    failCount,
    unknownCount,
    summaryZh: unknownCount
      ? `${passCount}/${items.length} 项通过 · ${unknownCount} 项未检`
      : `${passCount}/${items.length} 项通过`,
    blockingZh: failCount ? `存在 ${failCount} 处需处理的问题，才能通过终审` : unknownCount ? `还有 ${unknownCount} 项未检，需核对后终审` : "",
    readyForFinal: input.hasFinalVideo && failCount === 0 && unknownCount === 0,
  };
}
