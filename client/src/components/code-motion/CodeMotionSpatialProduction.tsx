import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { gcsTransferUrl } from "@/lib/gcsTransfer";
import { CodeMotionSpatialGenerator } from "./CodeMotionSpatialGenerator";
import { ManhuaWorldStagePreview } from "@/components/canvas/ManhuaWorldStagePreview";
import type { CodeMotionAudioSource } from "@shared/codeMotionAudio";
import type { CodeMotionProject } from "@shared/codeMotion";
import {
  CODE_MOTION_SPATIAL_MAX_BYTES,
  type CodeMotionSpatial,
} from "@shared/codeMotionSpatial";
import type { CodeMotionVideo } from "@shared/codeMotionVideo";

export default function CodeMotionSpatialProduction({
  project,
  disabled,
  threeDAvailable,
  save,
  saveSpatial,
  adopt,
  execute,
}: {
  project: CodeMotionProject;
  disabled: boolean;
  threeDAvailable: boolean;
  save(referenceSceneIndex?: number): Promise<{ generation: string }>;
  saveSpatial(value: CodeMotionSpatial): Promise<void>;
  adopt(value: {
    audioSource?: CodeMotionAudioSource;
    asset: CodeMotionVideo["assets"][number];
    clip: CodeMotionVideo["clips"][number];
  }): Promise<void>;
  execute(action: () => Promise<void>): Promise<void>;
}) {
  const [sceneIndex, setSceneIndex] = useState(0),
    [worldId, setWorldId] = useState("");
  const [referenceImageIds, setReferenceImageIds] = useState<string[]>([]);
  const [actors, setActors] = useState<
    CodeMotionSpatial["frames"][number]["actors"]
  >([]);
  const [scale, setScale] = useState(1),
    [ground, setGround] = useState(0),
    [sourceNote, setSourceNote] = useState("");
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false);
  const lock = useRef(false),
    live = useRef(project);
  live.current = project;
  const identity = useRef(project.id);
  identity.current = project.id;
  const spatial = project.plan?.spatial ?? { assets: [], frames: [] };
  const uploads = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();
  const importAsset =
    trpc.codeMotionProduction.importSpatialAsset.useMutation();
  const importFrame =
    trpc.codeMotionProduction.importSpatialFrame.useMutation();
  const imported = trpc.codeMotionProduction.importedVideos.useQuery(
    { projectId: project.id },
    { enabled: !disabled, retry: false }
  );
  const adoptImported =
    trpc.codeMotionProduction.adoptImportedVideo.useMutation();
  const importVideo =
    trpc.codeMotionProduction.importExistingVideo.useMutation();
  const previews = trpc.codeMotionProduction.spatialPreviews.useQuery(
    { projectId: project.id },
    { enabled: !disabled && spatial.assets.length > 0, retry: false }
  );
  useEffect(() => {
    void previews.refetch();
  }, [JSON.stringify(spatial)]);
  const frame = spatial.frames.find(f => f.sceneIndex === sceneIndex);
  useEffect(() => {
    setPreview(false);
    if (frame) {
      setWorldId(frame.worldId);
      setActors(frame.actors);
      setReferenceImageIds(frame.referenceImageIds || []);
      setScale(frame.metricScaleFactor);
      setGround(frame.groundPlaneOffset);
    }
  }, [sceneIndex, frame?.id]);
  async function run(action: () => Promise<void>, propagate = false) {
    if (lock.current) {
      if (propagate) throw Error("当前已有保存操作，请等待原回执");
      return;
    }
    lock.current = true;
    setBusy(true);
    setMessage("");
    let failure: unknown;
    try {
      await execute(async () => {
        try {
          await action();
        } catch (e) {
          failure = e;
          setMessage(
            e instanceof Error ? e.message : "本次未保存，原作品仍保留"
          );
          throw e;
        }
      });
    } catch (e) {
      failure = e;
      setMessage(e instanceof Error ? e.message : "本次未保存，原作品仍保留");
    } finally {
      void imported.refetch();
      lock.current = false;
      setBusy(false);
    }
    if (failure && propagate) throw failure;
  }
  function check(id: string) {
    if (identity.current !== id)
      throw Error("已切换作品，导入结果保留在原作品");
  }
  async function upload(file: Blob, name: string) {
    setMessage(`正在上传「${name}」…`);
    const mime = file.type || "application/octet-stream";
    const signed = await uploads.mutateAsync({
      fileName: name,
      mimeType: mime,
    });
    const response = await fetch(gcsTransferUrl(signed.uploadUrl), {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": mime, ...signed.requiredHeaders },
      body: file,
    });
    if (!response.ok)
      throw Error(`上传失败（${response.status}），未生成或扣费`);
    setMessage(`「${name}」上传完毕，正在核对与归档…`);
    return signed.gcsUri;
  }
  async function addAsset(file: File) {
    const id = project.id;
    const kind = file.name.split(".").at(-1)?.toLowerCase();
    if (kind !== "glb" && kind !== "spz")
      throw Error("请选择GLB人物或SPZ场景文件");
    if (file.size > CODE_MOTION_SPATIAL_MAX_BYTES)
      throw Error("三维文件不得超过250 MiB");
    const uri = await upload(file, file.name);
    check(id);
    const asset = await importAsset.mutateAsync({
      projectId: id,
      name: file.name,
      kind,
      gcsUri: uri,
    });
    check(id);
    const current = live.current.plan?.spatial ?? { assets: [], frames: [] };
    await saveSpatial({
      ...current,
      assets: [...current.assets.filter(a => a.id !== asset.id), asset],
    });
    if (kind === "spz") setWorldId(asset.id);
    else
      setActors(old =>
        old.some(a => a.assetId === asset.id)
          ? old
          : [
              ...old,
              {
                id: crypto.randomUUID(),
                assetId: asset.id,
                stagePoint: [0, 0] as [number, number],
                heightM: 1.7,
                yawDeg: 0,
              },
            ].slice(0, 8)
      );
    setMessage("已归档已有三维文件，没有购买或生成新资产。");
  }
  const world = previews.data?.assets.find(
    a => a.id === worldId && a.kind === "spz"
  );
  const characters = actors.map(a => {
    const asset = previews.data?.assets.find(
      v => v.id === a.assetId && v.kind === "glb"
    );
    return asset
      ? {
          id: a.id,
          assetRef: a.assetId,
          labelZh: asset.name,
          glbUrl: asset.url,
          stagePoint: a.stagePoint,
          heightM: a.heightM,
          yawDeg: a.yawDeg,
        }
      : null;
  });
  const unsavedFrame = Boolean(
    frame &&
      (worldId !== frame.worldId ||
        scale !== frame.metricScaleFactor ||
        ground !== frame.groundPlaneOffset ||
        JSON.stringify(actors) !== JSON.stringify(frame.actors) ||
        JSON.stringify(referenceImageIds) !==
          JSON.stringify(frame.referenceImageIds || []))
  );
  const blocked = disabled || busy;
  const button =
    "rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:opacity-50";
  return (
    <section
      aria-label="三维参考与已有模型视频"
      className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4"
    >
      <h3 className="font-medium">三维参考 → 模型视频 → 完整影片</h3>
      <p className="text-xs text-stone-600">
        在本页生成三维人物与场景，或导入已有资产；检查站位、选择视角后，把参考帧交给下方视频模型。最终采用模型片段，与代码画面、对白旁白和配乐合成影片。
      </p>
      <CodeMotionSpatialGenerator
        project={project}
        disabled={blocked}
        available={threeDAvailable}
        save={save}
        execute={execute}
        onAdopt={async value => {
          const current = live.current.plan?.spatial ?? {
            assets: [],
            frames: [],
          };
          const merged = new Map(current.assets.map(a => [a.id, a]));
          for (const asset of value.assets) merged.set(asset.id, asset);
          await saveSpatial({
            ...current,
            assets: Array.from(merged.values()),
          });
          setReferenceImageIds(value.referenceImageIds);
          setWorldId(value.worldId);
          setScale(value.metricScaleFactor);
          setGround(value.groundPlaneOffset);
          setActors(
            value.actorIds.map((assetId, i) => ({
              id: crypto.randomUUID(),
              assetId,
              stagePoint: [(i - (value.actorIds.length - 1) / 2) * 1.25, 0],
              heightM: 1.7,
              yawDeg: 0,
            }))
          );
          setPreview(false);
          await previews.refetch();
        }}
      />
      <details>
        <summary className="cursor-pointer text-sm">
          已有三维资产？直接导入，无需再次生成
        </summary>
        <label className="block text-sm">
          1. 导入已有三维资产{" "}
          <input
            type="file"
            accept=".glb,.spz"
            disabled={blocked}
            onChange={e => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void run(() => addAsset(file));
            }}
          />
        </label>
      </details>
      <label className="block text-sm">
        目标画面{" "}
        <select
          aria-label="三维参考目标画面"
          className={button}
          disabled={blocked}
          value={sceneIndex}
          onChange={e => setSceneIndex(Number(e.target.value))}
        >
          {project.plan?.scenes.map((s, i) => (
            <option key={i} value={i}>
              {i + 1}. {s.heading}（{s.duration}秒）
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-3 text-sm">
        <label>
          场景{" "}
          <select
            className={button}
            disabled={blocked}
            value={worldId}
            onChange={e => {
              setWorldId(e.target.value);
              setPreview(false);
            }}
          >
            <option value="">选择已归档SPZ</option>
            {spatial.assets
              .filter(a => a.kind === "spz")
              .map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          添加人物{" "}
          <select
            aria-label="添加三维人物"
            className={button}
            disabled={blocked || actors.length >= 8}
            value=""
            onChange={e => {
              const assetId = e.target.value;
              if (assetId)
                setActors(old => [
                  ...old,
                  {
                    id: crypto.randomUUID(),
                    assetId,
                    stagePoint: [0, 0] as [number, number],
                    heightM: 1.7,
                    yawDeg: 0,
                  },
                ]);
              setPreview(false);
            }}
          >
            <option value="">选择已有GLB</option>
            {spatial.assets
              .filter(a => a.kind === "glb")
              .map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {(
          [
            ["场景比例", scale, setScale],
            ["地面偏移", ground, setGround],
          ] as const
        ).map(([label, value, set]) => (
          <label key={label}>
            {label}
            <input
              aria-label={label}
              className="ml-1 w-20 rounded border p-1"
              type="number"
              step="0.1"
              disabled={blocked}
              value={value}
              onChange={e => {
                set(Number(e.target.value));
                setPreview(false);
              }}
            />
          </label>
        ))}
      </div>
      {actors.map((actor, index) => (
        <div
          key={actor.id}
          className="flex flex-wrap items-center gap-3 rounded border bg-white p-2 text-xs"
        >
          <span>
            人物{index + 1}：
            {spatial.assets.find(a => a.id === actor.assetId)?.name || "待恢复"}
          </span>
          {(
            ["左右（米）", "前后（米）", "身高（米）", "朝向（度）"] as const
          ).map((label, field) => (
            <label key={label}>
              {label}
              <input
                aria-label={`人物${index + 1}${label}`}
                type="number"
                step="0.1"
                className="ml-1 w-20 rounded border p-1"
                disabled={blocked}
                value={
                  field < 2
                    ? actor.stagePoint[field]
                    : field === 2
                      ? actor.heightM
                      : actor.yawDeg
                }
                onChange={e => {
                  const value = Number(e.target.value);
                  setActors(old =>
                    old.map((a, i) =>
                      i !== index
                        ? a
                        : field < 2
                          ? {
                              ...a,
                              stagePoint:
                                field === 0
                                  ? [value, a.stagePoint[1]]
                                  : [a.stagePoint[0], value],
                            }
                          : field === 2
                            ? { ...a, heightM: value }
                            : { ...a, yawDeg: value }
                    )
                  );
                  setPreview(false);
                }}
              />
            </label>
          ))}
          <button
            className={button}
            disabled={blocked}
            onClick={() => {
              setActors(old => old.filter(a => a.id !== actor.id));
              setPreview(false);
            }}
          >
            移出本镜参考
          </button>
        </div>
      ))}
      <fieldset disabled={blocked} className="text-xs">
        <legend>
          一起交给视频模型的人物身份图（生成三维人物后自动选中，可核对）
        </legend>
        {project.brief.images.map(image => (
          <label key={image.id} className="mr-3 inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={referenceImageIds.includes(image.id)}
              onChange={e => {
                setReferenceImageIds(old =>
                  e.target.checked
                    ? [...old, image.id]
                    : old.filter(id => id !== image.id)
                );
                setPreview(false);
              }}
            />
            {image.name}
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-stone-600">
        预览内容：{world?.name || "未选场景"}；{actors.length}个人物；目标为第
        {sceneIndex + 1}
        镜。初始站位和身高供调整，请检查每个人物后保存参考视角。保存时将本镜设为视频模型生成，随后仍须核对并确认生成；浏览器预览不调用模型，场景比例和地面偏移沿用原回执。
      </p>
      <button
        className={button}
        disabled={
          blocked ||
          !world ||
          characters.some(a => !a) ||
          scale <= 0 ||
          actors.some(a => a.heightM <= 0)
        }
        onClick={() => setPreview(true)}
      >
        查看三维参考并选择视角
      </button>
      {preview && world && (
        <div className="rounded-xl bg-slate-900 p-3 text-white">
          <ManhuaWorldStagePreview
            sceneLabelZh={
              project.plan?.scenes[sceneIndex]?.heading || "三维参考"
            }
            world={{
              spz500kUrl: world.url,
              metricScaleFactor: scale,
              groundPlaneOffset: ground,
            }}
            characters={characters.filter((a): a is NonNullable<typeof a> =>
              Boolean(a)
            )}
            onExportStageFrame={async (blob, view) => {
              if (blocked) throw Error("请等待当前保存完成");
              await run(async () => {
                const id = project.id,
                  saved = await save(sceneIndex);
                check(id);
                const gcsUri = await upload(blob, "三维参考.png");
                check(id);
                const record = await importFrame.mutateAsync({
                  projectId: id,
                  expectedGeneration: saved.generation,
                  gcsUri,
                  bytes: blob.size,
                  frame: {
                    sceneIndex,
                    worldId: world.id,
                    referenceImageIds,
                    actors: view.actors.map(a => ({
                      id: a.id,
                      assetId: a.assetRef!,
                      stagePoint: [a.stagePoint[0], a.stagePoint[1]],
                      heightM: a.heightM ?? 1.7,
                      yawDeg: a.yawDeg ?? 0,
                    })),
                    metricScaleFactor: scale,
                    groundPlaneOffset: ground,
                    camera: view.camera,
                    revision: view.revision,
                    viewLabelZh: view.viewLabelZh,
                  },
                });
                check(id);
                const current = live.current.plan?.spatial ?? {
                  assets: [],
                  frames: [],
                };
                await saveSpatial({
                  ...current,
                  frames: [
                    ...current.frames.filter(f => f.sceneIndex !== sceneIndex),
                    record,
                  ],
                });
                setMessage(
                  "参考帧已采用并保存；下方动作安排会展示它与身份图。未提交模型生成。"
                );
              }, true);
            }}
          />
        </div>
      )}
      {unsavedFrame && (
        <p role="status" className="text-sm text-orange-800">
          站位或身份图已有修改，尚未保存新参考帧。下方视频生成仍使用上次已保存的参考；请重新预览并保存视角。
        </p>
      )}
      {frame && (
        <div className="text-sm">
          <p>
            已保存参考：第{sceneIndex + 1}镜 · {frame.viewLabelZh} ·{" "}
            {frame.actors.length}个人物
          </p>
          {previews.data?.frames.find(f => f.id === frame.id)?.url && (
            <img
              className="max-h-56 rounded-lg"
              alt="已采用的三维参考帧"
              src={gcsTransferUrl(
                previews.data.frames.find(f => f.id === frame.id)!.url
              )}
            />
          )}
        </div>
      )}
      <label className="block text-sm">
        3. 既有模型片段的来源说明（可填原任务号）
        <input
          className="mt-1 block w-full rounded border p-2"
          value={sourceNote}
          maxLength={500}
          disabled={blocked}
          onChange={e => setSourceNote(e.target.value)}
          placeholder="保留原任务回执；外部任务号不会冒充平台扣费凭证"
        />
      </label>
      <label className="block text-sm">
        导入并采用已有MP4（4–30秒，最多100 MiB）
        <input
          type="file"
          accept="video/mp4,.mp4"
          disabled={blocked}
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            void run(async () => {
              if (file.size > 100 * 1024 * 1024)
                throw Error("MP4不得超过100 MiB");
              const id = project.id,
                saved = await save();
              check(id);
              const gcsUri = await upload(file, file.name);
              check(id);
              const result = await importVideo.mutateAsync({
                projectId: id,
                expectedGeneration: saved.generation,
                sceneIndex,
                gcsUri,
                name: file.name,
                sourceNote,
              });
              check(id);
              await adopt(result);
              setMessage(
                "已有模型片段已采用并保存，原声轨保留。可继续下方“保存并查看本次视频内容”合成完整影片；未重新生成或扣费。"
              );
            });
          }}
        />
      </label>
      {!!imported.data?.length && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">已归档的模型片段 · 可恢复采用</h4>
          {imported.data.map(item => (
            <div
              key={item.asset.id}
              className="rounded border bg-white p-3 text-sm"
            >
              <p>
                {item.name} · {item.asset.durationSec}秒 · 导入0积分
              </p>
              <p className="text-xs text-stone-500">
                来源说明：{item.sourceNote || "自行导入"}（非平台生成扣费凭证）
              </p>
              <video
                controls
                preload="metadata"
                className="my-2 max-h-48 rounded"
                src={gcsTransferUrl(item.url)}
              />
              <button
                className={button}
                disabled={blocked}
                onClick={() =>
                  void run(async () => {
                    const id = project.id,
                      saved = await save();
                    check(id);
                    const value = await adoptImported.mutateAsync({
                      projectId: id,
                      expectedGeneration: saved.generation,
                      sceneIndex,
                      assetId: item.asset.id,
                    });
                    check(id);
                    await adopt(value);
                    setMessage("已恢复采用原片段并保存，未重新上传或生成。");
                  })
                }
              >
                采用到第{sceneIndex + 1}镜
              </button>
            </div>
          ))}
        </div>
      )}
      {imported.error && (
        <p role="alert" className="text-sm text-red-700">
          {imported.error.message}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-orange-800">
          {message}
        </p>
      )}
      {previews.error && (
        <p role="alert" className="text-sm text-red-700">
          {previews.error.message}
        </p>
      )}
    </section>
  );
}
