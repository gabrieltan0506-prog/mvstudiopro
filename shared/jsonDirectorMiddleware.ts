/**
 * JSON 导演中台（super-i / 刺猬星球方法论，成稿去导演名）
 *
 * 链路：用户意图 → 结构化 JSON（锁摄影）→ LLM 译成自然语言/标签 → 生图
 * 图生视频：做减法，只用 [镜头运动]+[主体微动]+[环境氛围]，勿复贴整段电影感长文。
 *
 * 来源对齐：~/Downloads/2026Jul16/json.mp4 · https://www.super-i.cn/info-2570.html · info-2574.html
 */

import {
  compilePathAnnotationToMotionPrompt,
  normalizePathAnnotation,
} from "./manhuaPathCameraAnnotate.js";
import {
  compilePathCameraRecipeToMotionPrompt,
  getPathCameraRecipeById,
} from "./manhuaPathCameraRecipeBank.js";

export type AspectRatio169Or916 = "16:9" | "9:16";

export type DirectorJsonLock = {
  Project_Settings: {
    aspect_ratio: AspectRatio169Or916;
    resolution: string;
    rendering_style: string;
    negative_constraints: string;
  };
  Subject_Core: {
    identity: string;
    emotion_anchor: string;
    wardrobe_props: string;
  };
  Environment_Layer: {
    location: string;
    time_of_day: string;
    atmosphere: string;
  };
  Cinematography_Lock: {
    camera_body: string;
    lens: string;
    film_stock: string;
    lighting: string;
    composition: string;
    color_grade: string;
  };
};

/** 成稿禁止导演名 / 片名致敬（与 director-craft 一致；中文不用 \\b） */
const DIRECTOR_NAME_RES: RegExp[] = [
  /\bWes\s*Anderson\b/gi,
  /安德森/gi,
  /布达佩斯大饭店/gi,
  /\bThe\s*Grand\s*Budapest(?:\s*Hotel)?\b/gi,
  /诺兰|\bNolan\b/gi,
  /王家卫/gi,
  /昆汀|\bTarantino\b/gi,
  /斯皮尔伯格|\bSpielberg\b/gi,
  /宫崎骏/gi,
  /小津/gi,
  /库布里克|\bKubrick\b/gi,
  /雷德利\s*斯科特|\bRidley\s*Scott\b/gi,
];

export function stripDirectorNamesForDelivery(text: string): string {
  let out = String(text || "");
  for (const re of DIRECTOR_NAME_RES) out = out.replace(re, "");
  return out.replace(/\s{2,}/g, " ").replace(/\s+,/g, ",").trim();
}

export function looksLikeDirectorJson(text: string): boolean {
  const t = String(text || "").trim();
  if (!t.startsWith("{") && !/"Cinematography_Lock"|"Subject_Core"|"Project_Settings"/.test(t)) {
    return false;
  }
  return /Cinematography_Lock|Subject_Core|Project_Settings|Environment_Layer/.test(t);
}

/** 优先抽取本镜静帧段，避免长 prompt 前半把分镜动作挤掉 */
function extractKeyartShotStillBlock(idea: string): string {
  const m = String(idea || "").match(
    /【分镜\s*\d+[·・]静帧】[\s\S]*?(?=\n【(?!分镜)|$)/,
  );
  return m?.[0]?.trim() || "";
}

function wantsCgDramaRendering(idea: string): boolean {
  const t = String(idea || "");
  if (/画风硬锁】?\s*仿真人|rendering_style[^\n]*photoreal|photoreal cinematic/i.test(t)) {
    return false;
  }
  return /画风硬锁】?\s*CG\s*漫剧|CG 漫剧|二次元国乙|韩系厚涂|漫剧成片级 CG|cg_drama/i.test(t);
}

