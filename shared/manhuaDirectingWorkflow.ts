/**
 * 漫剧导戏工作流编译层（蒸馏公开 MIT Seedance Skill OS 的可执行子集）：
 * 一镜一意图 · 节拍防火墙 · 去空话 · 参考职责 · 尾帧续拍 · 链式深度 · 轻量重拍。
 * 前台禁止供应商 / Skill 仓库名。
 */

/** 垫图在成片链路中的职责（与人物/场景/道具分栏正交） */
export const MANHUA_REF_DUTIES = [
  "identity",
  "space",
  "motion",
  "first_frame",
  "last_frame",
  "style",
] as const;
export type ManhuaRefDuty = (typeof MANHUA_REF_DUTIES)[number];

export const MANHUA_REF_DUTY_LABEL_ZH: Record<ManhuaRefDuty, string> = {
  identity: "身份锁",
  space: "空间锁",
  motion: "运动参考",
  first_frame: "首帧",
  last_frame: "尾帧",
  style: "画风参考",
};

/** 同场景连续「接下一段」默认上限（再续须回设定板重锚） */
export const MANHUA_CHAIN_DEPTH_DEFAULT = 2;
export const MANHUA_CHAIN_DEPTH_HARD_MAX = 3;

export type ManhuaRetakeVariable =
  | "camera"
  | "performance"
  | "lighting"
  | "reference"
  | "duration"
  | "framing";

export const MANHUA_RETAKE_VARIABLE_LABEL_ZH: Record<ManhuaRetakeVariable, string> = {
  camera: "运镜",
  performance: "表演",
  lighting: "光影",
  reference: "参考图",
  duration: "时长节奏",
  framing: "构图景别",
};

const SLOP_PHRASES: Array<{ re: RegExp; replaceZh: string }> = [
  { re: /电影感|大片感|史诗感|好莱坞感/g, replaceZh: "" },
  { re: /极致(?:的)?|顶级(?:的)?|完美(?:的)?|惊人(?:的)?/g, replaceZh: "" },
  { re: /超高清|8K|电影级画质|大师级/gi, replaceZh: "" },
  { re: /氛围拉满|质感拉满|张力拉满/g, replaceZh: "" },
  { re: /cinematic|epic|masterpiece|best quality/gi, replaceZh: "" },
];

/** 去掉空洞夸饰，保留可观察动作/机位/光 */
export function stripManhuaPromptSlop(text: string): string {
  let t = String(text || "");
  for (const { re, replaceZh } of SLOP_PHRASES) t = t.replace(re, replaceZh);
  return t
    .replace(/[，,]{2,}/g, "，")
    .replace(/[；;]{2,}/g, "；")
    .replace(/\s{2,}/g, " ")
    .replace(/^[，,；;\s]+|[，,；;\s]+$/g, "")
    .trim();
}

export type ManhuaBeatFirewallInput = {
  /** 本段索引（1-based） */
  segmentIndex: number;
  /** 本段意图（观众应感到什么） */
  intentZh?: string;
  /** 本段可拍正文（对白/表演/光影等） */
  thisBeatZh: string;
  /** 更早段落摘要（已发生） */
  alreadyHappenedZh?: string;
  /** 留给后段的钩子/禁写内容 */
  reservedForLaterZh?: string;
};

