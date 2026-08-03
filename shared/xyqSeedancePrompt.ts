/**
 * 成片·加长（小云雀 2.5）提示词辅助：秒级时间戳分镜、延长、局部重拍、复刻。
 *
 * 路由由服务端 `runXyqSeedance25Video` 决定（勿只靠改文案假装能力）：
 * - generate / extend → video_part_tool_param（模型直出；延长须 videos[]）
 * - reshoot / remix → nest submit_run（message + asset_ids，无 video_part）
 * - upscale / erase_subtitle → video_part mini_tool_param（官方超分/擦字幕）
 */

export type XyqSeedance25WorkMode =
  | "generate"
  | "extend"
  | "reshoot"
  | "remix"
  | "upscale"
  | "erase_subtitle";

export const XYQ_SEEDANCE25_WORK_MODES: readonly XyqSeedance25WorkMode[] = [
  "generate",
  "extend",
  "reshoot",
  "remix",
  "upscale",
  "erase_subtitle",
] as const;

export function parseXyqSeedance25WorkMode(raw: unknown): XyqSeedance25WorkMode {
  const m = String(raw || "").trim().toLowerCase();
  if ((XYQ_SEEDANCE25_WORK_MODES as readonly string[]).includes(m)) {
    return m as XyqSeedance25WorkMode;
  }
  return "generate";
}

/** 需要参考视频的模式 */
export function xyqWorkModeNeedsVideo(mode: XyqSeedance25WorkMode): boolean {
  return (
    mode === "extend" ||
    mode === "reshoot" ||
    mode === "remix" ||
    mode === "upscale" ||
    mode === "erase_subtitle"
  );
}

/** nest 会话模式（无 video_part_tool_param） */
export function xyqWorkModeIsNest(mode: XyqSeedance25WorkMode): boolean {
  return mode === "reshoot" || mode === "remix";
}

/** 官方 mini tool（超分/擦字幕） */
export function xyqWorkModeIsMiniTool(mode: XyqSeedance25WorkMode): boolean {
  return mode === "upscale" || mode === "erase_subtitle";
}

/** 正文是否已含秒级时间戳（如 `0-5秒` / `0-5s` / `00:00-00:05`） */
export function hasXyqTimestampStoryboard(prompt: string): boolean {
  const t = String(prompt || "");
  if (/\d+\s*[-–~到至]\s*\d+\s*(秒|s)(?![a-z0-9])/i.test(t)) return true;
  if (/\d{1,2}:\d{2}\s*[-–~]\s*\d{1,2}:\d{2}/.test(t)) return true;
  if (/(^|\n)\s*\d+\s*[-–]\s*\d+\s*[：:]/m.test(t)) return true;
  return false;
}

/**
 * 把多行「时段 | 画面」整理成推荐写法。空行忽略。
 * 行格式示例：`0-5 | 环绕半周展空间，主角入画`
 */
export function formatXyqTimestampStoryboardLines(raw: string, durationSec: number): string {
  const dur = Math.max(4, Math.min(30, Math.floor(Number(durationSec) || 15)));
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return "";

  const out: string[] = ["【秒级分镜】"];
  for (const line of lines) {
    const m = line.match(
      /^(\d{1,2}(?::\d{2})?)\s*[-–~到至]\s*(\d{1,2}(?::\d{2})?)\s*[|：:]\s*(.+)$/,
    );
    if (m) {
      out.push(`${m[1]}-${m[2]}秒：${m[3]!.trim()}`);
      continue;
    }
    const m2 = line.match(/^(\d+)\s*[-–~]\s*(\d+)\s*(?:秒|s)?\s*[|：:]?\s*(.+)$/i);
    if (m2) {
      out.push(`${m2[1]}-${m2[2]}秒：${m2[3]!.trim()}`);
      continue;
    }
    out.push(line);
  }
  out.push(`（总时长约 ${dur} 秒；请在指定秒数执行对应画面，勿后半段跑偏）`);
  return out.join("\n");
}

