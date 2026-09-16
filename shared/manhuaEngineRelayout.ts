/**
 * 草稿档 / 成片档双引擎重铺（PR-14）。
 *
 * 白模与草稿视频固定 Seedance 2.0 mini（≤15s/段，参考 图9/视频3/音频3）；切到 2.5（30s/段，图30/视频10/音频10）
 * 时段表要重铺：2×15s 并成 30s，参考重打包；切回 mini 时拆段、按优先级砍参考（锁脸 > 白模 > 关键帧 > 场景），
 * 全程对白/气口不变（每句「」原样、顺序不变）。这里全是纯函数；写回 markdown 用 replaceManhuaEpisodeSegmentPlanInMarkdown。
 */
import type { ManhuaEpisodeSegmentBeat, ManhuaEpisodeSegmentPlan } from "./manhuaEpisodeSegmentPlan.js";
import { extractManhuaSegmentDialogueQuotes, parseManhuaEpisodeSegmentPlanFromMarkdown } from "./manhuaEpisodeSegmentPlan.js";

export type ManhuaRelayoutResult = {
  plan: ManhuaEpisodeSegmentPlan;
  /** 变化说明（给确认框） */
  notesZh: string[];
  /** 对白多重集前后一致（气口不变） */
  dialoguePreserved: boolean;
  mode: "merge" | "split" | "same";
};

function joinField(a: string, b: string, sep = "；"): string {
  const x = String(a || "").trim();
  const y = String(b || "").trim();
  if (!x) return y;
  if (!y || x === y) return x;
  return `${x}${sep}${y}`;
}

function unionCast(a: string, b: string): string {
  const parts = `${a}；${b}`.split(/[；;、，,/|\n]+/).map((s) => s.trim()).filter(Boolean);
  return Array.from(new Set(parts)).join("；");
}

/** 抽句并统一成带「」的形态（匿名句 extract 会去掉引号，序列化回去必须补上，否则解析器认不出） */
function dialogueLinesOf(beat: ManhuaEpisodeSegmentBeat): string[] {
  return extractManhuaSegmentDialogueQuotes(beat.dialogueZh || "").map((l) => (/：「[^」]*」$/.test(l) || /^「[^」]*」$/.test(l) ? l : `「${l}」`));
}

/** 比较有序发话序列，重复次数和顺序都属于内容。 */
function lineSet(plan: ManhuaEpisodeSegmentPlan): string {
  return JSON.stringify([...plan.segments].sort((a, b) => a.index - b.index).flatMap(dialogueLinesOf));
}

/** 2×15s → 30s：相邻两段并一段（最后落单的保留） */
function mergePairs(plan: ManhuaEpisodeSegmentPlan, toSec: number): ManhuaEpisodeSegmentPlan {
  const src = [...plan.segments].sort((a, b) => a.index - b.index);
  const out: ManhuaEpisodeSegmentBeat[] = [];
  for (let i = 0; i < src.length; i += 2) {
    const a = src[i]!;
    const b = src[i + 1];
    if (!b) {
      // 段数为奇数：最后一段落单，原样放进 30s 槽（内容只有 15s 的量，导入前请补戏或并入上一段）
      out.push({ ...a, index: out.length + 1 });
      continue;
    }
    out.push({
      index: out.length + 1,
      intentZh: joinField(a.intentZh, b.intentZh, " → "),
      dialogueZh: [...dialogueLinesOf(a), ...dialogueLinesOf(b)].join("\n"),
      performanceZh: joinField(a.performanceZh, b.performanceZh),
      sceneZh: a.sceneZh === b.sceneZh ? a.sceneZh : joinField(a.sceneZh, b.sceneZh, " → "),
      paletteZh: joinField(a.paletteZh, b.paletteZh),
      castZh: unionCast(a.castZh, b.castZh),
      wardrobePropZh: joinField(a.wardrobePropZh, b.wardrobePropZh),
      lightingCameraZh: joinField(a.lightingCameraZh, b.lightingCameraZh, "；后半：" ),
    });
  }
  return { segmentCount: out.length, durationSecPerSegment: toSec, targetSec: out.length * toSec, segments: out };
}