function guessSubject(idea: string): { identity: string; emotion: string; wardrobe: string } {
  const shotBlock = extractKeyartShotStillBlock(idea);
  const actionLine =
    shotBlock.match(/动作轨迹[^\n]*[：:]\s*(.+)/)?.[1]?.trim() ||
    shotBlock.match(/运镜[^\n]*[：:]\s*(.+)/)?.[1]?.trim() ||
    "";
  const raw = (shotBlock || String(idea || "").trim()).slice(0, 400);
  if (!raw) {
    return {
      identity: "a single clear subject with readable silhouette",
      emotion: "quiet focus, raw presence, no glamour gloss",
      wardrobe: "simple costume with tactile fabric detail",
    };
  }
  const cg = wantsCgDramaRendering(idea);
  return {
    identity: (actionLine || raw).slice(0, 220),
    emotion: /哭|泪|绝望|脏|伤|raw|despair|dirty|messy/i.test(raw)
      ? "raw emotion, imperfect skin, no beauty filter"
      : cg
        ? "stylized CG drama expression, painterly face, not photoreal skin pores"
        : "believable human presence, restrained expression",
    wardrobe: /西装|裙|制服|运动|校服|盔甲|旗袍|宫装|甲胄|袍服/.test(raw)
      ? "wardrobe locked to the described outfit, fabric micro-detail"
      : "wardrobe consistent with scene, no logo text",
  };
}

function guessEnvironment(idea: string): DirectorJsonLock["Environment_Layer"] {
  const raw = String(idea || "");
  if (/东京|Tokyo|雨巷|夜雨/i.test(raw)) {
    return {
      location: "rain-soaked urban street with practical neon reflections",
      time_of_day: "night",
      atmosphere: "wet asphalt, soft mist, distant traffic glow",
    };
  }
  if (/西部|牛仔|峡谷|desert|cowboy/i.test(raw)) {
    return {
      location: "wide canyon plateau with dusty ground",
      time_of_day: "golden hour",
      atmosphere: "windborne dust, long shadows, dry heat haze",
    };
  }
  if (/教室|课堂|school/i.test(raw)) {
    return {
      location: "daylit classroom with practical overhead fixtures",
      time_of_day: "afternoon",
      atmosphere: "dust motes in window light, lived-in desks",
    };
  }
  return {
    location: "environment implied by the idea, spatially readable",
    time_of_day: "motivated practical light period",
    atmosphere: "air has volume; haze or particulate only if motivated",
  };
}

/** 对称粉彩「画册感」手法（成稿去名，不写导演） */
function symmetryPastelLock(): Pick<
  DirectorJsonLock["Cinematography_Lock"],
  "composition" | "color_grade" | "lighting"
> {
  return {
    composition: "perfectly centered, planar storybook framing, deliberate symmetry",
    color_grade: "pastel palette, soft contrast, storybook saturation without neon blowout",
    lighting: "even soft key with gentle fill, theatrical but clean, no harsh digital HDR",
  };
}

function cinematicDefaultLock(idea: string): DirectorJsonLock["Cinematography_Lock"] {
  const wantsSymmetry = /对称|粉彩|画册|童话|糖果|pastel|symmetry|storybook|安德森|Wes/i.test(idea);
  if (wantsSymmetry) {
    return {
      camera_body: "Arri Alexa 65",
      lens: "40mm spherical, mild anamorphic character optional",
      film_stock: "Kodak Vision3 500T with subtle halation and fine grain",
      ...symmetryPastelLock(),
    };
  }
  return {
    camera_body: "Arri Alexa 65",
    lens: "anamorphic 40mm, oval bokeh, controlled horizontal flare",
    film_stock: "Kodak Vision3 500T, film grain, gentle halation",
    lighting: "volumetric motivated light, Rembrandt or soft window key as scene needs",
    composition: "subject-priority framing, negative space intentional, deep but readable",
    color_grade: "teal-and-orange restrained, soft contrast, no plastic HDR sharpening",
  };
}

function isStrictNoTextIdea(idea: string): boolean {
  return /禁字硬锁|keyart-|NO TEXT|MANHUA_KEYART|分镜\s*\d+·静帧/i.test(String(idea || ""));
}

