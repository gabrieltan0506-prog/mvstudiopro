/**
 * 排版云稿保存：默认只传变更（editableLayout.saveDocuments），对不上或服务端不认识新接口时自动退回整库保存（editableLayout.save）。
 *
 * 基线 = 最近一次读到或存成的云端库（前台视角）及其 generation，存的是私有结构拷贝：页面上的稿件对象即使被就地改动，
 * 也不会让「改过的稿」被误判为未改而漏传。没有基线、或基线版本与本次 expectedGeneration 不同，一律整库保存（与旧行为相同）。
 * 冲突（CONFLICT）与业务校验失败照原样抛出，不改用整库重试——否则会把「已拒绝」变成「再试一次」，并可能掩盖已写成的保存。
 */
import { buildLayoutSaveDelta, cloneLayoutTree, layoutSourceRetainText, LAYOUT_DELTA_NEEDS_FULL, type LayoutSaveDelta } from "@shared/editableLayoutDelta";
import type { LayoutLibrary } from "@shared/editableLayout";

export type LayoutCloudBaseline = { generation: string; library: LayoutLibrary };
export type LayoutSaveReceipt = { generation: string; updatedAt: string };

/** 原稿快照摘要（WebCrypto sha256）；同一基线快照对象只算一次。 */
const digestMemo = new WeakMap<object, Promise<string>>();
export function layoutSourceRetainDigestBrowser(source: object) {
  let hit = digestMemo.get(source);
  if (!hit) {
    hit = crypto.subtle.digest("SHA-256", new TextEncoder().encode(layoutSourceRetainText(source))).then(buffer =>
      Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, "0")).join(""));
    digestMemo.set(source, hit);
  }
  return hit;
}

export function layoutCloudBaseline(generation: string, library: LayoutLibrary | null | undefined, owner: string): LayoutCloudBaseline {
  return { generation, library: cloneLayoutTree(library || { version: 1, owner, documents: [] }) };
}

/** 服务端不认识新接口（旧版本）或要求整库保存。 */
export function layoutDeltaFallback(error: unknown): "unsupported" | "full" | null {
  const e = error as { data?: { code?: string; httpStatus?: number }; message?: string } | null;
  const code = e?.data?.code;
  if (code === "NOT_FOUND" || e?.data?.httpStatus === 404) return "unsupported";
  if (code === "PRECONDITION_FAILED" && String(e?.message || "").includes(LAYOUT_DELTA_NEEDS_FULL)) return "full";
  return null;
}

export async function saveLayoutLibraryToCloud<R extends LayoutSaveReceipt>(params: {
  input: { library: LayoutLibrary; expectedGeneration: string };
  baseline: LayoutCloudBaseline | null;
  /** 本会话已确认服务端不认识新接口时为 true，直接整库保存。 */
  deltaUnsupported: boolean;
  saveDelta: (delta: LayoutSaveDelta) => Promise<R>;
  saveFull: (input: { library: LayoutLibrary; expectedGeneration: string }) => Promise<R>;
  digest?: (source: object) => Promise<string>;
}): Promise<{ result: R; mode: "delta" | "full"; unsupported: boolean; baseline: LayoutCloudBaseline }> {
  const { input, baseline } = params;
  let unsupported = params.deltaUnsupported;
  if (!unsupported && baseline && baseline.generation === input.expectedGeneration) {
    const delta = await buildLayoutSaveDelta(baseline.library, input.library, input.expectedGeneration, params.digest || layoutSourceRetainDigestBrowser);
    try {
      const result = await params.saveDelta(delta);
      return { result, mode: "delta", unsupported, baseline: layoutCloudBaseline(result.generation, input.library, input.library.owner) };
    } catch (error) {
      const fallback = layoutDeltaFallback(error);
      if (!fallback) throw error;
      if (fallback === "unsupported") unsupported = true;
    }
  }
  const result = await params.saveFull(input);
  return { result, mode: "full", unsupported, baseline: layoutCloudBaseline(result.generation, input.library, input.library.owner) };
}
