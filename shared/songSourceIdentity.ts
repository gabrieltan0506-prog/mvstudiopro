import type { SongDemoVariant } from "./canvasMusicMv";

type MusicVariantIdentity = {
  index: number;
  musicId?: string | null;
  providerTaskId?: string | null;
};

/** 不从音频网址或候选序号伪造上游身份；旧记录允许缺省。 */
export function musicCandidateSourceIdentity(jobId: string, variant: MusicVariantIdentity) {
  return {
    musicJobId: jobId,
    variantIndex: variant.index,
    ...(variant.musicId?.trim() ? { musicId: variant.musicId.trim() } : {}),
    ...(variant.providerTaskId?.trim() ? { providerTaskId: variant.providerTaskId.trim() } : {}),
  };
}

/** 恢复原任务时补回身份，同时保留已有试听结果与未返回的旧变体。 */
export function mergeSongDemoSourceVariants(
  existing: SongDemoVariant[],
  incoming: Array<MusicVariantIdentity & { gcsUri: string; durationSec: number | null }>
): SongDemoVariant[] {
  const variants = new Map(existing.map(variant => [variant.index, variant]));
  for (const variant of incoming) {
    const old = variants.get(variant.index);
    if (old && old.sourceGcsUri !== variant.gcsUri)
      throw new Error("原Demo音轨身份发生变化，请保留原任务并核对，未覆盖已有试听");
    variants.set(variant.index, {
      index: variant.index,
      sourceGcsUri: variant.gcsUri,
      durationSec: Number(variant.durationSec),
      status: "pending",
      ...old,
      ...(variant.musicId?.trim() ? { musicId: variant.musicId.trim() } : {}),
      ...(variant.providerTaskId?.trim() ? { providerTaskId: variant.providerTaskId.trim() } : {}),
    });
  }
  return Array.from(variants.values());
}
