/**
 * 把段成片提示词切成「文本 + 资产引用」token 流，供中栏渲染成内联药丸。
 *
 * 提示词里 @角色2 这种引用是给引擎看的裸标记，人读起来完全对不上是谁。
 * 渲染成带缩略图和名字的药丸后，一眼能看出这句台词绑的是哪张脸。
 *
 * 映射不用外部传：绑定表就写在提示词自己里（@角色1|id=…|label=…|kind=…），
 * 所以同一份文本自带解释自己所需的一切，节点存稿改过也不会错位。
 */

export type ManhuaPromptAssetKind = "角色" | "场景" | "道具" | "服装";

export type ManhuaPromptAssetMeta = {
  tag: string;
  assetId: string;
  labelZh: string;
  kind: ManhuaPromptAssetKind;
  /** identity=锁脸大头照；look=锁妆造全身 */
  duty?: "identity" | "look" | null;
};

export type ManhuaPromptToken =
  | { kind: "text"; text: string }
  | {
      kind: "asset";
      /** 原文里的标记，如 @角色2 或 @图片1 */
      raw: string;
      meta: ManhuaPromptAssetMeta | null;
      /** @图片N 的序号；@角色N 类不带 */
      imageIndex?: number;
    };

const BIND_MARK = "【资产·Image对照】";
const HARD_BIND_MARK = "【出片Image硬绑】";

/** 从提示词自带的对照表抽 tag → 资产信息 */
export function parseManhuaPromptAssetMetaByTag(
  prompt: string | null | undefined,
): Record<string, ManhuaPromptAssetMeta> {
  const raw = String(prompt || "");
  const idx = raw.indexOf(BIND_MARK);
  if (idx < 0) return {};
  const body = raw.slice(idx + BIND_MARK.length);
  const end = body.search(/\n【/);
  const section = end >= 0 ? body.slice(0, end) : body;
  const out: Record<string, ManhuaPromptAssetMeta> = {};
  for (const line of section.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(
      /^(@(?:角色|场景|道具|服装)\d+)\|id=([^|]+)\|label=([^|]*)(?:\|kind=([^|]*))?/,
    );
    if (!m) continue;
    const tag = m[1]!;
    const kindFromTag = tag.replace(/^@/, "").replace(/\d+$/, "") as ManhuaPromptAssetKind;
    const duty = t.match(/\|duty=(identity|look)\b/)?.[1] as
      | "identity"
      | "look"
      | undefined;
    out[tag] = {
      tag,
      assetId: String(m[2] || "").trim(),
      labelZh: String(m[3] || "").trim() || tag,
      kind: (String(m[4] || "").trim() as ManhuaPromptAssetKind) || kindFromTag,
      duty: duty ?? null,
    };
  }
  return out;
}

/**
 * 药丸视图不显示对照表与硬绑句：那两块是给引擎的接线图，不是给人读的剧本。
 * 原文视图仍然完整可改，所以信息没丢。
 */
export function stripManhuaPromptBindBlocksForReview(
  prompt: string | null | undefined,
): string {
  let text = String(prompt || "");
  for (const mark of [BIND_MARK, HARD_BIND_MARK]) {
    const idx = text.indexOf(mark);
    if (idx < 0) continue;
    const rest = text.slice(idx + mark.length);
    const end = rest.search(/\n【/);
    text = text.slice(0, idx) + (end >= 0 ? rest.slice(end + 1) : "");
  }
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/** @角色2 / @场景1 / @图片3 —— 只认这几类，别把邮箱之类的 @ 也吃掉 */
const ASSET_REF_RE = /@(?:角色|场景|道具|服装|图片)\d+/g;

/**
 * 切 token。文本一个字都不改，拼回去必须与输入完全相同——
 * 这是药丸视图能当「同一份提示词」看的前提。
 */
export function tokenizeManhuaPromptAssets(
  text: string | null | undefined,
  metaByTag: Record<string, ManhuaPromptAssetMeta>,
): ManhuaPromptToken[] {
  const src = String(text || "");
  if (!src) return [];
  const out: ManhuaPromptToken[] = [];
  let last = 0;
  // 每次新建正则：ASSET_REF_RE 带 g，共用会把 lastIndex 带进下一次调用
  const re = new RegExp(ASSET_REF_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const at = m.index;
    if (at > last) out.push({ kind: "text", text: src.slice(last, at) });
    const raw = m[0];
    const imgNo = raw.match(/^@图片(\d+)$/)?.[1];
    out.push({
      kind: "asset",
      raw,
      meta: metaByTag[raw] || null,
      ...(imgNo ? { imageIndex: Number(imgNo) } : {}),
    });
    last = at + raw.length;
  }
  if (last < src.length) out.push({ kind: "text", text: src.slice(last) });
  return out;
}

/** 药丸上的副标：把职责写成人话，没职责就不写 */
export function manhuaAssetChipDutyLabelZh(
  duty: "identity" | "look" | null | undefined,
): string {
  if (duty === "identity") return "锁脸";
  if (duty === "look") return "锁妆造";
  return "";
}
