import { z } from "zod";

/** 这些选项编译为导演文字，不伪装为供应商支持的独立参数。 */
export const CINEMA_OPTIONS = {
  genre: {
    label: "影片类型",
    values: [
      "自动",
      "纪实讲述",
      "电影叙事",
      "产品演示",
      "动作",
      "史诗",
      "剧情",
      "黑色电影",
      "喜剧",
      "恐怖",
    ],
  },
  era: {
    label: "拍摄年代质感",
    values: [
      "自动",
      "当代",
      "复古胶片",
      "近未来",
      "1960年代",
      "1980年代",
      "1990年代",
      "2000年代",
      "2020年代",
    ],
  },
  tempo: {
    label: "节奏",
    values: [
      "自动",
      "从容",
      "自然",
      "紧凑",
      "一镜到底",
      "动态剪辑",
      "密集跳切",
    ],
  },
  camera: {
    label: "摄影质感",
    values: [
      "自动",
      "现代数字摄影",
      "胶片摄影",
      "35mm胶片",
      "8mm胶片",
      "DV纪实",
    ],
  },
  lens: {
    label: "镜头",
    values: [
      "自动",
      "清晰自然",
      "复古柔光",
      "广角空间",
      "人像中长焦",
      "变形宽银幕",
      "复古变形镜头",
      "暖调复古",
      "光晕复古",
    ],
  },
  aperture: {
    label: "景深",
    values: [
      "自动",
      "浅景深",
      "中等景深",
      "深景深",
      "f/1.4全开",
      "f/4适中",
      "f/11深焦",
    ],
  },
  movement: {
    label: "运镜",
    values: [
      "自动",
      "固定机位",
      "缓推",
      "拉远",
      "左摇",
      "右摇",
      "上仰",
      "下俯",
      "左移",
      "右移",
      "升起",
      "下降",
      "向左环绕",
      "向右环绕",
      "360度环绕",
      "滑动变焦",
      "快速推近",
      "手持跟随",
      "航拍拉远",
    ],
  },
  palette: {
    label: "色彩",
    values: [
      "自动",
      "自然肤色",
      "冷暖对照",
      "暖金",
      "青绿",
      "低饱和胶片",
      "黑白银盐",
      "港口黎明",
      "霓虹雨夜",
      "沙漠公路",
      "丝绒酒廊",
      "极地空间站",
      "果园午后",
      "午夜食堂",
      "褪色拍立得",
      "翡翠森林",
      "铜色铸造厂",
      "粉彩码头",
      "混凝土黑色电影",
      "藏红花集市",
      "紫外俱乐部",
      "秋日图书馆",
      "漂白海岸",
    ],
  },
  lighting: {
    label: "灯光",
    values: [
      "自动",
      "窗边柔光",
      "场景实用灯",
      "顶光",
      "逆光轮廓",
      "交叉柔光",
      "剪影",
    ],
  },
  expression: {
    label: "表情",
    values: ["自动", "自然亲切", "沉稳专注", "轻松幽默", "坚定有力"],
  },
  gestures: {
    label: "手势",
    values: ["自动", "克制自然", "随语义强调", "开放舒展"],
  },
} as const;
/** 本产品的示意配色；只控制色彩关系，不替换原有场景。 */
export const CINEMA_PALETTE_COLORS: Record<string, readonly string[]> = {
  自然肤色: ["#e1b194", "#b2b8a6", "#506573"],
  冷暖对照: ["#18445b", "#61a1a6", "#e9ab72"],
  暖金: ["#34271e", "#b98c4d", "#f3d7a2"],
  青绿: ["#173d36", "#548875", "#b7c9aa"],
  低饱和胶片: ["#6d7773", "#aaa18d", "#cfb49d"],
  黑白银盐: ["#161616", "#818181", "#e8e8e8"],
  港口黎明: ["#29435c", "#80a8ad", "#e8b69c"],
  霓虹雨夜: ["#15233e", "#c64b97", "#43b8c2"],
  沙漠公路: ["#805139", "#d9ad73", "#87aab7"],
  丝绒酒廊: ["#421e32", "#97614e", "#d1ab72"],
  极地空间站: ["#223847", "#8ab6c9", "#e5f1ef"],
  果园午后: ["#4d6541", "#a3b475", "#eed1a1"],
  午夜食堂: ["#25353b", "#be704b", "#efd09d"],
  褪色拍立得: ["#827f78", "#b7a598", "#ded4bc"],
  翡翠森林: ["#163c31", "#46866a", "#b1bd7b"],
  铜色铸造厂: ["#343638", "#956047", "#d9a470"],
  粉彩码头: ["#8cb9c6", "#dbb4b4", "#f0ddbb"],
  混凝土黑色电影: ["#232b31", "#6c767b", "#bbc0bc"],
  藏红花集市: ["#784438", "#c78a35", "#dfb959"],
  紫外俱乐部: ["#261e51", "#7644ae", "#dc6dab"],
  秋日图书馆: ["#3d3229", "#8c6343", "#c6a578"],
  漂白海岸: ["#91a9ac", "#d3d2bf", "#f0e5cd"],
};
export type CinemaKey = keyof typeof CINEMA_OPTIONS;
const choice = (key: CinemaKey) =>
  z
    .string()
    .refine(
      v => (CINEMA_OPTIONS[key].values as readonly string[]).includes(v),
      "导演选项无效"
    )
    .default("自动");
