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
import {
  extractPerformanceCuesFromScript,
  formatManhuaPerformanceInjectBlock,
} from "./manhuaPerformancePrompt.js";
import {
  MANHUA_ASSET_SHEET_SOFT_NO_TEXT_EN,
  MANHUA_ASSET_SHEET_SOFT_NO_TEXT_ZH,
} from "./manhuaScriptWorkbench.js";
import { formatManhuaPropShapeHintLineZh } from "./manhuaPropShapeHint.js";

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

  const perfCues = extractPerformanceCuesFromScript(raw, stage === "clip" ? 3 : 4);
  const perfBlocks = perfCues
    .map((c, i) =>
      formatManhuaPerformanceInjectBlock(c, {
        stage: stage === "clip" ? "clip" : "key_art",
        shotIndex: i + 1,
      }),
    )
    .filter(Boolean);

  const lines: string[] = [
    "【视觉提示词简报·禁止灌剧本】",
    "硬规则：只写可拍画面；运镜与主体动作分行；场景变换单独点明；台词/情绪作表演控制，禁止整段对白/世界观/人物表硬贴进生图，禁止烧字。",
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
  if (perfCues.length) {
    lines.push("人物表演线索（台词只驱动口型/气口，微表情须近景可读）：");
    for (const c of perfCues) {
      const bits = [
        c.dialogueZh ? `「${c.dialogueZh}」` : "",
        c.voiceToneZh || "",
        c.emotionZh || "",
        c.microExpressionZh || "",
      ].filter(Boolean);
      if (bits.length) lines.push(`- ${bits.join(" · ")}`);
    }
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
    ...perfBlocks.slice(0, 2),
  ]
    .filter(Boolean)
    .join("\n\n");

  if (body.length > maxChars - 320) {
    body = `${body.slice(0, Math.max(200, maxChars - 320)).trimEnd()}…`;
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
  /** 台词·语气·微表情摘要（工作台闸门可见） */
  performanceLines: string[];
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
  const performanceLines = extractPerformanceCuesFromScript(raw, 4).map((c) =>
    [
      c.dialogueZh ? `「${c.dialogueZh}」` : "",
      c.voiceToneZh,
      c.emotionZh,
      c.microExpressionZh,
    ]
      .filter(Boolean)
      .join(" · "),
  );
  return {
    topicZh: topic.slice(0, 120),
    scenes: extractSceneAnchors(raw, 3),
    cameras: extractCameraCues(raw, 4),
    motions: extractMotionCues(raw, 4),
    shifts: extractSceneShifts(raw, 3),
    events: extractShootableEvents(raw, 4),
    performanceLines,
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

/** 场景设定图（空镜主场景）生图提示——先于分镜静帧；禁字硬锁 */
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
    "生成一张竖版漫剧主场景空镜参考（9:16）：环境层次与纵深清楚，陈设与材质看得清。",
    "只按场景本体来画：光线、材质、陈设与纵深撑起画面；可有远处剪影，不要人物特写占满。",
    scenePrompt ? `请画出的场景视觉：${name} —— ${scenePrompt}` : `请画出的场景视觉：${name}`,
    styleLabel ? `【画风】${styleLabel}` : "",
    stylePrompt || "",
    MANHUA_ASSET_SHEET_SOFT_NO_TEXT_EN,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 道具单件参考图生图提示。
 *
 * 道具原先只并进角色定妆卡的特写格，于是它没有自己的 URL：段内绑图时
 * 要么拿到那张角色卡（等于和脸共用一张，反倒把脸的权重摊薄），要么是
 * logical:// 占位被过滤掉，等于压根没锁。所以这里出独立单件图。
 *
 * 单件、单角度、干净背景：多角度拼图是 ID 漂移头号根因，角色卡刚按这个
 * 理由拆成大头照 + 全身照，道具不能再走回拼图那条路。
 */
/**
 * 天生带字的道具：账册、密信、令牌、朝笏、契券、印章这类，纸面/牌面就是主体，
 * 模型默认会往上写汉字（用户 2026-07-29 验收发现道具图烧字）。命中就补一句纸面素净的正向描述。
 */
const PROP_TEXT_BEARING_RE =
  /账册|账本|帐册|密信|信函|书信|文书|案卷|卷宗|档|令|笏|契|券|符|榜|册|卷|谱|状|折子|奏折|印|章|牌|匾|额|碑|旗|封条|名录|名册/;

function isTextBearingProp(nameZh: string, propPromptZh: string): boolean {
  return PROP_TEXT_BEARING_RE.test(`${nameZh}${propPromptZh}`);
}


/**
 * 从道具视觉句里剥掉叙事文本，只留外形材质。
 *
 * 2026-07-29 验收：道具图被烧上海报标题（「最亲的人却在骗你?」「一枚缺口，颠覆战局」）。
 * 根因不是禁令不够狠，而是提示词把**可写的字**递到了模型手里——道具名、剧作功能、
 * 题材氛围都是成句的中文，模型自然把它排成标题。堆更多「禁止标题大字」只会把
 * 「标题」「海报」「书法」这些词重复喂进去，反而加强概念。
 * 所以这里直接不给素材：功能句、名字前缀、以及旧的重复禁令一并剥掉。
 */
export function stripPropNarrativeFromVisualZh(
  propPromptZh: string,
  nameZh?: string,
): string {
  let s = String(propPromptZh || "").trim();
  const name = String(nameZh || "").trim();
  if (name) {
    s = s.replace(new RegExp(`原创道具特写[·:：]?\\s*${name}[。;；]?`, "g"), "");
    s = s.replace(new RegExp(`^${name}[。;；]\\s*`), "");
  }
  s = s.replace(/原创道具特写[·:：]?/g, "");
  // 剧作功能 / 戏剧作用：纯叙事，画面用不上，留着就是标题素材
  s = s.replace(/(剧作功能|戏剧功能|叙事功能|作用)[：:][^。；;\n]*[。；;\n]?/g, "");
  // 旧模板自带的重复否定，交给统一的软边界句处理
  s = s.replace(/禁止可读文字[。；;]?/g, "");
  s = s.replace(/主体居中、材质可读、背景干净、竖屏9:16[。；;]?/g, "");
  return s.replace(/\s{2,}/g, " ").replace(/^[，,。;；·\s]+/, "").trim();
}

export function buildManhuaPropPlateGenPrompt(opts: {
  propNameZh: string;
  propPromptZh?: string;
  /** 这件道具归谁用：只作隐藏说明，画面不要出现人 */
  ownerNameZh?: string;
  topic?: string;
  artStyleLabelZh?: string;
  artStylePromptZh?: string;
  /**
   * 实物形制（已由服务端联网核对）。
   * 空串就不出这一行——形制宁缺勿错，Agent 不许凭常识补。
   */
  shapeHintZh?: string;
}): string {
  const name = String(opts.propNameZh || "").trim() || "关键道具";
  const propPrompt = String(opts.propPromptZh || "").trim();
  // ownerNameZh / topic 仍留在签名里给调用方，但**不进提示词**：人名与题材句就是烧标题的素材
  const styleLabel = String(opts.artStyleLabelZh || "").trim();
  const stylePrompt = String(opts.artStylePromptZh || "").trim();
  /**
   * 道具图走软边界：正面描述「博物馆藏品静物摄影」这一件器物本身，
   * 不把道具名、剧作功能、题材氛围、归属人名递进去当写字素材（那是烧海报标题的根因），
   * 也不再堆叠一长串「禁止标题/书法/印文」——重复否定只会把「标题」这个概念喂得更旺。
   */
  const visual = stripPropNarrativeFromVisualZh(propPrompt, name);
  return [
    "拍一张竖版单件器物静物照（9:16）：博物馆藏品级静物摄影，只有这一件器物与背景光，居中占画面主体，四分之三主视角，材质、纹样、磨损与配色看得清。",
    "背景是干净的浅色或深色渐变；画面里没有人、没有手、没有环境陈设，不做多角度并排或分格拼图，只要这一件的正面主视角。",
    "器物表面保持素净的旧料本色：纸见泛黄纤维，木见木纹，铜有包浆，绢见织纹；岁月只用磨损、压痕、水渍、褪色来讲。",
    formatManhuaPropShapeHintLineZh(opts.shapeHintZh || ""),
    isTextBearingProp(name, propPrompt)
      ? "器物表面只见材质本身：纤维走向或细密直纹、边角磨圆、折痕与水渍的深浅晕染，以及压过的凹痕。"
      : "",
    visual ? `器物外形与材质：${visual}` : "",
    styleLabel ? `【画风】${styleLabel}` : "",
    stylePrompt || "",
    MANHUA_ASSET_SHEET_SOFT_NO_TEXT_EN,
  ]
    .filter(Boolean)
    .join("\n");
}
