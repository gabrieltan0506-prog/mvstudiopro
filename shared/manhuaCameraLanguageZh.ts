/**
 * 分镜运镜/景别：界面与节拍成稿一律中文，剥离常见英文运镜前缀并译入 cameraZh。
 */

/** 较长短语优先，避免短词误伤 */
const CAMERA_EN_TO_ZH: ReadonlyArray<[RegExp, string]> = [
  [/over[-\s]?the[-\s]?shoulder\s+tracking\s+shot/gi, "过肩跟拍"],
  [/over[-\s]?the[-\s]?shoulder(?:\s+shot)?/gi, "过肩镜头"],
  [/extreme\s+close[-\s]?up(?:\s+push(?:es)?\s+in)?/gi, "大特写推进"],
  [/medium\s+close[-\s]?up/gi, "中近景"],
  [/close[-\s]?up\s+push(?:es)?\s+in/gi, "特写推进"],
  [/extreme\s+wide\s+shot/gi, "大远景"],
  [/wide\s+shot/gi, "全景"],
  [/medium\s+shot/gi, "中景"],
  [/two[-\s]?shot/gi, "双人镜头"],
  [/tracking\s+shot/gi, "跟随镜头"],
  [/whip\s+pan/gi, "极速甩镜"],
  [/slow\s+push[-\s]?in/gi, "缓慢推进"],
  [/slow\s+pull[-\s]?out/gi, "缓慢拉远"],
  [/push(?:es)?\s+in\s+and\s+pans?\s+fast/gi, "推进并急摇"],
  [/camera\s+pushes?\s+in\s+and\s+pans?\s+fast/gi, "镜头推进并急摇"],
  [/camera\s+pushes?\s+in/gi, "镜头推进"],
  [/pushes?\s+in/gi, "推进"],
  [/pull(?:s)?\s+out/gi, "拉远"],
  [/pans?\s+fast/gi, "急摇"],
  [/slow\s+pan/gi, "缓慢横摇"],
  [/\bpan(?:s|ning)?\b/gi, "横摇"],
  [/low\s+angle/gi, "低角仰拍"],
  [/high\s+angle/gi, "高角俯拍"],
  [/eye[-\s]?level/gi, "平视"],
  [/dutch\s+angle/gi, "荷兰角"],
  [/handheld/gi, "手持微晃"],
  [/dolly\s+in/gi, "推轨推进"],
  [/dolly\s+out/gi, "推轨拉远"],
  [/\borbit\b/gi, "环绕"],
  [/crane\s+up/gi, "升镜"],
  [/crane\s+down/gi, "降镜"],
  [/fade\s+to\s+black/gi, "淡出至黑"],
  [/smash\s+cut/gi, "硬切"],
  [/\bPOV\b/g, "第一人称视角"],
  [/\bECU\b/g, "大特写"],
  [/\bCU\b/g, "特写"],
  [/\bMCU\b/g, "近景"],
  [/\bOTS\b/g, "过肩"],
];

/** 句首英文运镜块：到句号/分号或「主体动作」中文前 */
const LEADING_EN_CAMERA_CHUNK =
  /^((?:(?:low|high)\s+angle|over[-\s]?the[-\s]?shoulder|extreme\s+close[-\s]?up|close[-\s]?up|medium\s+close[-\s]?up|wide\s+shot|tracking\s+shot|whip\s+pan|handheld|eye[-\s]?level|dutch\s+angle|dolly|orbit|crane|POV|ECU|CU|MCU|OTS|camera\s+[\w\s-]{0,40}|push(?:es)?\s+in|pull(?:s)?\s+out|pans?\s+fast|slow\s+(?:push|pull|pan))[^。.！？\n]*?)([.。;；]\s*|$)/i;

function translateCameraEnPhrases(raw: string): string {
  let out = String(raw || "");
  for (const [re, zh] of CAMERA_EN_TO_ZH) {
    out = out.replace(re, zh);
  }
  // 清理残留 "camera ," / 多余逗号空格
  out = out
    .replace(/\bcamera\b/gi, "镜头")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*([，,、])\s*/g, "$1")
    .replace(/^[，,\s]+|[，,\s]+$/g, "")
    .trim();
  return out;
}

function mergeCameraZh(a: string, b: string): string {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  if (!left) return right;
  if (!right) return left;
  if (left.includes(right) || right.includes(left)) return left.length >= right.length ? left : right;
  return `${left}，${right}`;
}

/**
 * 把分镜里英文化运镜前缀译成中文并并入 cameraZh；动作行去掉英文运镜头。
 * 不整段机器翻译叙事动作（避免胡译）；仅处理运镜/景别用语。
 */
export function normalizeManhuaShotCameraLanguage(input: {
  cameraZh?: string;
  actionZh?: string;
}): { cameraZh: string; actionZh: string } {
  let cameraZh = String(input.cameraZh || "").trim();
  let actionZh = String(input.actionZh || "").trim();
  if (!actionZh && !cameraZh) return { cameraZh: "", actionZh: "" };

  // camera 字段若含英文运镜词，先译
  if (cameraZh && /[A-Za-z]/.test(cameraZh)) {
    cameraZh = translateCameraEnPhrases(cameraZh);
  }

  const lead = actionZh.match(LEADING_EN_CAMERA_CHUNK);
  if (lead?.[1]) {
    const camFromAction = translateCameraEnPhrases(lead[1]);
    cameraZh = mergeCameraZh(cameraZh, camFromAction);
    actionZh = actionZh.slice(lead[0].length).trim();
  } else if (/^[A-Za-z]/.test(actionZh) && /(angle|push|pan|tracking|close-?up|shot|camera|dolly|orbit)/i.test(actionZh)) {
    // 无句号时：取逗号前第一段当运镜
    const comma = actionZh.match(/^([^,]{3,80}),\s*(.+)$/);
    if (comma?.[1] && /(angle|push|pan|tracking|close-?up|shot|camera|dolly|orbit)/i.test(comma[1])) {
      cameraZh = mergeCameraZh(cameraZh, translateCameraEnPhrases(comma[1]));
      actionZh = comma[2].trim();
    }
  }

  // 动作里残留的运镜英文词再就地替换（不整句英译）
  if (/[A-Za-z]/.test(actionZh) && /(push-?in|pull-?out|whip\s+pan|over-the-shoulder|fade\s+to\s+black|\bECU\b|\bOTS\b)/i.test(actionZh)) {
    actionZh = translateCameraEnPhrases(actionZh);
  }

  return { cameraZh, actionZh };
}

/** 提示词硬锁：分镜运镜字段禁止英文术语 */
export const MANHUA_CAMERA_ZH_ONLY_LOCK = `【运镜中文硬锁】
景别、机位、运镜起落必须用中文写（如：低角仰拍、过肩跟拍、大特写推进、急摇、淡出至黑）。
禁止在分镜说明/节拍表里写 Low angle、push-in、Over-the-shoulder、Extreme close-up、OTS、ECU、whip pan 等英文运镜词。
镜头运动与人物动作分行；动作描写也优先中文。`;