export function buildDirectorJsonFromIdea(
  idea: string,
  aspectRatio: AspectRatio169Or916 = "9:16",
): DirectorJsonLock {
  const subject = guessSubject(idea);
  const strictNoText = isStrictNoTextIdea(idea);
  const cg = wantsCgDramaRendering(idea);
  const renderingStyle = cg
    ? "semi-realistic 2D CG manhua drama still, Korean thick-paint illustration, cinematic soft light, NOT photoreal skin pores, NOT live-action photo"
    : "photoreal cinematic still, tactile medium, not plastic CGI";
  const styleNeg = cg
    ? "; also forbid photoreal live-action skin, documentary photo look, street photography, tennis/sportswear modern refs"
    : "";
  return {
    Project_Settings: {
      aspect_ratio: aspectRatio,
      resolution: "high definition masterwork",
      rendering_style: renderingStyle,
      negative_constraints: strictNoText
        ? `FATAL no on-image text: no letters, Chinese characters, numbers, subtitles, captions, speech bubbles, logos, watermarks, nameplates, UI, title cards, or readable signage; dialogue is acting-only never painted; screens/papers = illegible blur only; also no digital oversharpening or beauty-filter gloss${styleNeg}`
        : `No on-image text, no letters, no watermarks, no digital oversharpening, no beauty-filter gloss that erases emotion${styleNeg}`,
    },
    Subject_Core: {
      identity: subject.identity,
      emotion_anchor: subject.emotion,
      wardrobe_props: subject.wardrobe,
    },
    Environment_Layer: guessEnvironment(shotBlockOrIdea(idea)),
    Cinematography_Lock: cinematicDefaultLock(idea),
  };
}

function shotBlockOrIdea(idea: string): string {
  return extractKeyartShotStillBlock(idea) || idea;
}

export function stringifyDirectorJson(lock: DirectorJsonLock): string {
  return JSON.stringify(lock, null, 2);
}

/** 给 LLM 的翻译 brief：JSON → 目标模型可用的纯净提示词 */
export function buildJsonToImageTranslationBrief(
  targetModel: "nano-banana" | "gpt-image-2" | "generic",
  opts?: { strictNoText?: boolean },
): string {
  const shape =
    targetModel === "gpt-image-2"
      ? "写成一段连贯英文画面描写（120–220 words），摄影参数自然融入，不要列表、不要 Markdown 标题。"
      : targetModel === "nano-banana"
        ? "写成一段极具画面感的英文描写段落（100–200 words），摄影与介质词融入句子，不要 JSON、不要代码块。"
        : "写成一段干净英文提示词；若适合标签模型可附一行 comma-separated tags。";
  const noTextRule = opts?.strictNoText
    ? "5. **FATAL 画面零文字**：英文提示词末尾必须重申 no readable text/subtitles/speech bubbles/nameplates；禁止把对白写成画面上的字。"
    : "5. 遵守 negative_constraints；画面内无字。";
  return `你是电影摄影向提示词编译器（JSON 中台→绘图模型）。
硬规则：
1. 只输出最终提示词正文，不要解释、不要道歉、不要 Markdown 围栏。
2. 读取并**主导** Cinematography_Lock（镜头/胶片/布光/构图/调色必须出现在文案里）。
3. Subject_Core 是锚点：禁止「风格糖衣化」把苦难/脏乱画成精致时尚大片。
4. Environment_Layer 服从主体，不抢戏。
${noTextRule}
6. **成稿去名**：禁止导演名、片名、「向某某致敬」「某某风」。可用手法词：绝对对称、粉彩、画册构图、变形宽银幕、体积光、胶片颗粒。
7. ${shape}`;
}

/**
 * 准备生图用的「JSON 剧本 + 翻译 brief」。
 * 若用户已贴 JSON，原样（去导演名）交给 LLM；否则从意图编译。
 */
