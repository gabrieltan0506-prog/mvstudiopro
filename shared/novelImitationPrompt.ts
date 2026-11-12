/**
 * 爆款仿写（小说改编工作台第三种模式，1112 第一版）：提示词规则、提交前检查与前台文案。
 *
 * 产品定位：原创创作。用户上传一部原文作底稿，另填新的题材、方向与纲要；
 * 平台沿用底稿的结构骨架（节拍顺序、钩子位置、爽点与反转密度、情绪曲线、人物功能位），
 * 并套用结构模板加固，写出题材、人物、故事发展都不同的新作品。
 * 底稿拆解、定价常量与骨架 schema 在 shared/novelImitation.ts；原创度自查纯函数在 shared/novelOriginalityCheck.ts。
 */

/** 底稿长度上限（约 40 万字）。 */
export const NOVEL_IMITATION_BASE_MAX_CHARS = 400_000;

/**
 * 仿写模式在大纲与正文阶段必带的规则卡（站长 2026-11-12：仿写只参考架构与故事纲要）。
 * 中性规则卡，只讲正面做法；不并入技法条目库、不进检索索引，只由仿写模式按阶段直接注入。
 */
export const NOVEL_IMITATION_CRAFT_CARD_ID = "craft_imitation_structure";
export const NOVEL_IMITATION_CRAFT_STAGES = ["outline", "chapter"] as const;
export const NOVEL_IMITATION_STRUCTURE_CARD = {
  id: NOVEL_IMITATION_CRAFT_CARD_ID,
  title: "仿写只借结构骨架与故事纲要",
  body: [
    "1. 只参考示例底稿在结构骨架与故事纲要层面的安排：节拍顺序、钩子与爽点的位置、反转的密度、情绪曲线、人物功能位。",
    "2. 题材、人物、世界设定、具体情节、对白与文字，全部按用户的新题材、方向与纲要重新写。",
    "3. 逐拍对照时写「这一拍的功能」（例如：开局把主角压到低处、第一次反击扳回一局、卷末抛出新的悬念），不写示例底稿在这一拍里发生的原情节。",
    "4. 人物功能位只借功能（对手、助力、引路人、对照者等）；人物的身份、姓名、背景与关系由新故事重新创造。",
    "5. 写每一拍前先问「这一拍要让读者得到什么」，再用新故事自己的场景、人物与事件去实现它。",
    "自查：只看新作的大纲与正文，读者能说出它自己的题材、人物与事件；与示例底稿对照时，相同的只有节拍功能与位置。",
  ].join("\n"),
} as const;
/**
 * 仿写模式下不注入的技法条目：站长第一天资料原文转录的仿写卡（原卡内容不改，只在顾问阶段标注）。
 * 检索若自行挑中，仿写模式下从注入里剔除；仿写的做法以上面的结构卡为准。
 */
export const NOVEL_IMITATION_EXCLUDED_CRAFT_IDS = ["craft_owner_imitation"] as const;

/** 节拍功能参考词表（提示词用；输出允许其他简短功能名）。 */
export const NOVEL_IMITATION_BEAT_FUNCTIONS = [
  "钩子",
  "铺垫",
  "爽点",
  "反转",
  "情绪高点",
  "冲突升级",
  "卷末悬念",
] as const;

/** 各阶段共用的创作约束（内部指令，用户看不到；措辞保持中性）。 */
export const NOVEL_IMITATION_ORIGINAL_RULES =
  "本次是爆款仿写：用户上传了一部底稿，并给出新的题材、方向与纲要。imitationBrief.skeleton是底稿拆出的结构骨架（只有节拍、功能、位置与人物功能位），已选模板用来加固这套结构。沿用的只有结构——节拍顺序、钩子位置、爽点与反转密度、情绪曲线、人物功能位；题材、人物、世界设定与故事发展全部换成用户在imitationBrief里给出的新内容。不得沿用底稿或模板示例作品的人名、地名、组织名、门派、道具、设定、金手指、具体桥段与原句；imitationBrief.avoidNames列出的名称一律不用。人物功能位只借功能，人物的身份、姓名、背景与关系由新故事重新创造。";

