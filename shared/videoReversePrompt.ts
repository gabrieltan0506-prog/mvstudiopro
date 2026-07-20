/**
 * 视频反推提示词（nanophoto 对齐思路 · Gemini 主看片）
 * 成稿去导演名；输出八维分镜表 + Seedance/I2V 微动句。
 * ⑨A：八维拉片 + zh / en / compact 三档输出。
 */

export const VIDEO_REVERSE_MAX_FRAMES = 24;
export const VIDEO_REVERSE_DEFAULT_INTERVAL_SEC = 2;
export const VIDEO_REVERSE_MAX_DURATION_SEC = 120;

/** 拉片八维（不含镜号/时码/时长元数据） */
export const VIDEO_REVERSE_EIGHT_DIMS_ZH = [
  "景别",
  "角度",
  "运镜",
  "灯光",
  "构图",
  "主体动作",
  "音频",
  "转场/卡点",
] as const;

export const VIDEO_REVERSE_EIGHT_DIMS_EN = [
  "Shot size",
  "Angle",
  "Camera move",
  "Lighting",
  "Framing",
  "Subject action",
  "Audio",
  "Transition/beat",
] as const;

export type VideoReverseOutputMode = "zh" | "en" | "compact";

export function parseVideoReverseOutputMode(raw: unknown): VideoReverseOutputMode {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "en" || v === "english") return "en";
  if (v === "compact" || v === "short" || v === "精简") return "compact";
  return "zh";
}

export const VIDEO_REVERSE_SYSTEM_PROMPT = `你是影视拉片与 AI 视频提示词编译器。
输入是按时间顺序的视频关键帧（可能附带用户说明）。
任务：反推可复刻的**八维分镜表** + 可直接用于图生视频的短提示词。

硬规则：
1. 只输出 Markdown，不要 JSON 围栏、不要道歉。
2. 成稿禁止导演名、片名、「向某某致敬」「某某风」。只写可拍手法（景别、运镜、光影、微动）。
3. 有参考静帧时，视频提示词做减法：【镜头运动】+【主体微动】+【环境氛围】。
4. 大幅度打斗拆成 2–3 秒阶段并写因果与环境反馈。
5. 八维每格尽量短词；不要写成说明书墙。
6. 中文为主（除非用户要求英文档）；Seedance 微动句可用简洁英文。`;

function buildStructureZh(): string {
  const dims = VIDEO_REVERSE_EIGHT_DIMS_ZH.join("｜");
  return [
    "请严格按下列结构输出：",
    "",
    "## 一句话摘要",
    "（题材、情绪、视觉气质，≤40字）",
    "",
    "## 八维分镜表",
    `每镜覆盖：${dims}`,
    "| 镜号 | 约时码 | 景别 | 角度 | 运镜 | 灯光 | 构图 | 主体动作 | 音频 | 转场/卡点 | 时长建议 |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    "| 01 | 0:00 | … | … | … | … | … | … | … | … | 2–3s |",
    "（按实际镜头数继续；合并重复空镜；空维写「—」勿编造）",
    "",
    "## 角色与场景锁定",
    "- 人物：脸/发型/服装锚点（勿用真人名人名）",
    "- 场景：空间、时段、主光源",
    "- 一致性口令：下一镜如何引用上一镜尾帧",
    "",
    "## Seedance / I2V 微动提示词（每镜一句）",
    "1. …",
    "2. …",
    "",
    "## 可复制总提示（首镜）",
    "一段可直接粘贴的首镜生成提示（静帧用画面描写；若已有参考图则只写微动）。",
  ].join("\n");
}