export function prepareJsonDirectorImageJob(input: {
  userPrompt: string;
  aspectRatio?: AspectRatio169Or916;
  targetModel?: "nano-banana" | "gpt-image-2" | "generic";
}): { jsonText: string; translationBrief: string; usedCompiledTemplate: boolean } {
  const aspect = input.aspectRatio ?? "9:16";
  const target = input.targetModel ?? "generic";
  const raw = String(input.userPrompt || "").trim();
  let jsonText: string;
  let usedCompiledTemplate = false;
  if (looksLikeDirectorJson(raw)) {
    jsonText = stripDirectorNamesForDelivery(raw);
  } else {
    jsonText = stringifyDirectorJson(buildDirectorJsonFromIdea(raw, aspect));
    usedCompiledTemplate = true;
  }
  return {
    jsonText,
    translationBrief: buildJsonToImageTranslationBrief(target, {
      strictNoText: isStrictNoTextIdea(raw),
    }),
    usedCompiledTemplate,
  };
}

/** 从 LLM 返回里抽出纯提示词（去掉围栏/前言） */
export function extractPlainImagePrompt(llmOut: string): string {
  let t = String(llmOut || "").trim();
  t = t.replace(/^```(?:json|text|markdown)?\s*/i, "").replace(/\s*```$/i, "").trim();
  t = t.replace(/^[\s\S]*?(?=\n(?:A |The |Medium |Close|Wide|Cinematic|Photoreal|High ))/i, "").trim() || t;
  // 若仍是 JSON，压缩成一句 fallback
  if (looksLikeDirectorJson(t)) {
    try {
      const j = JSON.parse(t) as DirectorJsonLock;
      return fallbackEnglishFromJson(j);
    } catch {
      /* keep */
    }
  }
  return stripDirectorNamesForDelivery(t).slice(0, 2500);
}

export function fallbackEnglishFromJson(lock: DirectorJsonLock): string {
  const c = lock.Cinematography_Lock;
  const s = lock.Subject_Core;
  const e = lock.Environment_Layer;
  const p = lock.Project_Settings;
  return stripDirectorNamesForDelivery(
    [
      `${s.identity}, ${s.emotion_anchor}, ${s.wardrobe_props}.`,
      `Setting: ${e.location}, ${e.time_of_day}, ${e.atmosphere}.`,
      `Shot on ${c.camera_body} with ${c.lens}, ${c.film_stock}.`,
      `Lighting: ${c.lighting}. Composition: ${c.composition}. Grade: ${c.color_grade}.`,
      `${p.rendering_style}. ${p.negative_constraints}. Aspect ${p.aspect_ratio}.`,
    ].join(" "),
  );
}

function detectCameraMove(text: string): string | null {
  if (/slow\s*zoom\s*out|缓慢拉远|慢慢拉远/i.test(text)) return "缓慢电影感拉远";
  if (/slow\s*zoom\s*in|缓慢推近|慢推|缓推/i.test(text)) return "缓慢电影感推近";
  if (/push[- ]?in|推进/i.test(text)) return "轻缓推进";
  if (/pan\s*right|右摇/i.test(text)) return "缓慢右摇";
  if (/pan\s*left|左摇/i.test(text)) return "缓慢左摇";
  if (/orbit|环绕/i.test(text)) return "围绕主体轻微环绕";
  if (/handheld|手持微晃/i.test(text)) return "手持微晃";
  if (/static|固定镜头|锁死机位/i.test(text)) return "固定机位";
  return null;
}

function detectSubjectMicro(text: string): string | null {
  if (/hair|发丝|头发/i.test(text)) return "发丝随风轻动";
  if (/breath|呼吸/i.test(text)) return "胸口轻微呼吸起伏";
  if (/coat|大衣|衣摆/i.test(text)) return "衣摆轻应";
  if (/look(?:ing)?\s*around|环顾/i.test(text)) return "目光自然扫视";
  if (/smile|微笑/i.test(text)) return "面部细微表情变化";
  if (/手|手指|gesture/i.test(text)) return "手指细微动作";
  return null;
}

function detectAmbience(text: string): string | null {
  if (/dust|尘/i.test(text)) return "光束中尘粒漂浮";
  if (/rain|雨/i.test(text)) return "细雨落下，湿路面反光";
  if (/smoke|雾|haze|薄雾/i.test(text)) return "薄雾缓缓漂移";
  if (/snow|雪/i.test(text)) return "稀疏雪花飘落";
  if (/neon|霓虹/i.test(text)) return "霓虹轻微闪烁与溢色呼吸";
  return null;
}

