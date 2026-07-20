/**
 * 漫剧：把「剧本/编剧包」编成模型可读的视觉提示词，禁止整段剧情硬灌。
 * 重点抽出：场景锚点、运镜、动作轨迹、场景变换、本镜可拍事件。
 */

import {
  recommendActionCameraFromTopic,
  buildActionCameraInjectBlock,
} from "./manhuaActionCameraRecipeBank.js";
import {
  recommendPathCameraFromTopic,
  buildPathCameraInjectBlock,
} from "./manhuaPathCameraRecipeBank.js";

const CAMERA_RE =
  /远景|大远景|全景|中全景|中景|中近景|近景|特写|大特写|过肩|双人镜|推近|推进|拉远|横移|环绕|俯拍|仰拍|跟拍|手持|固定机位|一镜到底|甩镜|微推|缓慢推|反向平移|红蓝双轨|缓慢推进/;

const MOTION_RE =
  /追逐|奔跑|闪避|格挡|挥刀|拔刀|拔剑|架刀|佩剑|勒紧|护住|滑落|合缝|逼近|冲刺|闪身|翻滚|坠落|推门|转身|对峙|交锋|肢体|移位|群演|同框|火把|溅起|比武|打斗|比赛/;

const SCENE_SHIFT_RE =
  /切到|转场|外景|内景|破庙|朝堂|大殿|街市|天台|办公室|夜雨|庙外|殿内|窗外|门外|室内|室外|场景切换|时空跳|秘境|客栈|雨夜|石阶|宗门|教室|天台/;

export type ManhuaScriptVisualBriefOpts = {
  /** 题材一句（可选） */
  topic?: string;
  /** 输出上限（默认 1400，静帧专用可更短） */
  maxChars?: number;
  /** key_art | clip | beats —— 控制密度 */
  forStage?: "key_art" | "clip" | "beats" | "generic";
};

