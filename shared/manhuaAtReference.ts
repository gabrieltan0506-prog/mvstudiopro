/**
 * @即引用：用户在秒轴/成片提示词里敲 @，立刻弹资产并锁定。
 *
 * 例：`4-7秒 阿咎@image03 颤抖的说：这不是我干的@x3.mp3`
 * - `@imageNN`：图片资产（骑在 @角色N/@场景N/@道具N/@服装N 锁表上的平铺别名，
 *   不另造一套编号真源）
 * - `@xN.mp3` 等 `@<名字>.mp3`：音轨资产（音频库接入后同一套协议直接可用）
 * - `@dN.png`：导演板轨迹参考（红线=角色动线、青线=镜头轨迹；只进提示词层，
 *   出片画面零痕迹——由调用方在 prompt 里追加约束句）
 *
 * 稳定性：插入时 UI 落一份 bindings（token → 槽位 tag）随稿持久化；
 * 解析优先按 bindings 找槽位，找不到才按当前序号兜底——资产增删导致
 * 重排时旧稿不断链。断链（绑定的槽位已被删）如实报 missing，交 UI 标红，
 * 绝不静默跳过。
 */

import type { ManhuaAssetLockRegistry, ManhuaAssetLockSlot } from "./manhuaAssetLockRegistry.js";

export type ManhuaAtReferenceKind = "image" | "audio" | "board";

export type ManhuaAtReferenceEntry = {
  /** 不含 @ 的 token 文本，如 image03 / x3.mp3 / d1.png */
  token: string;
  kind: ManhuaAtReferenceKind;
  /** 图片类对应的锁表 tag（@角色1…）；音频/导演板无 */
  tag?: string;
  labelZh: string;
  url: string;
};

/** 随稿持久化的插入期绑定：token → 锁表 tag（图片类才需要） */
export type ManhuaAtReferenceBindings = Record<string, { tag: string }>;

/**
 * 正式形态中文（用户拍板：显示中文不显示英文）：@图03 / @音3 / @板1。
 * 英文形态兼容不废（@image03 / @x3.mp3 / @d1.png），解析时归一到中文。
 */
const IMAGE_TOKEN_RE = /^(?:image|图)(\d{1,3})$/i;
const AUDIO_FILE_TOKEN_RE = /^[\w-]{1,40}\.(?:mp3|wav|m4a)$/i;
const AUDIO_NO_TOKEN_RE = /^音(\d{1,3})$/;
const BOARD_TOKEN_RE = /^(?:d(\d{1,3})\.png|板(\d{1,3}))$/i;

/** 提示词中可出现的 @token（不吃邮箱：@ 前必须是行首/空白/中文/标点） */
const TOKEN_SCAN_RE =
  /(^|[\s，。：；、！？“”()（）一-鿿])@((?:image|图)\d{1,3}|音\d{1,3}|板\d{1,3}|[\w-]{1,40}\.(?:mp3|wav|m4a)|d\d{1,3}\.png)/gi;

export function classifyManhuaAtToken(token: string): ManhuaAtReferenceKind | null {
  if (IMAGE_TOKEN_RE.test(token)) return "image";
  if (BOARD_TOKEN_RE.test(token)) return "board";
  if (AUDIO_FILE_TOKEN_RE.test(token) || AUDIO_NO_TOKEN_RE.test(token)) return "audio";
  return null;
}

/** 英文形态归一到中文正式形态：image03→图03、d1.png→板1；音频文件名保持原样 */
export function canonicalizeManhuaAtToken(token: string): string {
  const img = token.match(IMAGE_TOKEN_RE);
  if (img) return `图${img[1]!.padStart(2, "0")}`;
  const board = token.match(BOARD_TOKEN_RE);
  if (board) return `板${board[1] || board[2]}`;
  return token;
}

/** 扫出文本里全部 @token（去重保序） */
export function parseManhuaAtReferenceTokens(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of Array.from(String(text || "").matchAll(TOKEN_SCAN_RE))) {
    const token = String(m[2] || "");
    const key = token.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(token);
    }
  }
  return out;
}

/**
 * 平铺图片索引：imageNN 按锁表 slots 当前顺序编（1-based）。
 * 序号只是快捷输入形态；真源永远是槽位 tag——UI 插入后立刻把
 * token→tag 落进 bindings，此后重排不影响旧稿。
 */