/** 节拍防火墙：只编译本段，标明已发生与勿提前剧透 */
export function formatManhuaBeatFirewallBlock(input: ManhuaBeatFirewallInput): string {
  const idx = Math.max(1, Math.floor(input.segmentIndex || 1));
  const intent = String(input.intentZh || "").trim().slice(0, 80);
  const now = stripManhuaPromptSlop(String(input.thisBeatZh || "").trim()).slice(0, 900);
  const already = String(input.alreadyHappenedZh || "").trim().slice(0, 280);
  const later = String(input.reservedForLaterZh || "").trim().slice(0, 200);
  return [
    "【节拍防火墙】",
    `当前只拍第 ${idx} 段；禁止把后段剧情提前演完。`,
    intent ? `本段单一意图：${intent}` : "本段单一意图：让观众感到局势或人物关系变化。",
    already ? `已发生（勿重演）：${already}` : "",
    now ? `本段只发生：${now}` : "",
    later ? `留给后段（本段勿拍）：${later}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatManhuaFeltIntentLine(intentZh?: string | null): string {
  const intent = String(intentZh || "").trim().slice(0, 80);
  if (!intent) return "";
  return `【本段意图】${intent}——机位、光影、表演只服务这一句。`;
}

export type ManhuaChainDepthState = {
  sceneKey: string;
  depth: number;
};

/** 场景键：同场连续续拍才累加；换场重计 */
export function normalizeManhuaChainSceneKey(raw?: string | null): string {
  const s = String(raw || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[，,。.;；]/g, "")
    .slice(0, 48);
  return s || "未命名场景";
}

/**
 * 统计「即将拍的这一段」之前、同场景连续已完成段数（从末尾往前数）。
 * ignoreFirstN：重锚后忽略更早的成片（产品闭环用）。
 */
export function measureManhuaChainDepth(opts: {
  priorSceneKeys: string[];
  nextSceneKey: string;
  ignoreFirstN?: number;
}): { depth: number; sceneKey: string } {
  const key = normalizeManhuaChainSceneKey(opts.nextSceneKey);
  const skip = Math.max(0, Math.floor(opts.ignoreFirstN || 0));
  const keys = (opts.priorSceneKeys || [])
    .slice(skip)
    .map((k) => normalizeManhuaChainSceneKey(k));
  let depth = 0;
  for (let i = keys.length - 1; i >= 0; i--) {
    if (keys[i] !== key) break;
    depth += 1;
  }
  return { depth, sceneKey: key };
}

/** 是否允许再链式续拍；超限须重锚设定板 */
export function canContinueManhuaChain(
  state: ManhuaChainDepthState | null | undefined,
  opts?: { maxDepth?: number },
): { ok: boolean; nextDepth: number; reasonZh?: string; maxDepth: number } {
  const max = Math.min(
    MANHUA_CHAIN_DEPTH_HARD_MAX,
    Math.max(1, Math.floor(opts?.maxDepth ?? MANHUA_CHAIN_DEPTH_DEFAULT)),
  );
  const depth = Math.max(0, Math.floor(state?.depth || 0));
  if (depth >= max) {
    return {
      ok: false,
      nextDepth: depth,
      maxDepth: max,
      reasonZh: `同场景「${state?.sceneKey || "当前场"}」已连续续拍 ${depth} 次（上限 ${max}）。请先重锚角色/场景设定图，再接着拍，避免脸与空间漂移。`,
    };
  }
  return { ok: true, nextDepth: depth + 1, maxDepth: max };
}

export function formatManhuaChainReanchorHintZh(sceneKey?: string | null): string {
  const key = normalizeManhuaChainSceneKey(sceneKey);
  return `同场景「${key}」续拍已达上限。点「重锚设定板」出齐角色/场景参考图后，可重新开链续拍。`;
}

/** 续拍硬门：优先真实尾帧图；无尾帧时可用已接受成片 URL 兜底 */
export function manhuaContinuationRequiresLastFrame(opts: {
  lastFrameUrl?: string | null;
  acceptedClipUrl?: string | null;
}): { ok: boolean; hintZh?: string; usedLastFrame: boolean } {
  const last = String(opts.lastFrameUrl || "").trim();
  const clip = String(opts.acceptedClipUrl || "").trim();
  if (/^https?:\/\//i.test(last)) return { ok: true, usedLastFrame: true };
  if (/^https?:\/\//i.test(clip)) return { ok: true, usedLastFrame: false };
  return {
    ok: false,
    usedLastFrame: false,
    hintZh: "续拍须挂上一段已抽取尾帧或已接受成片，才能按真实落点接着拍。",
  };
}

/** 单变量重拍：在原 prompt 上叠「只改一项」补丁，其它保持不变 */
export function patchPromptForRetakeVariable(
  prompt: string,
  variable: ManhuaRetakeVariable,
  attempt = 1,
): string {
  const base = stripManhuaPromptSlop(String(prompt || "").trim());
  const label = MANHUA_RETAKE_VARIABLE_LABEL_ZH[variable];
  const n = Math.max(1, Math.floor(attempt));
  const patchByVar: Record<ManhuaRetakeVariable, string> = {
    camera: "只调整运镜轨迹/速度/起落幅；人物站位、服装、场景陈设保持与参考一致。",
    performance: "只加强表情/口型气口/肢体可读性；机位与光比保持不变。",
    lighting: "只调整光比/轮廓/曝光层次；构图与表演节拍保持不变。",
    reference: "严格贴合参考图身份锁与空间锁；禁止换脸换装跳棚。",
    duration: "只收紧或拉开动作节奏与气口密度；场景与人物关系不变。",
    framing: "只调整景别/构图安全区；运镜意图与表演不变。",
  };
  const patch = [
    `【轻量重拍·第 ${n} 次】`,
    `只改「${label}」一项：${patchByVar[variable]}`,
    "禁止同时改其它变量；禁止新增无关角色或换场。",
  ].join("\n");
  // 去掉旧重拍块，避免叠多层
  const cleaned = base.replace(/\n*【轻量重拍·第\s*\d+\s*次】[\s\S]*?(?=\n【|$)/g, "").trim();
  return stripManhuaPromptSlop([cleaned, patch].filter(Boolean).join("\n\n"));
}

export function formatManhuaReferenceDutyBlock(
  duties: Array<{ duty: ManhuaRefDuty; labelZh?: string }>,
): string {
  const lines = duties
    .map((d) => {
      const dutyLabel = MANHUA_REF_DUTY_LABEL_ZH[d.duty] || d.duty;
      const name = String(d.labelZh || "").trim();
      return `- ${dutyLabel}${name ? `：${name}` : ""}`;
    })
    .filter(Boolean);
  if (!lines.length) return "";
  return [
    "【参考职责】",
    "各参考只服务标注职责；身份锁不改脸，空间锁不改陈设布局，首尾帧管起止构图。",
    ...lines,
  ].join("\n");
}

/** 质检失败后的单变量重拍建议（轻量） */
export function suggestManhuaRetakeVariable(summaryZh: string): ManhuaRetakeVariable {
  const s = String(summaryZh || "");
  if (/运镜|抖动|晃|推拉|跟拍|焦距/.test(s)) return "camera";
  if (/表情|表演|口型|肢体|眼神/.test(s)) return "performance";
  if (/光|曝光|过暗|过亮|色偏/.test(s)) return "lighting";
  if (/参考|脸|服装|漂移|不一致/.test(s)) return "reference";
  if (/时长|节奏|过快|过慢|秒/.test(s)) return "duration";
  if (/构图|裁切|景别|出画/.test(s)) return "framing";
  return "performance";
}

export function formatManhuaRetakeHintZh(
  variable: ManhuaRetakeVariable,
  attempt = 1,
  maxAttempts = 3,
): string {
  const n = Math.max(1, Math.floor(attempt));
  const max = Math.max(n, Math.floor(maxAttempts));
  return `重拍建议（第 ${n}/${max} 次）：只改「${MANHUA_RETAKE_VARIABLE_LABEL_ZH[variable]}」一项，其它保持不变。`;
}

/** 综合注入：意图 + 防火墙 + 去空话后的本段正文 */
export function compileManhuaDirectedSegmentPrompt(input: {
  segmentIndex: number;
  intentZh?: string;
  thisBeatZh: string;
  alreadyHappenedZh?: string;
  reservedForLaterZh?: string;
  extraBlocks?: string[];
}): string {
  const firewall = formatManhuaBeatFirewallBlock({
    segmentIndex: input.segmentIndex,
    intentZh: input.intentZh,
    thisBeatZh: input.thisBeatZh,
    alreadyHappenedZh: input.alreadyHappenedZh,
    reservedForLaterZh: input.reservedForLaterZh,
  });
  const intent = formatManhuaFeltIntentLine(input.intentZh);
  const extras = (input.extraBlocks || []).map(stripManhuaPromptSlop).filter(Boolean);
  return [intent, firewall, ...extras].filter(Boolean).join("\n\n");
}
