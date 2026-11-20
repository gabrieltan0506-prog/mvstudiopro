/**
 * 排版云稿「只传变更」保存协议（editableLayout.saveDocuments，1121 夜）。
 *
 * 为什么：旧协议每次保存都上传整个库（审校每完成一批存一次；6 本 48 章大书的库约 46MB/次）。
 * 新协议前台只上传与「上次读到/存成的云端版本（基线）」不同的稿件，加上完整的稿件顺序；
 * 其中只读的原稿快照（publication.source，含每章 5.5 万字的图外内文）若与基线相同，只传「沿用」标记与摘要。
 * 服务端用当前云端库（generation 必须等于基线）+ 这份增量重建出完整的库，再走与整库保存完全相同的写入路径。
 *
 * 正确性依据：
 * - 未上传的稿 = 前台与基线逐字段相同的稿；基线 = 该 generation 的云端稿（前台视角，配图为签名地址）。
 *   整库保存时服务端会把签名地址规范回 gs:// 再落盘，所以「前台稿规范后」与「云端稿」相同；重建结果与整库上传逐字相同。
 * - 已有知识稿的原稿快照本就不允许改动（保存校验逐字比对），沿用云端快照不会放过任何本该拒绝的保存。
 * - 基线 generation 不是当前版本 → 冲突（与整库保存同一语义），不自动合并。
 * - 任何对不上的情况（摘要不符、引用了云端没有的稿）→「需要整库保存」，前台退回旧协议。
 */
import { z } from "zod";
import type { EditableLayout, LayoutLibrary } from "./editableLayout";

/**
 * 结构拷贝：对象与数组逐层新建，字符串（不可变）共享引用——成本与节点数成正比，与正文字数无关。
 * 值为 undefined 的键按 JSON 语义丢弃，使拷贝与「序列化后再解析」等价。
 */
export function cloneLayoutTree<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => (item === undefined ? null : cloneLayoutTree(item))) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = cloneLayoutTree(item);
    }
    return out as T;
  }
  return value;
}

/** 按 JSON 语义的深比较（键顺序也要相同，保证序列化逐字相同）；字符串同引用时为 O(1)。 */
export function layoutTreeEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!layoutTreeEqual(a[i] ?? null, b[i] ?? null)) return false;
    return true;
  }
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(b)) return false;
  const ak = Object.keys(a).filter(k => (a as Record<string, unknown>)[k] !== undefined);
  const bk = Object.keys(b).filter(k => (b as Record<string, unknown>)[k] !== undefined);
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false;
    if (!layoutTreeEqual((a as Record<string, unknown>)[ak[i]], (b as Record<string, unknown>)[bk[i]])) return false;
  }
  return true;
}

/**
 * 「沿用原稿快照」的核对摘要输入：原稿快照去掉配图地址后的 JSON。
 * 配图地址在前台是签名地址、在云端是 gs:// 规范地址，两边不同；地址是否一致由前台的逐字段比较保证。
 */
export function layoutSourceRetainText(source: unknown) {
  return JSON.stringify(source, (key, value) => (key === "imageUrl" ? undefined : value));
}

const uuid = z.string().uuid();
export const layoutSaveDeltaSchema = z
  .object({
    expectedGeneration: z.string().regex(/^\d+$/),
    /** 保存后的完整稿件顺序（含未改动的稿）。云端有而这里没有 = 删除。 */
    order: z.array(uuid).max(100),
    /** 新建或有改动的稿。retainSource 存在时 doc.publication 不含 source，由服务端沿用云端同稿快照。 */
    upserts: z
      .array(
        z
          .object({
            doc: z.object({ id: uuid }).passthrough(),
            retainSource: z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
          })
          .strict()
      )
      .max(100),
  })
  .strict();
export type LayoutSaveDelta = z.infer<typeof layoutSaveDeltaSchema>;