/** 大纲阶段「结构锁定」规则。 */
export function buildNovelImitationOutlineRules(episodeCount: number) {
  return [
    `结构锁定（大纲阶段）：分两步完成，只输出最终JSON。第一步，以imitationBrief.skeleton的底稿节拍为准，参考已选模板加固，整理出本批要用的有序节拍写入structure：每拍给出节拍名（beat，沿用骨架里的节拍名）、功能（function，可选：${NOVEL_IMITATION_BEAT_FUNCTIONS.join("、")}等）与这一拍在骨架里承担的作用（role，只写结构功能与模板加固点，不复述底稿情节）。第二步，逐节拍写出用户新故事在这一拍发生什么：episodes里每集用beats按顺序列出本集覆盖的节拍（beat须与structure中的节拍名一致）、功能与本作内容（content，写新故事里的具体事件与人物）。`,
    `节拍顺序、钩子位置、爽点与反转的密度和情绪曲线沿用骨架；只生成 ${episodeCount} 集的可编辑提案，不生成小说或剧本。每拍content控制在80字内，整份格式化大纲不超过14000字。`,
    "模板文字里「不强制复刻固定节拍」的提示，本次不适用于节拍顺序与功能位：结构按骨架锁定，内容自由创作。",
  ];
}

/** 正文阶段：按已确认大纲里的结构节拍写。 */
export const NOVEL_IMITATION_CHAPTER_RULES =
  "仿写正文：按已确认大纲本集的「结构节拍」顺序展开，保持每拍的功能（钩子、铺垫、爽点、反转、情绪高点、卷末悬念等）落在对应位置；具体场景、人物言行与文字全部原创，不使用底稿的句子。";

/** 顾问阶段：按用户题材推荐能加固底稿结构的模板。 */
export const NOVEL_IMITATION_ADVICE_RULES =
  "仿写模式下推荐与讨论模板时，优先看模板结构（节拍顺序、钩子位置、爽点与反转密度、情绪曲线、人物功能位）能否加固底稿骨架、是否适合用户的新题材与纲要，并说明这套组合会怎样承载用户的新故事。";

/** 必带规范卡注入时的说明（内部指令）。 */
export const NOVEL_IMITATION_CRAFT_NOTE =
  "以下是本站的仿写规则（本次必带）：只借示例底稿的结构骨架与故事纲要层面的安排，题材、人物、情节与文字按用户的新故事重新写。规则仅供写作时遵循，输出中不要引用或复述规则原文。";

// ---------------------------------------------------------------------------
// 提交前检查（纯函数，前台调用）
// ---------------------------------------------------------------------------

export type NovelImitationReadinessInput = {
  stage: "advice" | "outline" | "chapter" | "script" | "revise";
  /** 已导入并勾选用于本次的底稿全文；没有则为空串。 */
  baseText: string;
  genre?: string;
  synopsis?: string;
  templateCount: number;
  /** 当前底稿已拆好结构骨架。 */
  skeletonReady: boolean;
  /** 创意环节（1112c）：可以不靠底稿，只凭新题材与纲要出创意；没导入底稿时不拦。 */
  premisesOnly?: boolean;
};

/** 返回拦截提示；可以提交时返回 null。审稿改稿不经此检查。 */
export function novelImitationSubmitBlock(v: NovelImitationReadinessInput): string | null {
  if (v.stage === "revise") return null;
  if (!v.baseText.trim() && !(v.premisesOnly && v.stage === "advice")) return NOVEL_IMITATION_UI.missingBase;
  if (v.baseText.length > NOVEL_IMITATION_BASE_MAX_CHARS) return NOVEL_IMITATION_UI.baseTooLong;
  if (!v.genre?.trim()) return NOVEL_IMITATION_UI.missingGenre;
  if (!v.synopsis?.trim()) return NOVEL_IMITATION_UI.missingSynopsis;
  if (v.stage === "advice") return null;
  if (!v.skeletonReady) return NOVEL_IMITATION_UI.missingSkeleton;
  if (!v.templateCount) return NOVEL_IMITATION_UI.missingTemplates;
  return null;
}

// ---------------------------------------------------------------------------
// 前台文案（中性、正面表述；不出现模型名、通道名、供应商名）
// ---------------------------------------------------------------------------

