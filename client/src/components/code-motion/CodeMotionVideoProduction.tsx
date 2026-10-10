import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { gcsTransferUrl } from "@/lib/gcsTransfer";
import type { CodeMotionProject } from "@shared/codeMotion";
import type { CodeMotionVideo } from "@shared/codeMotionVideo";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
type Prepared =
  inferRouterOutputs<AppRouter>["codeMotionProduction"]["prepare"];
export default function CodeMotionVideoProduction({
  project,
  disabled,
  save,
  adopt,
  execute,
}: {
  project: CodeMotionProject;
  disabled: boolean;
  save(): Promise<{ generation: string }>;
  adopt(value: {
    asset: CodeMotionVideo["assets"][number];
    clip: CodeMotionVideo["clips"][number];
  }): Promise<void>;
  execute(action: () => Promise<void>): Promise<void>;
}) {
  const utils = trpc.useUtils(),
    generate = trpc.codeMotionProduction.submit.useMutation(),
    useVideo = trpc.codeMotionProduction.adopt.useMutation();
  const [prepared, setPrepared] = useState<Prepared | null>(null),
    [generation, setGeneration] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false),
    identity = useRef(project.id);
  identity.current = project.id;
  useEffect(() => {
    setPrepared(null);
    setGeneration("");
  }, [JSON.stringify(project)]);
  const videos = trpc.codeMotionProduction.list.useQuery(
    { projectId: project.id },
    {
      enabled: !disabled,
      retry: false,
      refetchInterval: q =>
        q.state.data?.shots.some(s =>
          [
            "queued",
            "creating",
            "running",
            "timed_out_pending_reconcile",
          ].includes(s.status)
        )
          ? 4000
          : false,
    }
  );
  const images = trpc.codeMotion.resolveImages.useQuery(
    { images: project.brief.images },
    { enabled: !disabled && project.brief.images.length > 0, retry: false }
  );
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      await execute(action);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "本次未完成，请核对原任务"
      );
    } finally {
      await videos.refetch();
      lock.current = false;
      setBusy(false);
    }
  }
  async function inspect() {
    const id = project.id;
    const saved = await save();
    const result = await utils.codeMotionProduction.prepare.fetch({
      projectId: id,
      expectedGeneration: saved.generation,
    });
    if (identity.current !== id) return;
    setGeneration(saved.generation);
    setPrepared(result);
  }
  const button =
    "rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:opacity-50";
  const active = videos.data?.shots.some(s =>
    [
      "queued",
      "creating",
      "running",
      "timed_out_pending_reconcile",
      "reconcile_manual",
    ].includes(s.status)
  );
  return (
    <section
      className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4"
      aria-label="制作动作镜头"
    >
      <h3 className="font-medium">制作动作镜头</h3>
      <p className="text-xs text-stone-600">
        按分镜内容安排代码画面或短动作镜头。已采用的旁白和配乐会裁成对应镜头的参考音，最终成片沿用完整声轨。
      </p>
      <button
        className={button}
        disabled={disabled || busy || !project.plan}
        onClick={() => void run(inspect)}
      >
        查看本次动作安排
      </button>
      {prepared && (
        <div className="space-y-3">
          {!prepared.shots.length ? (
            <p className="text-sm">本作品使用代码画面，可直接预览和导出。</p>
          ) : (
            <>
              <p className="text-sm">
                {prepared.tier === "free"
                  ? "本作品使用免费制作名额"
                  : "本次按现有积分规则结算"}{" "}
                · 本批动作镜头 {prepared.totalCredits} 积分
              </p>
              {prepared.shots.map(shot => {
                const image = project.brief.images.find(i =>
                  shot.imageUrls.includes(i.gcsUri)
                );
                const preview = images.data?.find(i => i.id === image?.id);
                return (
                  <div
                    key={shot.sceneIndex}
                    className="rounded-lg border bg-white p-3 text-sm"
                  >
                    <p className="font-medium">
                      画面 {shot.sceneIndex + 1} · {shot.at}–
                      {shot.at + shot.duration} 秒 · {shot.resolution}
                    </p>
                    {preview && (
                      <img
                        src={gcsTransferUrl(preview.url)}
                        alt={`画面${shot.sceneIndex + 1}参考图`}
                        className="my-2 max-h-40 rounded object-contain"
                      />
                    )}
                    {prepared.videoPreviews?.find(
                      p => p.sceneIndex === shot.sceneIndex
                    ) && (
                      <video
                        controls
                        aria-label={`画面${shot.sceneIndex + 1}编辑原片`}
                        src={gcsTransferUrl(
                          prepared.videoPreviews.find(
                            p => p.sceneIndex === shot.sceneIndex
                          )!.url
                        )}
                        className="my-2 max-h-40 rounded"
                      />
                    )}
                    <p className="whitespace-pre-wrap">{shot.prompt}</p>
                    <p className="mt-1 text-xs text-stone-600">
                      {shot.model} ·{" "}
                      {shot.mode === "video_edit"
                        ? "原片编辑"
                        : shot.editSource
                          ? "参考原片修改"
                          : shot.mode === "reference_to_video"
                            ? "多模态参考生成"
                            : "图片生成动作"}{" "}
                      · 图片 {shot.imageUrls.length} / 视频{" "}
                      {shot.videoUrls.length} / 音源 {shot.audioUrls.length}
                      {shot.audioUrls.length
                        ? `（混为本镜 ${shot.duration} 秒参考音）`
                        : ""}
                    </p>
                    {shot.missing.map((text, index) => (
                      <p key={index} className="mt-1 text-amber-800">
                        {text}
                      </p>
                    ))}
                  </div>
                );
              })}
              <button
                className={button}
                disabled={
                  disabled ||
                  busy ||
                  !!active ||
                  prepared.shots.some(s => s.missing.length > 0)
                }
                onClick={() =>
                  void run(async () => {
                    await generate.mutateAsync({
                      projectId: project.id,
                      expectedGeneration: generation,
                      confirmedFingerprint: prepared.fingerprint,
                    });
                    setPrepared(null);
                  })
                }
              >
                按上述安排生成动作镜头
              </button>
            </>
          )}
        </div>
      )}
      <button
        className={button}
        disabled={disabled || busy}
        onClick={() => void videos.refetch()}
      >
        恢复原任务进度
      </button>
      {videos.error && (
        <p role="alert" className="text-sm text-red-700">
          {videos.error.message}
        </p>
      )}
      {videos.data?.shots.map(shot => (
        <div
          key={shot.sceneIndex}
          className="space-y-2 rounded-lg border bg-white p-3"
        >
          <p className="text-sm">
            画面 {shot.sceneIndex + 1} · {shot.status}
            {shot.taskId ? ` · ${shot.taskId}` : ""}
          </p>
          {shot.videoUrl && (
            <video
              controls
              preload="metadata"
              src={gcsTransferUrl(shot.videoUrl)}
              className="max-h-64 w-full rounded"
            />
          )}
          {shot.costStatus === "pending_cost" && <p role="status" className="text-sm text-amber-800">产物已保留，可采用和渲染。实际工具用量超过确认上限，费用待核对；未追加扣款。</p>}
          {shot.costStatus === "settled" && <p className="text-xs">实际用量结算 {shot.settledCredits} 积分，已原路退回差额 {shot.creditsRefunded} 积分。</p>}
          {shot.error && (
            <p role="alert" className="text-sm text-red-700">
              {shot.error}
            </p>
          )}
          {shot.status === "succeeded" && (
            <button
              className={button}
              disabled={disabled || busy}
              onClick={() =>
                void run(async () => {
                  const id = project.id;
                  const result = await useVideo.mutateAsync({
                    projectId: id,
                    sceneIndex: shot.sceneIndex,
                  });
                  if (identity.current === id) await adopt(result);
                })
              }
            >
              采用画面 {shot.sceneIndex + 1}
            </button>
          )}
        </div>
      ))}
      {message && (
        <p role="alert" className="text-sm text-red-700">
          {message}
        </p>
      )}
    </section>
  );
}