/** 增量与当前云稿对不上：前台应退回整库保存（不是冲突，也不是校验失败）。 */
export const LAYOUT_DELTA_NEEDS_FULL = "排版稿需要整库保存";
export class LayoutDeltaNeedsFull extends Error {
  constructor(reason: string) {
    super(`${LAYOUT_DELTA_NEEDS_FULL}：${reason}`);
  }
}

/**
 * 前台：由基线（该 generation 的云端稿，前台视角）与待保存的完整库算出增量。
 * digest：sha256 十六进制（前台用 WebCrypto，异步）；对同一基线原稿快照只算一次由调用方缓存。
 */
export async function buildLayoutSaveDelta(
  baseline: Pick<LayoutLibrary, "documents">,
  next: Pick<LayoutLibrary, "documents">,
  expectedGeneration: string,
  digest: (source: object) => Promise<string>
): Promise<LayoutSaveDelta> {
  const before = new Map(baseline.documents.map(doc => [doc.id, doc] as const));
  const upserts: LayoutSaveDelta["upserts"] = [];
  for (const doc of next.documents) {
    const old = before.get(doc.id);
    if (old && layoutTreeEqual(doc, old)) continue;
    const source = doc.publication?.source;
    if (old?.publication && source && layoutTreeEqual(source, old.publication.source)) {
      const { source: _retained, ...publication } = doc.publication!;
      upserts.push({ doc: { ...doc, publication } as LayoutSaveDelta["upserts"][number]["doc"], retainSource: { sha256: await digest(old.publication.source) } });
    } else upserts.push({ doc: doc as unknown as LayoutSaveDelta["upserts"][number]["doc"] });
  }
  return { expectedGeneration, order: next.documents.map(doc => doc.id), upserts };
}

/**
 * 服务端：当前云稿（与基线同一 generation）+ 增量 → 完整库（未经 schema 解析的原始对象，交给整库保存路径解析与校验）。
 * 未上传的稿与沿用的原稿快照取自云稿的结构拷贝（不共享引用，写入路径的就地规范化不会改到缓存）。
 */
export function applyLayoutSaveDelta(
  cloud: Pick<LayoutLibrary, "documents"> | null,
  owner: string,
  delta: LayoutSaveDelta,
  digest: (source: object) => string
) {
  const cloudDocs = new Map((cloud?.documents || []).map(doc => [doc.id, doc] as const));
  const upserts = new Map<string, LayoutSaveDelta["upserts"][number]>();
  for (const item of delta.upserts) {
    if (upserts.has(item.doc.id)) throw new LayoutDeltaNeedsFull("同一稿件重复上传");
    upserts.set(item.doc.id, item);
  }
  if (new Set(delta.order).size !== delta.order.length) throw new LayoutDeltaNeedsFull("稿件顺序重复");
  if (Array.from(upserts.keys()).some(id => !delta.order.includes(id))) throw new LayoutDeltaNeedsFull("上传的稿件不在顺序表中");
  const documents = delta.order.map(id => {
    const item = upserts.get(id);
    if (!item) {
      const kept = cloudDocs.get(id);
      if (!kept) throw new LayoutDeltaNeedsFull("引用了云端没有的稿件");
      return cloneLayoutTree(kept);
    }
    if (!item.retainSource) return item.doc;
    const old = cloudDocs.get(id) as EditableLayout | undefined;
    const publication = (item.doc as { publication?: Record<string, unknown> }).publication;
    if (!old?.publication || !publication || "source" in publication) throw new LayoutDeltaNeedsFull("沿用的原稿快照不存在");
    if (digest(old.publication.source) !== item.retainSource.sha256) throw new LayoutDeltaNeedsFull("原稿快照摘要不符");
    // 键顺序与 schema 一致由随后的 schema 解析保证；这里只放回内容。
    return { ...item.doc, publication: { ...publication, source: cloneLayoutTree(old.publication.source) } };
  });
  return { version: 1 as const, owner, documents };
}
