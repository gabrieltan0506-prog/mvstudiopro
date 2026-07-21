/**
 * 人物表演控制：台词 / 语气 / 微表情 / 情绪弧 → 静帧·成片注入。
 * 课源：Downloads/2026Jul21/feel.mp4（高密度抽帧）——学字段结构，不抄片中文案。
 * 硬锁：台词只作口型与气口依据，禁止烧进画面。
 */

export type ManhuaPerformanceCue = {
  dialogueZh: string;
  emotionZh: string;
  voiceToneZh: string;
  microExpressionZh: string;
  bodyBeatZh: string;
};

const DIALOGUE_RE =
  /[「『"“]([^」』"”]{1,48})[」』"”]|台词[：:]\s*([^\n。；;]{1,48})/;

const EMOTION_RE =
  /(?:语气|情绪|情感|哭腔|委屈|愧疚|不信|隐忍|克制|压抑|哀伤|决绝|不舍|心碎|冷静|沙哑|哽咽)[里的着]*[：:]?\s*([^\n。；;]{2,36})|(委屈|不信|愧疚|无力|隐忍|决绝|不舍|克制|压抑|哀伤|震惊|不敢信|倔强)/;

const VOICE_RE =
  /(?:声音|嗓音|语气)[里的着]*[：:]?\s*([^\n。；;]{2,40})|(沙哑|低沉|压着哭腔|压哭腔|冷硬|轻声|气声|一字一顿|缓慢|哽咽|闷声)/;

const MICRO_RE =
  /(?:微表情|表情|眼神|眼眶|泪|咬唇|下颌|喉结|耳饰)[^\n。；;]{0,40}|(双眼?发红|泪[^。]{0,12}未落|泪[^。]{0,8}滑落|咬下唇|下颌绷紧|咬牙|眼皮轻颤|喉结慢滚|耳饰轻晃|捂住嘴|不回头|不敢对视)/;

const BODY_RE =
  /(?:猛地|缓缓|立刻|忽然)?(?:抬头|别开脸|转过脸|攥拳|握拳|擦泪|擦眼角|抬手|转身|迈步|站定|并肩|肩[^。]{0,8}不碰)[^。；;\n]{0,28}/;

function clean(s: string): string {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(text: string, re: RegExp): string {
  const m = text.match(re);
  if (!m) return "";
  for (let i = 1; i < m.length; i++) {
    const g = clean(m[i] || "");
    if (g) return g.slice(0, 48);
  }
  return clean(m[0] || "").slice(0, 48);
}

/** 从分镜动作行 / 剧本句抽出表演线索 */
export function extractManhuaPerformanceCue(
  raw: string | undefined | null,
): ManhuaPerformanceCue {
  const t = clean(String(raw || ""));
  if (!t) {
    return {
      dialogueZh: "",
      emotionZh: "",
      voiceToneZh: "",
      microExpressionZh: "",
      bodyBeatZh: "",
    };
  }
  const dialogueZh = firstMatch(t, DIALOGUE_RE);
  const emotionZh = firstMatch(t, EMOTION_RE);
  const voiceToneZh = firstMatch(t, VOICE_RE);
  const microExpressionZh = firstMatch(t, MICRO_RE);
  const bodyBeatZh = firstMatch(t, BODY_RE);
  return {
    dialogueZh,
    emotionZh,
    voiceToneZh,
    microExpressionZh,
    bodyBeatZh,
  };
}

/** 合并显式字段 + 从 action 行再抽一层 */
export function mergeManhuaPerformanceCue(
  base: Partial<ManhuaPerformanceCue> | undefined,
  actionOrScript: string,
): ManhuaPerformanceCue {
  const fromAction = extractManhuaPerformanceCue(actionOrScript);
  return enrichPerformanceCueWithVisibleAction({
    dialogueZh: clean(base?.dialogueZh || "") || fromAction.dialogueZh,
    emotionZh: clean(base?.emotionZh || "") || fromAction.emotionZh,
    voiceToneZh: clean(base?.voiceToneZh || "") || fromAction.voiceToneZh,
    microExpressionZh:
      clean(base?.microExpressionZh || "") || fromAction.microExpressionZh,
    bodyBeatZh: clean(base?.bodyBeatZh || "") || fromAction.bodyBeatZh,
  });
}

export function hasManhuaPerformanceCue(cue: ManhuaPerformanceCue): boolean {
  return Boolean(
    cue.dialogueZh ||
      cue.emotionZh ||
      cue.voiceToneZh ||
      cue.microExpressionZh ||
      cue.bodyBeatZh,
  );
}

/**
 * 写入静帧 / 成片：精准表演控制。
 * stage=key_art 偏微表情定格；stage=clip 偏气口与情绪过程。
 */
export function formatManhuaPerformanceInjectBlock(
  cue: ManhuaPerformanceCue,
  opts?: { stage?: "key_art" | "clip"; shotIndex?: number },
): string {
  if (!hasManhuaPerformanceCue(cue)) return "";
  const stage = opts?.stage || "key_art";
  const shot =
    typeof opts?.shotIndex === "number" && opts.shotIndex >= 1
      ? `·镜${opts.shotIndex}`
      : "";
  const lines: string[] = [
    `【人物表演·台词情绪${shot}】`,
    "硬锁：台词/旁白只作口型、气口与表演依据，禁止字幕、气泡、旁白条或任何可读字形烧进画面。",
  ];
  if (cue.dialogueZh) {
    lines.push(`台词（勿烧字）：「${cue.dialogueZh}」`);
  }
  if (cue.voiceToneZh) {
    lines.push(`说话语气：${cue.voiceToneZh}`);
  }
  if (cue.emotionZh) {
    lines.push(`情绪弧：${cue.emotionZh}`);
  }
  if (cue.microExpressionZh) {
    lines.push(
      stage === "key_art"
        ? `微表情定格（近景可读）：${cue.microExpressionZh}`
        : `微表情过程：${cue.microExpressionZh}`,
    );
  }
  if (cue.bodyBeatZh) {
    lines.push(`身体节拍：${cue.bodyBeatZh}`);
  }
  if (stage === "clip") {
    lines.push(
      "气口：有台词则口型与气息对齐语气；无台词则用呼吸停顿与视线变化撑情绪。",
    );
  } else {
    lines.push(
      "静帧优先：双眼/嘴角/下颌/手部细节把情绪钉住；禁止空洞微笑或表情糊成海报脸。",
    );
  }
  return lines.join("\n");
}

/**
 * 抽象情绪 → 可见动作/微表情提示（少写心理，多写可拍细节）。
 * 用于补全微表情/身体节拍为空时的提示。
 */
const EMOTION_TO_VISIBLE: Array<{ re: RegExp; micro: string; body: string }> = [
  {
    re: /害怕|恐惧|慌/,
    micro: "瞳孔微缩，嘴唇发白，视线乱飘找出口",
    body: "后退半步，手指死死抓住门把或衣角",
  },
  {
    re: /委屈|不信|震惊/,
    micro: "眼眶发红泪未落，眉心微蹙，下颌绷紧",
    body: "猛地抬头或别开脸，肩线僵住",
  },
  {
    re: /愧疚|心虚/,
    micro: "不敢对视，喉结慢滚，嘴角抿紧",
    body: "肩膀微塌，手指反复摩挲袖口",
  },
  {
    re: /愤怒|怒/,
    micro: "咬牙，鼻翼扇动，眼神发冷",
    body: "攥拳，前倾半步，呼吸加重",
  },
  {
    re: /决绝|狠/,
    micro: "目光钉死，嘴角压平",
    body: "站定转身，步幅干净不再回头",
  },
  {
    re: /悲伤|哭|不舍/,
    micro: "眼皮轻颤，泪在睫毛停住或滑落",
    body: "抬手擦眼角，肩轻抖后强行压住",
  },
];

/** 若缺微表情/身体节拍，用情绪词补可见表演 */
export function enrichPerformanceCueWithVisibleAction(
  cue: ManhuaPerformanceCue,
): ManhuaPerformanceCue {
  const emotion = cue.emotionZh || cue.voiceToneZh || "";
  if (!emotion && !cue.dialogueZh) return cue;
  let micro = cue.microExpressionZh;
  let body = cue.bodyBeatZh;
  for (const row of EMOTION_TO_VISIBLE) {
    if (!row.re.test(emotion) && !row.re.test(cue.dialogueZh)) continue;
    if (!micro) micro = row.micro;
    if (!body) body = row.body;
    break;
  }
  return { ...cue, microExpressionZh: micro, bodyBeatZh: body };
}

/** 从整段剧本抽若干表演线索（给视觉简报） */
export function extractPerformanceCuesFromScript(
  rawScript: string,
  limit = 4,
): ManhuaPerformanceCue[] {
  const raw = String(rawScript || "");
  const chunks = raw
    .split(/\r?\n/)
    .map((l) => clean(l))
    .filter((l) => l.length >= 6 && (/[「『"“]/.test(l) || /情绪|语气|哭腔|委屈|愧疚/.test(l)));
  const out: ManhuaPerformanceCue[] = [];
  const seen = new Set<string>();
  for (const line of chunks) {
    const cue = extractManhuaPerformanceCue(line);
    if (!hasManhuaPerformanceCue(cue)) continue;
    const key = `${cue.dialogueZh}|${cue.emotionZh}|${cue.microExpressionZh}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cue);
    if (out.length >= limit) break;
  }
  return out;
}
