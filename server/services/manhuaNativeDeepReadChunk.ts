/**
 * 学习链路的**模型层替换**：一个分片走原生视频精读，产出与抽帧链路同形状的 chunk。
 *
 * 立此模块的由头（0824 盘点）：新旧两条链路**各有一半**——
 *   旧链路 `manhuaTemplateLearnService` 有素材接入层（解析剧名／合集展开／
 *     付费边界识别／读到付费自动停止／cookie 轮换），模型层是已判废的抽帧读图；
 *   新链路 runner + 入库都写完并合并了，却**没有素材接入层**，
 *     输入是一份人手写的 episodes.json。
 * 于是「学第 1 集到第 20 集」一直跑不起来——缺的不是代码，是中间这道接线。
 *
 * **本模块只替换模型层**：素材接入层原样保留，一行不改。
 * 用户口径：「废除模型以外，其他的解析剧名、读 web api 看哪些是付费集、
 * 读到付费的自动停止，这些都该保留……这些是任何模型学习都需要用到的基本功能」。
 *
 * ---
 * ⚠️ **质量门在这里，不在下游。**
 *
 * `shared/manhuaTemplateLearnSeries.ts:190` 的严格门判据是
 * `usesStrictPolicy = Boolean(chunk.audioAnalysis || chunk.denseFrames)` ——
 * 精读 chunk 这两个字段都不填，所以**不会**被那道门误杀；
 * 但反过来说，精读产出走的是「无门」路径。
 * `shared/manhuaNativeDeepRead.ts` 的三个信号注释写着「producer 必须检查」，
 * 而在本模块出现之前**没有任何生产路径执行过这套检查**。所以门补在这里。
 */
import {
  runManhuaNativeDeepRead,
  resolveNativeDeepReadNodeUrls,
  type NativeDeepReadRunResult,
} from "./manhuaNativeDeepReadRunner.js";
import type { ManhuaLearnEpisodeChunk } from "../../shared/manhuaTemplateLearnSeries.js";

/** 供测试注入；生产走默认实现，不另开旁路 */
export type NativeDeepReadChunkDeps = {
  run: typeof runManhuaNativeDeepRead;
  resolveNodes: typeof resolveNativeDeepReadNodeUrls;
};

const defaultDeps: NativeDeepReadChunkDeps = {
  run: runManhuaNativeDeepRead,
  resolveNodes: resolveNativeDeepReadNodeUrls,
};

export type NativeDeepReadChunkInput = {
  /** 素材接入层已经解析好的播放地址；本模块不自己找片源 */
  mediaSource: { url: string; referer?: string };
  startSec: number;
  endSec: number;
  /** 该段的题材/剧情提示，进 prompt 帮模型定位 */
  hintZh?: string;
  abortSignal?: AbortSignal;
};

/**
 * 三信号检查的结论。
 *
 * 只拦**硬失败**（有段没读成 / 一个镜头都没学到）——这两种情况产出不可用，
 * 与旧链路「本分片未计入已学」同一口径。
 * `truncated` 与 `droppedCount` **记录但不拦**：它们是质量提示，
 * 该由人在审批页判断，替用户拍板不是这一层的事。
 */
export function evaluateNativeDeepReadSignals(out: {
  failedSegmentCount: number;
  droppedCount: number;
  truncated: boolean;
  shotCount: number;
  segmentCount: number;
  beatGrid: readonly unknown[];
}): { ok: boolean; reasonZh?: string; noteZh?: string } {
  if (out.failedSegmentCount > 0) {
    return {
      ok: false,
      reasonZh: `原生精读有 ${out.failedSegmentCount} 段未读成（失败／截断／非法 JSON），本分片未计入已学`,
    };
  }
  if (!out.beatGrid.length) {
    return { ok: false, reasonZh: "原生精读没有产出任何镜头，本分片未计入已学" };
  }
  const notes: string[] = [];
  if (out.truncated) {
    notes.push("镜头数触顶 128 已抽稀，产出超模板承载，建议人工确认");
  }
  if (out.droppedCount > 0) {
    notes.push(`${out.droppedCount} 个镜头因动作或节奏结构为空被丢弃`);
  }
  return { ok: true, noteZh: notes.join("；") || undefined };
}

/**
 * 跑一个分片的原生精读，产出 `ManhuaLearnEpisodeChunk`。
 *
 * 不填的字段就是真没有，**不编占位**：
 *   `transcriptPreview` 精读不做转写；`climaxNotes` / `sceneHints` 精读产出里没有对应项。
 * 编出来会让审批页看见「学到了」而其实没学到（0824 provenance 静默吞数据同类）。
 */
export async function learnEpisodeChunkViaNativeDeepRead(
  input: NativeDeepReadChunkInput,
  deps: NativeDeepReadChunkDeps = defaultDeps,
): Promise<ManhuaLearnEpisodeChunk> {
  const startSec = Math.max(0, Math.floor(input.startSec));
  const endSec = Math.floor(input.endSec);
  if (!(endSec > startSec)) {
    throw new Error("原生精读分片区间非法（endSec 必须大于 startSec）");
  }

  let out: NativeDeepReadRunResult;
  try {
    out = await deps.run({
      resolveNodes: () => deps.resolveNodes(input.mediaSource.url, input.abortSignal),
      segments: [{ startSec, endSec, hintZh: input.hintZh }],
      abortSignal: input.abortSignal,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "原生精读失败";
    throw new Error(`${reason}，本分片未计入已学`);
  }

  const verdict = evaluateNativeDeepReadSignals(out);
  if (!verdict.ok) throw new Error(verdict.reasonZh || "原生精读产出不可用，本分片未计入已学");

  return {
    startSec,
    endSec,
    // 精读不做语音转写：空就是没有，不拿节奏结构冒充台词
    transcriptPreview: "",
    // 「憋了几秒、第几秒爆、爆后怎么收」正是钩子的描述
    hookNoteZh: String(out.beatStructureZh || "").trim(),
    beatHints: out.beatGrid,
    climaxNotes: [],
    sceneHints: [],
    learnedAt: new Date().toISOString(),
    /**
     * 只填 vision，**不填 audioAnalysis / denseFrames**。
     * 那两个字段一旦出现就会触发 `usesStrictPolicy`，
     * 而严格门要求的语音分析与高密度抽帧正是本链路替换掉的东西——
     * 填了等于自己给自己判死刑。质量门已由上面的三信号检查承担。
     */
    vision: {
      provider: "bailian-native-deep-read",
      model: out.model,
      attempted: true,
      success: true,
      errorNote: verdict.noteZh,
    },
  };
}
