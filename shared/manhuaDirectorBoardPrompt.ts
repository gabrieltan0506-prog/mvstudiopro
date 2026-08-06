/**
 * 导演分镜板提示词：确定性拼装，零文本模型调用。
 *
 * 板子是可拍表的可视化，不是另外想出来的东西——右侧竖栏那七行字段就是
 * 段级九字段（`ManhuaEpisodeSegmentBeat`）在集级的汇总。字段都在手上，
 * 直接拼好送图像模型即可，不调 LLM 去「想」这段提示词。
 */

import type { ManhuaEpisodeSegmentBeat } from "./manhuaEpisodeSegmentPlan.js";
import { splitManhuaCastZhNames } from "./manhuaAssetLockRegistry.js";

export type ManhuaDirectorBoardPromptInput = {
  /** 第几集，用于右侧文字栏「第NN集」 */
  episodeNumber: number;
  episodeTitleZh: string;
  segments: ManhuaEpisodeSegmentBeat[];
};

export type ManhuaDirectorBoardPromptResult = {
  promptZh: string;
  /** 右侧文字栏逐行内容，供预览/校对（不含引号，正文里会补上） */
  rightTextLinesZh: string[];
};

const COSTUME_HINT_RE = /衣|袍|甲|裙|服|巾|靴|冠|钗|饰|带|篷|裳|鞋|帽|袄|装/;
const LIGHT_HINT_RE = /光|影|逆光|侧光|顶光|剪影|冷调|暖调|夜色|晨光|霞|月色|烛/;
const CAMERA_MOVE_RE = /推|拉|摇|移|跟|升|降|环绕|甩|变焦|长镜|运镜|镜头|俯|仰|近景|远景|中景|全景|特写/;

function uniqPush(list: string[], seen: Set<string>, v: string): void {
  const t = String(v || "").trim();
  if (!t || seen.has(t)) return;
  seen.add(t);
  list.push(t);
}

