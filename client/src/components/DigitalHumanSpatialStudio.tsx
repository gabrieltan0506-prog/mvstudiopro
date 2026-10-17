import { DigitalHumanSpatialAdvisorPanel } from "./DigitalHumanSpatialAdvisorPanel";
import { digitalHumanPrevisScenePatch, digitalHumanSceneInputKey, digitalHumanPrevisSceneAligned } from "@/lib/digitalHumanSpatialAdvisor";
import { DigitalHumanDirectorPanel } from "./DigitalHumanDirectorPanel";
import { digitalHumanShotText } from "@/lib/digitalHumanAdvisor";
import { buildAdvisorPrevisShotSource } from "@shared/manhuaAdvisorPrevisShotSource";
import { DigitalHumanRenderReview } from "./DigitalHumanRenderReview";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { defaultCanvasBlock, type CanvasBlock } from "@/lib/canvasTypes";
import { digitalHumanMediaUrl } from "@/lib/digitalHumanVideo";
import {
  digitalHumanSpatialFingerprint,
  currentDigitalHumanAudio,
  type DigitalHumanDraft,
  type DigitalHumanMedia,
} from "@shared/digitalHumanStudio";
import { Manhua3dModelStudio } from "./canvas/Manhua3dModelStudio";
import { ManhuaWorldStudio } from "./canvas/ManhuaWorldStudio";
import { ManhuaPrevisStudio } from "./canvas/ManhuaPrevisStudio";
import ManhuaAutoRigEditor from "./canvas/ManhuaAutoRigEditor";
import { ArtMotionStudio } from "./canvas/ArtMotionStudio";
import {
  artMotionStateSchema,
  defaultArtMotionSpec,
  normalizeArtMotionJobStatus,
  type ArtMotionState,
} from "@shared/artMotion";
import { manhuaPrevisAnimationSource } from "@shared/manhuaPrevisAnimationSource";
import { toManhuaWorld3dRef } from "@shared/manhuaWorld3d";
import type { ManhuaAsset3dRef } from "@shared/manhuaAsset3d";
import { createManhuaPrevisStudio } from "@shared/manhuaPrevis";
import { uploadFileToSignedUrl } from "@/lib/omniCanvasApi";