function buildStructureEn(): string {
  const dims = VIDEO_REVERSE_EIGHT_DIMS_EN.join(" | ");
  return [
    "Output Markdown in English with this structure:",
    "",
    "## One-line summary",
    "(genre, mood, visual tone, ≤40 words)",
    "",
    "## Eight-dimension shot table",
    `Each shot covers: ${dims}`,
    "| # | TC | Size | Angle | Move | Light | Frame | Action | Audio | Transition | Dur |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    "| 01 | 0:00 | … | … | … | … | … | … | … | … | 2–3s |",
    "(merge empty holds; use — for unknown dims; no director/film names)",
    "",
    "## Character & scene lock",
    "- Face/hair/wardrobe anchors (no celebrity names)",
    "- Space, time of day, key light",
    "- Continuity cue from previous end frame",
    "",
    "## I2V micro-motion lines (one per shot)",
    "1. …",
    "",
    "## Copy-paste master prompt (shot 01)",
    "Still description or micro-motion-only if a reference image exists.",
  ].join("\n");
}

function buildStructureCompact(): string {
  return [
    "请输出**精简档** Markdown（短词优先，禁止说明书墙）：",
    "",
    "## 摘要",
    "≤24字。",
    "",
    "## 八维表（精简）",
    "| # | 时码 | 景别 | 角度 | 运镜 | 灯光 | 构图 | 动作 | 音频 | 转场 |",
    "|---|---|---|---|---|---|---|---|---|---|",
    "| 01 | 0:00 | … | … | … | … | … | … | … | … |",
    "每格≤8字；可省略时长列。",
    "",
    "## 锁定",
    "人物锚点 / 场景 / 主光 各一行。",
    "",
    "## 微动句",
    "每镜一行：运镜+微动+氛围（≤20词，可中英混）。",
    "",
    "## 首镜总提示",
    "≤2 句可粘贴。",
  ].join("\n");
}

export function buildVideoReverseUserPrompt(opts?: {
  userHint?: string;
  locale?: "zh" | "en";
  /** ⑨A：zh 完整中文 / en 英文 / compact 精简 */
  outputMode?: VideoReverseOutputMode;
  targetEngine?: "seedance-2.0" | "generic";
}): string {
  const hint = String(opts?.userHint || "").trim();
  const engine = opts?.targetEngine || "seedance-2.0";
  const mode: VideoReverseOutputMode =
    opts?.outputMode ||
    (opts?.locale === "en" ? "en" : "zh");

  const structure =
    mode === "en" ? buildStructureEn() : mode === "compact" ? buildStructureCompact() : buildStructureZh();

  return [
    hint ? `【用户关注点】${hint}` : "",
    `【目标引擎】${engine}`,
    `【输出档】${mode}`,
    "",
    structure,
  ]
    .filter(Boolean)
    .join("\n");
}

/** 漫剧工作室阶段（优于抄袭：结构化 + 导演中台 + 反推闭环） */
export const MANHUA_DRAMA_STAGE_LABELS = [
  "story_brief",
  "character_bible",
  "episode_beats",
  "video_reverse",
  "key_art",
  "seedance_clip",
] as const;

export type ManhuaDramaStage = (typeof MANHUA_DRAMA_STAGE_LABELS)[number];

export const MANHUA_DRAMA_DEFAULT_PROMPTS: Record<ManhuaDramaStage, string> = {
  story_brief:
    "用 5 行写出漫剧一集（约 15 秒成片）：标题钩子、世界观一句、主角欲望、核心冲突、本集收束。禁止灌水。成稿去导演名/片名。",
  character_bible:
    "输出本集 1–3 个角色设定卡：外形锚点（发型/服装/标志物）、性格一句、对白语气、禁止崩坏点。成稿去真人名。",
  episode_beats:
    "把故事拆成 6–8 个可拍镜头节拍（合计约 15 秒）：镜号｜景别｜运镜｜灯光情绪｜动作｜对白/旁白。每镜 2–3 秒。这是导演灵感画布，不是死板清单。",
  video_reverse:
    "若已上传参考短片：反推八维编导分镜表 + Seedance 微动句。若无片：根据上游节拍补全八维分镜表（起承转合 + 观众必看点）。成稿去导演名。",
  key_art:
    "根据角色卡与编导分镜，生成竖屏关键静帧（角色锁定、电影感布光、无字幕无水印）。",
  seedance_clip:
    "有参考图时只写运镜+主体微动+氛围；单次生成严格按 10 秒设计，不得要求 15 秒。",
};
