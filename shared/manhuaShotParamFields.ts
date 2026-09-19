/**
 * 当前镜参数四个字段（对照图 01 第三格右栏：镜头时长 / 景别 / 机位运动 / 画面描述 0/200）。
 *
 * 数据来源是可拍表里的真实字段：`durationSec` 与 `cameraZh`、`actionZh`。
 * `cameraZh` 是一句自由文本（线上实测形如「全景，平视，缓慢推近」「中景，固定机位，三分构图」），
 * 所以这里把它**按词表切**成景别与机位运动两格；**切不出来就写「未标注」并把原文原样给出**，
 * 不许猜一个好看的值填进去 —— 用户按这格去改镜头，猜错比空着更贵。
 */
export const MANHUA_SHOT_SIZE_VOCAB_ZH = [
  "大特写",
  "特写",
  "中近景",
  "近景",
  "中景",
  "全景",
  "远景",
  "大远景",
] as const;

/**
 * 只收**两字以上**的词。写过单字「推/拉/跟/摇」，结果「跟着感觉走」被切成「跟」——
 * 自己的测试当场抓到。宁可写「未标注」并把原文给用户，也不要一个猜出来的机位。
 */
export const MANHUA_CAMERA_MOVE_VOCAB_ZH = [
  "固定机位",
  "缓慢推近",
  "快速推近",
  "推近",
  "推镜",
  "拉远",
  "拉镜",
  "横移",
  "平移",
  "摇镜",
  "跟拍",
  "跟镜",
  "升降",
  "手持",
  "环绕",
  "固定",
] as const;

export type ManhuaShotParamFields = {
  durationZh: string;
  shotSizeZh: string;
  cameraMoveZh: string;
  descriptionZh: string;
  descriptionLen: number;
  descriptionLimit: number;
  overLimit: boolean;
  /** 原始机位文本：切不出来时把它给用户看，不藏原文 */
  rawCameraZh: string;
  /** 景别与机位都没切出来 */
  cameraUnparsed: boolean;
};

const UNSET = "未标注";

function pick(vocab: readonly string[], text: string): string {
  for (const word of [...vocab].sort((a, b) => b.length - a.length)) if (text.includes(word)) return word;
  return "";
}

export function buildManhuaShotParamFields(
  shot: { durationSec?: number; cameraZh?: string; actionZh?: string } | null | undefined,
  descriptionLimit = 200,
): ManhuaShotParamFields {
  const rawCameraZh = String(shot?.cameraZh || "").trim();
  const shotSize = pick(MANHUA_SHOT_SIZE_VOCAB_ZH, rawCameraZh);
  const cameraMove = pick(MANHUA_CAMERA_MOVE_VOCAB_ZH, rawCameraZh);
  const descriptionZh = String(shot?.actionZh || "").trim();
  const seconds = Math.max(0, Number(shot?.durationSec) || 0);
  return {
    durationZh: seconds > 0 ? `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} 秒` : UNSET,
    shotSizeZh: shotSize || UNSET,
    cameraMoveZh: cameraMove || UNSET,
    descriptionZh,
    descriptionLen: descriptionZh.length,
    descriptionLimit,
    overLimit: descriptionZh.length > descriptionLimit,
    rawCameraZh,
    cameraUnparsed: !shotSize && !cameraMove,
  };
}