export function mergeXyqTimestampIntoPrompt(
  basePrompt: string,
  storyboardRaw: string | undefined,
  durationSec: number,
): string {
  const base = String(basePrompt || "").trim();
  const board = formatXyqTimestampStoryboardLines(String(storyboardRaw || ""), durationSec);
  if (!board) return base;
  if (hasXyqTimestampStoryboard(base) && !String(storyboardRaw || "").trim()) return base;
  return [base, board].filter(Boolean).join("\n\n").trim();
}

export function buildXyqExtendInstruction(userPrompt: string, extendSec: number): string {
  const sec = Math.max(4, Math.min(30, Math.floor(Number(extendSec) || 15)));
  const body = String(userPrompt || "").trim();
  return [
    "【成片延长】",
    `在已提供的参考视频之后，无缝续写约 ${sec} 秒。`,
    "保持同一角色外形、服装、场景空间、光影与运镜气质；动作与剧情自然承接末帧，禁止硬切重开。",
    "不要重复片头自我介绍；从上一镜结束处继续。",
    body ? `续写内容要求：\n${body}` : "续写内容：延续当前情绪与动作，推进下一拍戏剧功能。",
  ].join("\n");
}

export function buildXyqReshootInstruction(
  userPrompt: string,
  fromSec: number,
  toSec: number,
): string {
  const a = Math.max(0, Math.floor(Number(fromSec) || 0));
  const b = Math.max(a + 1, Math.floor(Number(toSec) || a + 3));
  const body = String(userPrompt || "").trim();
  return [
    "【局部重拍】",
    `仅重做参考视频中约 ${a}-${b} 秒这一段；其余时段尽量保持原画面、角色、场景与节奏。`,
    "不要整条重生成；以参考视频为时间轴真值，只替换指定秒段。",
    body ? `该秒段修改要求：\n${body}` : "该秒段：修正动作/表情/台词口型问题，其余不变。",
  ].join("\n");
}

/** 视频复刻 / 风格迁移（nest 会话自然语言；须带参考视频 asset） */
export function buildXyqRemixInstruction(userPrompt: string): string {
  const body = String(userPrompt || "").trim();
  return [
    "【视频复刻】",
    "参考已提供的视频（及可选图/音频），复刻其节奏、运镜与叙事气质，生成一条新成片。",
    "角色外形与场景可按说明改写，但镜头语言与剪辑节奏要贴近参考片。",
    body ? `复刻要求：\n${body}` : "复刻要求：保持参考片的镜头节奏与情绪弧，换成当前剧本主体。",
  ].join("\n");
}

export function composeXyqSeedance25Prompt(input: {
  basePrompt: string;
  workMode?: XyqSeedance25WorkMode;
  timestampStoryboard?: string;
  durationSec: number;
  reshootFromSec?: number;
  reshootToSec?: number;
}): string {
  const mode = input.workMode || "generate";
  const dur = input.durationSec;
  if (mode === "upscale") {
    // 服务端用官方固定 message；此处仅作占位，避免空 prompt 被拦
    return String(input.basePrompt || "").trim() || "提升视频清晰度";
  }
  if (mode === "erase_subtitle") {
    return String(input.basePrompt || "").trim() || "擦除视频字幕";
  }
  if (mode === "extend") {
    const merged = mergeXyqTimestampIntoPrompt(
      input.basePrompt,
      input.timestampStoryboard,
      dur,
    );
    return buildXyqExtendInstruction(merged, dur);
  }
  if (mode === "reshoot") {
    return buildXyqReshootInstruction(
      mergeXyqTimestampIntoPrompt(input.basePrompt, input.timestampStoryboard, dur),
      input.reshootFromSec ?? 0,
      input.reshootToSec ?? 3,
    );
  }
  if (mode === "remix") {
    return buildXyqRemixInstruction(
      mergeXyqTimestampIntoPrompt(input.basePrompt, input.timestampStoryboard, dur),
    );
  }
  return mergeXyqTimestampIntoPrompt(input.basePrompt, input.timestampStoryboard, dur);
}