export const NOVEL_IMITATION_UI = {
  modeLabel: "爆款仿写",
  modeIntro:
    "上传一部原文作底稿，填入你要写的新题材、方向与纲要；平台沿用其结构骨架并套用结构模板，写出题材、人物、故事发展都不同的新作品。",
  genreLabel: "新题材",
  genrePlaceholder: "例如：都市逆袭、古言宅斗、悬疑探案",
  synopsisLabel: "新纲要",
  synopsisPlaceholder: "你的新故事：主角是谁、想要什么、遇到什么阻碍、大致怎么发展。可短可长。",
  templateHint: "在「模板与配比」里自己挑选结构模板，或请创作顾问按题材推荐；模板用来加固底稿的结构。",
  priceNote: (skeletonCredits: number, episodeCredits: number) =>
    `参考价：底稿结构拆解每次 ${skeletonCredits} 积分；仿写正文每集 ${episodeCredits} 积分。`,
  readyHint: "导入底稿并拆解结构，填好作品名称、新题材、方向与纲要后提交；模板可以自己选，也可以让顾问推荐。",
  skeletonButton: "拆解底稿结构",
  skeletonRedo: "重新拆解底稿结构",
  skeletonBusy: "正在拆解底稿结构…",
  skeletonProgress: (done: number, total: number) => `正在拆解底稿结构… ${done}/${total} 片`,
  skeletonConfirm: (chars: number) =>
    `将拆解底稿结构（约 ${chars.toLocaleString()} 字，分段并行处理，同一底稿只拆一次）。将调用创作服务并产生实际成本，是否继续？`,
  skeletonReady: (beats: number) => `底稿结构已拆解：共 ${beats} 个节拍。`,
  skeletonStale: "底稿已更换，请重新拆解结构。",
  skeletonFailed: "底稿结构拆解未完成，底稿与已填内容保留；可稍后重试。",
  skeletonTitle: "底稿结构骨架",
  missingBase: "请先导入要仿写的原文。",
  baseTooLong: "底稿超过40万字，请导入较短的原文或分卷导入。",
  missingGenre: "请先填写新题材。",
  missingSynopsis: "请先填写新纲要，简单几句也可以。",
  missingSkeleton: "请先拆解底稿结构。",
  missingTemplates: "请先在「模板与配比」选择至少一个结构模板，或请创作顾问推荐。",
  mappingTitle: "结构对照：底稿节拍 → 本作内容",
  mappingSkeleton: "本批结构节拍",
  mappingEpisode: (index: number, title: string) => `第${index}集 · ${title}`,
  mappingUnlisted: "（骨架中未单列）",
  mappingStale: "大纲已手动修改，下方对照为生成时的版本。",
  mappingColumnBeat: "底稿节拍",
  mappingColumnContent: "本作内容",
  originalityTitle: "原创度自查",
  originalityNames: (terms: readonly string[]) =>
    `以下名称与底稿重名，建议换成你自己的命名：${terms.join("、")}`,
  originalitySentences: "以下句子与底稿相同，建议改写：",
  originalityClear: "未发现与底稿重名的名称或相同的句子。",
  // ---- 1112b：参考分与拆书参考模板 ----
  scoreTitle: "示例底稿参考分",
  scoreNote: "参考分按审稿七个维度给出（每项 1–5 分），仅供参考。",
  scoreTotal: (total: number) => `综合 ${total} 分`,
  scoreMissing: "本次拆解未给出参考分。",
  collectDone: (whole: boolean, highlights: number) =>
    whole
      ? `本次拆解的结构已收入拆书参考模板库（整本 1 条、特色章节 ${highlights} 条）。`
      : `整本结构未收入，已收入特色章节 ${highlights} 条。`,
  collectKept: "这部示例底稿的结构此前已收入拆书参考模板库，本次参考分未更高，保留原有条目。",
  collectFailed: "参考模板收录未完成，结构骨架不受影响；可重新拆解再收录。",
  libraryTitle: "拆书参考模板",
  libraryHint: (threshold: number, max: number) =>
    `从拆解过的示例底稿里收录的结构参考：参考分达到 ${threshold} 分收录整本结构，有特色的章节逐条收录。最多勾选 ${max} 条，作为大纲与正文的结构参考，只借结构。`,
  libraryEmpty: "暂时还没有拆书参考模板。",
  libraryLoadFailed: "拆书参考模板列表暂时读取不到，可稍后刷新。",
  libraryKindWhole: "整本结构",
  libraryKindHighlight: "特色章节",
  libraryScore: (total: number) => `参考分 ${total}`,
  libraryReuse: (text: string) => `可复用：${text}`,
  libraryPickLimit: (max: number) => `最多勾选 ${max} 条。`,
  libraryPicked: (count: number, max: number) => `已勾选 ${count}/${max}`,
  libraryDelete: "删除",
  libraryDeleteConfirm: "从拆书参考模板库删除这一条？删除后，同一底稿重新拆解也不会再收回这一条。",
  libraryDeleteFailed: "删除未完成，可稍后重试。",
} as const;
