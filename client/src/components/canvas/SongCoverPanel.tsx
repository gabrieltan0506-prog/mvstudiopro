import { creativeUserText } from "@/lib/creativeUserText";
import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { getJob } from "@/lib/jobs";
import type { SongCoverReceipt } from "@shared/songCover";
/** 刷新后继续原封面任务；网络错误只对账同一ID，失败终态不重买。 */
export function SongCoverPanel({
  records,
  onUpdate,
}: {
  records: SongCoverReceipt[];
  onUpdate: (musicJobId: string, patch: Partial<SongCoverReceipt>) => void;
}) {
  const utils = trpc.useUtils();
  const queue = trpc.canvasMusicMv.queueSongCover.useMutation();
  const latest = useRef({ records, onUpdate, utils, queue });
  latest.current = { records, onUpdate, utils, queue };
  useEffect(() => {
    let alive = true,
      busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        for (const row of latest.current.records) {
          if (!alive) return;
          if (row.status === "succeeded" || row.status === "failed") continue;
          const update = (delta: Partial<SongCoverReceipt>) => {
            if (alive) latest.current.onUpdate(row.musicJobId, delta);
          };
          try {
            let jobId = row.jobId;
            if (!jobId) {
              const music =
                await latest.current.utils.mvAnalysis.getManhuaBgmJob.fetch({
                  jobId: row.musicJobId,
                });
              if (!alive) return;
              if (music.status === "failed" || music.status === "cancelled") {
                update({ status: "failed", error: "歌曲未成功，封面未生成" });
                continue;
              }
              if (music.status !== "succeeded") continue;
              const created = await latest.current.queue.mutateAsync({
                musicJobId: row.musicJobId,
                prompt: row.prompt,
                aspectRatio: row.aspectRatio,
              });
              jobId = created.jobId;
              update({ jobId, status: "queued", error: undefined });
            }
            const job = await getJob(jobId);
            if (!alive) return;
            if (job.status === "failed") {
              update({
                status: "failed",
                error: job.error || "封面生成失败，原任务保留",
              });
              continue;
            }
            if (job.status === "succeeded") {
              const imageUrl = String(
                job.output?.imageUrl || job.output?.imageUrls?.[0] || ""
              );
              if (!/^https:\/\//.test(imageUrl))
                throw Error("封面已返回但图片地址尚不可用，请查询原任务");
              update({ status: "succeeded", imageUrl, error: undefined });
            } else update({ status: job.status, error: undefined });
          } catch (error) {
            update({
              error:
                error instanceof Error
                  ? error.message
                  : "封面状态暂未确认，保留原任务",
            });
          }
        }
      } finally {
        busy = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 10000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  if (!records.length) return null;
  return (
    <div className="space-y-2">
      {records.map(row => (
        <div
          key={row.musicJobId}
          className="rounded border border-white/15 p-2 text-xs"
        >
          <p>
            {row.aspectRatio === "1:1" ? "专辑封面 · 1:1" : "歌曲封面 · 9:16"} ·
            {" "}
            {
              {
                waiting_music: "等待歌曲完成",
                queued: "排队中",
                running: "生成中",
                succeeded: "已生成",
                failed: "未生成成功",
              }[row.status]
            }
          </p>
          {row.imageUrl && (
            <a href={row.imageUrl} target="_blank" rel="noreferrer">
              <img
                src={row.imageUrl}
                alt="本次歌曲封面"
                className="max-h-64 rounded object-contain"
              />
            </a>
          )}
          {row.error && <p className="text-amber-200">{creativeUserText(row.error)}</p>}
          <details>
            <summary>查看封面提交内容</summary>
            <p>
              歌曲任务：{row.musicJobId}
              {row.jobId ? ` · 封面任务：${row.jobId}` : ""}
            </p>
            <pre className="whitespace-pre-wrap">{row.prompt}</pre>
          </details>
        </div>
      ))}
    </div>
  );
}
