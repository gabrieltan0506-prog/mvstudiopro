import { useEffect, useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import type { CodeMotionProject } from "@shared/codeMotion";
import { trpc } from "@/lib/trpc";

type Prepared = inferRouterOutputs<AppRouter>["codeMotion"]["imagePrepare"];
type Adopted = inferRouterOutputs<AppRouter>["codeMotion"]["imageAdopt"];
export default function CodeMotionImageProduction({
  project,
  disabled,
  save,
  adopt,
  execute,
}: {
  project: CodeMotionProject;
  disabled: boolean;
  save(): Promise<{ generation: string }>;
  adopt(source: Adopted): Promise<void>;
  execute(action: () => Promise<void>): Promise<void>;
}) {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const lock = useRef(false),
    mounted = useRef(true);
  const projectId = project.id;
  const prepare = trpc.codeMotion.imagePrepare.useMutation();
  const submit = trpc.codeMotion.imageSubmit.useMutation();
  const analyze = trpc.codeMotion.imageAnalyze.useMutation();
  const useImage = trpc.codeMotion.imageAdopt.useMutation();
  const batches = trpc.codeMotion.imageList.useQuery(
    { projectId },
    {
      enabled: !disabled,
      retry: false,
      refetchInterval: q =>
        q.state.data?.some(b =>
          b.shots.some(s => ["queued", "running"].includes(s.status))
        )
          ? 4000
          : false,
    }
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const projectContent = JSON.stringify(project);
  useEffect(() => {
    setPrepared(null);
  }, [projectContent]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      await execute(action);
    } catch (error) {
      if (mounted.current)
        setMessage(
          error instanceof Error ? error.message : "本次未完成，请恢复原批次"
        );
    } finally {
      if (mounted.current) {
        await batches.refetch();
        setBusy(false);
      }
      lock.current = false;
    }
  }
  const needsSemantic =
    !batches.data?.some(b => b.grantId === prepared?.grantId) &&
    !!prepared?.shots.some(
      s =>
        s.preflight?.images.length &&
        s.preflight.semanticAssessment === "not_performed"
    );
  const button =
    "rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:opacity-50";
  return (
    <section
      className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4"
      aria-label="制作场景图"
    >
      <h3 className="font-medium">制作场景图</h3>
      <p className="text-xs text-stone-600">
        依已保存的 4–6
        个画面制作场景图。先核对本次内容和积分，生成后逐张预览、采用；关闭页面后可恢复同一批次。
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          className={button}
          disabled={
            disabled ||
            busy ||
            !project.plan ||
            batches.isLoading ||
            !!batches.error
          }
          onClick={() =>
            void run(async () => {
              const saved = await save();
              const result = await prepare.mutateAsync({
                projectId,
                expectedGeneration: saved.generation,
              });
              if (mounted.current) setPrepared(result);
            })
          }
        >
          保存并查看场景图内容
        </button>
        <button
          className={button}
          disabled={busy}
          onClick={() => void batches.refetch()}
        >
          刷新已有场景图
        </button>
      </div>
      {message && (
        <p role="alert" className="text-sm text-red-700">
          {message}
        </p>
      )}
      {batches.error && (
        <p role="alert" className="text-sm text-red-700">
          {batches.error.message}
        </p>
      )}
      {prepared && (
        <div className="space-y-3 rounded-lg border border-orange-200 bg-orange-50 p-3">
          <p className="text-sm font-medium">
            本次 {prepared.shots.length} 张 ·{" "}
            {prepared.tier === "free" ? "免费体验" : "精细制作"} · 合计{" "}
            {prepared.credits} 积分
          </p>
          <p className="text-xs text-stone-600">
            {prepared.tier === "free"
              ? "每个账号一次，确认核对或生成后绑定本作品；刷新和恢复不会新开任务。"
              : "沿用现有图片积分规则，仅提交尚未开始的固定任务。"}
          </p>
          <ol className="space-y-3">
            {prepared.shots.map(s => (
              <li key={s.requestId}>
                <strong className="text-sm">{s.name}</strong>
                {s.preflight && (
                  <p className="text-xs text-stone-600">
                    {s.mode === "edit"
                      ? `原图需一次重绘（${s.referenceImageUrls?.length || 0}张参考）`
                      : s.mode === "reuse"
                        ? "原图尺寸与画幅可用，沿用原素材，不新增生成"
                        : "此镜尚无原图，生成场景图"}
                    。{s.preflight.reasons.join("；")}{" "}
                    {s.preflight.semanticAssessment === "not_performed"
                      ? "已检查文件尺寸与画幅；尚未进行语义内容冲突分析。"
                      : s.preflight.semanticAssessment === "uncertain"
                        ? "语义核对不确定，请人工核对，不据此自动重绘。"
                        : `Gemini 3.8 Flash 已核对实际素材：${s.preflight.semanticAssessment === "conflict" ? "发现明确冲突" : "未发现明确冲突"}。`}
                    {s.preflight.semanticFinding &&
                      ` ${s.preflight.semanticFinding.observations.map(o => o.observation).join("；")}`}
                    {s.preflight.semanticLimitations &&
                      ` 核对限制：${s.preflight.semanticLimitations}`}
                  </p>
                )}
                <p className="whitespace-pre-wrap text-xs leading-5 text-stone-700">
                  {s.prompt}
                </p>
              </li>
            ))}
          </ol>
          {needsSemantic && (
            <div className="space-y-2 text-xs text-stone-600">
              <p>
                核对范围：本作品 {project.brief.images.length}{" "}
                张原图、已采用原声音窗及参考影片，与已保存的文稿和镜头需求。每个制作授权仅核对一次，包含在本次制作中；有明确证据才建议一次重绘，分析后先展示修改内容。
              </p>
              <button
                className={button}
                disabled={disabled || busy}
                onClick={() =>
                  void run(async () => {
                    const result = await analyze.mutateAsync({
                      projectId,
                      expectedGeneration: prepared.generation,
                      grantId: prepared.grantId,
                    });
                    if (mounted.current) setPrepared(result);
                  })
                }
              >
                确认核对原图与音画需求
              </button>
            </div>
          )}
          <button
            className={button}
            disabled={disabled || busy || needsSemantic}
            onClick={() =>
              void run(async () => {
                const result = await submit.mutateAsync({
                  projectId,
                  expectedGeneration: prepared.generation,
                  grantId: prepared.grantId,
                  fingerprint: prepared.fingerprint,
                });
                if (mounted.current) {
                  setPrepared(null);
                  if (Object.keys(result.enqueueErrors).length)
                    setMessage(
                      "部分图片尚未开始，可从下方继续原批次；已提交任务不会重复购买。"
                    );
                }
              })
            }
          >
            生成这组场景图（{prepared.credits} 积分）
          </button>
        </div>
      )}
      {batches.data?.map(batch => (
        <article
          key={batch.grantId}
          className="space-y-3 rounded-lg border bg-white p-3"
        >
          <p className="text-xs text-stone-500">
            {new Date(batch.createdAt).toLocaleString()} · {batch.shots.length}{" "}
            张 · {batch.tier === "free" ? "免费体验" : "精细制作"}
          </p>
          {batch.shots.some(s => s.canResume) && (
            <button
              className={button}
              disabled={disabled || busy}
              onClick={() =>
                void run(async () => {
                  await submit.mutateAsync({
                    projectId,
                    expectedGeneration: batch.generation,
                    grantId: batch.grantId,
                    fingerprint: batch.fingerprint,
                  });
                })
              }
            >
              继续原批次尚未开始的图片
            </button>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {batch.shots.map(shot => (
              <div key={shot.jobId} className="space-y-2 rounded-lg border p-3">
                <p className="text-sm font-medium">{shot.name}</p>
                <p className="text-xs text-stone-600">
                  {shot.status === "reused"
                    ? "沿用原素材，未新增模型调用"
                    : shot.status === "succeeded"
                      ? "已生成，请预览后采用"
                      : shot.status === "queued"
                        ? "排队中"
                        : shot.status === "running"
                          ? "生成中"
                          : shot.status === "not_started"
                            ? "已保存，尚未开始"
                            : shot.error || "结果待核对，不会自动重复生成"}
                </p>
                {shot.previewUrl && (
                  <a href={shot.previewUrl} target="_blank" rel="noreferrer">
                    <img
                      src={shot.previewUrl}
                      alt={shot.name}
                      className="max-h-56 w-full rounded object-contain"
                    />
                  </a>
                )}
                {shot.status === "succeeded" && (
                  <button
                    className={button}
                    disabled={disabled || busy}
                    onClick={() =>
                      void run(async () => {
                        await save();
                        const source = await useImage.mutateAsync({
                          projectId,
                          grantId: batch.grantId,
                          index: shot.index,
                        });
                        if (!mounted.current) return;
                        await adopt(source);
                      })
                    }
                  >
                    {project.brief.images.some(i => i.id === shot.requestId)
                      ? "已采用 · 重新采用"
                      : "采用到本镜"}
                  </button>
                )}
                <details className="text-xs text-stone-500">
                  <summary>本次内容与任务</summary>
                  <p className="mt-2 whitespace-pre-wrap">{shot.prompt}</p>
                  <p className="mt-2 break-all">任务 {shot.jobId}</p>
                </details>
              </div>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}
