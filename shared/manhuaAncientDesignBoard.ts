/**
 * 古风/仙侠角色设计板 Schema + 提示词公式。
 * 与都市 char_* 槽分离；成稿禁止外仓品牌水印。
 */

export type ManhuaAncientLane = "ancient" | "xianxia" | "jianghu" | "gongting";

export type ManhuaAncientPromptFormulaKind = "standard" | "weathered" | "physician";

export type ManhuaAncientDesignBoard = {
  id: string;
  nameZh: string;
  lane: ManhuaAncientLane;
  positioning: string[];
  coreTags: string[];
  /** 年龄/身形一句 */
  ageBuildZh: string;
  /** 五官气质一句 */
  faceTemperamentZh: string;
  /** 发型结构一句 */
  hairstyleZh: string;
  wardrobeLayers: string[];
  props: string[];
  palette: string[];
  materials: string[];
  expressions: string[];
  dynamics: string[];
  accessories: string[];
  /** 场景氛围一句 */
  atmosphereZh: string;
  promptFormulaKind: ManhuaAncientPromptFormulaKind;
  /** 预拼主 prompt（可再经 builder 规范化） */
  promptZh: string;
  /** 浏览器可访问设定板路径 */
  sheetPublicPath?: string;
};

export function buildAncientArchetypePrompt(
  board: Pick<
    ManhuaAncientDesignBoard,
    | "positioning"
    | "ageBuildZh"
    | "faceTemperamentZh"
    | "hairstyleZh"
    | "wardrobeLayers"
    | "props"
    | "palette"
    | "materials"
    | "atmosphereZh"
    | "promptFormulaKind"
    | "coreTags"
  >,
): string {
  const identity = board.positioning.filter(Boolean).join("·") || "古风角色";
  const tags = board.coreTags.length ? `气质标签：${board.coreTags.join("、")}。` : "";
  let wardrobe = `服饰层次：${board.wardrobeLayers.join("、") || "层叠古装"}。`;
  if (board.promptFormulaKind === "weathered") {
    wardrobe = `服饰旧化：${board.wardrobeLayers.join("、") || "旧袍破摆"}；湿布褶皱、泥点与磨损可见。`;
  }
  let props = `道具：${board.props.join("、") || "随身旧物"}。`;
  if (board.promptFormulaKind === "physician") {
    props = `医者道具：${board.props.join("、") || "药囊、针包、药瓶"}。`;
  }
  return [
    `角色身份：${identity}。`,
    tags,
    `年龄身形：${board.ageBuildZh || "青年，修长体态"}。`,
    `五官气质：${board.faceTemperamentZh || "五官分明，气质稳定"}。`,
    `发型结构：${board.hairstyleZh || "长发束起"}。`,
    wardrobe,
    props,
    `配色：${board.palette.join("、") || "素雅主色"}。`,
    `材质：${board.materials.join("、") || "棉麻与暗纹绣"}。`,
    `环境氛围：${board.atmosphereZh || "古风场景，光影克制"}。`,
    "东方古风幻想设定卡；结构清晰可复用；禁止现代街拍、西装连衣裙与品牌水印（时代服饰以剧本为准）。",
  ]
    .filter(Boolean)
    .join(" ");
}

/** 注入编剧室/工厂的短 brief（锁气质与服饰层次，不锁死单帧脸） */
export function formatAncientDesignBoardBrief(board: ManhuaAncientDesignBoard): string {
  return [
    `【古风原型·设计板】${board.nameZh}（${board.id}）`,
    `定位：${board.positioning.join(" / ") || "—"}`,
    `标签：${board.coreTags.join("、") || "—"}`,
    `服饰：${board.wardrobeLayers.join("、") || "—"}`,
    `道具：${board.props.join("、") || "—"}`,
    `配色：${board.palette.join("、") || "—"}`,
    `材质：${board.materials.join("、") || "—"}`,
    board.expressions.length ? `神情可调度：${board.expressions.join("、")}` : "",
    "锁骨相与气质连续；服饰层次与道具贯穿全片；禁止外仓品牌名。",
    `主提示词：${board.promptZh || buildAncientArchetypePrompt(board)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function getAncientArchetypePreviewUrl(id?: string | null): string {
  const key = String(id || "").trim();
  if (!/^arch_[a-z0-9_]+$/.test(key)) return "";
  return `/manhua-characters/ancient/${key}_sheet.jpg`;
}