type Props = {
  draft: DigitalHumanDraft;
  role: string;
  disabled: boolean;
  onChange: (patch: Partial<DigitalHumanDraft>) => void;
  uploadFile: (file: File) => Promise<DigitalHumanMedia>;
  beforeSubmit: () => Promise<void>;
  acquireWork: (label: string) => () => void;
};
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));
export function DigitalHumanSpatialStudio({
  draft,
  role,
  disabled,
  onChange,
  uploadFile,
  beforeSubmit,
  acquireWork,
}: Props) {
  const api = trpc.useUtils();
  const worldList = trpc.manhuaWorld.listMine.useQuery(
    { limit: 100 },
    { enabled: role === "admin", retry: false }
  );
  const modelSubmit = trpc.manhua3d.submit.useMutation(),
    modelImport = trpc.manhua3d.importExisting.useMutation();
  const worldSubmit = trpc.manhuaWorld.submit.useMutation(),
    worldRetry = trpc.manhuaWorld.retry.useMutation(),
    signed = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();
  const queue = trpc.mvAnalysis.queuePostProd.useMutation();
  const latest = useRef(draft);
  latest.current = draft;
  const latestWorlds = useRef(worldList.data);
  latestWorlds.current = worldList.data;
  const [busy, setBusy] = useState<string[]>([]),
    [error, setError] = useState(""),
    [rig, setRig] = useState<string>();
  const lock = useRef(false);

  const [trialHost, setTrialHost] = useState<HTMLDivElement | null>(null);
  const [previsDuration, setPrevisDuration] = useState<number>();
  const advisorStorage: Storage = {
    get length() { return Object.keys(latest.current.advisorStorage).length; },
    key: i => Object.keys(latest.current.advisorStorage)[i] ?? null,
    getItem: key => latest.current.advisorStorage[key] ?? null,
    setItem: (key, value) => patch({ advisorStorage: { ...latest.current.advisorStorage, [key]: String(value) } }),
    removeItem: key => { const next = { ...latest.current.advisorStorage }; delete next[key]; patch({ advisorStorage: next }); },
    clear: () => { throw new Error("请逐项删除顾问记录，不能清空全部制作证据"); },
  };
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const mainId = `dh-person-${draft.id}`,
    sceneId = `dh-scene-${draft.id}`,
    clipId = `dh-previs-${draft.id}`;
  const characters = [
    ...(draft.portrait
      ? [
          {
            id: mainId,
            labelZh: "讲述者",
            portrait: draft.portrait,
            model: draft.mainModel,
            x: draft.mainStage?.x || 0,
            y: draft.mainStage?.y || 0,
            yaw: draft.mainStage?.yaw || 0,
          },
        ]
      : []),
    ...draft.actors,
  ];
  useEffect(() => {
    let alive = true;
    void Promise.all(
      characters.map(
        async c =>
          [c.id, await digitalHumanMediaUrl(c.portrait.source)] as const
      )
    )
      .then(rows => {
        if (alive) setThumbs(Object.fromEntries(rows));
      })
      .catch(e => {
        if (alive) setError(err(e));
      });
    return () => {
      alive = false;
    };
  }, [JSON.stringify(characters.map(c => [c.id, c.portrait.source]))]);
  const [sceneThumb, setSceneThumb] = useState<{ source: string; url: string }>();
  useEffect(() => {
    let alive = true;
    const source = draft.scene?.source;
    if (source) void digitalHumanMediaUrl(source).then(url => {
      if (alive) setSceneThumb({ source, url });
    }).catch(e => { if (alive) setError(err(e)); });
    return () => { alive = false; };
  }, [draft.scene?.source]);
  function patch(p: Partial<DigitalHumanDraft>) {
    if (p.previsSpatialInvalidated === undefined && latest.current.previsStudio &&
      ("mainStage" in p || "actors" in p || "stageCamera" in p || "scene" in p || "worldTaskId" in p)) {
      const next = { ...latest.current, ...p };
      if (digitalHumanSpatialFingerprint(next) !== digitalHumanSpatialFingerprint(latest.current)) p = { ...p, previsSpatialInvalidated: true };
    }
    onChange(p);
    latest.current = { ...latest.current, ...p };
  }
  function setModel(id: string, model: ManhuaAsset3dRef) {
    if (id === mainId) patch({ mainModel: model });
    else
      patch({
        actors: latest.current.actors.map(a =>
          a.id === id ? { ...a, model } : a
        ),
      });
  }
  async function work(id: string, fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy([id]);
    setError("");
    let release: (() => void) | undefined;
    try {
      release = acquireWork("人物与空间素材处理中");
      await beforeSubmit();
      await fn();
      await beforeSubmit();
    } catch (e) {
      setError(err(e));
    } finally {
      release?.();
      lock.current = false;
      setBusy([]);
    }
  }
  async function refreshModels() {
    const d = latest.current;
    const current = [
      ...(d.portrait
        ? [{ id: mainId, portrait: d.portrait, model: d.mainModel }]
        : []),
      ...d.actors,
    ];
    const queries = [
      ...d.modelRequests.map(request => ({
        assetRef: request.assetRef,
        sourceVersion: request.sourceVersion,
        request,
        taskId: undefined as string | undefined,
      })),
      ...current
        .filter(
          c =>
            c.model &&
            !d.modelRequests.some(
              r =>
                r.assetRef === c.id &&
                r.sourceVersion === c.model!.sourceVersion
            )
        )
        .map(c => ({
          assetRef: c.id,
          sourceVersion: c.model!.sourceVersion,
          taskId: c.model!.taskId,
          request: undefined,
        })),
    ];
    const results = await Promise.allSettled(
      queries.map(async q => {
        const r = q.taskId
          ? await api.digitalHuman.getModel.fetch({ taskId: q.taskId })
          : await api.digitalHuman.getExistingModel.fetch({
              assetRef: q.assetRef,
              sourceVersion: q.sourceVersion,
            });
        if (!r) return;
        const model = { ...r, updatedAt: Date.parse(r.updatedAt) };
        const now = latest.current;
        const matching =
          q.assetRef === mainId
            ? now.portrait?.source === q.sourceVersion
            : now.actors.some(
                c =>
                  c.id === q.assetRef && c.portrait.source === q.sourceVersion
              );
        patch({
          modelHistory: [
            ...now.modelHistory.filter(h => h.model.taskId !== model.taskId),
            { assetRef: q.assetRef, model },
          ],
          modelRequests: now.modelRequests.filter(
            p =>
              !(
                p.assetRef === q.assetRef && p.sourceVersion === q.sourceVersion
              )
          ),
        });
        if (matching) setModel(q.assetRef, model);
      })
    );
    const pending = latest.current.worldRequest;
    if (pending) {
      const found = await api.digitalHuman.getExistingWorld.fetch({
        sceneRef: pending.sceneRef,
        sourceVersion: pending.sourceVersion,
        model: pending.model,
        textPrompt: pending.textPrompt,
      });
      if (found) patch({ worldTaskId: found.taskId, worldRequest: undefined });
    }
    const failed = results.find(r => r.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
  useEffect(() => {
    if (role !== "admin") return;
    let stopped = false;
    const tick = async (initial = false) => {
      if (stopped || lock.current) return;
      const d = latest.current;
      const models = [d.mainModel, ...d.actors.map(a => a.model)];
      const activeModel = models.some(m => m && !["succeeded", "failed"].includes(m.status));
      const currentWorld = latestWorlds.current?.find(w => w.taskId === d.worldTaskId);
      const activeWorld = Boolean(d.worldTaskId && (!currentWorld || !["succeeded", "failed", "reconcile_manual"].includes(currentWorld.status)));
      // 终态资产不再周期占用整份制作稿，避免白模编辑和渲染反复被锁住。
      if (!initial && !d.modelRequests.length && !d.worldRequest && !activeModel && !activeWorld) return;
      await work("recover", async () => {
        await refreshModels();
        await worldList.refetch();
      });
    };
    void tick(true);
    const timer = setInterval(() => void tick(), 15000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [role]);

  const world = worldList.data?.find(
    w =>
      w.taskId === draft.worldTaskId && w.sourceVersion === draft.scene?.source
  );
  const studio = draft.previsStudio;
  const targetPrevisDuration = previsDuration ?? studio?.spec.durationSec ?? Math.min(30, Math.ceil(currentDigitalHumanAudio(draft)?.durationSec || 10));
  const previsDurationChanged = Boolean(studio && studio.spec.durationSec !== targetPrevisDuration);
  const previsOutdated = !digitalHumanPrevisSceneAligned(draft);
  function rebuildStudio() {
    if (!characters.length) throw new Error("请先添加人物，再描述动作");
          const next = createManhuaPrevisStudio(targetPrevisDuration);
          next.spec.aspect = draft.aspectRatio;
          next.spec.actors = characters.map(c => ({
            ...next.spec.actors[0],
            id: c.id,
            assetRef: c.id,
            nameZh: c.labelZh,
            start: [c.x, c.y],
            end: [c.x, c.y],
            facingDeg: c.yaw,
          }));
          if (latest.current.stageCamera) {
            const camera = latest.current.stageCamera;
            next.spec.cameras = [{ startSec: 0, endSec: next.spec.durationSec, position: [...camera.position], target: [...camera.target], lens: camera.lens }];
          }
          const previous = latest.current.previsStudio;
          if (previous) {
            next.scopeId = previous.scopeId;
            next.audioEnabled = previous.audioEnabled;
            next.audioStartSec = previous.audioStartSec;
            next.loopBgm = previous.loopBgm;
            next.history = previous.history;
            next.referenceHistory = previous.referenceHistory;
            next.specHistory = [...(previous.specHistory ?? []), { spec: previous.spec, createdAt: new Date().toISOString(), reasonZh: "场景站位更新前的白模草稿" }];
          }
          patch({ previsStudio: next, previsSpatialInvalidated: false,
            ...(previous ? { advisorStorage: { ...latest.current.advisorStorage, [`previs-before-rebuild:${previous.scopeId}`]: JSON.stringify(previous) } } : {}) });
    return next;
  }
  async function prepareAdvisorStudio() {
    if (!latest.current.previsStudio || !digitalHumanPrevisSceneAligned(latest.current) || previsDurationChanged) rebuildStudio();
    await beforeSubmit();
    return advisorStudio();
  }
  function advisorStudio() {
    const d = latest.current;
    if (!d.previsStudio) throw new Error("请先建立当前人物白模");
    return { ...d.previsStudio, advisorShotSource: buildAdvisorPrevisShotSource(clipId, [{ index: 1,
      durationSec: d.previsStudio.spec.durationSec, actionZh: digitalHumanShotText(d) || "按当前人物站位讲述正文",
      cameraZh: d.direction, dialogueZh: d.script }]) };
  }
  const block: CanvasBlock = {
    ...defaultCanvasBlock("video", 0, 0),
    id: clipId,
    videoModel: "seedance-2.5",
    aspectRatio: draft.aspectRatio,
    prompt: `目标时长：${studio?.spec.durationSec ?? targetPrevisDuration}秒。${draft.direction}`,
    previsStudio: studio,
  };
  const animationSource = previsOutdated ? null : manhuaPrevisAnimationSource(studio, clipId);
  const take = studio?.history.find(t => t.jobId === studio.selectedJobId);
  const selectedRig = characters.find(c => c.id === rig);
  const spatialBlocks: CanvasBlock[] = draft.spatialRenders.map(r => ({
    ...defaultCanvasBlock("video", 0, 0),
    id: r.id,
    artMotion: r.state,
  }));
  async function saveArt(
    id: string,
    state: ArtMotionState,
    expected: ArtMotionState | null,
    adopt?: { url: string; gcsUri: string; useAsSegment?: boolean }
  ) {
    const existing = latest.current.spatialRenders.find(r => r.id === id);
    if (
      expected
        ? JSON.stringify(existing?.state) !== JSON.stringify(expected)
        : Boolean(existing)
    )
      throw new Error("渲染记录已变化，请重新查询");
    if (adopt || state.request?.status === "submitting") {
      const source = state.spec.stageAnimation;
      if (!digitalHumanPrevisSceneAligned(latest.current)) throw new Error("场景站位已改变，请按新站位重新建立并审查白模");
      const current = manhuaPrevisAnimationSource(
        latest.current.previsStudio,
        clipId
      );
      if (
        source &&
        (!current ||
          source.previsJobId !== current.previsJobId ||
          source.worldTaskId !== latest.current.worldTaskId)
      )
        throw new Error("空间或白模已变化，请重新检查输入");
    }
    patch({
      spatialRenders: [
        ...latest.current.spatialRenders.filter(r => r.id !== id),
        { id, state: artMotionStateSchema.parse(state) },
      ],
      ...(adopt
        ? {
            spatialRenderCandidate: {
              reference: {
                url: adopt.url,
                gcsUri: adopt.gcsUri,
                durationSec: state.spec.duration,
                updatedAt: new Date().toISOString(),
                fileName: "3D场景人物预演.mp4",
                motionGuideZh:
                  "保留3D预演的人物站位、动作与镜头，真实外观以身份图片为准。",
              },
              sourceFingerprint: digitalHumanSpatialFingerprint(latest.current),
            },
          }
        : {}),
    });
    await beforeSubmit();
  }
  if (role !== "admin")
    return (
      <p>
        3D 人物、3DGS
        与多人预演工具目前需要管理员权限。数字人生成可使用上方人像、场景与声音。
      </p>
    );
  return (
    <section className="dh-spatial" aria-label="数字人导演工作区">
      <details className="dh-spatial-materials"><summary>管理人物与场景素材</summary>
      <p>
        在本制作稿中组合人物、场景和动作。预演须逐帧、常速审看后采用，再进入视频输入。
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        disabled={disabled || busy.length > 0}
        onClick={() =>
          void work("recover", async () => {
            await refreshModels();
            await worldList.refetch();
          })
        }
      >
        查询原模型与场景任务
      </button>
      {draft.modelRequests.length > 0 && (
        <p>有建模请求等待核对，已停止重复提交。</p>
      )}
      {draft.modelHistory.length > 0 && (
        <details>
          <summary>已找回的建模记录</summary>
          {draft.modelHistory.map(h => (
            <p key={h.model.taskId}>
              {h.assetRef} · {h.model.status} · {h.model.taskId}
            </p>
          ))}
        </details>
      )}
      {draft.worldRequest && <p>3DGS请求等待核对，请查看已有世界列表。</p>}
      <label>
        增加同场人物
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={disabled || busy.length > 0}
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file)
              void work("actor", async () => {
                const portrait = await uploadFile(file);
                patch({
                  actors: [
                    ...latest.current.actors,
                    {
                      id: `dh-actor-${crypto.randomUUID()}`,
                      labelZh: `人物${latest.current.actors.length + 2}`,
                      portrait,
                      x: latest.current.actors.length + 1,
                      y: 0,
                      yaw: 0,
                    },
                  ],
                });
              });
          }}
        />
      </label>
      {draft.actors.map(a => (
        <div className="dh-actor" key={a.id}>
          <label>
            人物名称
            <input
              value={a.labelZh}
              onChange={e =>
                patch({
                  actors: latest.current.actors.map(c =>
                    c.id === a.id ? { ...c, labelZh: e.target.value } : c
                  ),
                })
              }
            />
          </label>
          <button
            type="button"
            onClick={() =>
              patch({
                actors: latest.current.actors.filter(c => c.id !== a.id),
              })
            }
          >
            移出当前片
          </button>
        </div>
      ))}
      <div className="dh-factory">
        <Manhua3dModelStudio
          characters={characters.map(c => ({
            id: c.id,
            labelZh: c.labelZh,
            thumbUrl: thumbs[c.id],
            eligibility: {
              eligible: Boolean(thumbs[c.id]),
              sourceVersion: c.portrait.source,
              currentModel3d:
                c.model?.sourceVersion === c.portrait.source
                  ? c.model
                  : undefined,
            },
          }))}
          busyIds={busy}
          disabled={disabled}
          onGenerate={id =>
            work(id, async () => {
              const c = characters.find(c => c.id === id)!;
              if (latest.current.modelRequests.some(r => r.assetRef === id))
                throw new Error("原建模请求待核对，请先刷新原任务");
              if (
                !window.confirm(
                  `为${c.labelZh}建立3D人物，沿用漫剧工厂建模计费。确认？`
                )
              )
                return;
              const sourceImageUrl = await digitalHumanMediaUrl(
                c.portrait.source
              );
              patch({
                modelRequests: [
                  ...latest.current.modelRequests,
                  {
                    assetRef: id,
                    sourceVersion: c.portrait.source,
                    submittedAt: new Date().toISOString(),
                  },
                ],
              });
              await beforeSubmit();
              const r = await modelSubmit.mutateAsync({
                assetRef: id,
                sourceVersion: c.portrait.source,
                sourceImageUrl,
              });
              setModel(id, { ...r, updatedAt: Date.parse(r.updatedAt) });
              patch({
                modelRequests: latest.current.modelRequests.filter(
                  p => p.assetRef !== id
                ),
              });
            })
          }
          onImport={(id, file) =>
            work(id, async () => {
              const c = characters.find(c => c.id === id)!;
              const receipt = await signed.mutateAsync({
                fileName: file.name,
                mimeType: "model/gltf-binary",
                objectName: `canvas/model/${crypto.randomUUID()}.glb`,
              });
              if (!receipt.gcsUri) throw new Error("模型上传缺少持久地址");
              await uploadFileToSignedUrl({
                file,
                uploadUrl: receipt.uploadUrl,
                headers: receipt.requiredHeaders,
                contentType: "model/gltf-binary",
              });
              const r = await modelImport.mutateAsync({
                assetRef: id,
                sourceVersion: c.portrait.source,
                sourceImageUrl: await digitalHumanMediaUrl(c.portrait.source),
                glbGcsUri: receipt.gcsUri,
              });
              setModel(id, { ...r, updatedAt: Date.parse(r.updatedAt) });
            })
          }
          onRig={id => setRig(id)}
        />
      </div>
      {selectedRig?.model && (
        <ManhuaAutoRigEditor
          assetRef={selectedRig.id}
          label={selectedRig.labelZh}
          sourceJobId={selectedRig.model.taskId}
          sourceVersion={selectedRig.portrait.source}
          disabled={disabled}
          onClose={() => setRig(undefined)}
          onApply={(model, expected) => {
            const c = characters.find(c => c.id === model.assetRef);
            if (c?.model?.taskId !== expected) return false;
            setModel(c.id, {
              ...model,
              updatedAt: Date.parse(model.updatedAt),
            });
            return true;
          }}
        />
      )}
      <label>
        复用已有3DGS场景
        <select
          value={draft.worldTaskId || ""}
          onChange={e => {
            const selected = worldList.data?.find(
              w => w.taskId === e.target.value
            );
            if (
              selected &&
              !/^(gs:\/\/|https:\/\/)/.test(selected.sourceVersion)
            ) {
              setError(
                "该旧世界未保存可恢复的场景图片身份，请先选择对应场景图后核对"
              );
              return;
            }
            patch({
              worldTaskId: selected?.taskId,
              ...(selected
                ? {
                    scene: {
                      source: selected.sourceVersion,
                      name: selected.displayName,
                    },
                  }
                : {}),
            });
          }}
        >
          <option value="">请选择已有世界，或从场景图生成</option>
          {worldList.data?.map(w => (
            <option key={w.taskId} value={w.taskId}>
              {w.displayName} · {w.status}
            </option>
          ))}
        </select>
      </label>
      {worldList.error && (
        <p role="alert">3DGS 列表读取失败：{worldList.error.message}</p>
      )}
      <DigitalHumanSpatialAdvisorPanel key={`scene-advisor-${draft.owner}-${draft.id}`} draft={draft} getDraft={() => latest.current}
        world={world?.status === "succeeded" ? world.assets : undefined}
        storage={advisorStorage} disabled={disabled || busy.length > 0} beforeSubmit={beforeSubmit} acquireWork={acquireWork} onApply={patch} />
      <div className="dh-factory">
        <ManhuaWorldStudio
          imageGeneration
          hideCameraPresets
          stageCamera={draft.stageCamera}
          onConfirmGroundAnchor={disabled ? undefined : async (labelZh, point) => {
            const snapshot = latest.current, key = digitalHumanSceneInputKey(snapshot);
            if (!snapshot.scene || !snapshot.worldTaskId || !world || world.taskId !== snapshot.worldTaskId || world.sourceVersion !== snapshot.scene.source) throw new Error("场景已变化，请重新打开正确场景标记地点");
            const release = acquireWork("保存场景地点");
            try {
              await beforeSubmit();
              if (key !== digitalHumanSceneInputKey(latest.current)) throw new Error("场景已变化，未保存旧地点");
              const anchors = latest.current.stageAnchors ?? [];
              const existing = anchors.find(a => a.labelZh === labelZh && a.sceneSource === snapshot.scene!.source && a.worldTaskId === snapshot.worldTaskId);
              if (!labelZh.trim() || labelZh.length > 80) throw new Error("地点名称需为1至80字");
              if (!existing && anchors.length >= 50) throw new Error("当前制作稿已保存50个地点，请使用已有地点名称更新位置");
              const anchor = { id: existing?.id ?? crypto.randomUUID(), labelZh, point, sceneSource: snapshot.scene.source, worldTaskId: snapshot.worldTaskId };
              patch({ stageAnchors: [...anchors.filter(a => a.id !== anchor.id), anchor] });
              await beforeSubmit();
            } finally { release(); }
          }}
          scenes={
            draft.scene
              ? [
                  {
                    id: world?.sceneRef || sceneId,
                    labelZh: world?.displayName || draft.scene.name,
                    thumbUrl: sceneThumb?.source === draft.scene.source ? sceneThumb.url : undefined,
                    hintZh: draft.sceneDescription,
                    eligibility: {
                      eligible: true,
                      sourceVersion: world?.sourceVersion || draft.scene.source,
                      currentWorld3d: world
                        ? toManhuaWorld3dRef(world)
                        : undefined,
                    },
                  },
                ]
              : []
          }
          busyIds={busy}
          disabled={disabled}
          stageCharacters={characters.map(c => ({
            id: c.id,
            assetRef: c.id,
            labelZh: c.labelZh,
            glbUrl:
              c.model?.sourceVersion === c.portrait.source
                ? c.model.glbUrl || ""
                : "",
            modelIssue:
              c.model?.status !== "succeeded"
                ? { code: "not_modeled" as const }
                : undefined,
            stagePoint: [c.x, c.y] as [number, number],
            yawDeg: c.yaw,
          }))}
          onGenerate={(id, options) =>
            work(id, async () => {
              if (!latest.current.scene) throw new Error("请先选择场景图");
              if (latest.current.worldRequest)
                throw new Error("原场景建模请求待核对，请先从已有世界列表查询");
              if (
                !window.confirm(
                  "提交3DGS场景生成，费用采用上方所选漫剧工厂档位。确认？"
                )
              )
                return;
              const source = latest.current.scene.source;
              const sourceImageUrl = await digitalHumanMediaUrl(source);
              patch({
                worldRequest: {
                  sceneRef: sceneId,
                  sourceVersion: source,
                  model: options.model,
                  textPrompt: options.textPrompt,
                  submittedAt: new Date().toISOString(),
                },
              });
              await beforeSubmit();
              const r = await worldSubmit.mutateAsync({
                sceneRef: sceneId,
                sourceVersion: source,
                sourceImageUrl,
                ...(source.startsWith("gs://")
                  ? { sourceImageGcsUri: source }
                  : {}),
                displayName: latest.current.scene.name,
                model: options.model,
                prompt: {
                  type: "image",
                  isPano: false,
                  textPrompt: options.textPrompt,
                },
              });
              patch({ worldTaskId: r.taskId, worldRequest: undefined });
              await worldList.refetch();
            })
          }
          onRetry={id => work(id, async () => {
            const snapshot = latest.current;
            const original = latestWorlds.current?.find(w => w.taskId === snapshot.worldTaskId);
            if (snapshot.worldRequest || !snapshot.scene || !original || id !== original.sceneRef || original.sourceVersion !== snapshot.scene.source || original.status !== "failed") {
              throw new Error("当前场景没有可重试的失败任务，请先查询原任务");
            }
            if (!window.confirm("按原输入重试此3DGS场景，费用沿用原模型档位；旧任务保留。确认？")) return;
            await beforeSubmit();
            if (latest.current.id !== snapshot.id || latest.current.scene?.source !== snapshot.scene.source || latest.current.worldTaskId !== original.taskId || latest.current.worldRequest) {
              throw new Error("场景或任务已变化，未提交旧场景重试");
            }
            const result = await worldRetry.mutateAsync({ taskId: original.taskId });
            if (latest.current.id === snapshot.id && latest.current.scene?.source === snapshot.scene.source && latest.current.worldTaskId === original.taskId) {
              patch({ worldTaskId: result.taskId, worldRequest: undefined });
            }
            await worldList.refetch();
          })}
          onExportStageFrame={async (_, blob) => {
            const sourceFingerprint = digitalHumanSpatialFingerprint(
              latest.current
            );
            const media = await uploadFile(
              new File([blob], "3D视角图.png", { type: "image/png" })
            );
            if (
              sourceFingerprint !==
              digitalHumanSpatialFingerprint(latest.current)
            )
              throw new Error("空间输入已变化，请重新导帧");
            patch({ stageFrame: { media, sourceFingerprint } });
          }}
          previsStudio={studio}
          previsAnimationSource={animationSource || undefined}
          stageAnimation={
            take?.animation && animationSource
              ? {
                  jobId: take.jobId,
                  requestId: take.requestId,
                  ...take.animation,
                }
              : undefined
          }
          savedFrameCount={draft.stageFrame ? 1 : 0}
          adoptedFrameCount={draft.stageFrame ? 1 : 0}
          onRenderStageAnimation={async spec => {
            if (lock.current) throw new Error("请等待当前操作结束");
            if (!digitalHumanPrevisSceneAligned(latest.current)) throw new Error("场景站位已改变，请重新核对并采用白模");
            const current = manhuaPrevisAnimationSource(
              latest.current.previsStudio,
              clipId
            );
            if (
              !current ||
              current.previsJobId !== spec.stageAnimation?.previsJobId
            )
              throw new Error("请先审片并采用当前白模");
            if (
              latest.current.spatialRenders.some(
                r =>
                  r.state.request &&
                  ["submitting", "queued", "running"].includes(
                    r.state.request.status
                  )
              )
            )
              throw new Error("请先在下方查询原渲染任务");
            const id = `dh-art-${crypto.randomUUID()}`;
            const state: ArtMotionState = {
              version: 1,
              spec,
              history: [],
              request: { id: crypto.randomUUID(), spec, status: "submitting" },
            };
            await saveArt(id, state, null);
            const receipt = await queue.mutateAsync({
              action: "art_motion",
              scopeKey: `dh-art:${draft.owner}:${draft.id}`,
              requestId: state.request!.id,
              params: spec,
            });
            await saveArt(
              id,
              {
                ...state,
                request: {
                  ...state.request!,
                  jobId: receipt.jobId,
                  status: normalizeArtMotionJobStatus(receipt.status),
                },
              },
              state
            );
          }}
        />
      </div>
      </details>
      <div className="dh-director-workbench">
      <aside className="dh-project-rail" aria-label="项目素材与镜头">
        <h3>项目素材</h3>
        {characters.map(c => <figure key={c.id}>{thumbs[c.id] && <img src={thumbs[c.id]} alt={c.labelZh} />}<figcaption>{c.labelZh}</figcaption></figure>)}
        {sceneThumb && <figure><img src={sceneThumb.url} alt={draft.scene?.name || "当前场景"} /><figcaption>{draft.scene?.name}</figcaption></figure>}
        <details><summary>已关联台词</summary><p>{draft.script || "请先填写台词"}</p></details>
        <h3>镜头安排</h3>
        {studio?.spec.cameras.map((camera, i) => <p key={i}><strong>{String(i + 1).padStart(2, "0")}</strong> · {camera.startSec}–{camera.endSec} 秒</p>)}
        {!studio && <p>描述动作后生成镜头方案。</p>}
      </aside>
      <div id="dh-preview" className="dh-previs-main">
      <div className="dh-previs-heading"><h3>白模预演</h3><span>{draft.previs?.reviewed && draft.previs.sourceFingerprint === digitalHumanSpatialFingerprint(draft) && !previsOutdated ? "已确认当前版本" : "待预演与确认"}</span></div>
      <div ref={setTrialHost} data-clip-id={clipId} className="dh-director-trial" />
      <label>白模目标时长（秒）<input type="number" aria-label="白模目标时长" min={2} max={30} step={1}
        value={targetPrevisDuration} disabled={disabled || Boolean(studio?.pending)} onChange={e => {
          const value = Number(e.target.value);
          if (Number.isInteger(value) && value >= 2 && value <= 30) setPrevisDuration(value);
        }} /></label>
      {previsDurationChanged && <p>时长已调整，请重建并重新审片；旧方案与回执会保留。</p>}
      {studio && (previsOutdated || previsDurationChanged) && <button
        type="button"
        disabled={disabled || Boolean(studio?.pending)}
        onClick={() => {
          rebuildStudio();
        }}
      >
        更新当前预演方案（保留旧稿）
      </button>}
      {previsOutdated && <p role="status">场景站位或机位已改变，旧白模暂不能用于渲染和视频。旧稿已保留，请按当前场景重建并重新审片。</p>}
      {studio && !previsOutdated && (
        <div className="dh-factory">
          <ManhuaPrevisStudio
            creatorMode
            block={block}
            beforeSubmit={beforeSubmit}
            acquireWork={acquireWork}
            characters={characters.map(c => ({
              id: c.id,
              label: c.labelZh,
              model:
                c.model?.status === "succeeded" &&
                c.model.sourceVersion === c.portrait.source
                  ? { taskId: c.model.taskId, assetRef: c.id }
                  : undefined,
            }))}
            disabled={disabled}
            sourceShots={[
              {
                index: 1,
                durationSec: studio.spec.durationSec,
                actionZh: digitalHumanShotText(draft) || "按当前人物站位讲述正文",
                cameraZh: draft.direction,
                dialogueZh: draft.script,
              },
            ]}
            onChange={(next, reference) => {
              const scenePatch = digitalHumanPrevisScenePatch(latest.current, next);
              const updated = { ...latest.current, ...scenePatch };
              patch({
                ...scenePatch,
                ...(reference
                  ? {
                      previs: {
                        reference,
                        sourceFingerprint:
                          digitalHumanSpatialFingerprint(updated),
                        reviewed: true,
                      },
                    }
                  : {}),
              });
            }}
          />
        </div>
      )}
      {!studio && <div className="dh-previs-empty"><strong>先把动作演给你看</strong><p>在右侧描述人物动作、场景和镜头。导演方案会使用当前素材；渲染完成后，在这里播放并逐帧检查。</p></div>}
      </div>
      <aside className="dh-director-assistant">
        <DigitalHumanDirectorPanel key={`${draft.owner}:${draft.id}`} draft={draft}
          storage={advisorStorage} disabled={disabled || busy.length > 0 || Boolean(studio?.pending) || !characters.length} beforeSubmit={beforeSubmit} acquireWork={acquireWork}
          previewHost={trialHost} prepareStudio={prepareAdvisorStudio} currentStudio={advisorStudio} onApply={next => patch(digitalHumanPrevisScenePatch(latest.current, next))} />
        <p>确认预演后，再核对完整提示词、参考与费用，生成正式视频。</p>
      </aside>
      </div>
      {draft.spatialRenders.length > 0 && (
        <ArtMotionStudio
          scopeKey={`dh-art:${draft.owner}:${draft.id}`}
          blocks={spatialBlocks}
          onCreate={async () => {
            const id = `dh-art-${crypto.randomUUID()}`;
            await saveArt(
              id,
              { version: 1, spec: defaultArtMotionSpec(), history: [] },
              null
            );
            return id;
          }}
          onSave={saveArt}
        />
      )}
      {draft.spatialRenderCandidate && (
        <DigitalHumanRenderReview
          key={
            draft.spatialRenderCandidate.reference.gcsUri ||
            draft.spatialRenderCandidate.reference.url
          }
          candidate={draft.spatialRenderCandidate}
          disabled={disabled}
          onApprove={review => {
            const candidate = latest.current.spatialRenderCandidate;
            if (
              !candidate ||
              candidate.sourceFingerprint !==
                digitalHumanSpatialFingerprint(latest.current)
            )
              throw new Error("人物或空间已变化，请重新渲染后审片");
            patch({
              previs: { ...candidate, reviewed: true, review },
              spatialRenderCandidate: undefined,
            });
          }}
        />
      )}
      {draft.stageFrame && (
        <p>已采用3D视角图；会作为独立构图参考加入视频输入。</p>
      )}
      {draft.previs && (
        <p>已采用审片后的预演；会随当前人物与场景版本进入视频输入。</p>
      )}
    </section>
  );
}
