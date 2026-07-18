/**
 * 漫剧「编剧室」：题材+短条件 → 可确认的多集剧情包（默认 3 集，2–6 可调）。
 * 前台文案禁止出现模型名 / 供应商 / 「仿写某某」等后台话术。
 */

import {
  composeManhuaPropDemoPromptBlock,
  recommendManhuaContentLanesFromTopic,
} from "./manhuaScenePropDemoCatalog.js";

export const MANHUA_WRITER_EPISODE_MIN = 2;
export const MANHUA_WRITER_EPISODE_MAX = 6;
export const MANHUA_WRITER_EPISODE_DEFAULT = 3;

export type ManhuaWriterEpisode = {
  index: number;
  title: string;
  /** 本集剧情（含人物场） */
  body: string;
  /** 片尾钩子（必填） */
  endHook: string;
};

export type ManhuaWriterPack = {
  seriesTitle: string;
  logline: string;
  charactersMd: string;
  propsMd: string;
  locationsMd: string;
  episodes: ManhuaWriterEpisode[];
  rawMarkdown: string;
  episodeCount: number;
};

export function clampWriterEpisodeCount(n: unknown): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return MANHUA_WRITER_EPISODE_DEFAULT;
  return Math.max(MANHUA_WRITER_EPISODE_MIN, Math.min(MANHUA_WRITER_EPISODE_MAX, v));
}

/**
 * 注入编导阶段的手法约束（灯光/运镜/情绪）。
 * 内部用；勿把「Skill / 模型」字样暴露给用户 UI。
 */
export const CANVAS_DIRECTOR_CRAFT_PROMPT_BLOCK = `【编导手法约束】
成稿禁止导演名、片名、「向某某致敬」「某某风」。
每集主用 1 种可拍手法语法（灯光+运镜+情绪一致），勿六种硬拼。
优先可拍：景别、运镜、主光/色温/明暗比、环境反馈、微动。
分镜六栏可用：景别｜运镜｜灯光安排｜情绪表达｜画面内容｜台词与音效。
竖屏短片节奏：钩子要早，片尾钩子留给下一集。`;

/** 编剧室扩写 system/user 一体 prompt（给文本生成用） */
export function buildManhuaWriterExpandPrompt(opts: {
  topic: string;
  brief: string;
  episodeCount: number;
}): string {
  const topic = String(opts.topic || "").trim().slice(0, 500);
  const brief = String(opts.brief || "").trim().slice(0, 2000);
  const n = clampWriterEpisodeCount(opts.episodeCount);
  const propDemo = composeManhuaPropDemoPromptBlock({
    lanes: recommendManhuaContentLanesFromTopic(`${topic}\n${brief}`),
    limit: 4,
  });
  return [
    "你是竖屏漫剧连载编剧。根据用户题材与补充条件，扩写成可拍的连载剧情包。",
    "硬规则：",
    "1. 只输出 Markdown，不要代码围栏、不要道歉。",
    "2. 成稿禁止导演名、真实剧集/电影片名、「仿写某某」「致敬某某」。只写可拍的人物关系、权力结构与情绪节奏。",
    "3. 默认竖屏短剧单集约 15 秒可拍密度；本阶段先写剧情与设定，不写镜头表。",
    `4. 必须正好输出 ${n} 集；每一集结尾必须有「片尾钩子」（未揭答案、逼观众追下一集）。`,
    "5. 人物 / 道具 / 场景表要具体、可锁定外形与空间，禁止空泛。",
    "6. 道具表可参考下方示范库外观锚点改写，勿照抄剧名；权谋/商战可偏海外可读符号。",
    "",
    `【用户题材】${topic || "（未填，请基于补充条件合理拟定）"}`,
    brief ? `【补充条件】\n${brief}` : "【补充条件】（无，请在合理范围内自行补全并保持克制）",
    propDemo,
    "",
    "请严格按下列结构输出：",
    "",
    "## 系列标题",
    "（一句话标题）",
    "",
    "## 一句话系列梗概",
    "（≤40字）",
    "",
    "## 人物表",
    "- 姓名/称呼｜外形锚点｜欲望｜与他人关系｜禁止崩坏点",
    "",
    "## 道具表",
    "- 道具｜叙事作用｜外观锚点",
    "",
    "## 场景表",
    "- 场景｜氛围｜可互动物件",
    "",
    ...Array.from({ length: n }, (_, i) => {
      const ep = i + 1;
      return [
        `## 第${ep}集`,
        "### 集标题",
        "### 本集剧情",
        "（冲突、人物场、转折；可分段，勿灌水）",
        "### 片尾钩子",
        "（必须留下未解悬念或关系反转预兆）",
        "",
      ].join("\n");
    }),
  ].join("\n");
}

