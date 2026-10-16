import { TRPCError } from "@trpc/server";
import { getJobByIdStrict } from "../jobs/repository";

export type SongOperationSourceReference = {
  candidateId?: string;
  jobId?: string;
  sourceJobId?: string;
  musicJobId?: string;
  variantIndex?: number;
  gcsUri?: string;
  /** 客户端缓存仅供兼容；不会用作上游操作身份。 */
  musicId?: string;
};

export type ResolvedSongOperationSource = {
  jobId: string;
  variantIndex: number;
  gcsUri: string;
  musicId?: string;
  providerTaskId?: string;
  durationSec?: number;
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const invalidSource = () => new TRPCError({ code: "BAD_REQUEST", message: "歌曲来源身份不一致，请重新选择原歌曲" });

/** 旧候选仅保存 job:index；支持恢复但绝不以候选字符串伪造 musicId。 */
export function parseSongOperationSourceReference(source: SongOperationSourceReference) {
  const legacy = source.candidateId?.match(/^(.+):(\d+)$/);
  const jobIds = [source.jobId, source.sourceJobId, source.musicJobId, legacy?.[1]].filter((id): id is string => Boolean(id));
  const jobId = jobIds[0];
  const variantIndex = source.variantIndex ?? (legacy ? Number(legacy[2]) : undefined);
  if (!jobId || jobIds.some(id => id !== jobId) || !Number.isSafeInteger(variantIndex) || Number(variantIndex) < 0)
    throw invalidSource();
  if (legacy && source.variantIndex !== undefined && Number(legacy[2]) !== source.variantIndex)
    throw invalidSource();
  return { jobId, variantIndex: variantIndex as number };
}

/** 只能消费本人已完成原任务的永久回执；不读取签名 URL，也不发模型请求。 */
export async function resolveSongOperationSource(
  userId: string | number,
  source: SongOperationSourceReference,
  options: { requireMusicId?: boolean } = {}
): Promise<ResolvedSongOperationSource> {
  const identity = parseSongOperationSourceReference(source);
  const job = await getJobByIdStrict(identity.jobId);
  if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "原歌曲任务不存在，请恢复原任务" });
  if (String(job.userId) !== String(userId))
    throw new TRPCError({ code: "FORBIDDEN", message: "无权使用此歌曲" });
  if (job.type !== "audio" || record(job.input)?.action !== "manhua_bgm_v55")
    throw new TRPCError({ code: "BAD_REQUEST", message: "原任务不是可用的歌曲任务" });
  if (job.status !== "succeeded")
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "原歌曲尚未完成，请先恢复原任务" });
  const output = record(job.output);
  const terminal = record(output?.terminalOutput) ?? output;
  const matches = Array.isArray(terminal?.variants)
    ? terminal.variants.map(record).filter(variant => variant?.index === identity.variantIndex)
    : [];
  if (matches.length !== 1)
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "原歌曲版本回执不完整，请恢复原任务" });
  const variant = matches[0]!;
  const gcsUri = text(variant.gcsUri);
  if (!/^gs:\/\/[^/]+\/.+/.test(gcsUri) || !Number.isFinite(Number(variant.bytes)) || Number(variant.bytes) <= 0)
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "原歌曲尚未永久保存，请恢复原任务" });
  if (source.gcsUri && source.gcsUri !== gcsUri) throw invalidSource();
  const musicId = text(variant.musicId) || undefined;
  if (options.requireMusicId && !musicId)
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "此旧歌曲缺少原始歌曲身份，不能执行该操作；可使用音频参考功能" });
  const duration = Number(variant.durationSec);
  return {
    ...identity,
    gcsUri,
    ...(musicId ? { musicId } : {}),
    ...(text(terminal?.upstreamTaskId) ? { providerTaskId: text(terminal?.upstreamTaskId) } : {}),
    ...(Number.isFinite(duration) && duration > 0 ? { durationSec: duration } : {}),
  };
}