/** 30s → 2×15s：对白按句数对半拆，表演/运镜按「；」对半拆，其余字段沿用 */
function splitHalves(plan: ManhuaEpisodeSegmentPlan, toSec: number): ManhuaEpisodeSegmentPlan {
  const src = [...plan.segments].sort((a, b) => a.index - b.index);
  const out: ManhuaEpisodeSegmentBeat[] = [];
  const halve = (s: string): [string, string] => {
    const parts = String(s || "").split(/[；;]/).map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2) return [s, s];
    const mid = Math.ceil(parts.length / 2);
    return [parts.slice(0, mid).join("；"), parts.slice(mid).join("；")];
  };
  for (const seg of src) {
    const lines = dialogueLinesOf(seg);
    const mid = Math.ceil(lines.length / 2);
    const [p1, p2] = halve(seg.performanceZh);
    const [c1, c2] = halve(seg.lightingCameraZh);
    const scenes = String(seg.sceneZh || "").split(" → ");
    const intents = String(seg.intentZh || "").split(" → ");
    out.push({ ...seg, index: out.length + 1, intentZh: intents[0] || seg.intentZh, dialogueZh: lines.slice(0, mid).join("\n"), performanceZh: p1, sceneZh: scenes[0] || seg.sceneZh, lightingCameraZh: c1 });
    out.push({ ...seg, index: out.length + 1, intentZh: intents[1] || intents[0] || seg.intentZh, dialogueZh: lines.slice(mid).join("\n"), performanceZh: p2, sceneZh: scenes[1] || scenes[0] || seg.sceneZh, lightingCameraZh: c2 });
  }
  return { segmentCount: out.length, durationSecPerSegment: toSec, targetSec: out.length * toSec, segments: out };
}

export function relayoutManhuaSegmentPlanForEngine(
  plan: ManhuaEpisodeSegmentPlan,
  input: { fromDurationSec: number; toDurationSec: number; toSegmentMax?: number },
): ManhuaRelayoutResult {
  const from = Math.max(1, input.fromDurationSec);
  const to = Math.max(1, input.toDurationSec);
  if (from === to || !plan.segments.length) {
    return { plan, notesZh: ["段长不变，无需重铺"], dialoguePreserved: true, mode: "same" };
  }
  const before = lineSet(plan);
  let next: ManhuaEpisodeSegmentPlan;
  const notesZh: string[] = [];
  if (to > from) {
    next = mergePairs(plan, to);
    notesZh.push(`${plan.segments.length} 段×${from}s → ${next.segments.length} 段×${to}s：相邻两段并一段，对白原样接续`);
    if (plan.segments.length % 2 === 1) notesZh.push(`段数为奇数：最后一段落单，内容只有 ${from}s 的量，导入前请补戏或手动并入上一段`);
  } else {
    next = splitHalves(plan, to);
    notesZh.push(`${plan.segments.length} 段×${from}s → ${next.segments.length} 段×${to}s：每段对白对半拆、表演/运镜按「；」对半拆`);
    const dlgShort = next.segments.filter((s) => dialogueLinesOf(s).length < 3).length;
    if (dlgShort) notesZh.push(`${dlgShort} 段拆后对白不足 3 句，导入前请补句`);
  }
  if (input.toSegmentMax && next.segments.length > input.toSegmentMax) {
    notesZh.push(`重铺后 ${next.segments.length} 段超过该引擎上限 ${input.toSegmentMax}，请手动合并或删段`);
  }
  const saved = parseManhuaEpisodeSegmentPlanFromMarkdown(formatManhuaEpisodeSegmentPlanMarkdown(next));
  const dialoguePreserved = lineSet(next) === before && lineSet(saved) === before;
  if (!dialoguePreserved) notesZh.push("对白次数或顺序在重铺/存稿后不一致——不应发生，请勿应用");
  return { plan: next, notesZh, dialoguePreserved, mode: to > from ? "merge" : "split" };
}