function cleanLine(s: string): string {
  return String(s || "")
    .replace(/[*_`>#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pickLines(raw: string, pred: (line: string) => boolean, limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of String(raw || "").split(/\r?\n/)) {
    const t = cleanLine(line);
    if (t.length < 4 || t.length > 160) continue;
    if (/^第\s*\d+\s*集|^系列|^梗概|^人物|^世界观|^标题|^##\s/.test(t)) continue;
    if (!pred(t)) continue;
    const key = t.slice(0, 48);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/** 优先取「编剧视觉摘要」或短视觉句，避免整包人物表硬灌 */
function extractVisualSummarySeed(raw: string): string {
  const tagged = String(raw || "").match(/【编剧视觉摘要】\s*([^\n【]+)/);
  if (tagged?.[1]) return cleanLine(tagged[1]).slice(0, 220);
  const compact = cleanLine(raw);
  if (
    compact.length > 0 &&
    compact.length <= 360 &&
    !/【已确认编剧包|##\s*人物表|##\s*道具表|##\s*场景表/.test(String(raw || ""))
  ) {
    return compact.slice(0, 220);
  }
  return "";
}

/** 只取「本集优先」正文，丢掉人物表/道具表长文 */
function extractEpisodeBody(raw: string): string {
  const m = String(raw || "").match(/##\s*本集优先[\s\S]*?(?=\n##\s|$)/);
  if (m?.[0]) return m[0];
  if (/【已确认编剧包/.test(raw)) {
    // 有整包结构但无本集段时，仍尽量避开人物表
    return String(raw || "")
      .replace(/##\s*人物表[\s\S]*?(?=\n##\s|$)/g, "")
      .replace(/##\s*道具表[\s\S]*?(?=\n##\s|$)/g, "")
      .replace(/##\s*场景表[\s\S]*?(?=\n##\s|$)/g, "")
      .replace(/【已确认编剧包·强制遵守】[\s\S]*?\n\n/, "");
  }
  return raw;
}

/** 从编剧包抽出「可拍事件」短句（去长论述） */
function extractShootableEvents(raw: string, limit: number): string[] {
  const events: string[] = [];
  const seen = new Set<string>();
  const seed = extractVisualSummarySeed(raw);
  if (seed) {
    events.push(seed);
    seen.add(seed.slice(0, 40));
  }
  const body = extractEpisodeBody(raw);
  const numbered = String(body || "").match(
    /(?:^|\n)\s*(?:[-*•]\s*)?(?:分镜|镜头|节拍)?\s*\d{1,2}\s*[:：、.\)\]】]\s*[^\n]+/g,
  );
  if (numbered?.length) {
    for (const row of numbered) {
      const text = cleanLine(
        row.replace(/^(?:[-*•]\s*)?(?:分镜|镜头|节拍)?\s*\d{1,2}\s*[:：、.\)\]】]\s*/i, ""),
      );
      if (text.length < 6) continue;
      const key = text.slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(text.slice(0, 96));
      if (events.length >= limit) return events;
    }
  }
  for (const line of String(body || "").split(/[。！？\n]+/)) {
    const t = cleanLine(line);
    if (t.length < 8 || t.length > 72) continue;
    if (!MOTION_RE.test(t) && !CAMERA_RE.test(t) && !SCENE_SHIFT_RE.test(t)) continue;
    if (/世界观|标题钩子|主角欲望|核心冲突|本集收束|梗概：|片尾钩子/.test(t)) continue;
    const key = t.slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(t);
    if (events.length >= limit) break;
  }
  return events.slice(0, limit);
}

function extractSceneAnchors(raw: string, limit: number): string[] {
  return pickLines(extractEpisodeBody(raw), (t) => SCENE_SHIFT_RE.test(t) || /殿|庙|街|台|房|院|雨|夜|火把|供案|洞府/.test(t), limit);
}

function extractCameraCues(raw: string, limit: number): string[] {
  return pickLines(extractEpisodeBody(raw), (t) => CAMERA_RE.test(t), limit);
}

function extractMotionCues(raw: string, limit: number): string[] {
  return pickLines(extractEpisodeBody(raw), (t) => MOTION_RE.test(t), limit);
}

function extractSceneShifts(raw: string, limit: number): string[] {
  return pickLines(extractEpisodeBody(raw), (t) => SCENE_SHIFT_RE.test(t), limit);
}

/**
 * 将剧本/编剧包编成【视觉提示词简报】——供静帧 / 成片注入。
 * 不含长篇对白与世界观论述；运镜与动作拆开写。
 */
export function compileManhuaScriptVisualBrief(
  rawScript: string,
  opts?: ManhuaScriptVisualBriefOpts,
): string {
  const raw = String(rawScript || "").trim();
  if (!raw) return "";

  const stage = opts?.forStage || "generic";
  const maxChars =
    typeof opts?.maxChars === "number" && opts.maxChars > 200
      ? Math.floor(opts.maxChars)
      : stage === "key_art"
        ? 1100
        : stage === "clip"
          ? 900
          : 1400;

  const topic = String(opts?.topic || "").trim();
  const blobForRec = [topic, extractEpisodeBody(raw)].filter(Boolean).join("\n");
  const pathRec = recommendPathCameraFromTopic(blobForRec);
  const actionRec = recommendActionCameraFromTopic(blobForRec);
  const pathBlock = buildPathCameraInjectBlock(
    pathRec.recipeId ? [pathRec.recipeId] : [],
  );
  const actionBlock = buildActionCameraInjectBlock(
    actionRec.recipeId ? [actionRec.recipeId] : [],
  );

  const eventLimit = stage === "key_art" ? 4 : stage === "clip" ? 3 : 5;
  const events = extractShootableEvents(raw, eventLimit);
  const scenes = extractSceneAnchors(raw, 3);
  const cameras = extractCameraCues(raw, 4);
  const motions = extractMotionCues(raw, 4);
  const shifts = extractSceneShifts(raw, 3);

  const lines: string[] = [
    "【视觉提示词简报·禁止灌剧本】",
    "硬规则：只写可拍画面；运镜与主体动作分行；场景变换单独点明；禁止整段对白/世界观/人物表硬贴进生图。",
  ];
  if (topic) lines.push(`题材锚点：${topic.slice(0, 120)}`);

  if (scenes.length) {
    lines.push("场景锚点（本镜必须进景，禁止悬浮抠人）：");
    for (const s of scenes) lines.push(`- ${s}`);
  }
  if (shifts.length) {
    lines.push("场景变换（跨镜/镜内空间跳转，须可读）：");
    for (const s of shifts) lines.push(`- ${s}`);
  }
  if (cameras.length) {
    lines.push("运镜线索（镜头运动，勿与人物动作混写）：");
    for (const s of cameras) lines.push(`- ${s}`);
  }
  if (motions.length) {
    lines.push("动作轨迹（肢体移位/身体位移，须有方向与起止）：");
    for (const s of motions) lines.push(`- ${s}`);
  }
  if (events.length) {
    lines.push("本集可拍事件（按序，每条≤一句）：");
    events.forEach((e, i) => lines.push(`${i + 1}. ${e}`));
  } else {
    lines.push("本集可拍事件：从题材与场景做 3～4 个连续冲突节拍，禁止空镜走路。");
  }

  let body = lines.join("\n");
  const recipeTail = [
    pathBlock ? pathBlock.split("\n").slice(0, 6).join("\n") : "",
    actionBlock ? actionBlock.split("\n").slice(0, 6).join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (body.length > maxChars - 280) {
    body = `${body.slice(0, Math.max(200, maxChars - 280)).trimEnd()}…`;
  }
  const out = [body, recipeTail].filter(Boolean).join("\n\n");
  return out.length > maxChars ? `${out.slice(0, maxChars).trimEnd()}…` : out;
}

/** 工作台可见简报闸门：结构化摘要（非整段剧本） */
export type ManhuaVisualBriefUiSummary = {
  topicZh: string;
  scenes: string[];
  cameras: string[];
  motions: string[];
  shifts: string[];
  events: string[];
  pathLabelZh: string;
  actionLabelZh: string;
  fullBriefZh: string;
};

export function summarizeManhuaVisualBriefForUi(
  rawScript: string,
  opts?: ManhuaScriptVisualBriefOpts,
): ManhuaVisualBriefUiSummary {
  const topic = String(opts?.topic || "").trim();
  const raw = String(rawScript || "").trim();
  const body = extractEpisodeBody(raw);
  const blobForRec = [topic, body].filter(Boolean).join("\n");
  const pathRec = recommendPathCameraFromTopic(blobForRec);
  const actionRec = recommendActionCameraFromTopic(blobForRec);
  return {
    topicZh: topic.slice(0, 120),
    scenes: extractSceneAnchors(raw, 3),
    cameras: extractCameraCues(raw, 4),
    motions: extractMotionCues(raw, 4),
    shifts: extractSceneShifts(raw, 3),
    events: extractShootableEvents(raw, 4),
    pathLabelZh: pathRec.entry?.nameZh || pathRec.reasonZh || "",
    actionLabelZh: actionRec.entry?.nameZh || actionRec.reasonZh || "",
    fullBriefZh: compileManhuaScriptVisualBrief(raw, {
      ...opts,
      forStage: opts?.forStage || "key_art",
      maxChars: opts?.maxChars ?? 900,
    }),
  };
}

/** 是否仍像「整段剧本硬灌」（用于测试与门禁自检） */
export function looksLikeRawScriptDump(prompt: string): boolean {
  const p = String(prompt || "");
  if (/【视觉提示词简报/.test(p)) return false;
  const narrativeHits = (p.match(/世界观一句|主角欲望|核心冲突|本集收束|标题钩子|##\s*人物表|【已确认编剧包/g) || [])
    .length;
  return narrativeHits >= 2 && p.length > 800;
}

/** 场景设定图（空镜主场景）生图提示——先于分镜静帧 */
export function buildManhuaScenePlateGenPrompt(opts: {
  sceneNameZh: string;
  scenePromptZh: string;
  topic?: string;
  artStyleLabelZh?: string;
  artStylePromptZh?: string;
}): string {
  const name = String(opts.sceneNameZh || "").trim() || "主场景";
  const scenePrompt = String(opts.scenePromptZh || "").trim();
  const topic = String(opts.topic || "").trim();
  const styleLabel = String(opts.artStyleLabelZh || "").trim();
  const stylePrompt = String(opts.artStylePromptZh || "").trim();
  return [
    "生成一张竖版【漫剧主场景设定图】空镜（无可读文字、无字幕）：",
    "硬约束：环境层次与纵深清楚；可互动物件可读；禁止纯白棚拍；禁止人物特写占满；可有远处剪影人物但不抢戏。",
    `场景名：${name}`,
    scenePrompt ? `场景视觉：${scenePrompt}` : "",
    topic ? `题材锚点：${topic.slice(0, 120)}` : "",
    styleLabel ? `【画风】${styleLabel}` : "",
    stylePrompt || "",
  ]
    .filter(Boolean)
    .join("\n");
}
