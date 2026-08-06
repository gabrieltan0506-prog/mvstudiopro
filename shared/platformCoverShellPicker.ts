/**
 * 封面版式「按选题择一」。
 *
 * 出图提示词原先把 17 种版式壳、7 种排版手法、10 个强调色**并列**摆给模型，
 * 让它自己挑。模型挑不出个性，只会取平均值——用户 2026-08-06 反馈生成的封面
 * 「连点开的欲望都没有」，同质化是主因之一。
 *
 * 这里改成在服务端先定死一组（1 个壳 + 1 个强调色 + 1–2 个手法）再写进提示词。
 * 用选题主句做种子而不是随机数：同一条选题重出还是同一套（用户不会觉得系统在抽奖），
 * 不同选题之间自然轮换。
 */

export type PlatformCoverShell = {
  id: string;
  /** 写进提示词的一句版式指令 */
  directive: string;
  /** 适合的选题气质；用于先缩小候选池再取模 */
  vibe: "contrast" | "list" | "emotion" | "knowledge";
};

/** 版式壳：每条都是能单独成立的一套画面结构，不是形容词。 */
export const PLATFORM_COVER_SHELLS: PlatformCoverShell[] = [
  {
    id: "side-column",
    vibe: "contrast",
    directive: "侧栏夹字：画面一侧竖向色块压住主句的一半，侧栏字可轻压肩背，但不遮眼口。",
  },
  {
    id: "truth-vertical",
    vibe: "contrast",
    directive: "真相竖排：关键词竖排贴边，与横排主句形成十字张力，竖排字号小一档。",
  },
  {
    id: "big-number",
    vibe: "contrast",
    directive: "大数字压屏：把主句里的数字放到近全屏高度当主视觉，其余字绕它排布。",
  },
  {
    id: "left-right-clamp",
    vibe: "contrast",
    directive: "左右大字夹人：人物居中，两侧各一组大字夹住，配一条细箭头注解。",
  },
  {
    id: "yellow-bold",
    vibe: "knowledge",
    directive: "黄底粗标：顶部一条厚实暖黄色块托住主句，下方留给实拍画面。",
  },
  {
    id: "category-layer",
    vibe: "knowledge",
    directive: "类目大字 + 弱一档背景小字层：主句最大，背后一层灰度小字做质感垫底，不抢读。",
  },
  {
    id: "double-tag-bar",
    vibe: "knowledge",
    directive: "顶部双层标签条：上条写类目、下条写结果，主句放在画面中下部。",
  },
  {
    id: "private-notes",
    vibe: "knowledge",
    directive: "私人笔记刊头：顶部一行极小英文刊头字（private notes · 年份），主句手写感偏正。",
  },
  {
    id: "pink-two-line",
    vibe: "emotion",
    directive: "粉系双行紧排：主句拆成紧挨的两行，行距压到极窄，配柔和粉调背景。",
  },
  {
    id: "mood-bar",
    vibe: "emotion",
    directive: "简约情绪条：画面下部一条半透明色条托住主句，其余留给人物神态。",
  },
  {
    id: "warm-four-char",
    vibe: "emotion",
    directive: "暖光四字 + 温柔副句：主句压到四字极简，副句小字跟在下方，光线暖。",
  },
  {
    id: "brush-arrow",
    vibe: "emotion",
    directive: "暖色细笔刷箭头 + 问句钉：一道细笔刷箭头指向主体，主句以问句收尾。",
  },
  {
    id: "flatlay-wall",
    vibe: "list",
    directive: "数字件数好物墙：物件平铺成阵列俯拍，大数字压在中央说明件数。",
  },
  {
    id: "slash-clamp",
    vibe: "list",
    directive: "斜杠夹字 + 手持实物：主句用 \\短句/ 形式夹住，人物手持其中一件实物怼镜头。",
  },
  {
    id: "food-white-frame",
    vibe: "list",
    directive: "食物/实物大图 + 白框手写感叹：主体占满画面，一角白框内写一句手写感短评。",
  },
  {
    id: "vertical-three-seg",
    vibe: "list",
    directive: "竖排三段词 + 底部结果条：三个关键词竖向分段，底部一条横幅写最终结果。",
  },
];