/** 宽松解析扩写 Markdown → 结构（失败时仍保留 raw） */
export function parseManhuaWriterPack(raw: string, episodeCount: number): ManhuaWriterPack {
  const md = String(raw || "").trim();
  const n = clampWriterEpisodeCount(episodeCount);
  const seriesTitle =
    md.match(/##\s*系列标题\n+([^\n#]+)/)?.[1]?.trim() || "未命名系列";
  const logline =
    md.match(/##\s*一句话系列梗概\n+([^\n#]+)/)?.[1]?.trim() || "";
  const charactersMd =
    md.match(/##\s*人物表\n+([\s\S]*?)(?=\n##\s|$)/)?.[1]?.trim() || "";
  const propsMd = md.match(/##\s*道具表\n+([\s\S]*?)(?=\n##\s|$)/)?.[1]?.trim() || "";
  const locationsMd =
    md.match(/##\s*场景表\n+([\s\S]*?)(?=\n##\s|$)/)?.[1]?.trim() || "";

  const episodes: ManhuaWriterEpisode[] = [];
  for (let i = 1; i <= n; i++) {
    const block =
      md.match(new RegExp(`##\\s*第${i}集\\n+([\\s\\S]*?)(?=\\n##\\s*第\\d+集|\\n##\\s[^第]|$)`))?.[1] ||
      "";
    const title =
      block.match(/###\s*集标题\n+([^\n#]+)/)?.[1]?.trim() || `第${i}集`;
    const body =
      block.match(/###\s*本集剧情\n+([\s\S]*?)(?=\n###\s*片尾钩子|$)/)?.[1]?.trim() ||
      block.trim();
    const endHook =
      block.match(/###\s*片尾钩子\n+([\s\S]*?)(?=\n###|\n##|$)/)?.[1]?.trim() || "";
    episodes.push({ index: i, title, body, endHook });
  }

  return {
    seriesTitle,
    logline,
    charactersMd,
    propsMd,
    locationsMd,
    episodes,
    rawMarkdown: md,
    episodeCount: n,
  };
}

export function writerPackLooksReady(pack: ManhuaWriterPack | null | undefined): boolean {
  if (!pack?.rawMarkdown || pack.rawMarkdown.length < 120) return false;
  if (pack.episodes.length < MANHUA_WRITER_EPISODE_MIN) return false;
  const hooks = pack.episodes.filter((e) => e.endHook.trim().length >= 4);
  return hooks.length >= Math.min(pack.episodes.length, 2);
}

/** 确认进编导后，灌进工厂故事/角色/节拍的上下文块 */
export function composeWriterPackFactoryContext(pack: ManhuaWriterPack, focusEpisode = 1): string {
  const ep = pack.episodes.find((e) => e.index === focusEpisode) || pack.episodes[0];
  return [
    "【已确认编剧包·强制遵守】",
    `系列：${pack.seriesTitle}`,
    pack.logline ? `梗概：${pack.logline}` : "",
    "",
    "## 人物表",
    pack.charactersMd || "（见原文）",
    "",
    "## 道具表",
    pack.propsMd || "（见原文）",
    "",
    "## 场景表",
    pack.locationsMd || "（见原文）",
    "",
    ep
      ? [
          `## 本集优先：第${ep.index}集《${ep.title}》`,
          ep.body,
          `片尾钩子：${ep.endHook}`,
          "本轮制作先兑现这一集；钩子留给下一集，勿在本集拍穿。",
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