export function buildManhuaAtReferenceIndex(input: {
  registry: Pick<ManhuaAssetLockRegistry, "slots"> | null | undefined;
  /** 音频资产（配乐链路接入后传入；现在传空数组即可） */
  audioAssets?: Array<{ name: string; labelZh?: string; url: string }> | null;
  /** 每集导演板：episodeIndex → 主图 URL（d<集号>.png） */
  boardUrlByEpisode?: Record<number, string> | null;
}): ManhuaAtReferenceEntry[] {
  const out: ManhuaAtReferenceEntry[] = [];
  const slots = input.registry?.slots || [];
  slots.forEach((slot, i) => {
    if (!slot?.path) return;
    out.push({
      token: `图${String(i + 1).padStart(2, "0")}`,
      kind: "image",
      tag: slot.tag,
      labelZh: slot.labelZh || slot.tag,
      url: slot.path,
    });
  });
  (input.audioAssets || []).forEach((a, i) => {
    const name = String(a?.name || "").trim();
    if (!a?.url) return;
    // 正式 token 用中文序号；真实文件名（x3.mp3）作兼容别名由 resolver 归一
    out.push({
      token: `音${i + 1}`,
      kind: "audio",
      labelZh: a.labelZh || name || `音${i + 1}`,
      url: a.url,
    });
    if (name && AUDIO_FILE_TOKEN_RE.test(name)) {
      out.push({ token: name, kind: "audio", labelZh: a.labelZh || name, url: a.url });
    }
  });
  for (const [ep, url] of Object.entries(input.boardUrlByEpisode || {})) {
    const n = Number(ep);
    if (!Number.isFinite(n) || n < 1 || !url) continue;
    out.push({
      token: `板${n}`,
      kind: "board",
      labelZh: `第${String(n).padStart(2, "0")}集导演板`,
      url: String(url),
    });
  }
  return out;
}

export type ManhuaAtReferenceResolution = {
  resolved: ManhuaAtReferenceEntry[];
  /** 找不到实体的 token（断链/敲错）；UI 标红、出片前拦截 */
  missing: string[];
};

function slotByTag(
  slots: ManhuaAssetLockSlot[],
  tag: string,
): ManhuaAssetLockSlot | undefined {
  return slots.find((s) => s.tag === tag && s.path);
}

/** 解析文本里的 @ 引用：bindings 优先（稳定），序号兜底（便捷） */
export function resolveManhuaAtReferences(input: {
  text: string;
  index: ManhuaAtReferenceEntry[];
  registry?: Pick<ManhuaAssetLockRegistry, "slots"> | null;
  bindings?: ManhuaAtReferenceBindings | null;
}): ManhuaAtReferenceResolution {
  const tokens = parseManhuaAtReferenceTokens(input.text);
  const byToken = new Map(
    input.index.map((e) => [canonicalizeManhuaAtToken(e.token).toLowerCase(), e]),
  );
  const slots = input.registry?.slots || [];
  const resolved: ManhuaAtReferenceEntry[] = [];
  const missing: string[] = [];
  for (const rawToken of tokens) {
    const token = canonicalizeManhuaAtToken(rawToken);
    const binding = input.bindings?.[rawToken] || input.bindings?.[token];
    const bound = binding?.tag ? slotByTag(slots, binding.tag) : undefined;
    if (bound) {
      resolved.push({
        token,
        kind: "image",
        tag: bound.tag,
        labelZh: bound.labelZh || bound.tag,
        url: bound.path,
      });
      continue;
    }
    const hit = byToken.get(token.toLowerCase());
    if (hit) resolved.push({ ...hit, token });
    else missing.push(token);
  }
  return { resolved, missing };
}

/** 出片注入块：引用清单 + 导演板轨迹约束（板引用存在时才追加约束句） */
export function formatManhuaAtReferencePromptBlock(
  resolution: ManhuaAtReferenceResolution,
): string {
  if (!resolution.resolved.length) return "";
  const lines = resolution.resolved.map((e) => {
    const head = e.kind === "audio" ? "音轨" : e.kind === "board" ? "轨迹参考" : "垫图";
    return `- @${e.token}＝${head}·${e.labelZh}${e.tag ? `（${e.tag}）` : ""}`;
  });
  const hasBoard = resolution.resolved.some((e) => e.kind === "board");
  return [
    "【@引用对照】",
    ...lines,
    ...(hasBoard
      ? [
          "导演板仅作轨迹参考：红线＝角色/道具动线，青线＝镜头轨迹；" +
            "箭头、虚线框、信息栏文字一律不得出现在成片画面中。",
        ]
      : []),
  ].join("\n");
}