/** 强调色池：只挑一个，主字仍是米白/象牙白。 */
export const PLATFORM_COVER_ACCENTS = [
  "暖黄块",
  "品红侧栏",
  "真相深红",
  "吸睛绿",
  "知识黑金",
  "走心红",
  "水蜜桃",
  "玫瑰金",
  "天蓝钴蓝",
  "香槟琥珀",
] as const;

/** 排版手法：挑 1–2 个，不叠满。 */
export const PLATFORM_COVER_TYPO_MOVES = [
  "斜杠夹字 \\短句/",
  "主句下一行小号英文对照",
  "桃/玫瑰金细笔刷箭头圈注",
  "英文手写体压中文",
  "角落画中画证据（不超过 1/4 画面）",
  "顶部双层标签条（类目条 + 结果条）",
  "私人笔记刊头小字（private notes · 年份）",
] as const;

export type PlatformCoverShellPick = {
  shell: PlatformCoverShell;
  accent: string;
  typoMoves: string[];
};

/** 稳定哈希：同一句话永远得到同一个数，跨进程一致（不能用 Math.random 或对象地址）。 */
function stableHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const LIST_RE = /清单|清單|合集|必备|必備|盘点|盤點|\d+\s*件|\d+\s*个|\d+\s*樣|保姆级|保姆級|不踩雷|攻略/;
const CONTRAST_RE = /反而|竟然|居然|结果|結果|没想到|沒想到|原来|原來|不是|别|別|错|錯|\d/;
const EMOTION_RE = /心疼|想哭|治愈|温柔|溫柔|陪|妈妈|媽媽|孩子|一个人|一個人|累|难过|難過|喜欢|喜歡/;

/** 先按选题气质缩小候选池，再取模——避免抒情选题配上大数字压屏这种明显不搭。 */
function shellPoolForTopic(topic: string): PlatformCoverShell[] {
  const t = String(topic || "");
  const pick = (vibe: PlatformCoverShell["vibe"]) =>
    PLATFORM_COVER_SHELLS.filter((s) => s.vibe === vibe);
  if (LIST_RE.test(t)) return pick("list");
  if (EMOTION_RE.test(t)) return pick("emotion");
  if (CONTRAST_RE.test(t)) return pick("contrast");
  return pick("knowledge");
}

export function pickPlatformCoverShell(params: {
  /** 选题主句：既当气质判据，也当轮换种子 */
  topicHook: string;
  /** 额外种子（例如场景 id），让同一主句在不同场景下也能换一套 */
  salt?: string;
}): PlatformCoverShellPick {
  const topic = String(params.topicHook || "").trim();
  const seed = stableHash(`${topic}|${String(params.salt || "")}`);
  const pool = shellPoolForTopic(topic);
  const shell = pool[seed % pool.length] || PLATFORM_COVER_SHELLS[0];
  const accent = PLATFORM_COVER_ACCENTS[(seed >>> 3) % PLATFORM_COVER_ACCENTS.length];
  const first = (seed >>> 7) % PLATFORM_COVER_TYPO_MOVES.length;
  const second = (first + 1 + ((seed >>> 11) % (PLATFORM_COVER_TYPO_MOVES.length - 1))) %
    PLATFORM_COVER_TYPO_MOVES.length;
  const typoMoves = seed % 3 === 0
    ? [PLATFORM_COVER_TYPO_MOVES[first]]
    : [PLATFORM_COVER_TYPO_MOVES[first], PLATFORM_COVER_TYPO_MOVES[second]];
  return { shell, accent, typoMoves };
}

/** 拼成提示词里的两行硬指令。 */
export function composePlatformCoverShellDirective(pick: PlatformCoverShellPick): string {
  return [
    `- **版式（这张就用这一种，不要自己换）**：${pick.shell.directive}`,
    `- **强调色（只用这一个）**：${pick.accent}；主字米白/象牙白，主句内只提亮 2–6 个关键字。`,
    `- **排版手法（只用这些，不再叠加）**：${pick.typoMoves.join("；")}。英文只作装饰，不承担信息。`,
  ].join("\n");
}