export const digitalHumanCinemaSchema = z
  .object({
    mode: z.enum(["reference", "talking", "image"]).default("reference"),
    genre: choice("genre"),
    era: choice("era"),
    tempo: choice("tempo"),
    camera: choice("camera"),
    lens: choice("lens"),
    aperture: choice("aperture"),
    movement: choice("movement"),
    palette: choice("palette"),
    lighting: choice("lighting"),
    expression: choice("expression"),
    gestures: choice("gestures"),
    customPalette: z
      .array(z.string().regex(/^#[0-9a-fA-F]{6}$/))
      .max(6)
      .default([]),
    customLights: z
      .array(
        z
          .object({
            direction: z.enum(["上方", "正面", "右侧", "左侧", "背面", "下方"]),
            color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
            brightness: z.number().min(0).max(100),
            softness: z.number().min(0).max(100),
          })
          .strict()
      )
      .max(4)
      .default([]),
  })
  .strict();
export type DigitalHumanCinema = z.infer<typeof digitalHumanCinemaSchema>;
export const CINEMA_START = "【Cinema导演设置】";
export const CINEMA_END = "【Cinema导演设置结束】";
export function compileDigitalHumanCinema(raw: DigitalHumanCinema): string {
  const value = digitalHumanCinemaSchema.parse(raw);
  const keys: CinemaKey[] =
    value.mode === "talking"
      ? ["tempo", "expression", "gestures"]
      : (Object.keys(CINEMA_OPTIONS) as CinemaKey[]).filter(
          key =>
            value.mode !== "image" || (key !== "movement" && key !== "tempo")
        );
  const lines = keys
    .filter(key => value[key] !== "自动")
    .map(key => `${CINEMA_OPTIONS[key].label}：${value[key]}。`);
  const colors = value.customPalette.length
    ? value.customPalette
    : (CINEMA_PALETTE_COLORS[value.palette] ?? []);
  return [
    CINEMA_START,
    value.mode === "talking"
      ? "照片口播：保持照片中的人物、服装、背景与构图，以确认音频驱动口型和自然表演。"
      : value.mode === "image"
        ? "静帧：遵循已确认人物与场景参考，构建单幅画面；摄影风格不改变人物身份和动作对象。"
        : "参考视频：遵循已确认人物、场景与动作参考；摄影风格不得改变人物身份和动作对象。",
    ...lines,
    ...(value.mode !== "talking" && colors.length
      ? [
          `${value.customPalette.length ? "自定义" : "预设"}色板：${colors.join("、")}；只改变色彩关系，不新增色板名称中的地点、物件或人物，保持自然肤色。`,
        ]
      : []),
    ...(value.mode !== "talking"
      ? value.customLights.map(
          (light, i) =>
            `灯光${i + 1}：${light.direction}，${light.color}，相对亮度${light.brightness}%，柔和度${light.softness}%；光照作用于同一场景与人物。`
        )
      : []),
    CINEMA_END,
  ].join("\n");
}
/** 读取原文中已采用的完整区块；不以当前控件值自动采用待确认改稿。 */
export function extractDigitalHumanCinemaBlock(direction: string): string {
  const start = direction.indexOf(CINEMA_START);
  const end = direction.indexOf(CINEMA_END);
  if (
    (start >= 0) !== (end >= 0) ||
    (start >= 0 && end < start) ||
    (start >= 0 && direction.indexOf(CINEMA_START, start + CINEMA_START.length) >= 0) ||
    (end >= 0 && direction.indexOf(CINEMA_END, end + CINEMA_END.length) >= 0)
  ) {
    throw new Error("导演设置标记被修改，请先整理完整导演要求中的Cinema区块");
  }
  return start < 0 ? "" : direction.slice(start, end + CINEMA_END.length);
}

export function applyDigitalHumanCinema(
  direction: string,
  cinema: DigitalHumanCinema
): string {
  const previous = extractDigitalHumanCinemaBlock(direction);
  const block = compileDigitalHumanCinema(cinema);
  const next = previous
    ? direction.replace(previous, () => block)
    : `${direction}${direction ? "\n\n" : ""}${block}`;
  if (next.length > 20000)
    throw new Error("完整导演要求超过20000字，请精简后再采用");
  return next;
}
export function assertDigitalHumanCinemaApplied(
  draft: { cinema?: DigitalHumanCinema; direction: string },
  mode?: DigitalHumanCinema["mode"]
): void {
  if (!draft.cinema) return;
  if (!draft.direction.includes(compileDigitalHumanCinema(draft.cinema)))
    throw new Error("Cinema设置已修改，请先预览并采用到完整导演要求");
  if (mode && draft.cinema.mode !== mode)
    throw new Error("当前Cinema制作模式与生成入口不一致，请切换模式并采用设置");
}
