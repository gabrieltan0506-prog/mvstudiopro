/**
 * 道具形制提示（联网核对后的一两句外形描述）
 *
 * 2026-07-29 验收：「象牙色朝笏」被画成一张纸。朝笏实为细长微弯的窄板，
 * 而提示词只按「文书类」给了纸面、封皮，形制就跑偏了。
 *
 * 口径（用户 2026-07-29 明文）：形制**不许 Agent 凭常识编**，须以参考图或联网检索为准；
 * 查不到就不写——宁可少一句，也不要给模型一个错形状。
 */

export const MANHUA_PROP_SHAPE_HINT_MAX = 160;

/** 一次最多核对几件：批量补图时别把检索也放大成几十次调用。 */
export const MANHUA_PROP_SHAPE_LOOKUP_MAX = 12;

/** 检索不到 / 无法确认时的哨兵，服务端与前台都据此丢弃。 */
export const MANHUA_PROP_SHAPE_UNKNOWN = "UNKNOWN" as const;

/** 形制句里出现这些就说明混进了叙事或元指令，一律丢弃整句。 */
const SHAPE_HINT_REJECT_RE =
  /留白|空白|写字|写过|文字|汉字|字样|题名|标题|禁止|不要|不得|剧作|功能|象征|寓意|主角|用户|提示词/;

/** 不确定语气：模型自己都没把握的形制，不该拿去锁画面。 */
const SHAPE_HINT_HEDGE_RE = /可能|大概|也许|或许|未证实|不确定|推测|据说|传说中/;

/**
 * 清洗联网返回的形制句：
 * - 去掉编号、引号、Markdown 记号
 * - 命中叙事 / 元指令 / 不确定语气 → 丢弃（返回空串）
 * - 超长截到句末
 */
export function normalizeManhuaPropShapeHintZh(raw: unknown): string {
  let s = String(raw || "")
    .replace(/```[a-z]*|```/gi, " ")
    .replace(/^[\s\-*•\d.、)）]+/, "")
    .replace(/[「」『』“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  if (s.toUpperCase().includes(MANHUA_PROP_SHAPE_UNKNOWN)) return "";
  if (SHAPE_HINT_REJECT_RE.test(s)) return "";
  if (SHAPE_HINT_HEDGE_RE.test(s)) return "";
  if (s.length < 8) return "";
  if (s.length > MANHUA_PROP_SHAPE_HINT_MAX) {
    const cut = s.slice(0, MANHUA_PROP_SHAPE_HINT_MAX);
    const lastStop = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("；"), cut.lastIndexOf("，"));
    s = lastStop >= 24 ? cut.slice(0, lastStop + 1) : cut;
  }
  return s.endsWith("。") ? s : `${s}。`;
}

/**
 * 写进生图提示词的那一行；空串表示这件道具没有可用形制，别硬塞。
 *
 * 尾巴那句「比例优先于构图」是必需的：朝笏实测被画成 3:1 的砧板，
 * 因为 9:16 竖幅会诱使模型把主体撑满画面，把细长器物越画越宽。
 */
export function formatManhuaPropShapeHintLineZh(hintZh: string): string {
  const s = normalizeManhuaPropShapeHintZh(hintZh);
  if (!s) return "";
  return [
    `实物形制（按实物来画，不要凭想象改形状）：${s}`,
    "真实长宽比优先于构图饱满：细长的器物就画得细长，四周该是背景就让它是背景，不要为了填满画幅把它加宽变粗。",
  ].join("\n");
}
