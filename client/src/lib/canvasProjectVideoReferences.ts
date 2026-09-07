import type { ManhuaCustomAssetRef } from "@shared/manhuaCustomAssetRefs";
import { normalizeSeedance25EvolinkMode } from "@shared/seedanceEvolinkModels";
import type { CanvasBlock } from "./canvasTypes";
import { resolveManhuaCanvasVideoImageReferenceMax } from "./canvasRunBlock";
import {
  assetImageGcsUri,
  refreshAssetImageUrl,
} from "./manhuaAssetImageSource";
import { resolveUrlForCloudSync } from "./manhuaLocalMediaStore";

/** 工厂节点仍由剧本编译器绑定，不提供手动旁路。 */
export function canSelectProjectVideoReferences(block: CanvasBlock): boolean {
  return (
    block.kind === "video" &&
    !block.manhuaRetake &&
    !/^(clip|omni_edit|final|keyart|charsheet|sceneplate|propsheet|propplate)-/i.test(
      block.id
    )
  );
}

/** 选择顺序就是出站顺序，不拿 uploadedAssets 当选择真源。 */
export function projectVideoReferenceUrls(block: CanvasBlock): string[] {
  return Array.from(
    new Set(
      [block.refImageUrl, ...(block.editFusionUrls || [])].filter(
        (url): url is string => Boolean(url)
      )
    )
  );
}

function cloudSource(url: string): string {
  return resolveUrlForCloudSync(url) || url;
}

function stableObjectPath(url: string): string | undefined {
  try {
    const parsed = new URL(url, "https://canvas.invalid");
    if (!parsed.pathname.startsWith("/api/canvas-media/")) return;
    return decodeURIComponent(
      parsed.pathname.slice("/api/canvas-media/".length)
    );
  } catch {
    return;
  }
}

export function matchesProjectVideoReference(
  url: string,
  ref: ManhuaCustomAssetRef
): boolean {
  const source = cloudSource(url);
  if (source === ref.url) return true;
  const gcs = ref.gcsUri || assetImageGcsUri(ref.url);
  if (!gcs) return false;
  if (assetImageGcsUri(source) === gcs) return true;
  const path = stableObjectPath(source);
  return Boolean(path && gcs.replace(/^gs:\/\/[^/]+\//, "") === path);
}

export function projectVideoReferenceLimit(block: CanvasBlock): number {
  // 本机 normalizeCanvasBlock 只保留十五张附图；不允许选完刷新被静默截掉。
  const max = Math.min(
    16,
    resolveManhuaCanvasVideoImageReferenceMax(block.videoModel)
  );
  if (block.videoModel !== "seedance-2.5") return max;
  const mode = normalizeSeedance25EvolinkMode(block.seedance25WorkMode, {
    imageUrls: projectVideoReferenceUrls(block),
    videoUrls: block.seedance25RefVideoUrls || [],
    audioUrls: block.seedance25RefAudioUrls || [],
  });
  return mode === "text_to_video" ? 0 : mode === "image_to_video" ? 2 : max;
}

export function toggleProjectVideoReference(
  block: CanvasBlock,
  ref: ManhuaCustomAssetRef
): CanvasBlock {
  if (!canSelectProjectVideoReferences(block)) return block;
  const current = projectVideoReferenceUrls(block);
  const selected = current.some(url => matchesProjectVideoReference(url, ref));
  if (
    !selected &&
    (ref.reviewStatus === "needs_review" ||
      ref.role === "unset" ||
      !/^https:\/\//i.test(ref.url))
  ) {
    throw new Error("请先确认这张参考图可用，再添加到视频节点");
  }
  const next = selected
    ? current.filter(url => !matchesProjectVideoReference(url, ref))
    : [...current, ref.url];
  if (!selected && next.length > projectVideoReferenceLimit(block)) {
    throw new Error("参考图已达到当前模式或草稿保存上限，请先移除不需要的图片");
  }
  return { ...block, refImageUrl: next[0], editFusionUrls: next.slice(1) };
}

/** 仅在普通节点使用本集图时现签；结果只用于本次运行，不改原资产和旧产物。 */
export async function prepareProjectVideoReferences(
  block: CanvasBlock,
  refs: readonly ManhuaCustomAssetRef[],
  refresh = refreshAssetImageUrl,
  isCurrent: () => boolean = () => true
): Promise<CanvasBlock> {
  if (!refs.length || !canSelectProjectVideoReferences(block)) return block;
  const urls = projectVideoReferenceUrls(block);
  const matched = urls.map(url =>
    refs.find(ref => matchesProjectVideoReference(url, ref))
  );
  if (!matched.some(Boolean)) return block;
  if (urls.length > projectVideoReferenceLimit(block)) {
    throw new Error("已选参考图超过当前模式或草稿保存上限，尚未提交生成");
  }
  const prepared: string[] = [];
  for (let index = 0; index < urls.length; index++) {
    if (!isCurrent()) throw new Error("项目或账号已变化，未提交生成");
    const ref = matched[index];
    if (ref?.reviewStatus === "needs_review" || ref?.role === "unset") {
      throw new Error("所选参考图已变为待确认，尚未提交生成");
    }
    const source = cloudSource(urls[index]);
    const url = await refresh(
      ref || { url: source, gcsUri: assetImageGcsUri(source) }
    );
    if (!/^https:\/\//i.test(url))
      throw new Error("参考图无法恢复为可读取地址，尚未提交生成");
    prepared.push(url);
  }
  if (!isCurrent()) throw new Error("项目或账号已变化，未提交生成");
  return {
    ...block,
    refImageUrl: prepared[0],
    editFusionUrls: prepared.slice(1),
  };
}