/** 段表 → markdown（与解析器字段名对齐；对白按行） */
export function formatManhuaEpisodeSegmentPlanMarkdown(plan: ManhuaEpisodeSegmentPlan): string {
  const title = plan.durationSecPerSegment >= 30 ? "### 四段可拍表（Seedance 2.5）" : "### 五至六段可拍表";
  const blocks = [...plan.segments].sort((a, b) => a.index - b.index).map((s) => {
    const lines = dialogueLinesOf(s);
    return [
      `#### 段${String(s.index).padStart(2, "0")}`,
      `- 意图：${s.intentZh || ""}`,
      lines.length ? ["- 对白：", ...lines.map((l) => `  - ${l}`)].join("\n") : `- 对白：${s.dialogueZh || ""}`,
      `- 表演：${s.performanceZh || ""}`,
      `- 场景：${s.sceneZh || ""}`,
      `- 配色风格：${s.paletteZh || ""}`,
      `- 角色：${s.castZh || ""}`,
      `- 服装道具：${s.wardrobePropZh || ""}`,
      `- 光影运镜：${s.lightingCameraZh || ""}`,
    ].join("\n");
  });
  return [title, ...blocks].join("\n");
}

/** 把集正文里的可拍表整段替换（从可拍表标题或第一个 #### 段 起，到 ### 片尾钩子 前）；找不到可拍表就追加 */
export function replaceManhuaEpisodeSegmentPlanInMarkdown(body: string, plan: ManhuaEpisodeSegmentPlan): string {
  const src = String(body || "");
  const md = formatManhuaEpisodeSegmentPlanMarkdown(plan);
  const startRe = /(?:^|\n)(#{2,3}\s*[^\n]*可拍表[^\n]*\n|#{2,4}\s*段\s*0*1\b[^\n]*\n)/;
  const m = src.match(startRe);
  if (!m || m.index == null) return `${src.trimEnd()}\n\n${md}\n`;
  const start = m.index + (m[0].startsWith("\n") ? 1 : 0);
  const rest = src.slice(start);
  // 与解析器段块的收尾一致：片尾钩子 / 任意 ## 二级标题（含「## 第N集」）都算可拍表结束，不能把后面的章节一起吞掉
  const endRe = /\n#{2,3}\s*片尾钩子|\n##\s[^#]/;
  const e = rest.match(endRe);
  const end = e && e.index != null ? start + e.index : src.length;
  return `${src.slice(0, start)}${md}\n${src.slice(end)}`;
}

/* ───────────── 参考重打包 ───────────── */

export type ManhuaRefPriority = "identity" | "previs" | "keyframe" | "scene" | "prop" | "other";
export type ManhuaPackableRef = { id: string; kind: "image" | "video" | "audio"; priority: ManhuaRefPriority; labelZh?: string };
export type ManhuaRefLimits = { image: number; video: number; audio: number; total?: number };

const PRIORITY_ORDER: ManhuaRefPriority[] = ["identity", "previs", "keyframe", "scene", "prop", "other"];

/** 按优先级 锁脸 > 白模 > 关键帧 > 场景 > 道具 > 其他 装到上限；砍掉的带原因 */
export function packManhuaSegmentRefsForEngine(
  refs: readonly ManhuaPackableRef[],
  limits: ManhuaRefLimits,
): { kept: ManhuaPackableRef[]; dropped: Array<ManhuaPackableRef & { reasonZh: string }> } {
  const sorted = [...refs].sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority));
  const count = { image: 0, video: 0, audio: 0 };
  const kept: ManhuaPackableRef[] = [];
  const dropped: Array<ManhuaPackableRef & { reasonZh: string }> = [];
  for (const r of sorted) {
    const cap = limits[r.kind];
    if (count[r.kind] >= cap) {
      dropped.push({ ...r, reasonZh: `${r.kind === "image" ? "图片" : r.kind === "video" ? "视频" : "音频"}参考超过该引擎上限 ${cap}，按优先级砍掉` });
      continue;
    }
    if (limits.total != null && kept.length >= limits.total) {
      dropped.push({ ...r, reasonZh: `参考总数超过该引擎上限 ${limits.total}` });
      continue;
    }
    count[r.kind] += 1;
    kept.push(r);
  }
  return { kept, dropped };
}
