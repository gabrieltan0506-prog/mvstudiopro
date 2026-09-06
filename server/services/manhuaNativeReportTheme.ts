import type { NativeReportThemeChoice } from "../../shared/manhuaNativeReportThemeChoice.js";
import { readFile } from "node:fs/promises";

/** 只读展示元数据，不进入模型请求、模板持久化或付费缓存身份。 */
export type NativeReportThemeMetadata = {
  nameZh?: unknown;
  classification?: unknown;
};
const themes = [
  {
    id: "celadon",
    name: "青瓷雨巷",
    paper: "#ebeae0",
    accent: "#426657",
    title: "#36564c",
    ink: "#2e3933",
    card: "#fafbf7",
    words: [
      "仙侠",
      "仙俠",
      "玄幻",
      "修仙",
      "修真",
      "宗门",
      "宗門",
      "修士",
      "渡劫",
    ],
  },
  {
    id: "amber",
    name: "秋金园林",
    paper: "#feedc3",
    accent: "#ab7132",
    title: "#915021",
    ink: "#302d29",
    card: "#fffdf7",
    words: [
      "古装",
      "古裝",
      "权谋",
      "權謀",
      "宫廷",
      "宮廷",
      "宫斗",
      "宮鬥",
      "朝堂",
      "皇权",
      "皇權",
      "宅斗",
      "宅鬥",
    ],
  },
  {
    id: "rose",
    name: "蔷薇街角",
    paper: "#faede8",
    accent: "#aa716b",
    title: "#8a5353",
    ink: "#3d3334",
    card: "#fffbf9",
    words: [
      "都市",
      "都市情感",
      "婚恋",
      "婚戀",
      "爱情",
      "愛情",
      "甜宠",
      "甜寵",
      "霸总",
      "霸總",
      "职场",
      "職場",
    ],
  },
  {
    id: "moon",
    name: "月蓝影院",
    paper: "#e5e4e2",
    accent: "#728498",
    title: "#334e6a",
    ink: "#2c3642",
    card: "#f9fafc",
    words: [
      "谍战",
      "諜戰",
      "悬疑",
      "懸疑",
      "侦探",
      "偵探",
      "间谍",
      "間諜",
      "刑侦",
      "刑偵",
      "破案",
      "推理",
    ],
  },
  {
    id: "apricot",
    name: "杏色茶巷",
    paper: "#fee6c0",
    accent: "#b97834",
    title: "#925328",
    ink: "#363c2f",
    card: "#fffaf1",
    words: [
      "喜剧",
      "喜劇",
      "市井",
      "搞笑",
      "轻喜",
      "輕喜",
      "无厘头",
      "無厘頭",
    ],
  },
] as const;
export type NativeReportThemeId = (typeof themes)[number]["id"];
const classificationKeys = [
  "emotionTagsZh",
  "narrativeFeatureTagsZh",
  "performanceTagsZh",
  "audiovisualTagsZh",
  "audienceExperienceTagsZh",
] as const;
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function tags(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const row = value as Record<string, unknown>;
  return classificationKeys
    .flatMap(key =>
      Array.isArray(row[key]) ? row[key].filter(v => typeof v === "string") : []
    )
    .join(" ");
}
function choose(classification: string, title: string) {
  const scores = themes.map(theme => {
    const tagScore = theme.words.filter(word =>
      classification.includes(word)
    ).length;
    const titleScore = theme.words.filter(word => title.includes(word)).length;
    return { theme, tagScore, titleScore };
  });
  // 分类优先，标题打破并列；固定主题顺序处理剩余并列，不依赖随机数或时间。
  scores.sort((a, b) => b.tagScore - a.tagScore || b.titleScore - a.titleScore);
  return scores[0]!.tagScore || scores[0]!.titleScore
    ? scores[0]!.theme
    : undefined;
}
export function selectNativeReportTheme(input: {
  themeChoice?: NativeReportThemeChoice;
  metadata?: NativeReportThemeMetadata;
  card?: Record<string, unknown>;
  episodeIndex?: number;
}) {
  if (input.themeChoice && input.themeChoice !== "auto") {
    const selected = themes.find(theme => theme.id === input.themeChoice);
    if (!selected) throw new Error("无效的报告主题");
    return selected;
  }
  const primary = choose(
    tags(input.metadata?.classification),
    text(input.metadata?.nameZh)
  );
  const evidence =
    primary ??
    choose(
      tags(input.card?.classification),
      text(input.card?.templateTitleZh) || text(input.card?.nameZh)
    );
  const episode =
    Number.isSafeInteger(input.episodeIndex) && input.episodeIndex! > 0
      ? input.episodeIndex!
      : 1;
  return evidence ?? themes[(episode - 1) % themes.length]!;
}

const assetRoot = new URL("../assets/native-report-themes/", import.meta.url);
let cssCache: Promise<string> | undefined;
const imageCache = new Map<NativeReportThemeId, Promise<string>>();
/** 资源随服务端打包；只读封闭ID，禁止把用户输入拼成文件名/URL。失败清缓存允许下次恢复。 */
export async function nativeReportThemePresentation(
  input: Parameters<typeof selectNativeReportTheme>[0]
) {
  const theme = selectNativeReportTheme(input);
  cssCache ??= readFile(new URL("notebook.css", assetRoot), "utf8").catch(
    error => {
      cssCache = undefined;
      throw new Error("报告主题资源暂不可用，请稍后重试", { cause: error });
    }
  );
  if (!imageCache.has(theme.id)) {
    imageCache.set(
      theme.id,
      readFile(new URL(`${theme.id}.png`, assetRoot))
        .then(buffer => {
          if (
            buffer.length < 8 ||
            buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
          )
            throw new Error("报告插画资源无效");
          return `data:image/png;base64,${buffer.toString("base64")}`;
        })
        .catch(error => {
          imageCache.delete(theme.id);
          throw new Error("报告主题资源暂不可用，请稍后重试", { cause: error });
        })
    );
  }
  const [baseCss, imageDataUri] = await Promise.all([
    cssCache,
    imageCache.get(theme.id)!,
  ]);
  const motif =
    theme.id === "celadon"
      ? "repeating-radial-gradient(ellipse at 50% 100%,transparent 0 5px,var(--gold) 6px 7px,transparent 8px 12px)"
      : theme.id === "rose"
        ? "radial-gradient(circle,var(--gold) 1px,transparent 2px)"
        : theme.id === "moon"
          ? "repeating-linear-gradient(135deg,transparent 0 4px,var(--gold) 5px 6px,transparent 7px 10px)"
          : theme.id === "apricot"
            ? "repeating-radial-gradient(circle at 50% 50%,transparent 0 3px,var(--gold) 4px 5px,transparent 6px 10px)"
            : "repeating-linear-gradient(45deg,transparent 0 7px,var(--gold) 7px 8px,transparent 8px 15px),repeating-linear-gradient(-45deg,transparent 0 7px,var(--gold) 7px 8px,transparent 8px 15px)";
  const css = `${baseCss}\n:root{--paper:${theme.paper};--ink:${theme.ink};--blue:${theme.title};--gold:${theme.accent};--white:${theme.card};--line:color-mix(in srgb,var(--gold) 36%,var(--paper))}\n.cover:after,.chapter h2:after,.colophon:before{background:${motif};background-size:20px 14px;border-color:var(--line)}`;
  return { id: theme.id, css, imageDataUri };
}
