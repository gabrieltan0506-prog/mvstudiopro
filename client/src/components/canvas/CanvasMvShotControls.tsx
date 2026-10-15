import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { resolveCanvasMaterialUrl } from "@/lib/omniCanvasApi";
import type { CanvasBlock } from "@/lib/canvasTypes";
import { MUSIC_MV_SHOT_LABELS } from "@shared/canvasMusicMv";

/** 先准备并试听精确唱段，再由原视频按钮生成；裁段不会提交任何视频模型。 */
export function CanvasMvShotControls({
  block,
  onPatch,
}: {
  block: CanvasBlock;
  onPatch: (patch: Partial<CanvasBlock>) => void;
}) {
  const binding = block.musicMvShot;
  const prepare = trpc.canvasMusicMv.prepareSinging.useMutation({
    retry: false,
  });
  const utils = trpc.useUtils();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const patchRef = useRef(onPatch);
  patchRef.current = onPatch;
  const current = useRef(block);
  current.current = block;
  const lock = useRef(false);
  const [preview, setPreview] = useState("");
  useEffect(() => {
    let stopped = false;
    setPreview("");
    if (binding?.singingAudio)
      void resolveCanvasMaterialUrl(binding.singingAudio.gcsUri)
        .then(url => {
          if (!stopped) setPreview(url);
        })
        .catch(() => {
          if (!stopped) setError("唱段试听地址暂不可用，请稍后重试");
        });
    return () => {
      stopped = true;
    };
  }, [binding?.singingAudio?.gcsUri]);
  useEffect(() => {
    if (!binding?.singingJobId || binding.singingAudio) return;
    let stopped = false;
    let terminal = false;
    let checking = false;
    const jobId = binding.singingJobId;
    const check = async () => {
      if (stopped || terminal || checking) return;
      checking = true;
      try {
        const job = await utils.mvAnalysis.getPostProdJob.fetch({ jobId });
        const now = current.current.musicMvShot;
        if (stopped || !now || now.singingJobId !== jobId) return;
        if (!job) throw new Error("唱段任务暂不可读取，请稍后恢复原任务");
        if (job.status === "failed" || job.status === "cancelled") {
          setError(job.error || "唱段准备失败，原任务保留");
          setStatus("准备失败");
          terminal = true;
          return;
        }
        if (job.status !== "succeeded") {
          setStatus("唱段准备中");
          return;
        }
        const output = job.output as
          | {
              gcsUri?: string;
              durationSec?: number;
              sourceStartSec?: number;
              sourceEndSec?: number;
            }
          | undefined;
        if (
          !output?.gcsUri ||
          !Number.isFinite(output.durationSec) ||
          Math.abs(Number(output.durationSec) - (now.endSec - now.startSec)) >
            0.03 ||
          output.sourceStartSec !== now.startSec ||
          output.sourceEndSec !== now.endSec
        )
          throw new Error("唱段回执与镜头秒窗不一致，未绑定");
        terminal = true;
        patchRef.current({
          musicMvShot: {
            ...now,
            singingAudio: {
              jobId,
              gcsUri: output.gcsUri,
              startSec: now.startSec,
              endSec: now.endSec,
            },
          },
        });
        setStatus("唱段已就绪，请试听后生成");
      } catch (e) {
        if (!stopped)
          setError(e instanceof Error ? e.message : "唱段查询失败，原任务保留");
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [binding?.singingJobId, binding?.singingAudio, utils]);
  if (!binding) return null;
  return (
    <section
      aria-label="MV镜头制作"
      className="space-y-1 rounded border border-cyan-300/20 p-2 text-xs"
    >
      <strong>
        {MUSIC_MV_SHOT_LABELS[binding.kind || "generated"]} · 歌曲{" "}
        {binding.startSec}–{binding.endSec}秒
      </strong>
      {binding.kind === "footage" && binding.sourceClip && (
        <p>
          采用已有素材 {binding.sourceClip.sourceStartSec}–
          {binding.sourceClip.sourceStartSec +
            binding.endSec -
            binding.startSec}
          秒，合成时精确裁切，原视频保留。
        </p>
      )}
      {binding.kind === "singing" && (
        <>
          <p>
            先裁出本镜演唱音频，再试听并生成。人物外观使用本镜参考图；实际口型效果生成后审片。
          </p>
          <button
            type="button"
            disabled={prepare.isPending || Boolean(binding.singingAudio)}
            className="rounded border px-2 py-1 disabled:opacity-40"
            onClick={async () => {
              if (lock.current) return;
              lock.current = true;
              setError("");
              try {
                const requestId =
                  (status === "准备失败" ? undefined : binding.singingRequestId) || crypto.randomUUID();
                onPatch({
                  musicMvShot: { ...binding, singingRequestId: requestId,
                    singingJobId: status === "准备失败" ? undefined : binding.singingJobId,
                    singingHistory: status === "准备失败" && binding.singingRequestId && binding.singingJobId ? [...(binding.singingHistory || []),{requestId:binding.singingRequestId,jobId:binding.singingJobId}] : binding.singingHistory },
                });
                setStatus("唱段准备中");
                const result = await prepare.mutateAsync({
                  requestId,
                  planRequestId: binding.planRequestId,
                  shotId: binding.shotId,
                });
                const now = current.current.musicMvShot;
                if (
                  now?.planRequestId !== binding.planRequestId ||
                  now.shotId !== binding.shotId
                )
                  return;
                onPatch({
                  musicMvShot: {
                    ...now,
                    singingRequestId: requestId,
                    singingJobId: result.jobId,
                  },
                });
                setStatus("唱段准备中");
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "唱段准备未确认，请用原编号恢复"
                );
              } finally {
                lock.current = false;
              }
            }}
          >
            {status === "准备失败" ? "原裁段已失败，重新准备唱段" : binding.singingRequestId
              ? "查询／恢复原唱段准备"
              : "准备并试听本镜唱段（不生成视频）"}
          </button>
          {preview && <audio controls src={preview} className="w-full" />}
          {status && <p role="status">{status}</p>}
          {error && (
            <p role="alert" className="text-amber-200">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
