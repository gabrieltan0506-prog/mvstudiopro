import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { defaultCanvasBlock, type CanvasBlock } from "@/lib/canvasTypes";
import { resolveCanvasMaterialUrl } from "@/lib/omniCanvasApi";
import { toStableCanvasMediaUrl } from "@/lib/manhuaCloudDraftSync";
import { resolveUrlForCloudSync } from "@/lib/manhuaLocalMediaStore";
import { getJob } from "@/lib/jobs";
import {
  readOpenAiImageVariantMode,
  readOpenAiImageVariantPref,
} from "@/lib/openaiImageVariantPref";
import { CanvasAudioStudio } from "./CanvasAudioStudio";
import {
  createCanvasAudioCue,
  emptyCanvasAudioStudio,
  type CanvasAudioStudio as AudioState,
} from "@shared/canvasAudioStudio";
import { ModelViewer } from "@/components/ModelViewer";
import {
  imageWorldStateSchema,
  imageWorldPlanSchema,
  IMAGE_WORLD_ANALYSIS_PROMPT,
  parseImageWorldAnalysis,
  imageWorldPlatePrompt,
  imageWorldObjectPrompt,
  imageWorldEmptyPrompt,
  type ImageWorldState,
  type ImageWorldPlan,
} from "@shared/imageWorld";
import { manhuaAsset3dSourceIdentity } from "@shared/manhuaAsset3d";
import { toManhuaWorld3dRef } from "@shared/manhuaWorld3d";
import type { ManhuaCustomAssetRef } from "@shared/manhuaCustomAssetRefs";

export type ImageWorldBlockUpdate = {
  expected: CanvasBlock | null;
  next: CanvasBlock;
};
type Props = {
  scopeKey: string;
  blocks: CanvasBlock[];
  enabled: boolean;
  onSave(
    updates: ImageWorldBlockUpdate[],
    asset?: ManhuaCustomAssetRef
  ): Promise<void>;
  onAudioChange?(blockId: string, state: AudioState): boolean;
  onRun(
    block: CanvasBlock,
    sourceUrl: string,
    onTaskCreated: (jobId: string) => Promise<void>,
    assertCurrent: () => void,
    variants?: ("flare" | "sunburst")[]
  ): Promise<Partial<CanvasBlock>>;
};
const field =
  "rounded-lg border border-stone-300 bg-white p-2 text-sm text-stone-900";
const button =
  "rounded-lg border border-stone-400 bg-white px-3 py-2 text-sm text-stone-900 disabled:opacity-40";
const output = (b: CanvasBlock | undefined) =>
  b?.outputUrl ||
  b?.outputUrls?.[0] ||
  b?.uploadedAssets?.find(a => a.kind === "image")?.url ||
  b?.refImageUrl ||
  "";
const generatedOutput = (b: CanvasBlock | undefined) =>
  b?.status === "done" ? b.outputUrl || b.outputUrls?.[0] || "" : "";