export type CompileI2VMotionPromptOpts = {
  hasReferenceImage?: boolean;
  /** 路径运镜配方 id：优先编译分阶段时段句 */
  pathCameraRecipeId?: string | null;
  /** 路径标注 JSON：优先于 recipeId */
  pathAnnotationJson?: unknown;
};

/**
 * 图生视频提示词编译：有参考图时强制做减法。
 * 公式：[镜头运动] + [主体微动] + [环境氛围]
 * 有路径配方/标注时优先用分阶段时段句。
 */
export function compileI2VMotionPrompt(
  rawPrompt: string,
  opts?: CompileI2VMotionPromptOpts,
): string {
  if (opts?.pathAnnotationJson != null) {
    const ann = normalizePathAnnotation(opts.pathAnnotationJson);
    if (ann) return compilePathAnnotationToMotionPrompt(ann);
  }
  const recipeId = String(opts?.pathCameraRecipeId || "").trim();
  if (recipeId) {
    const recipe = getPathCameraRecipeById(recipeId);
    if (recipe) return compilePathCameraRecipeToMotionPrompt(recipe);
  }

  const raw = stripDirectorNamesForDelivery(String(rawPrompt || "").trim());
  if (!raw) {
    return "缓慢电影感推进，主体呼吸微动自然，气氛柔和。";
  }

  // 必须像「运镜口令」本身，不能仅因含 cinematic/dust 形容词就原样放行长文
  const alreadyMotionLike =
    raw.length <= 160 &&
    /(slow\s+cinematic|zoom\s+(in|out)|push-?in|pan\s+(left|right)|orbit|handheld|locked-?off|缓慢(推|拉)|慢推|右摇|左摇|微动|推进|跟拍|环绕)/i.test(
      raw,
    ) &&
    !/(masterpiece|8k|cyberpunk|neon\s+masterpiece)/i.test(raw) &&
    !looksLikeDirectorJson(raw);

  if (alreadyMotionLike) return raw;

  // 中文路径时段句 / 红蓝双轨句直接放行
  if (
    /^\d+[–-]\d+秒[：:]/m.test(raw) ||
    /【路径】|【动作】|红蓝双轨|人物节拍|镜头节拍/.test(raw) ||
    /^\d+-\d+s:\s*camera/i.test(raw) ||
    /One primary path move/i.test(raw)
  ) {
    return raw.slice(0, 1200);
  }

  const camera =
    detectCameraMove(raw) ||
    (opts?.hasReferenceImage ? "缓慢电影感推进" : "缓慢电影感拉远");
  const subject = detectSubjectMicro(raw) || "主体微动自然，衣料轻应";
  const ambience = detectAmbience(raw) || "动机光下轻薄气氛粒子";

  if (opts?.hasReferenceImage) {
    // 有静帧时禁止复述赛博/霓虹/电影感长清单
    return `${camera}；${subject}；${ambience}。`;
  }

  // 无图 T2V：保留一句主体要点 + 微动公式
  const subjectHint = raw.replace(/\s+/g, " ").slice(0, 90);
  return `${subjectHint}。${camera}；${subject}；${ambience}。`;
}

/** 俯视调度组合公式（super-i 2917，成稿去名） */
export const SEEDANCE_COMPOSITE_PROMPT_FORMULA =
  "【摄影参数及画面质感】+【整体情绪】+【角色描述】+【场景描述/调度说明】+【画面内容】";

export const JSON_DIRECTOR_PIPELINE_SUMMARY = [
  "JSON 是给 LLM 的导演剧本中台，不是直接喂给绘图模型的咒语。",
  "生图：JSON → LLM 翻译 → Nano Banana / GPT-Image-2。",
  "视频：静帧已含光影构图时，只用运镜+微动+氛围自然语言。",
  "成稿禁止导演名与片名致敬；只保留可拍手法词。",
].join(" ");
