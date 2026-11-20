/**
 * 排版库大字段外置（editable-layout-v2，1121）。
 *
 * 为什么：每个账号的全部稿件同存一个 library.json。一本 48 章、每章图外内文约 5.5 万字的大书约 9.9MB，
 * 200 章约 37.7MB；整库上限 64MB，六本左右就再也存不进去，而且每次保存服务端都要整库下载、整库上传。
 * 其中绝大部分是 publication.source.pages[].supplement——它是原稿快照的一部分，建稿后不可改（保存校验会拒绝改动），
 * 所以按内容寻址（sha256）存成独立的不可变对象最安全：同一段文字永远同一个对象名，写一次即可，之后保存只写小索引。
 *
 * 不变量：
 * - 读出来的库与旧格式逐字相同（外置文字原样还原、再经同一 schema 解析），原稿摘要/请求身份/回执不受影响。
 * - 先写外置对象、后写索引（索引写入仍是唯一的 generation 条件写）；任何一步失败都不会出现「索引有引用但对象不存在」。
 * - 读到缺失或内容不符的外置对象直接报明确错误，绝不当作空文本。
 * - 外置对象只增不删（本模块不做任何清理）。
 */
import { createHash } from "node:crypto";
import { z } from "zod";

export const EDITABLE_LAYOUT_V1 = "editable-layout-v1";
export const EDITABLE_LAYOUT_V2 = "editable-layout-v2";
/** 单段图外内文达到这个字数才外置；短文字留在索引里，避免大量小对象。 */
export const EXTERNAL_TEXT_MIN_CHARS = 8192;

const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);
export const externalTextRefSchema = z
  .object({
    documentId: z.string().uuid(),
    pageId: z.string().uuid(),
    sha256: sha256Hex,
    chars: z.number().int().min(0),
  })
  .strict();
export type ExternalTextRef = z.infer<typeof externalTextRefSchema>;
export const externalTextIndexSchema = z
  .object({
    version: z.literal(1),
    field: z.literal("publication.source.pages.supplement"),
    refs: z.array(externalTextRefSchema),
  })
  .strict();
export type ExternalTextIndex = z.infer<typeof externalTextIndexSchema>;

export const externalTextObjectName = (owner: number, sha256: string) =>
  `editable-layouts/user-${owner}/text/sha256-${sha256}.json`;

/**
 * 外置对象内容 = JSON 字符串字面量。用 JSON 而非裸 UTF-8：孤立代理字符经 UTF-8 编码会被替换，
 * JSON.stringify 会把它转义保留，还原后与原文逐码元相同（与旧 library.json 的序列化方式一致）。
 */
export function encodeExternalText(text: string) {
  const buffer = Buffer.from(JSON.stringify(text), "utf8");
  return { buffer, sha256: createHash("sha256").update(buffer).digest("hex") };
}
export function decodeExternalText(buffer: Buffer, ref: Pick<ExternalTextRef, "sha256" | "chars">) {
  const actual = createHash("sha256").update(buffer).digest("hex");
  if (actual !== ref.sha256) throw new Error(`云端排版稿外置原文校验不符（${ref.sha256.slice(0, 12)}），未读取、未覆盖；请联系支持恢复`);
  const text: unknown = JSON.parse(buffer.toString("utf8"));
  if (typeof text !== "string" || text.length !== ref.chars)
    throw new Error(`云端排版稿外置原文长度不符（${ref.sha256.slice(0, 12)}），未读取、未覆盖；请联系支持恢复`);
  return text;
}

type RawPage = { id: string; supplement?: unknown };
type RawDoc = { id: string; publication?: { source?: { pages?: RawPage[] } } };
type RawLibrary = { documents: RawDoc[] };

/**
 * 从已通过 schema 解析的完整库生成「索引库」与外置文字清单。不改入参：只浅拷贝通向 supplement 的路径（文档 → publication → source → 页），
 * 其余字段与原库共享引用（只用于序列化）。只外置 ≥ EXTERNAL_TEXT_MIN_CHARS 的 supplement；同内容同对象（sha256）。
 */
export function externalizeSupplements(library: unknown) {
  const refs: ExternalTextRef[] = [];
  const objects = new Map<string, { buffer: Buffer; text: string }>();
  const source = library as RawLibrary & Record<string, unknown>;
  const index = {
    ...source,
    documents: source.documents.map(doc => {
      const pages = doc.publication?.source?.pages;
      if (!pages?.some(p => typeof p.supplement === "string" && p.supplement.length >= EXTERNAL_TEXT_MIN_CHARS)) return doc;
      return {
        ...doc,
        publication: {
          ...doc.publication,
          source: {
            ...doc.publication!.source,
            pages: pages.map(page => {
              if (typeof page.supplement !== "string" || page.supplement.length < EXTERNAL_TEXT_MIN_CHARS) return page;
              const { buffer, sha256 } = encodeExternalText(page.supplement);
              refs.push({ documentId: doc.id, pageId: page.id, sha256, chars: page.supplement.length });
              if (!objects.has(sha256)) objects.set(sha256, { buffer, text: page.supplement });
              const { supplement: _external, ...rest } = page;
              return rest;
            }),
          },
        },
      };
    }),
  };
  return { index, externalText: { version: 1 as const, field: "publication.source.pages.supplement" as const, refs }, objects };
}

/** 完整库里已有的外置文字（sha256 → 原文），供写前核对旧版时免下载还原。 */
export function knownExternalTexts(plan: ReturnType<typeof externalizeSupplements>) {
  return new Map(Array.from(plan.objects, ([sha256, object]) => [sha256, object.text] as const));
}

/** 把外置文字放回索引库对应页（就地修改 rawLibrary）。引用找不到稿/页、或该页已有内文，都视为损坏并报错。 */
export async function hydrateSupplements(
  rawLibrary: unknown,
  externalText: ExternalTextIndex,
  load: (ref: ExternalTextRef) => Promise<string>,
  concurrency = 8
) {
  const library = rawLibrary as RawLibrary;
  const targets = externalText.refs.map(ref => {
    const page = library.documents.find(d => d.id === ref.documentId)?.publication?.source?.pages?.find(p => p.id === ref.pageId);
    if (!page || page.supplement !== undefined) throw new Error("云端排版稿外置原文索引与稿件不符，未读取、未覆盖；请联系支持恢复");
    return { ref, page };
  });
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const { ref, page } = targets[next++];
      page.supplement = await load(ref);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return rawLibrary;
}

/** 有界的外置原文缓存：内容寻址、不可变，按 sha256 复用；按字数上限淘汰最旧项。 */
export class ExternalTextCache {
  private entries = new Map<string, string>();
  private chars = 0;
  constructor(readonly maxChars: number) {}
  get(sha256: string) {
    const hit = this.entries.get(sha256);
    if (hit === undefined) return undefined;
    this.entries.delete(sha256);
    this.entries.set(sha256, hit);
    return hit;
  }
  set(sha256: string, text: string) {
    if (text.length > this.maxChars || this.entries.has(sha256)) return;
    this.entries.set(sha256, text);
    this.chars += text.length;
    while (this.chars > this.maxChars) {
      const [oldest, value] = this.entries.entries().next().value as [string, string];
      this.entries.delete(oldest);
      this.chars -= value.length;
    }
  }
  clear() { this.entries.clear(); this.chars = 0; }
}
