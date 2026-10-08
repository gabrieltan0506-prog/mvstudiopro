import { creativeStudioAudioAssets } from "@/lib/creativeStudioAudio";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { resolveCanvasMaterialUrl } from "@/lib/omniCanvasApi";
import { trpc } from "@/lib/trpc";
import type { CanvasBlock } from "@/lib/canvasTypes";
import {
  artMotionSpecSchema,
  normalizeArtMotionJobStatus,
  defaultArtMotionSpec,
  ART_MOTION_CUE_KINDS,
  artMotionGrammarDraft,
  type ArtMotionSpec,
  type ArtMotionState,
} from "@shared/artMotion";
import {
  ART_MOTION_GRAMMARS,
  ART_MOTION_STYLES,
} from "@shared/artMotionCatalog";

type Props = {
  scopeKey: string;
  blocks: CanvasBlock[];
  onCreate(): Promise<string>;
  onSave(
    id: string,
    state: ArtMotionState,
    expected: ArtMotionState,
    adopt?: { url: string; gcsUri: string; useAsSegment?: boolean }
  ): Promise<void>;
};
const field =
  "rounded-lg border border-stone-300 bg-white p-2 text-sm text-stone-900";
const button =
  "rounded-lg border border-stone-400 bg-white px-3 py-2 text-sm text-stone-900 disabled:opacity-40";