function splitFreeListZh(raw: string | null | undefined): string[] {
  return String(raw || "")
    .split(/[；;、，,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 各段 castZh 去重合并（人物连续性、右侧文字栏共用） */
export function collectManhuaEpisodeCastZh(
  segments: ManhuaEpisodeSegmentBeat[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const seg of segments) {
    for (const name of splitManhuaCastZhNames(seg.castZh)) uniqPush(out, seen, name);
  }
  return out;
}

/** wardrobePropZh 按关键词粗分服装 / 道具（无强分隔符时的确定性启发式） */
export function splitManhuaWardrobeAndProps(
  segments: ManhuaEpisodeSegmentBeat[],
): { costumesZh: string[]; propsZh: string[] } {
  const costumesSeen = new Set<string>();
  const propsSeen = new Set<string>();
  const costumesZh: string[] = [];
  const propsZh: string[] = [];
  for (const seg of segments) {
    for (const token of splitFreeListZh(seg.wardrobePropZh)) {
      if (COSTUME_HINT_RE.test(token)) uniqPush(costumesZh, costumesSeen, token);
      else uniqPush(propsZh, propsSeen, token);
    }
  }
  return { costumesZh, propsZh };
}

/** 各段 sceneZh 用箭头连成动线（相邻重复场景不复述） */
export function joinManhuaSceneFlowZh(segments: ManhuaEpisodeSegmentBeat[]): string {
  const out: string[] = [];
  for (const seg of segments) {
    const s = String(seg.sceneZh || "").trim();
    if (!s) continue;
    if (out.length && out[out.length - 1] === s) continue;
    out.push(s);
  }
  return out.join(" → ");
}

/** 各段 lightingCameraZh 压缩成 3–4 种主要运镜，勿堆砌 */
export function compressManhuaCameraMovesZh(
  segments: ManhuaEpisodeSegmentBeat[],
  maxMoves = 4,
): string {
  const seen = new Set<string>();
  const out: string[] = [];
  outer: for (const seg of segments) {
    for (const token of splitFreeListZh(seg.lightingCameraZh)) {
      if (!CAMERA_MOVE_RE.test(token)) continue;
      uniqPush(out, seen, token);
      if (out.length >= maxMoves) break outer;
    }
  }
  return out.join("、");
}

/** 表演 / 段内白描拆成连续节拍链（进入→急停→蹲下…） */
export function chainManhuaActionBeatsZh(segments: ManhuaEpisodeSegmentBeat[]): string {
  const beats: string[] = [];
  for (const seg of segments) {
    for (const token of splitFreeListZh(seg.performanceZh)) beats.push(token);
  }
  return beats.join(" → ");
}

/** paletteZh + lightingCameraZh 的灯光部分合并 */
export function summarizeManhuaLightingZh(segments: ManhuaEpisodeSegmentBeat[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const seg of segments) {
    const palette = String(seg.paletteZh || "").trim();
    if (palette) uniqPush(out, seen, palette);
    for (const token of splitFreeListZh(seg.lightingCameraZh)) {
      if (LIGHT_HINT_RE.test(token)) uniqPush(out, seen, token);
    }
  }
  return out.join("；");
}

/** 各段 intentZh 压缩合并成 2–4 句：开场看见什么 → 中段误会/紧张 → 结尾钩子 */
export function summarizeManhuaIntentZh(segments: ManhuaEpisodeSegmentBeat[]): string {
  const sentences = segments
    .map((s) => String(s.intentZh || "").trim())
    .filter(Boolean);
  if (!sentences.length) return "";
  if (sentences.length <= 4) return sentences.join("；");
  const picks = [
    sentences[0]!,
    sentences[Math.floor((sentences.length - 1) / 2)]!,
    sentences[sentences.length - 1]!,
  ];
  const seen = new Set<string>();
  return picks.filter((s) => (seen.has(s) ? false : (seen.add(s), true))).join("；");
}

/** 挑「戏剧峰值段」：表演 + 意图正文最长的一段，近似全集戏剧张力最高点 */
export function pickManhuaPeakSegment(
  segments: ManhuaEpisodeSegmentBeat[],
): ManhuaEpisodeSegmentBeat | null {
  if (!segments.length) return null;
  let best = segments[0]!;
  let bestScore = -1;
  for (const seg of segments) {
    const score =
      String(seg.performanceZh || "").length + String(seg.intentZh || "").length;
    if (score > bestScore) {
      bestScore = score;
      best = seg;
    }
  }
  return best;
}

/**
 * 确定性拼装导演分镜板提示词。按固定结构顺序拼接，顺序不要乱：
 * 图片用途 → 戏剧核心 → 人物连续性 → 场景/服装/道具 → 版式 → 中央主画面 →
 * 下方三个小分镜 → 运镜 → 人物与道具运动 → 灯光 → 右侧文字 → 视觉风格 → 禁止事项。
 */
export function buildManhuaDirectorBoardPromptZh(
  input: ManhuaDirectorBoardPromptInput,
): ManhuaDirectorBoardPromptResult {
  const segments = input.segments || [];
  const episodeNo = String(Math.max(1, Math.floor(Number(input.episodeNumber) || 1))).padStart(
    2,
    "0",
  );
  const titleZh = String(input.episodeTitleZh || "").trim() || "未命名";

  const castZh = collectManhuaEpisodeCastZh(segments);
  const { costumesZh, propsZh } = splitManhuaWardrobeAndProps(segments);
  const sceneFlowZh = joinManhuaSceneFlowZh(segments);
  const cameraMovesZh = compressManhuaCameraMovesZh(segments);
  const actionBeatsZh = chainManhuaActionBeatsZh(segments);
  const lightingZh = summarizeManhuaLightingZh(segments);
  const intentZh = summarizeManhuaIntentZh(segments);
  const peak = pickManhuaPeakSegment(segments);

  const centerPictureZh = [peak?.sceneZh, peak?.performanceZh, peak?.lightingCameraZh]
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .join("；");

  const smallPanelsZh = [
    `1) ${propsZh[0] || "本集关键道具特写"}`,
    `2) ${actionBeatsZh.split(" → ")[0] || "人物动作关键帧"}`,
    `3) ${sentencesLast(intentZh) || "结尾钩子或焦点转移"}`,
  ];

  const rightTextLinesZh = [
    `第${episodeNo}集　${titleZh}`,
    `人物：${castZh.join("、") || "无"}`,
    `服装：${costumesZh.join("、") || "无"}`,
    `道具：${propsZh.join("、") || "无"}`,
    `场景：${sceneFlowZh || "无"}`,
    `运镜：${cameraMovesZh || "无"}`,
    `动作：${actionBeatsZh || "无"}`,
    `灯光：${lightingZh || "无"}`,
  ];

  const promptZh = [
    "【图片用途】",
    "生成一张 16:9 横版的短剧导演分镜设定板。",
    "它是拍摄前使用的导演视觉板，结合电影概念图、摄影分镜与信息图表。",
    "不是电影海报，不是单张剧照。",
    "",
    "【戏剧核心】",
    intentZh || "无",
    "须写清：观众先看见什么 → 接着误会/紧张什么 → 最后留下什么疑问。",
    "",
    "【人物连续性】",
    castZh.join("、") || "无",
    "若有参考图：图 N 只作为人物身份参考；保持脸型、五官、发型、年龄、身材比例与服装不变，",
    "只改变场景、姿势与镜头。不得重新设计脸部。",
    "",
    "【场景 / 服装 / 道具】",
    `场景：${sceneFlowZh || "无"}`,
    `服装：${costumesZh.join("、") || "无"}`,
    `道具：${propsZh.join("、") || "无"}`,
    "",
    "【版式】",
    "中央大型电影主画面约占画布 65%。",
    "下方横向排列三个编号证据/动作小分镜。",
    "右侧深色垂直信息栏。",
    "中央叠加淡色 9:16 竖屏安全框（青色虚线）。",
    "红色箭头：人物与道具运动方向。",
    "青色箭头：摄影机运动轨迹。",
    "",
    "【中央主画面】",
    centerPictureZh || "无",
    "",
    "【下方三个小分镜】",
    ...smallPanelsZh,
    "",
    "【运镜】",
    "青色箭头表示摄影机运动。",
    "每条运镜写清：从哪里开始 → 往哪里移动 → 最后停在哪里。",
    `全板控制在 3–4 种主要运镜：${cameraMovesZh || "无"}`,
    "",
    "【人物与道具运动】",
    "红色箭头表示人物和道具轨迹。",
    `动作节拍链（进入→急停→蹲下→发现→藏物→回望…）：${actionBeatsZh || "无"}`,
    "",
    "【灯光】",
    `${lightingZh || "无"}（时间→主光方向→冷暖关系→戏剧情绪）`,
    "",
    "【右侧文字，必须逐字呈现】",
    ...rightTextLinesZh.map((l) => `「${l}」`),
    "共 7–9 行短句；除上述文字外不要生成任何其他文字；不得改写引号内用字。",
    "",
    "【视觉风格】",
    "写实历史电影质感（题材随剧本），冷蓝夜色与暖黄实景光对照；真实材质与使用痕迹；",
    "电影级构图；避免廉价影楼感。",
    "",
    "【禁止事项】",
    "不要仙侠法术，不要现代物品，不要血腥画面，不要水印，不要标志，",
    "不要增加未指定文字，不要把信息栏文字烧进主画面人物身上。",
  ].join("\n");

  return { promptZh, rightTextLinesZh };
}

function sentencesLast(s: string): string {
  const parts = String(s || "")
    .split(/[；;]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.length ? parts[parts.length - 1]! : "";
}
