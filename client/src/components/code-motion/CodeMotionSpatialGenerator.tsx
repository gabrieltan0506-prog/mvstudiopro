import { useEffect, useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { trpc } from "@/lib/trpc";
import { gcsTransferUrl } from "@/lib/gcsTransfer";
import type { CodeMotionProject } from "@shared/codeMotion";
import type { CodeMotionSpatialProductionInput } from "@shared/codeMotionSpatialProduction";
import { CODE_MOTION_3D_COST_NOTICE } from "@shared/codeMotionSpatialProduction";

type Output = inferRouterOutputs<AppRouter>["codeMotionProduction"];
const statusLabel = (value?: string) =>
  ({
    queued: "排队中",
    creating: "提交中",
    running: "生成中",
    succeeded: "已归档",
    failed: "失败",
    timed_out_pending_reconcile: "正在核对原任务",
    reconcile_manual: "需要核对原回执",
  })[value || ""] ||
  value ||
  "尚无任务回执";
const running = (value?: string) =>
  ["queued", "creating", "running", "timed_out_pending_reconcile"].includes(
    value || ""
  );

export function CodeMotionSpatialGenerator({
  project,
  disabled,
  available,
  save,
  execute,
  onAdopt,
}: {
  project: CodeMotionProject;
  disabled: boolean;
  available: boolean;
  save(): Promise<{ generation: string }>;
  execute(action: () => Promise<void>): Promise<void>;
  onAdopt(value: Output["spatialAdopt"]): Promise<void>;
}) {
  const [worldImageId, setWorldImageId] = useState("");
  const [actorImageIds, setActorImageIds] = useState<string[]>([]);
  const [worldPrompt, setWorldPrompt] = useState("");
  const [prepared, setPrepared] = useState<{
    input: CodeMotionSpatialProductionInput;
    value: Output["spatialPrepare"];
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const lock = useRef(false),
    identity = useRef(project.id);
  identity.current = project.id;
  const prepare = trpc.codeMotionProduction.spatialPrepare.useMutation();
  const submit = trpc.codeMotionProduction.spatialSubmit.useMutation();
  const adopt = trpc.codeMotionProduction.spatialAdopt.useMutation();
  const tasks = trpc.codeMotionProduction.spatialStatus.useQuery(
    { projectId: project.id },
    {
      enabled: available && !disabled,
      retry: false,
      refetchInterval: query => {
        const value = query.state.data;
        return value &&
          (running(value.world?.status) ||
            value.actors.some(a => running(a.task?.status)))
          ? 5000
          : false;
      },
    }
  );
  useEffect(() => {
    setPrepared(null);
  }, [
    worldImageId,
    actorImageIds.join(","),
    worldPrompt,
    project.brief.generationTier,
    JSON.stringify(project.brief.images),
  ]);
  useEffect(() => {
    if (!tasks.data) return;
    setWorldImageId(tasks.data.worldSource.id);
    setActorImageIds(tasks.data.actors.map(a => a.source.id));
    setWorldPrompt(tasks.data.worldPrompt);
  }, [tasks.data?.fingerprint]);
  async function run(action: (projectId: string) => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    const id = project.id;
    try {
      await execute(async () => {
        try {
          await action(id);
        } catch (error) {
          setMessage(
            error instanceof Error ? error.message : "本次未完成，请查询原任务"
          );
          throw error;
        }
      });
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "本次未完成，请查询原任务"
      );
    } finally {
      if (identity.current === id) void tasks.refetch();
      lock.current = false;
      setBusy(false);
    }
  }
  function check(id: string) {
    if (identity.current !== id)
      throw Error("已切换作品，3D任务保留在原作品中");
  }
  const blocked = disabled || busy;
  const lockedInput = blocked || Boolean(tasks.data);
  const paid = available && project.brief.generationTier !== "free";
  const button =
    "rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:opacity-50";
  return (
    <div
      id="ink-spatial-production"
      aria-label="网页生成三维资产"
      className="space-y-3 rounded-lg border border-stone-300 bg-white p-4"
    >
      <h4 className="font-medium">从参考图生成三维资产</h4>
      <p className="text-xs text-stone-600">
        本作品支持一个场景、最多四个人物。先在上方生成或上传并采用参考图，再核对本次安排；生成后在本页选视角，交给下方视频模型。
      </p>
      {!available && (
        <p className="text-sm text-amber-800">
          当前账号尚未开放三维生成；可以导入已有资产。原有账号权限不变。
        </p>
      )}
      {available && (
        <>
          {!paid && (
            <p className="text-sm text-amber-800">
              三维生成使用原有付费服务，请在上方“生成方案”选择付费生成；免费名额不包含三维资产。
            </p>
          )}
          <label className="block text-sm">
            场景参考图{" "}
            <select
              aria-label="生成三维场景的参考图"
              className={button}
              disabled={lockedInput || !paid}
              value={worldImageId}
              onChange={e => setWorldImageId(e.target.value)}
            >
              <option value="">选择本作品已采用的场景图</option>
              {project.brief.images.map(image => (
                <option key={image.id} value={image.id}>
                  {image.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset
            disabled={lockedInput || !paid}
            className="space-y-2 text-sm"
          >
            <legend>人物参考图（每人选择一张，最多四人）</legend>
            {project.brief.images.map(image => (
              <label
                key={image.id}
                className="mr-4 inline-flex items-center gap-2"
              >
                <input
                  type="checkbox"
                  checked={actorImageIds.includes(image.id)}
                  disabled={
                    !actorImageIds.includes(image.id) &&
                    actorImageIds.length >= 4
                  }
                  onChange={e =>
                    setActorImageIds(old =>
                      e.target.checked
                        ? [...old, image.id]
                        : old.filter(id => id !== image.id)
                    )
                  }
                />
                {image.name}
              </label>
            ))}
          </fieldset>
          <label className="block text-sm">
            场景空间与风格要求
            <textarea
              aria-label="三维场景生成要求"
              className="mt-1 block min-h-24 w-full rounded border p-2"
              maxLength={2000}
              value={worldPrompt}
              disabled={lockedInput || !paid}
              onChange={e => setWorldPrompt(e.target.value)}
              placeholder="说明空间布局、材质、光线与需要保留的场景特征"
            />
          </label>
          <p className="text-xs text-stone-600">{CODE_MOTION_3D_COST_NOTICE}</p>
          {(!tasks.data || tasks.data.needsResume) && (
            <button
              className={button}
              disabled={
                blocked ||
                !paid ||
                !worldImageId ||
                !actorImageIds.length ||
                worldPrompt.trim().length < 2
              }
              onClick={() =>
                void run(async id => {
                  const saved = await save();
                  check(id);
                  const input = {
                    projectId: id,
                    expectedGeneration: saved.generation,
                    worldImageId,
                    actorImageIds,
                    worldPrompt,
                  };
                  const value = await prepare.mutateAsync(input);
                  check(id);
                  setPrepared({ input, value });
                })
              }
            >
              {tasks.data
                ? "查看原批次并恢复未收回执的任务"
                : "查看本次三维生成内容与费用说明"}
            </button>
          )}
          {prepared && (
            <div
              aria-label="三维生成前确认"
              className="space-y-3 rounded-lg border border-amber-300 p-3"
            >
              <p className="font-medium">
                本次：1个场景 + {prepared.value.actors.length}个人物
              </p>
              <div className="flex flex-wrap gap-3">
                <figure>
                  <img
                    className="h-32 w-40 rounded object-contain"
                    src={gcsTransferUrl(prepared.value.worldPreview)}
                    alt={`场景参考：${prepared.value.world.name}`}
                  />
                  <figcaption className="text-xs">
                    场景：{prepared.value.world.name}
                  </figcaption>
                </figure>
                {prepared.value.actorPreviews.map(actor => (
                  <figure key={actor.id}>
                    <img
                      className="h-32 w-28 rounded object-contain"
                      src={gcsTransferUrl(actor.url)}
                      alt={`人物参考：${actor.name}`}
                    />
                    <figcaption className="text-xs">
                      人物：{actor.name}
                    </figcaption>
                  </figure>
                ))}
              </div>
              <p className="whitespace-pre-wrap text-sm">
                {prepared.value.worldPrompt}
              </p>
              <p className="text-xs">
                场景：Marble
                1.1，图片生成空间、自动判断全景。人物：Tripo，精细几何与材质、PBR、保持原图纹理和朝向。
              </p>
              <p className="text-xs text-amber-900">
                {prepared.value.costNotice}
              </p>
              <button
                className={button}
                disabled={blocked}
                onClick={() =>
                  void run(async id => {
                    check(id);
                    await submit.mutateAsync({
                      request: prepared.input,
                      confirmedFingerprint: prepared.value.fingerprint,
                    });
                    check(id);
                    setPrepared(null);
                    setMessage(
                      "已记录本次三维任务，下方显示真实进度。刷新后可恢复原任务。"
                    );
                  })
                }
              >
                {tasks.data
                  ? "确认恢复原批次，不重新购买已有任务"
                  : "确认上述参考与费用，生成三维资产"}
              </button>
            </div>
          )}
          {tasks.data && (
            <div className="space-y-2 text-sm" aria-label="三维任务与恢复">
              <p>
                场景「{tasks.data.worldSource.name}」：
                {statusLabel(tasks.data.world?.status)}
                {tasks.data.world?.errorZh
                  ? ` · ${tasks.data.world.errorZh}`
                  : ""}
              </p>
              {tasks.data.actors.map(actor => (
                <p key={actor.source.id}>
                  人物「{actor.source.name}」：{statusLabel(actor.task?.status)}
                  {actor.task?.errorZh ? ` · ${actor.task.errorZh}` : ""}
                </p>
              ))}
              <button
                className={button}
                disabled={blocked}
                onClick={() => void tasks.refetch()}
              >
                查询原任务
              </button>
              <button
                className={`${button} ml-2`}
                disabled={blocked || !tasks.data.ready}
                onClick={() =>
                  void run(async id => {
                    const value = await adopt.mutateAsync({ projectId: id });
                    check(id);
                    await onAdopt(value);
                    setMessage(
                      `已采用1个场景和${value.actorIds.length}个人物，真实空间比例已回填。请在下方检查站位并选择参考视角。`
                    );
                  })
                }
              >
                采用三维资产并设置参考视角
              </button>
            </div>
          )}
          {tasks.error && (
            <p role="alert" className="text-sm text-red-700">
              {tasks.error.message}
            </p>
          )}
        </>
      )}
      {message && (
        <p role="status" className="text-sm text-orange-800">
          {message}
        </p>
      )}
    </div>
  );
}