export function ArtMotionStudio({ scopeKey, blocks, onCreate, onSave }: Props) {
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState("");
  const options = blocks.filter(b => b.artMotion);
  const target = options.find(b => b.id === selected) ?? options[0];
  const [draft, setDraft] = useState<ArtMotionSpec>(defaultArtMotionSpec);
  const [busy, setBusy] = useState(false),
    [previewSpec, setPreviewSpec] = useState<unknown>(null),
    [previewError, setPreviewError] = useState("");
  const [candidate, setCandidate] = useState<{
    url: string;
    gcsUri: string;
    requestId: string;
  } | null>(null);
  const [time, setTime] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null),
    alive = useRef(true),
    lock = useRef(false);
  const identity = useRef({ scopeKey, blockId: target?.id });
  identity.current = { scopeKey, blockId: target?.id };
  const utils = trpc.useUtils(),
    queue = trpc.mvAnalysis.queuePostProd.useMutation();
  const assets = useMemo(() => {
    const actual = [
      ...blocks.flatMap(b => b.uploadedAssets ?? []),
      ...creativeStudioAudioAssets(blocks),
    ].filter(a => a.gcsUri);
    const remembered = (target?.artMotion?.media ?? [])
      .filter(a => !actual.some(x => x.gcsUri === a.gcsUri))
      .map(a => ({
        id: a.id,
        fileName: a.name,
        kind: a.kind,
        gcsUri: a.gcsUri,
        url: "",
        mimeType: a.kind === "image" ? "image/png" : "audio/mpeg",
      }));
    return [...actual, ...remembered];
  }, [blocks, target?.artMotion?.media]);
  const images = assets.filter(a => a.kind === "image"),
    audio = assets.filter(a => a.kind === "audio");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent).detail?.blockId;
      if (blocks.some(b => b.id === id && b.artMotion)) {
        setSelected(id);
        setOpen(true);
      }
    };
    window.addEventListener("art-motion-open", handler);
    return () => window.removeEventListener("art-motion-open", handler);
  }, [blocks]);
  useEffect(() => {
    setDraft(target?.artMotion?.spec ?? defaultArtMotionSpec());
    setCandidate(null);
    setPreviewSpec(null);
    setPreviewError("");
  }, [scopeKey, target?.id]);
  useEffect(() => {
    const receive = (e: MessageEvent) => {
      if (
        e.source !== frame.current?.contentWindow ||
        e.origin !== location.origin
      )
        return;
      if (e.data?.type === "art-motion-awaiting" && previewSpec)
        frame.current?.contentWindow?.postMessage(
          { type: "art-motion-init", spec: previewSpec },
          location.origin
        );
      if (e.data?.type === "art-motion-error")
        setPreviewError(String(e.data.message));
    };
    addEventListener("message", receive);
    return () => removeEventListener("message", receive);
  }, [previewSpec]);
  const run = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await work();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "动画操作失败");
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const current = (scope: string, id: string) =>
    alive.current &&
    identity.current.scopeKey === scope &&
    identity.current.blockId === id;
  const rememberMedia = (spec: ArtMotionSpec) => {
    const selected = new Set(
      [spec.audioUri, ...spec.cues.map(c => c.imageUri)].filter(Boolean)
    );
    const old = target?.artMotion?.media ?? [];
    return [
      ...old,
      ...assets
        .filter(
          a =>
            a.gcsUri &&
            selected.has(a.gcsUri) &&
            !old.some(x => x.gcsUri === a.gcsUri) &&
            (a.kind === "image" || a.kind === "audio")
        )
        .map(a => ({
          id: a.id,
          name: a.fileName,
          kind: a.kind as "image" | "audio",
          gcsUri: a.gcsUri!,
        })),
    ];
  };
  const save = async () => {
    if (!target?.artMotion) return;
    const spec = artMotionSpecSchema.parse(draft);
    await onSave(
      target.id,
      { ...target.artMotion, spec, media: rememberMedia(spec) },
      target.artMotion
    );
    toast.success("动画方案已保存");
  };
  const preview = async () => {
    if(draft.stageAnimation)throw new Error("请在原3D场景播放动作与运镜；这里查看实际渲染视频候选");
    if (!target) return;
    const scope = scopeKey,
      id = target.id;
    const spec = artMotionSpecSchema.parse(draft);
    const cues = await Promise.all(
      spec.cues.map(async c => {
        if (c.imageUri && !images.some(a => a.gcsUri === c.imageUri))
          throw new Error("预览图片不在当前作品，请重新选择素材");
        const image = c.imageUri
          ? await resolveCanvasMaterialUrl(c.imageUri)
          : undefined;
        return { ...c, ...(image ? { image } : {}) };
      })
    );
    if (!current(scope, id)) return;
    setPreviewError("");
    setTime(0);
    setPreviewSpec(null);
    await new Promise<void>(r => setTimeout(r, 0));
    if (current(scope, id)) setPreviewSpec({ ...spec, cues });
  };
  const refresh = async () => {
    if (!target?.artMotion?.request?.jobId)
      throw new Error("请先提交或续查本次渲染");
    const { id, artMotion: state } = target,
      scope = scopeKey,
      request = state.request!;
    const job = await utils.mvAnalysis.getPostProdJob.fetch({
      jobId: request.jobId!,
    });
    if (!current(scope, id)) return;
    if (
      !job ||
      job.scopeKey !== scope ||
      job.action !== "art_motion" ||
      job.requestId !== request.id
    )
      throw new Error("任务不属于当前动画方案");
    const status = normalizeArtMotionJobStatus(job.status);
    const output = job.output as { url?: unknown; gcsUri?: unknown; stageAnimation?: unknown } | null;
    if (status === "succeeded" && request.spec.stageAnimation && (!output?.stageAnimation || typeof output.stageAnimation!=="object" || Object.entries(request.spec.stageAnimation).some(([key,value])=>(output.stageAnimation as Record<string,unknown>)[key]!==value)))
      throw new Error("场景动画回执来源不一致，未采用候选");
    const uri = typeof output?.gcsUri === "string" ? output.gcsUri : undefined;
    await onSave(
      id,
      {
        ...state,
        request: {
          ...request,
          status,
          ...(uri ? { gcsUri: uri } : {}),
          ...(job.error ? { error: job.error } : {}),
        },
      },
      state
    );
    if (
      current(scope, id) &&
      status === "succeeded" &&
      uri &&
      typeof output?.url === "string"
    )
      setCandidate({ url: output.url, gcsUri: uri, requestId: request.id });
  };
  const submit = async () => {
    if (!target?.artMotion) return;
    const { id, artMotion: state } = target,
      scope = scopeKey,
      spec = artMotionSpecSchema.parse(draft);
    const pending =
      state.request &&
      ["submitting", "queued", "running"].includes(state.request.status)
        ? state.request
        : undefined;
    if (pending && JSON.stringify(pending.spec) !== JSON.stringify(spec))
      throw new Error("原动画任务尚未结束，请先续查原任务");
    if (pending?.jobId) {
      await refresh();
      return;
    }
    const request = pending ?? {
      id: crypto.randomUUID(),
      spec,
      status: "submitting" as const,
    };
    const history = state.history ?? [];
    const saved = {
      ...state,
      spec,
      request,
      media: rememberMedia(spec),
      history:
        !pending && state.request
          ? [...history.filter(r => r.id !== state.request!.id), state.request]
          : history,
    };
    await onSave(id, saved, state);
    if (!current(scope, id)) return;
    const receipt = await queue.mutateAsync({
      action: "art_motion",
      scopeKey: scope,
      requestId: request.id,
      params: request.spec,
    });
    if (!current(scope, id)) return;
    await onSave(
      id,
      {
        ...saved,
        request: {
          ...request,
          jobId: receipt.jobId,
          status: normalizeArtMotionJobStatus(receipt.status),
        },
      },
      saved
    );
    toast.success("动画已提交，可用原任务继续查询");
  };
  const patch = (p: Partial<ArtMotionSpec>) => {
    setDraft(v => ({ ...v, ...p }));
    setPreviewSpec(null);
  };
  const patchCue = (i: number, p: Partial<ArtMotionSpec["cues"][number]>) =>
    patch({ cues: draft.cues.map((c, k) => (k === i ? { ...c, ...p } : c)) });
  return (
    <section
      className="my-4 rounded-2xl border border-stone-300 bg-stone-50 p-4 text-stone-900"
      aria-label="艺术动画工作台"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">艺术动画</h3>
          <p className="text-xs text-stone-600">
            独立制作单支影片，也可作为片头、转场或插入片段。
          </p>
        </div>
        <button className={button} onClick={() => setOpen(v => !v)}>
          {open ? "收起" : "打开工作台"}
        </button>
      </div>
      {open && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="动画方案"
              className={field}
              value={target?.id ?? ""}
              onChange={e => setSelected(e.target.value)}
            >
              <option value="" disabled>
                选择方案
              </option>
              {options.map(b => (
                <option key={b.id} value={b.id}>
                  {b.artMotion?.spec.title || b.prompt || "未命名动画"}
                </option>
              ))}
            </select>
            <button
              className={button}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const id = await onCreate();
                  if (alive.current) setSelected(id);
                })
              }
            >
              新建单支影片
            </button>
          </div>
          {target?.artMotion && (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <label>
                  名称
                  <input
                    className={field + " block w-full"}
                    value={draft.title}
                    maxLength={120}
                    onChange={e => patch({ title: e.target.value })}
                  />
                </label>
                <label>
                  画幅
                  <select
                    className={field + " block w-full"}
                    disabled={Boolean(draft.stageAnimation)}
                    value={`${draft.width}x${draft.height}`}
                    onChange={e => {
                      const [width, height] = e.target.value
                        .split("x")
                        .map(Number);
                      patch({
                        width: width as ArtMotionSpec["width"],
                        height: height as ArtMotionSpec["height"],
                      });
                    }}
                  >
                    {["1280x720", "720x1280", "1920x1080", "1080x1920"].map(
                      v => (
                        <option key={v}>{v}</option>
                      )
                    )}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap gap-3">
                <label>
                  类型
                  <select
                    className={field + " ml-2"}
                    disabled={Boolean(draft.stageAnimation)}
                    value={draft.mode}
                    onChange={e =>
                      patch({
                        mode: e.target.value as ArtMotionSpec["mode"],
                        alpha: false,
                        scenes: [
                          {
                            style: "17_ink",
                            duration: draft.duration,
                            transition: "fade",
                          },
                        ],
                      })
                    }
                  >
                    <option value="animation">解说与动态文字</option>
                    <option value="art">艺术场景与转场</option>
                  </select>
                </label>
                <label>
                  片长（秒）
                  <input
                    className={field + " ml-2 w-24"}
                    type="number"
                    min={1}
                    max={180}
                    value={draft.duration}
                    disabled={draft.mode === "art" || Boolean(draft.stageAnimation)}
                    onChange={e => patch({ duration: Number(e.target.value) })}
                  />
                </label>
              </div>
              {draft.stageAnimation ? (<p className="rounded-xl border border-stone-300 bg-white p-3 text-sm">动作、运镜、片长与画幅沿用本段已采用的动画工程。请在原3D场景播放预览；这里选择配乐、生成影片并查看实际候选。</p>) : draft.mode === "animation" ? (
                <>
                  <label>
                    动画样式
                    <select
                      className={field + " ml-2"}
                      value={draft.grammar}
                      onChange={e => {
                        setDraft(artMotionGrammarDraft(draft, e.target.value));
                        setPreviewSpec(null);
                      }}
                    >
                      {ART_MOTION_GRAMMARS.map(g => (
                        <option key={g.id} value={g.id}>
                          {g.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {draft.cues.map((cue, i) => (
                    <div
                      key={i}
                      className="grid gap-2 rounded-xl border border-stone-200 bg-white p-3 md:grid-cols-4"
                    >
                      <label>
                        出现秒位
                        <input
                          className={field + " w-full"}
                          type="number"
                          min={0}
                          step={0.1}
                          value={cue.at}
                          onChange={e =>
                            patchCue(i, { at: Number(e.target.value) })
                          }
                        />
                      </label>
                      <input
                        aria-label={`第${i + 1}段主文字`}
                        className={field}
                        value={cue.text ?? ""}
                        placeholder="主文字"
                        onChange={e => patchCue(i, { text: e.target.value })}
                      />
                      <input
                        aria-label={`第${i + 1}段副文字`}
                        className={field}
                        value={cue.sub ?? ""}
                        placeholder="补充说明"
                        onChange={e => patchCue(i, { sub: e.target.value })}
                      />
                      <div className="flex gap-2">
                        <select
                          className={field}
                          aria-label="段落类型"
                          value={cue.kind}
                          onChange={e =>
                            patchCue(i, {
                              kind: e.target.value as typeof cue.kind,
                            })
                          }
                        >
                          {[
                            ["title", "标题"],
                            ["point", "要点"],
                            ["card", "信息卡"],
                            ["number", "数字"],
                            ["image", "图片"],
                            ["draw", "绘画"],
                            ["highlight", "强调"],
                            ["enter", "深入概念"],
                            ["equation", "公式"],
                            ["line", "曲线"],
                            ["insert", "插入镜头"],
                            ["react", "反应镜头"],
                            ["step", "步骤"],
                            ["bar", "柱形图"],
                            ["candle", "蜡烛图"],
                          ]
                            .filter(([v]) =>
                              (
                                ART_MOTION_CUE_KINDS[draft.grammar] as string[]
                              ).includes(v)
                            )
                            .map(([v, l]) => (
                              <option key={v} value={v}>
                                {l}
                              </option>
                            ))}
                        </select>
                        <button
                          className={button}
                          onClick={() =>
                            patch({
                              cues: draft.cues.filter((_, k) => k !== i),
                            })
                          }
                        >
                          移除
                        </button>
                      </div>
                      {cue.kind === "image" && (
                        <select
                          className={field}
                          aria-label="动画图片"
                          value={cue.imageUri ?? ""}
                          onChange={e =>
                            patchCue(i, {
                              imageUri: e.target.value || undefined,
                            })
                          }
                        >
                          <option value="">选择已上传图片</option>
                          {images.map(a => (
                            <option key={a.id} value={a.gcsUri}>
                              {a.fileName}
                            </option>
                          ))}
                        </select>
                      )}
                      {(cue.kind === "number" ||
                        (cue.kind === "line" &&
                          draft.grammar === "t1_3b1b")) && (
                        <input
                          className={field}
                          aria-label="数值"
                          placeholder="曲线用逗号分隔多个数值"
                          value={
                            cue.kind === "line"
                              ? Array.isArray(cue.data?.values)
                                ? cue.data.values.join(",")
                                : ""
                              : String(cue.data?.value ?? 0)
                          }
                          onChange={e =>
                            patchCue(i, {
                              data: {
                                ...cue.data,
                                ...(cue.kind === "line"
                                  ? {
                                      values: e.target.value
                                        .split(/[,，]/)
                                        .map(Number),
                                    }
                                  : { value: Number(e.target.value) }),
                              },
                            })
                          }
                        />
                      )}
                    </div>
                  ))}
                  <button
                    className={button}
                    disabled={draft.cues.length >= 60}
                    onClick={() =>
                      patch({
                        cues: [
                          ...draft.cues,
                          {
                            at: Math.max(0, draft.duration - 1),
                            kind:
                              draft.grammar === "t2_keynote_ui"
                                ? "card"
                                : draft.grammar === "t3_finance_chart"
                                  ? "bar"
                                  : "point",
                            text: "新的段落",
                          },
                        ],
                      })
                    }
                  >
                    添加段落
                  </button>
                  {draft.grammar === "t3_finance_chart" && (
                    <label className="block">
                      图表数据（柱形／曲线：名称,数值；蜡烛图：名称,开,高,低,收）
                      <select
                        aria-label="图表类型"
                        className={field + " ml-2"}
                        value={String(draft.data.chart || "bar")}
                        onChange={e => {
                          const chart = e.target.value as
                            | "bar"
                            | "line"
                            | "candle";
                          patch({
                            data: {
                              ...draft.data,
                              chart,
                              series:
                                chart === "candle"
                                  ? [
                                      {
                                        label: "第一项",
                                        o: 10,
                                        h: 15,
                                        l: 8,
                                        c: 12,
                                      },
                                      {
                                        label: "第二项",
                                        o: 12,
                                        h: 17,
                                        l: 9,
                                        c: 14,
                                      },
                                    ]
                                  : [
                                      { label: "第一项", value: 10 },
                                      { label: "第二项", value: 20 },
                                    ],
                            },
                            cues: draft.cues.map(c =>
                              ["bar", "line", "candle"].includes(c.kind)
                                ? { ...c, kind: chart }
                                : c
                            ),
                          });
                        }}
                      >
                        <option value="bar">柱形</option>
                        <option value="line">折线</option>
                        <option value="candle">蜡烛图</option>
                      </select>
                      <textarea
                        className={field + " block w-full"}
                        value={(Array.isArray(draft.data.series)
                          ? draft.data.series
                          : []
                        )
                          .map(row =>
                            row &&
                            typeof row === "object" &&
                            !Array.isArray(row)
                              ? draft.data.chart === "candle"
                                ? `${row.label},${row.o},${row.h},${row.l},${row.c}`
                                : `${row.label},${row.value}`
                              : ""
                          )
                          .join("\n")}
                        onChange={e =>
                          patch({
                            data: {
                              ...draft.data,
                              title: draft.title,
                              series: e.target.value
                                .split("\n")
                                .filter(Boolean)
                                .map(
                                  (line): Record<string, string | number> => {
                                    const [label, ...numbers] =
                                      line.split(/[,，]/);
                                    const [value, h, l, c] =
                                      numbers.map(Number);
                                    return draft.data.chart === "candle"
                                      ? { label, o: value, h, l, c }
                                      : { label, value };
                                  }
                                ),
                            },
                          })
                        }
                      />
                    </label>
                  )}
                  <label className="ml-4">
                    <input
                      type="checkbox"
                      disabled={Boolean(draft.stageAnimation)}
                      checked={draft.alpha}
                      onChange={e => patch({ alpha: e.target.checked })}
                    />{" "}
                    透明背景（下载供合成的影片）
                  </label>
                </>
              ) : (
                <>
                  <p className="text-xs text-stone-600">
                    艺术场景是可组合的程序动画；选择风格不会自动把任意上传影片变成该画风。竖屏保留完整场景。
                  </p>
                  {draft.scenes.map((scene, i) => (
                    <div key={i} className="flex flex-wrap gap-2">
                      <select
                        className={field}
                        value={scene.style}
                        onChange={e =>
                          patch({
                            scenes: draft.scenes.map((s, k) =>
                              k === i ? { ...s, style: e.target.value } : s
                            ),
                          })
                        }
                      >
                        {ART_MOTION_STYLES.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <input
                        className={field + " w-24"}
                        type="number"
                        aria-label="场景秒数"
                        value={scene.duration}
                        min={0.5}
                        max={180}
                        step={0.5}
                        onChange={e => {
                          const scenes = draft.scenes.map((s, k) =>
                            k === i
                              ? { ...s, duration: Number(e.target.value) }
                              : s
                          );
                          patch({
                            scenes,
                            duration: scenes.reduce(
                              (s, c) => s + c.duration,
                              0
                            ),
                          });
                        }}
                      />
                      <select
                        className={field}
                        aria-label="转场"
                        value={scene.transition}
                        onChange={e =>
                          patch({
                            scenes: draft.scenes.map((s, k) =>
                              k === i
                                ? {
                                    ...s,
                                    transition: e.target
                                      .value as typeof scene.transition,
                                  }
                                : s
                            ),
                          })
                        }
                      >
                        {[
                          ["none", "直切"],
                          ["fade", "淡化"],
                          ["inkBloom", "墨晕"],
                          ["swirl", "旋涡"],
                          ["pixelate", "像素"],
                          ["shards", "碎片"],
                        ].map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                      <button
                        className={button}
                        disabled={draft.scenes.length === 1}
                        onClick={() => {
                          const scenes = draft.scenes.filter((_, k) => k !== i);
                          patch({
                            scenes,
                            duration: scenes.reduce(
                              (s, c) => s + c.duration,
                              0
                            ),
                          });
                        }}
                      >
                        移除
                      </button>
                    </div>
                  ))}
                  <button
                    className={button}
                    disabled={draft.scenes.length >= 35}
                    onClick={() =>
                      patch({
                        scenes: [
                          ...draft.scenes,
                          {
                            style: "14_8bit",
                            duration: 3,
                            transition: "pixelate",
                          },
                        ],
                        duration: draft.duration + 3,
                      })
                    }
                  >
                    添加艺术场景
                  </button>
                </>
              )}
              <label className="block">
                配音或音乐
                <select
                  className={field + " ml-2"}
                  value={draft.audioUri ?? ""}
                  onChange={e =>
                    patch({ audioUri: e.target.value || undefined })
                  }
                >
                  <option value="">无音轨</option>
                  {audio.map(a => (
                    <option key={a.id} value={a.gcsUri}>
                      {a.fileName}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => void run(save)}
                >
                  保存方案
                </button>
                {!draft.stageAnimation && <button
                  className={button}
                  disabled={busy}
                  onClick={() => void run(preview)}
                >
                  预览动画
                </button>}
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => void run(submit)}
                >
                  {target.artMotion.request?.status === "submitting"
                    ? "续查原提交"
                    : "生成影片"}
                </button>
                <button
                  className={button}
                  disabled={busy || !target.artMotion.request?.jobId}
                  onClick={() => void run(refresh)}
                >
                  更新任务与候选
                </button>
              </div>
              <p className="text-xs text-stone-600">
                预览展示画面；配音在正式渲染中合入。渲染使用工作机，不调用视频生成模型。
                {target.artMotion.request &&
                  ` 当前任务：${target.artMotion.request.status}${target.artMotion.request.error ? " · " + target.artMotion.request.error : ""}`}
              </p>
              {previewSpec !== null && (
                <div className="rounded-xl border border-stone-300 bg-white p-3">
                  <iframe
                    key={JSON.stringify(previewSpec)}
                    ref={frame}
                    title="艺术动画预览"
                    src="/art-motion/engine/studio.html"
                    className="h-80 w-full"
                  />
                  <div className="mt-2 flex gap-3">
                    <button
                      className={button}
                      onClick={() =>
                        frame.current?.contentWindow?.postMessage(
                          { type: "art-motion-play" },
                          location.origin
                        )
                      }
                    >
                      播放／暂停
                    </button>
                    <input
                      aria-label="动画预览秒位"
                      type="range"
                      min={0}
                      max={draft.duration}
                      step={1 / draft.fps}
                      value={time}
                      onChange={e => {
                        setTime(Number(e.target.value));
                        frame.current?.contentWindow?.postMessage(
                          {
                            type: "art-motion-seek",
                            time: Number(e.target.value),
                          },
                          location.origin
                        );
                      }}
                    />
                  </div>
                  {previewError && <p role="alert">{previewError}</p>}
                </div>
              )}
              {(target.artMotion.history ?? []).length > 0 && (
                <details>
                  <summary>历史渲染与方案</summary>
                  {target.artMotion.history.map(r => (
                    <div className="my-2 flex gap-2" key={r.id}>
                      <span>
                        {r.spec.title || "未命名动画"} · {r.status}
                      </span>
                      <button
                        className={button}
                        disabled={
                          busy ||
                          (!!target.artMotion?.request &&
                            ["submitting", "queued", "running"].includes(
                              target.artMotion.request.status
                            ))
                        }
                        onClick={() =>
                          void run(async () => {
                            const state = target.artMotion!;
                            await onSave(
                              target.id,
                              {
                                ...state,
                                spec: r.spec,
                                request: r,
                                history: [
                                  ...state.history.filter(x => x.id !== r.id),
                                  ...(state.request ? [state.request] : []),
                                ],
                              },
                              state
                            );
                            setDraft(r.spec);
                            setCandidate(null);
                            toast.success("已恢复历史方案，请更新任务与候选");
                          })
                        }
                      >
                        恢复此方案
                      </button>
                    </div>
                  ))}
                </details>
              )}
              {target.artMotion.request &&
                JSON.stringify(draft) !==
                  JSON.stringify(target.artMotion.request.spec) && (
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const state = target.artMotion!;
                        await onSave(
                          target.id,
                          { ...state, spec: state.request!.spec },
                          state
                        );
                        setDraft(state.request!.spec);
                        setPreviewSpec(null);
                      })
                    }
                  >
                    恢复当前候选的方案
                  </button>
                )}
              {candidate && (
                <div className="space-y-2">
                  <p>实际渲染候选</p>
                  {target.artMotion.request?.spec.alpha ? (
                    <a href={candidate.url} target="_blank" rel="noreferrer">
                      下载透明影片
                    </a>
                  ) : (
                    <video
                      src={candidate.url}
                      controls
                      className="max-h-96 w-full"
                    />
                  )}
                  <button
                    className={button}
                    disabled={
                      busy ||
                      JSON.stringify(draft) !==
                        JSON.stringify(target.artMotion.request?.spec)
                    }
                    onClick={() =>
                      void run(async () => {
                        if (
                          !target.artMotion ||
                          target.artMotion.request?.id !==
                            candidate.requestId ||
                          JSON.stringify(target.artMotion.spec) !==
                            JSON.stringify(target.artMotion.request.spec)
                        )
                          throw new Error("方案已变化，请先核对候选来源");
                        await onSave(
                          target.id,
                          target.artMotion,
                          target.artMotion,
                          candidate
                        );
                        toast.success("已采用到画布影片节点");
                      })
                    }
                  >
                    采用到画布
                  </button>
                  {draft.stageAnimation && <button className={button} disabled={busy || JSON.stringify(draft)!==JSON.stringify(target.artMotion.request?.spec)} onClick={()=>void run(async()=>{
                    const state=target.artMotion;
                    if(!state || state.request?.id!==candidate.requestId || JSON.stringify(state.spec)!==JSON.stringify(state.request.spec))throw new Error("方案已变化，请重新核对候选");
                    if(!window.confirm("把已播放检查的这份动画作为原分段的当前剪辑版本？原视频版本与音轨配置仍保留。"))return;
                    await onSave(target.id,state,state,{...candidate,useAsSegment:true});
                    toast.success("已采用为本段剪辑版本，可在整集剪辑中查看");
                  })}>采用为本段剪辑版本</button>}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