const identity = (source: string) => {
  const remote = resolveUrlForCloudSync(source) || source,
    gs = manhuaAsset3dSourceIdentity(remote);
  const stable = gs.startsWith("gs://")
    ? toStableCanvasMediaUrl(
        gs.replace(/^gs:\/\//, "https://storage.googleapis.com/")
      )
    : toStableCanvasMediaUrl(remote);
  return stable.startsWith("/api/canvas-media/")
    ? stable
    : manhuaAsset3dSourceIdentity(stable);
};
export function ImageWorldStudio({
  scopeKey,
  blocks,
  enabled,
  onSave,
  onRun,
  onAudioChange,
}: Props) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState(""),
    [sourceId, setSourceId] = useState("");
  const [busy, setBusy] = useState(false),
    [model, setModel] = useState<"marble-1.1" | "marble-1.0-draft">(
      "marble-1.1"
    );
  const [plan, setPlan] = useState<ImageWorldPlan>({
    scene: "描述场景布局与光照",
    ambience: "",
    objects: [],
  });
  const [resolvedImages, setResolvedImages] = useState<Record<string, string>>(
    {}
  );
  const [glbs, setGlbs] = useState<Record<string, string>>({});
  const options = blocks.filter(b => b.imageWorld),
    root = options.find(b => b.id === selected) ?? options[0],
    state = root?.imageWorld;
  const live = useRef({ scopeKey, blocks, rootId: root?.id });
  live.current = { scopeKey, blocks, rootId: root?.id };
  const alive = useRef(true),
    locked = useRef(false);
  const utils = trpc.useUtils(),
    makeObject = trpc.imageWorld.object.useMutation(),
    makeWorld = trpc.imageWorld.world.useMutation();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (state) setPlan(state.plan);
    setGlbs({});
  }, [scopeKey, root?.id, state?.plan]);
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent).detail?.blockId;
      if (blocks.some(b => b.id === id && b.imageWorld)) {
        setSelected(id);
        setOpen(true);
      }
    };
    window.addEventListener("image-world-open", handler);
    return () => window.removeEventListener("image-world-open", handler);
  }, [blocks]);
  const imageUrls = state
    ? [
        state.sourceUrl,
        ...[state.plateBlockId, ...Object.values(state.objectBlockIds)].map(
          id => generatedOutput(blocks.find(b => b.id === id))
        ),
      ].filter(Boolean)
    : [];
  const imageKeys = JSON.stringify(imageUrls.map(identity));
  useEffect(() => {
    let active = true;
    setResolvedImages({});
    void Promise.all(
      imageUrls.map(async url => {
        const key = manhuaAsset3dSourceIdentity(
          resolveUrlForCloudSync(url) || url
        );
        try {
          return [
            url,
            key.startsWith("gs://") ? await resolveCanvasMaterialUrl(key) : url,
          ] as const;
        } catch {
          return [url, url] as const;
        }
      })
    ).then(rows => {
      if (active && alive.current) setResolvedImages(Object.fromEntries(rows));
    });
    return () => {
      active = false;
    };
  }, [scopeKey, root?.id, imageKeys]);
  const imageUrl = (url: string) => resolvedImages[url] || url;
  const run = async (work: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      await work();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "拆景操作未完成，原记录保留"
      );
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const context = (requireSource = true) => {
    if (!root?.imageWorld) throw new Error("请先创建拆景方案");
    const scope = scopeKey,
      id = root.id,
      source = root.imageWorld.sourceUrl,
      sourceBlockId = root.imageWorld.sourceBlockId;
    const assertIdentity = () => {
      const now = live.current;
      if (!alive.current || now.scopeKey !== scope || now.rootId !== id)
        throw new Error("作品或方案已切换，请回原作品查询任务");
    };
    const assert = () => {
      assertIdentity();
      if (
        requireSource &&
        identity(
          output(live.current.blocks.find(b => b.id === sourceBlockId))
        ) !== identity(source)
      )
        throw new Error("来源图片已改变，请为新图创建方案；旧任务记录保留");
    };
    assert();
    return { assert, assertIdentity, root, state: root.imageWorld };
  };
  const newPlan = async () => {
    const source = blocks.find(b => b.id === sourceId),
      url = output(source);
    if (!source || !url) throw new Error("请选择一张已上传或已生成图片");
    const id = `image-world-${crypto.randomUUID()}`;
    const next = {
      ...defaultCanvasBlock("text", 100, 100),
      id,
      prompt: "图片拆景方案",
      imageWorld: imageWorldStateSchema.parse({
        version: 1,
        sourceBlockId: source.id,
        sourceUrl: url,
        plan: { scene: "描述场景布局与光照", objects: [] },
      }),
    };
    await onSave([
      { expected: null, next },
      ...(!source.outputUrl && !source.refImageUrl
        ? [{ expected: source, next: { ...source, refImageUrl: url } }]
        : []),
    ]);
    if (alive.current && live.current.scopeKey === scopeKey) setSelected(id);
  };
  const savePlan = async () => {
    const c = context();
    const parsed = imageWorldPlanSchema.parse(plan);
    await onSave([
      {
        expected: c.root,
        next: { ...c.root, imageWorld: { ...c.state, plan: parsed } },
      },
    ]);
    toast.success("拆景方案已保存");
  };
  const generate = async (
    kind: "analysis" | "plate" | "object",
    objectId?: string
  ) => {
    const c = context();
    let work = c.root,
      st = c.state;
    if (JSON.stringify(plan) !== JSON.stringify(st.plan))
      throw new Error("请先保存修改后的场景与物件方案");
    const obj = st.plan.objects.find(o => o.id === objectId);
    const prompt =
      kind === "analysis"
        ? IMAGE_WORLD_ANALYSIS_PROMPT
        : kind === "plate"
          ? imageWorldPlatePrompt(st.plan)
          : obj
            ? imageWorldObjectPrompt(obj)
            : "";
    if (!prompt) throw new Error("物件不存在");
    const oldId =
      kind === "analysis"
        ? st.analysisBlockId
        : kind === "plate"
          ? st.plateBlockId
          : st.objectBlockIds[objectId!];
    const old = blocks.find(b => b.id === oldId);
    if (old && old.prompt === prompt) {
      if (kind === "analysis" && old.outputText) {
        await onSave([
          {
            expected: work,
            next: {
              ...work,
              imageWorld: {
                ...st,
                plan: parseImageWorldAnalysis(old.outputText),
              },
            },
          },
        ]);
        return;
      }
      if (kind !== "analysis" && generatedOutput(old)) {
        toast.message("已保留这份方案的图片，可以继续建立三维资产");
        return;
      }
      if (st.generations[old.id])
        throw new Error("此请求已有提交记录，请查询原任务；未知结果不重新生成");
    }
    if (oldId && st.generations[oldId]?.status === "submitting")
      throw new Error("前一份图片请求尚未结束，请先查询原任务");
    if (
      !window.confirm(
        kind === "analysis"
          ? "分析这张图片将使用现有读图服务。继续？"
          : "按已保存方案生成新图片，沿当前画布图像设置计费，原图保留。继续？"
      )
    )
      return;
    c.assert();
    const child = {
      ...defaultCanvasBlock(
        kind === "analysis" ? "text" : "image",
        work.x + 460,
        work.y + 120
      ),
      id: `iw-${kind}-${crypto.randomUUID()}`,
      prompt,
      imageMode: "edit" as const,
      imageBatchCount: 1 as const,
      refImageUrl: st.sourceUrl,
    };
    const variants: ("flare" | "sunburst")[] =
      readOpenAiImageVariantMode() === "both"
        ? ["flare", "sunburst"]
        : [readOpenAiImageVariantPref()];
    st = {
      ...st,
      ...(kind === "analysis"
        ? { analysisBlockId: child.id }
        : kind === "plate"
          ? { plateBlockId: child.id }
          : {
              objectBlockIds: { ...st.objectBlockIds, [objectId!]: child.id },
            }),
      generations: {
        ...st.generations,
        [child.id]: {
          status: "submitting",
          jobIds: [],
          expectedCount: kind === "analysis" ? 1 : variants.length,
          variants,
          prompt,
          sourceUrl: st.sourceUrl,
        },
      },
    };
    let next = { ...work, imageWorld: st };
    await onSave([
      { expected: work, next },
      { expected: null, next: child },
    ]);
    work = next;
    c.assert();
    let writes = Promise.resolve();
    const receipt = (jobId: string) => {
      writes = writes.then(async () => {
        c.assertIdentity();
        const generation = st.generations[child.id];
        st = {
          ...st,
          generations: {
            ...st.generations,
            [child.id]: {
              ...generation,
              jobIds: Array.from(new Set([...generation.jobIds, jobId])),
            },
          },
        };
        next = { ...work, imageWorld: st };
        await onSave([{ expected: work, next }]);
        work = next;
      });
      return writes;
    };
    const result = await onRun(
      child,
      st.sourceUrl,
      receipt,
      c.assert,
      variants
    );
    await writes;
    c.assert();
    const savedChild = { ...child, ...result, status: "done" as const };
    st = {
      ...st,
      generations: {
        ...st.generations,
        [child.id]: { ...st.generations[child.id], status: "returned" },
      },
    };
    // Persist the complete returned text before parsing; a schema failure keeps the evidence and candidate.
    next = { ...work, imageWorld: st };
    await onSave([
      { expected: work, next },
      { expected: child, next: savedChild },
    ]);
    work = next;
    if (kind === "analysis") {
      const parsed = parseImageWorldAnalysis(savedChild.outputText || "");
      c.assert();
      await onSave([
        {
          expected: work,
          next: { ...work, imageWorld: { ...st, plan: parsed } },
        },
      ]);
    }
    toast.success(
      kind === "analysis"
        ? "分析候选已保存，请核对物件与位置"
        : "新图片已保存，原图保留"
    );
  };
  const refreshImage = async (id: string) => {
    const c = context(false),
      g = c.state.generations[id],
      child = blocks.find(b => b.id === id);
    if (!g || !child) throw new Error("未找到原请求记录");
    if (child.kind === "text") {
      const answer = await utils.imageWorld.analysisStatus.fetch({
        requestId: child.id,
        sourceUri: g.sourceUrl,
      });
      c.assert();
      const result = { outputText: answer.text };
      const returned = {
        ...c.root,
        imageWorld: {
          ...c.state,
          generations: {
            ...c.state.generations,
            [id]: { ...g, status: "returned" as const },
          },
        },
      };
      await onSave([
        { expected: c.root, next: returned },
        { expected: child, next: { ...child, ...result, status: "done" } },
      ]);
      const parsed = parseImageWorldAnalysis(result.outputText || "");
      await onSave([
        {
          expected: returned,
          next: {
            ...returned,
            imageWorld: { ...returned.imageWorld, plan: parsed },
          },
        },
      ]);
      return;
    }
    if (!g.jobIds.length)
      throw new Error(
        "提交结果未确认且尚无任务编号，请在任务面板核对原提交，禁止重复生成"
      );
    const jobs = await Promise.all(g.jobIds.map(getJob));
    c.assert();
    if (jobs.some(j => j.status !== "succeeded")) {
      toast.message(
        jobs.some(j => j.status === "failed")
          ? "原任务失败，已保留回执，请核对任务面板"
          : "原任务仍在执行，请稍后查询"
      );
      return;
    }
    if (g.jobIds.length !== g.expectedCount)
      throw new Error(
        "还有图片请求的回执未确认，已保留查询结果，请核对任务面板"
      );
    const urls = jobs.flatMap(j => {
      const o = j.output as { imageUrl?: string; imageUrls?: string[] };
      return o?.imageUrls?.length
        ? o.imageUrls
        : o?.imageUrl
          ? [o.imageUrl]
          : [];
    });
    if (!urls.length) throw new Error("原任务未返回可使用图片");
    await onSave([
      {
        expected: c.root,
        next: {
          ...c.root,
          imageWorld: {
            ...c.state,
            generations: {
              ...c.state.generations,
              [id]: { ...g, status: "returned" },
            },
          },
        },
      },
      {
        expected: child,
        next: {
          ...child,
          outputUrl: urls[0],
          outputUrls: urls,
          status: "done",
        },
      },
    ]);
  };
  const prepareAmbience = async () => {
    const c = context();
    if (JSON.stringify(plan) !== JSON.stringify(c.state.plan))
      throw new Error("请先保存当前拆景方案");
    if (c.state.audioBlockId && blocks.some(b => b.id === c.state.audioBlockId))
      return;
    const cue = {
      ...createCanvasAudioCue("sfx", crypto.randomUUID(), 10),
      labelZh: "场景环境音",
      shotZh: c.state.plan.ambience,
      textZh: c.state.plan.ambience,
      endSec: 10,
      sourceEndSec: 10,
    };
    const child = {
      ...defaultCanvasBlock("video", c.root.x + 480, c.root.y + 280),
      id: `iw-audio-${crypto.randomUUID()}`,
      prompt: c.state.plan.ambience || "场景环境音",
      audioStudio: { ...emptyCanvasAudioStudio(), cues: [cue] },
    };
    await onSave([
      {
        expected: c.root,
        next: { ...c.root, imageWorld: { ...c.state, audioBlockId: child.id } },
      },
      { expected: null, next: child },
    ]);
  };
  const make3d = async (objectId?: string) => {
    const c = context(),
      key = objectId || "world",
      childId = objectId
        ? c.state.objectBlockIds[objectId]
        : c.state.plateBlockId,
      child = blocks.find(b => b.id === childId),
      url = generatedOutput(child);
    if (!child || !url)
      throw new Error("请先生成并核对对应的独立物件图或空场景图");
    if (JSON.stringify(plan) !== JSON.stringify(c.state.plan))
      throw new Error("请先保存当前方案");
    const obj = c.state.plan.objects.find(o => o.id === objectId);
    const prompt = objectId
      ? obj
        ? imageWorldObjectPrompt(obj)
        : ""
      : imageWorldPlatePrompt(c.state.plan);
    if (child.prompt !== prompt)
      throw new Error("方案已经修改，请先按新方案生成对应图片");
    if (!objectId) imageWorldEmptyPrompt(c.state.plan);
    const prior = objectId ? c.state.models[key] : c.state.world;
    if (prior && identity(prior.sourceVersion) === identity(url)) {
      if (
        !objectId &&
        prior.inputKey !== JSON.stringify({ plan: c.state.plan, model })
      )
        throw new Error(
          "此底图已有另一版空间任务；原候选已保留。请新建拆景方案制作新的空间版本，或用查询按钮查看原候选"
        );
      await refresh3d(objectId);
      return;
    }
    const pending = c.state.pending[key];
    const intent = pending ?? {
      kind: objectId ? ("object" as const) : ("world" as const),
      assetRef: child.id,
      sourceUri: manhuaAsset3dSourceIdentity(
        resolveUrlForCloudSync(url) || url
      ),
      name: obj?.name || "拆景场景",
      plan: c.state.plan,
      model,
    };
    if (
      pending &&
      (pending.assetRef !== child.id ||
        identity(pending.sourceUri) !== identity(url))
    )
      throw new Error("原三维提交仍待确认，不能换来源重复提交");
    if (
      !pending &&
      !window.confirm(
        "将以当前图片建立三维资产，会使用已有三维服务并产生费用。继续？"
      )
    )
      return;
    let st = { ...c.state, pending: { ...c.state.pending, [key]: intent } },
      work = { ...c.root, imageWorld: st };
    await onSave([{ expected: c.root, next: work }]);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    c.assert();
    const currentRoot = live.current.blocks.find(
      b => b.id === c.root.id
    )?.imageWorld;
    const currentChild = live.current.blocks.find(
      b => b.id === intent.assetRef
    );
    if (
      identity(generatedOutput(currentChild)) !== identity(intent.sourceUri) ||
      JSON.stringify(currentRoot?.pending[key]) !== JSON.stringify(intent)
    )
      throw new Error(
        "三维输入图片或原提交意图已经变化，未提交付费调用；原意图保留待核对"
      );
    const task =
      intent.kind === "object"
        ? await makeObject.mutateAsync({
            assetRef: intent.assetRef,
            sourceUri: intent.sourceUri,
          })
        : await makeWorld.mutateAsync({
            sceneRef: intent.assetRef,
            sourceUri: intent.sourceUri,
            name: intent.name,
            plan: intent.plan,
            model: intent.model,
          });
    c.assert();
    const receipt = {
      taskId: task.taskId,
      status: task.status,
      sourceVersion: task.sourceVersion,
      inputKey: JSON.stringify({ plan: intent.plan, model: intent.model }),
    };
    const { [key]: _done, ...rest } = st.pending;
    st = {
      ...st,
      pending: rest,
      ...(objectId
        ? { models: { ...st.models, [key]: receipt } }
        : { world: receipt }),
    };
    await onSave([{ expected: work, next: { ...work, imageWorld: st } }]);
    toast.success("三维任务已登记，可查询原任务");
  };
  const refresh3d = async (objectId?: string, adopt = false) => {
    if (!root?.imageWorld) return;
    const original = root,
      st = root.imageWorld,
      scope = scopeKey;
    const receipt = objectId ? st.models[objectId] : st.world,
      childId = objectId ? st.objectBlockIds[objectId] : st.plateBlockId,
      child = blocks.find(b => b.id === childId);
    if (!receipt || !child)
      throw new Error("尚无三维任务，请先提交或续查原提交");
    const task = objectId
      ? await utils.manhua3d.getStatus.fetch({ taskId: receipt.taskId })
      : await utils.manhuaWorld.getStatus.fetch({ taskId: receipt.taskId });
    if (
      !alive.current ||
      live.current.scopeKey !== scope ||
      live.current.rootId !== original.id
    )
      return;
    if (!task || task.sourceVersion !== receipt.sourceVersion)
      throw new Error("三维结果来源不一致，未采用");
    const next = {
      ...st,
      ...(objectId
        ? {
            models: {
              ...st.models,
              [objectId]: { ...receipt, status: task.status },
            },
          }
        : { world: { ...receipt, status: task.status } }),
    };
    let asset: ManhuaCustomAssetRef | undefined;
    if (adopt) {
      const c = context();
      c.assert();
      const object = objectId
        ? st.plan.objects.find(o => o.id === objectId)
        : undefined;
      const currentPrompt = object
        ? imageWorldObjectPrompt(object)
        : imageWorldPlatePrompt(st.plan);
      if (
        child.prompt !== currentPrompt ||
        (object && !object.selected) ||
        (!objectId &&
          receipt.inputKey !==
            JSON.stringify({
              plan: st.plan,
              model: (task as { model?: string }).model,
            }))
      )
        throw new Error("拆景方案已变化，原候选保留但不能作为当前方案采用");
      if (
        task.status !== "succeeded" ||
        identity(generatedOutput(child)) !== identity(task.sourceVersion)
      )
        throw new Error("结果尚未完成或来源已改变，未采用");
      const freshUrl = task.sourceVersion.startsWith("gs://")
        ? await resolveCanvasMaterialUrl(task.sourceVersion)
        : generatedOutput(child);
      c.assert();
      asset = {
        id: child.id,
        url: freshUrl,
        gcsUri: task.sourceVersion.startsWith("gs://")
          ? task.sourceVersion
          : undefined,
        role: objectId ? "prop" : "scene",
        labelZh: objectId
          ? st.plan.objects.find(o => o.id === objectId)?.name
          : "拆景场景",
        source: "generated",
        reviewStatus: "accepted",
        refDuty: objectId ? "style" : "space",
      };
      if ("assetRef" in task) {
        asset.model3d = { ...task, updatedAt: Date.parse(task.updatedAt) };
      } else asset.world3d = toManhuaWorld3dRef(task);
    }
    await onSave(
      [
        { expected: original, next: { ...original, imageWorld: next } },
        ...(asset ? [{ expected: child, next: child }] : []),
      ],
      asset
    );
    if (
      !alive.current ||
      live.current.scopeKey !== scope ||
      live.current.rootId !== original.id
    )
      return;
    if ("glbUrl" in task && task.glbUrl)
      setGlbs(v => ({ ...v, [objectId!]: task.glbUrl! }));
    toast.success(
      adopt ? "已采用到当前作品素材库" : `三维任务：${task.status}`
    );
  };
  const stale =
    state &&
    identity(output(blocks.find(b => b.id === state.sourceBlockId))) !==
      identity(state.sourceUrl);
  const audioBlock = blocks.find(b => b.id === state?.audioBlockId);
  const artSources = blocks.filter(b => b.kind === "image" && output(b));
  return (
    <section
      className="my-4 rounded-2xl border border-stone-300 bg-stone-50 p-4 text-stone-900"
      aria-label="图片拆景工作台"
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">图片拆景</h3>
          <p className="text-xs text-stone-600">
            从原图确认独立物件、补齐空场景，再分别建立物件模型与空间。
          </p>
        </div>
        <button className={button} onClick={() => setOpen(v => !v)}>
          {open ? "收起" : "打开工作台"}
        </button>
      </div>
      {open && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <select
              className={field}
              aria-label="拆景来源"
              value={sourceId}
              onChange={e => setSourceId(e.target.value)}
            >
              <option value="">选择图片节点</option>
              {artSources.map(b => (
                <option key={b.id} value={b.id}>
                  {b.prompt.slice(0, 40) || b.id}
                </option>
              ))}
            </select>
            <button
              className={button}
              disabled={busy || !sourceId}
              onClick={() => void run(newPlan)}
            >
              创建拆景方案
            </button>
            <select
              className={field}
              aria-label="拆景方案"
              value={root?.id || ""}
              onChange={e => setSelected(e.target.value)}
            >
              <option value="" disabled>
                已保存方案
              </option>
              {options.map(b => (
                <option key={b.id} value={b.id}>
                  {b.imageWorld?.plan.scene.slice(0, 40)}
                </option>
              ))}
            </select>
          </div>
          {state && (
            <>
              <img
                src={imageUrl(state.sourceUrl)}
                alt="拆景原图"
                className="max-h-64 rounded-lg"
              />
              {stale && (
                <p role="alert">来源图片已变，旧任务保留。请为新图创建方案。</p>
              )}
              <button
                className={button}
                disabled={busy || !!stale}
                onClick={() => void run(() => generate("analysis"))}
              >
                分析场景与独立物件
              </button>
              <label className="block">
                场景布局与光照
                <textarea
                  className={field + " block w-full"}
                  value={plan.scene}
                  maxLength={1600}
                  onChange={e => setPlan({ ...plan, scene: e.target.value })}
                />
              </label>
              <label className="block">
                环境声提示
                <textarea
                  className={field + " block w-full"}
                  value={plan.ambience}
                  maxLength={800}
                  onChange={e => setPlan({ ...plan, ambience: e.target.value })}
                />
              </label>
              <button
                className={button}
                disabled={busy || !!stale || !onAudioChange}
                onClick={() => void run(prepareAmbience)}
              >
                打开环境音编辑
              </button>
              {audioBlock && onAudioChange && (
                <div className="rounded-xl bg-neutral-950 p-4 text-white">
                  <p className="mb-3 text-sm">
                    导入真实环境音后裁切、试听与采用，可继续使用原合听工具。原曲生成只用于配乐，不会把音乐冒充环境音。
                  </p>
                  <CanvasAudioStudio
                    block={audioBlock}
                    timelineDurationSec={10}
                    dialogueSources={blocks}
                    disabled={busy || !!stale}
                    onChange={next => onAudioChange(audioBlock.id, next)}
                  />
                </div>
              )}
              {plan.objects.map((o, i) => (
                <div
                  className="space-y-2 rounded-xl border border-stone-200 bg-white p-3"
                  key={o.id}
                >
                  <label>
                    <input
                      type="checkbox"
                      checked={o.selected}
                      onChange={e =>
                        setPlan({
                          ...plan,
                          objects: plan.objects.map((x, k) =>
                            k === i ? { ...x, selected: e.target.checked } : x
                          ),
                        })
                      }
                    />{" "}
                    制作此独立物件
                  </label>
                  <input
                    className={field}
                    value={o.name}
                    aria-label="物件名称"
                    onChange={e =>
                      setPlan({
                        ...plan,
                        objects: plan.objects.map((x, k) =>
                          k === i ? { ...x, name: e.target.value } : x
                        ),
                      })
                    }
                  />
                  <input
                    className={field + " w-full"}
                    value={o.position}
                    aria-label="物件位置"
                    onChange={e =>
                      setPlan({
                        ...plan,
                        objects: plan.objects.map((x, k) =>
                          k === i ? { ...x, position: e.target.value } : x
                        ),
                      })
                    }
                  />
                  <textarea
                    className={field + " w-full"}
                    value={o.description}
                    aria-label="物件外观"
                    onChange={e =>
                      setPlan({
                        ...plan,
                        objects: plan.objects.map((x, k) =>
                          k === i ? { ...x, description: e.target.value } : x
                        ),
                      })
                    }
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={button}
                      disabled={busy || !!stale || !o.selected}
                      onClick={() => void run(() => generate("object", o.id))}
                    >
                      提取物件图
                    </button>
                    <button
                      className={button}
                      disabled={busy || !enabled || !!stale}
                      onClick={() => void run(() => make3d(o.id))}
                    >
                      {state.pending[o.id] ? "续查原三维提交" : "建立物件模型"}
                    </button>
                    <button
                      className={button}
                      disabled={busy || !state.models[o.id]}
                      onClick={() => void run(() => refresh3d(o.id))}
                    >
                      查询三维候选
                    </button>
                    <button
                      className={button}
                      disabled={
                        busy ||
                        !!stale ||
                        state.models[o.id]?.status !== "succeeded"
                      }
                      onClick={() => void run(() => refresh3d(o.id, true))}
                    >
                      采用物件
                    </button>
                  </div>
                  {generatedOutput(
                    blocks.find(b => b.id === state.objectBlockIds[o.id])
                  ) && (
                    <img
                      alt={o.name}
                      src={imageUrl(
                        generatedOutput(
                          blocks.find(b => b.id === state.objectBlockIds[o.id])
                        )
                      )}
                      className="max-h-48"
                    />
                  )}
                  {glbs[o.id] && (
                    <>
                      <ModelViewer glbUrl={glbs[o.id]} height={260} />
                      <a
                        className="underline"
                        href={glbs[o.id]}
                        target="_blank"
                        rel="noreferrer"
                      >
                        下载物件模型
                      </a>
                    </>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <button
                  className={button}
                  disabled={busy || !!stale}
                  onClick={() =>
                    setPlan({
                      ...plan,
                      objects: [
                        ...plan.objects,
                        {
                          id: crypto.randomUUID(),
                          name: "新物件",
                          description: "填写外观",
                          position: "填写位置",
                          selected: true,
                        },
                      ],
                    })
                  }
                >
                  添加独立物件
                </button>
                <button
                  className={button}
                  disabled={busy || !!stale}
                  onClick={() => void run(savePlan)}
                >
                  保存拆景方案
                </button>
                <button
                  className={button}
                  disabled={busy || !!stale}
                  onClick={() => void run(() => generate("plate"))}
                >
                  生成空场景底图
                </button>
              </div>
              {generatedOutput(
                blocks.find(b => b.id === state.plateBlockId)
              ) && (
                <img
                  alt="空场景底图"
                  className="max-h-64"
                  src={imageUrl(
                    generatedOutput(
                      blocks.find(b => b.id === state.plateBlockId)
                    )
                  )}
                />
              )}
              <div className="flex flex-wrap gap-2">
                <select
                  className={field}
                  aria-label="空间质量"
                  value={model}
                  onChange={e => setModel(e.target.value as typeof model)}
                >
                  <option value="marble-1.1">完整空间</option>
                  <option value="marble-1.0-draft">草稿空间</option>
                </select>
                <button
                  className={button}
                  disabled={busy || !enabled || !!stale}
                  onClick={() => void run(() => make3d())}
                >
                  {state.pending.world ? "续查原空间提交" : "建立三维空间"}
                </button>
                <button
                  className={button}
                  disabled={busy || !state.world}
                  onClick={() => void run(() => refresh3d())}
                >
                  查询空间候选
                </button>
                <button
                  className={button}
                  disabled={
                    busy || !!stale || state.world?.status !== "succeeded"
                  }
                  onClick={() => void run(() => refresh3d(undefined, true))}
                >
                  采用空间到场景库
                </button>
              </div>
              {!enabled && (
                <p className="text-xs">
                  三维制作仅对已开放三维权限的账号提供。
                </p>
              )}
              <p className="text-xs text-stone-600">
                物件是独立模型；空间是可浏览的静态场景，碰撞网格不等于完整可编辑模型。采用会保存到当前作品素材库。物件可在本工作台查询、预览和下载；空间可从场景库浏览。环境音可在原声音编辑器导入、裁切、试听与采用，不新增音效生成服务。
              </p>
              {Object.entries(state.generations).map(([id, g]) => (
                <div className="text-xs" key={id}>
                  图片／分析记录：{g.status} · {g.jobIds.length} 个回执{" "}
                  {g.status === "submitting" && (
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => void run(() => refreshImage(id))}
                    >
                      查询原任务
                    </button>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}
