import { useEffect, useRef, useState } from "react";
import type { CanvasBlock } from "@/lib/canvasTypes";
import type {
  CanvasMusicCandidate,
  CanvasMusicMvPlan,
} from "@shared/canvasMusicMv";
import {
  commitMusicMvEdit,
  undoMusicMvEdit,
  redoMusicMvEdit,
  reorderMusicMvClip,
  trimMusicMvClip,
  splitMusicMvClip,
  musicMvEditPositions,
  musicMvEditKey,
  musicMvEditIssues,
  bindMusicMvStockFootage,
  isMusicMvStockSource,
  musicMvClipReadiness,
  musicMvEditMaterialGap,
  type MusicMvEditClip,
  type MusicMvEditDocument,
  type MusicMvEditSession,
} from "@shared/canvasMusicMvEdit";
import {
  initialMusicMvEdit,
  syncMusicMvEditSources,
} from "@/lib/canvasMusicMvEditWorkflow";
import { resolveMusicMvMediaUrl } from "@/lib/musicMvAdvisor";
import { trpc } from "@/lib/trpc";
import {
  StockFootageDrawer,
  type StockFootagePick,
} from "@/components/stockFootage/StockFootageDrawer";
import { stockTrimToFrames } from "@shared/stockFootageTrim";

type Props = {
  plan: CanvasMusicMvPlan;
  baseId: string;
  audio: CanvasMusicCandidate;
  blocks: CanvasBlock[];
  shotIds: string[];
  session?: MusicMvEditSession;
  onSession: (s: MusicMvEditSession) => void;
  disabled: boolean;
  /** 仅作图库采用记录的归属筛选，不作权限依据。 */
  projectId?: string;
  orientation?: "landscape" | "portrait";
};
const button =
  "rounded border border-white/20 px-2 py-1 text-xs disabled:opacity-40";
const READINESS_LABEL = {
  ready: "已就绪",
  syncable: "待同步",
  missing: "待素材",
} as const;
/** 已采用图库片段的缩略画面：按入点取一帧，签名地址只在本机临时使用，不写回草稿。 */
function StockClipThumb({ url, inFrame }: { url: string; inFrame: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let stop = false;
    setSrc("");
    resolveMusicMvMediaUrl(url)
      .then(u => {
        if (!stop) setSrc(u);
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [url]);
  if (!src) return null;
  return (
    <video
      aria-hidden
      src={`${src}#t=${(inFrame / 30).toFixed(2)}`}
      preload="metadata"
      muted
      playsInline
      className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-50"
    />
  );
}
export function CanvasMvTimelineEditor(p: Props) {
  const [initial] = useState(() =>
    initialMusicMvEdit(p.plan, p.baseId, p.shotIds)
  );
  const s = p.session || { draft: initial, undo: [], redo: [], versions: [] };
  const current = useRef({ p, s });
  current.current = { p, s };
  const [selected, setSelected] = useState(s.draft.clips[0]?.id || "");
  const [frame, setFrame] = useState(0);
  const frameRef = useRef(0);
  frameRef.current = frame;
  const [zoom, setZoom] = useState(24);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [drawerFor, setDrawerFor] = useState("");
  const [preview, setPreview] = useState<{ id: string; url: string }>();
  const [songUrl, setSongUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const save = trpc.canvasMusicMv.saveEdit.useMutation({ retry: false });
  const utils = trpc.useUtils();
  const positions = musicMvEditPositions(s.draft);
  const active = positions.find(
    c => frame >= c.startFrame && frame < c.endFrame
  );
  const clip = s.draft.clips.find(c => c.id === selected);
  const put = (next: MusicMvEditSession) => {
    current.current = { ...current.current, s: next };
    p.onSession(next);
  };
  const change = (doc: MusicMvEditDocument) => {
    if (current.current.p.disabled || lock.current) return;
    try {
      put(commitMusicMvEdit(current.current.s, doc));
      setError("");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };
  const action = async (fn: () => Promise<void>) => {
    if (lock.current || p.disabled) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    let stop = false;
    resolveMusicMvMediaUrl(p.audio.gcsUri || p.audio.url)
      .then(url => {
        if (!stop) setSongUrl(url);
      })
      .catch(e => {
        if (!stop) setError(String(e));
      });
    return () => {
      stop = true;
    };
  }, [p.audio.gcsUri, p.audio.url]);
  useEffect(() => {
    let stop = false;
    setPreview(undefined);
    if (active?.clip.source)
      resolveMusicMvMediaUrl(active.clip.source.url)
        .then(url => {
          if (!stop) setPreview({ id: active.clip.id, url });
        })
        .catch(e => {
          if (!stop) {
            setError(String(e));
            setPlaying(false);
          }
        });
    return () => {
      stop = true;
    };
  }, [active?.clip.id, active?.clip.source?.url]);
  const align = () => {
    const v = video.current;
    const at = musicMvEditPositions(current.current.s.draft).find(
      c => frameRef.current >= c.startFrame && frameRef.current < c.endFrame
    );
    if (v && at && preview?.id === at.clip.id) {
      const t = (at.clip.sourceInFrame + frameRef.current - at.startFrame) / 30;
      if (Math.abs(v.currentTime - t) > 0.12) v.currentTime = t;
    }
  };
  useEffect(() => {
    align();
    if (playing && video.current && preview?.id === active?.clip.id)
      void video.current.play().catch(() => setPlaying(false));
  }, [frame, preview, playing]);
  useEffect(() => {
    if (!playing) {
      audio.current?.pause();
      video.current?.pause();
      return;
    }
    let raf = 0;
    const tick = () => {
      if (audio.current) {
        const next = Math.round(audio.current.currentTime * 30);
        frameRef.current = next;
        setFrame(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  useEffect(() => {
    setPlaying(false);
  }, [musicMvEditKey(s.draft)]);
  const shotNo = (shotId: string) =>
    String(Math.max(1, p.plan.shots.findIndex(x => x.id === shotId) + 1)).padStart(2, "0");
  const shotText = (c: MusicMvEditClip) => {
    const shot = p.plan.shots.find(x => x.id === c.shotId);
    return (
      (shot
        ? [shot.visualPrompt, shot.cameraPrompt, shot.lyricQuote]
            .filter(Boolean)
            .join("；")
        : "") || c.title
    ).slice(0, 1000);
  };
  // 尚无剪辑会话时合成直接取画布已完成镜头，「待同步」即等同已就绪；有会话后合成只认草稿中已绑定的源。
  const readiness = (c: MusicMvEditClip) => {
    const r = musicMvClipReadiness(c, p.blocks);
    return !p.session && r === "syncable" ? "ready" : r;
  };
  const rawGap = musicMvEditMaterialGap(s.draft, p.blocks);
  const gap = p.session
    ? rawGap
    : { missing: rawGap.missing - rawGap.syncable, syncable: 0 };
  const drawerClip = s.draft.clips.find(
    c => c.id === drawerFor && c.kind !== "singing"
  );
  const openDrawer = (c: MusicMvEditClip) => {
    if (c.kind === "singing" || busy || p.disabled) return;
    setSelected(c.id);
    setDrawerFor(c.id);
  };
  // 抽屉采用成功后按所选入出点写入剪辑草稿（可撤销）；保存时服务端凭 assetId 核对本人采用记录与实测时长。
  const pickStock = async (clipId: string, pick: StockFootagePick) => {
    if (current.current.p.disabled || lock.current) {
      const message = "正在保存或处理中，素材已采用，请稍后重新选用";
      setError(message);
      throw new Error(message);
    }
    try {
      const trim = stockTrimToFrames({ inSec: pick.inSec, outSec: pick.outSec }, 30);
      const next = bindMusicMvStockFootage(
        current.current.s.draft,
        clipId,
        pick.asset,
        trim
      );
      put(commitMusicMvEdit(current.current.s, next));
      setDrawerFor("");
      setError("");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      throw new Error(message);
    }
  };
  const seek = (f: number) => {
    const next = Math.max(0, Math.min(Math.round(p.audio.durationSec * 30), f));
    frameRef.current = next;
    setFrame(next);
    if (audio.current) audio.current.currentTime = next / 30;
  };
  const edge = (
    event: React.PointerEvent,
    side: "left" | "right",
    id: string
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy || p.disabled) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const original = current.current.s.draft;
    const c = original.clips.find(c => c.id === id)!;
    const x = event.clientX;
    const finish = (end: PointerEvent) => {
      target.removeEventListener("pointerup", finish);
      target.removeEventListener("pointercancel", cancel);
      const delta = Math.round(((end.clientX - x) / zoom) * 30);
      const max = Math.floor((c.source?.durationSec ?? 3600) * 30);
      const adjusted =
        side === "left"
          ? Math.max(-c.sourceInFrame, Math.min(delta, c.durationFrames - 15))
          : Math.max(
              15 - c.durationFrames,
              Math.min(delta, max - c.sourceInFrame - c.durationFrames)
            );
      change(
        trimMusicMvClip(
          original,
          id,
          c.sourceInFrame + (side === "left" ? adjusted : 0),
          c.durationFrames + (side === "left" ? -adjusted : adjusted)
        )
      );
    };
    const cancel = () => {
      target.removeEventListener("pointerup", finish);
      target.removeEventListener("pointercancel", cancel);
    };
    target.addEventListener("pointerup", finish);
    target.addEventListener("pointercancel", cancel);
  };
  return (
    <section
      aria-label="MV时间轴剪辑"
      className="space-y-2 rounded border border-cyan-400/30 p-2 text-xs"
    >
      <strong>时间轴剪辑 · 拖动排序，拖边裁切</strong>
      <p>歌曲保持原速，画面顺接。编辑和保存免费；预览直接播放已有素材。</p>
      <div className="flex flex-wrap gap-1">
        <button
          className={button}
          disabled={busy || p.disabled}
          onClick={() =>
            void action(async () => {
              const before = current.current.s;
              const doc = await syncMusicMvEditSources(before.draft, p.blocks);
              if (
                musicMvEditKey(current.current.s.draft) !==
                musicMvEditKey(before.draft)
              )
                throw new Error("同步期间草稿已变化，请重新同步");
              put(commitMusicMvEdit(current.current.s, doc));
            })
          }
        >
          同步已有镜头
        </button>
        <button
          className={button}
          disabled={busy || p.disabled || !s.undo.length}
          onClick={() => put(undoMusicMvEdit(current.current.s))}
        >
          撤销
        </button>
        <button
          className={button}
          disabled={busy || p.disabled || !s.redo.length}
          onClick={() => put(redoMusicMvEdit(current.current.s))}
        >
          重做
        </button>
        <button
          className={button}
          disabled={busy || p.disabled}
          onClick={() =>
            void action(async () => {
              const before = current.current.s;
              const pending = before.pending || {
                revisionId: crypto.randomUUID(),
                document: before.draft,
              };
              put({ ...before, pending });
              const receipt = await save.mutateAsync(pending);
              const now = current.current.s;
              if (now.pending?.revisionId !== pending.revisionId) return;
              put({
                ...now,
                pending: undefined,
                saved: receipt,
                versions: [
                  ...now.versions.filter(
                    r => r.revisionId !== receipt.revisionId
                  ),
                  receipt,
                ],
              });
            })
          }
        >
          {s.pending ? "恢复原保存" : "保存剪辑版本"}
        </button>
      </div>
      <p>
        {s.saved && musicMvEditKey(s.saved.document) === musicMvEditKey(s.draft)
          ? "当前剪辑已保存"
          : "有未保存剪辑"}{" "}
        · {s.draft.clips.length} 个片段
        {gap.missing > 0 && (
          <span className="text-amber-200">
            {" "}· 还缺 {gap.missing} 个镜头素材
            {gap.syncable > 0 && `（其中 ${gap.syncable} 个已有画面，点「同步已有镜头」）`}
          </span>
        )}
      </p>
      <ol aria-label="镜头清单" className="space-y-1">
        {s.draft.clips.map(c => {
          const ready = readiness(c);
          return (
            <li
              key={c.id}
              data-testid={`mv-shot-row-${c.id}`}
              className={`flex flex-wrap items-center gap-1 rounded px-1 ${selected === c.id ? "bg-cyan-900/40" : ""}`}
            >
              <button
                type="button"
                className="text-left underline-offset-2 hover:underline"
                onClick={() => {
                  setSelected(c.id);
                  const pos = positions.find(r => r.clip.id === c.id);
                  if (pos) seek(pos.startFrame);
                }}
              >
                镜头{shotNo(c.shotId)} · {c.title.slice(0, 24)} ·{" "}
                {(c.durationFrames / 30).toFixed(1)}秒
                {c.kind === "singing" ? " · 对口型" : ""}
              </button>
              <span
                className={`rounded px-1 ${ready === "ready" ? "bg-emerald-700/60" : ready === "syncable" ? "bg-sky-700/60" : "bg-amber-700/60"}`}
              >
                {READINESS_LABEL[ready]}
                {ready === "ready" && isMusicMvStockSource(c.source) ? " · 图库" : ""}
              </span>
              {c.kind !== "singing" && (
                <button
                  type="button"
                  className={button}
                  disabled={busy || p.disabled}
                  onClick={() => openDrawer(c)}
                >
                  {isMusicMvStockSource(c.source) ? "换素材" : "找素材"}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <label>
        时间轴缩放{" "}
        <input
          aria-label="时间轴缩放"
          type="range"
          min={4}
          max={100}
          value={zoom}
          onChange={e => setZoom(Number(e.target.value))}
        />
      </label>
      <div
        className="overflow-x-auto rounded bg-black/40"
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault();
          if (e.target === e.currentTarget) {
            const id = e.dataTransfer.getData("text/mv-clip");
            if (id)
              change(reorderMusicMvClip(s.draft, id, s.draft.clips.length));
          }
        }}
      >
        <div
          style={{
            width: Math.max(
              400,
              Math.max(
                p.audio.durationSec,
                (positions.at(-1)?.endFrame || 0) / 30
              ) * zoom
            ),
            position: "relative",
          }}
        >
          <div
            aria-label="时间尺"
            className="relative h-7 cursor-crosshair"
            onClick={e =>
              seek(
                Math.round(
                  ((e.clientX - e.currentTarget.getBoundingClientRect().left) /
                    zoom) *
                    30
                )
              )
            }
          >
            {Array.from(
              {
                length:
                  Math.ceil(
                    Math.max(
                      p.audio.durationSec,
                      (positions.at(-1)?.endFrame || 0) / 30
                    ) / 5
                  ) + 1,
              },
              (_, i) => (
                <span
                  key={i}
                  style={{ position: "absolute", left: i * 5 * zoom }}
                >
                  {i * 5}s
                </span>
              )
            )}
          </div>
          <div className="flex h-16">
            {positions.map(({ clip: c, startFrame }) => (
              <div
                key={c.id}
                draggable={!busy && !p.disabled}
                data-testid={`mv-clip-${c.id}`}
                onDragStart={e => e.dataTransfer.setData("text/mv-clip", c.id)}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  const id = e.dataTransfer.getData("text/mv-clip");
                  if (id)
                    change(
                      reorderMusicMvClip(
                        s.draft,
                        id,
                        s.draft.clips.findIndex(x => x.id === c.id)
                      )
                    );
                }}
                onClick={e => {
                  setSelected(c.id);
                  seek(startFrame);
                  // 拖边裁切结束时的点击不弹抽屉；点占位本身才打开找素材。
                  if (
                    !c.source &&
                    (e.target as HTMLElement).getAttribute("role") !== "slider"
                  )
                    openDrawer(c);
                }}
                title={
                  c.source
                    ? undefined
                    : c.kind === "singing"
                      ? "对口型镜头待素材，请生成或同步原唱段"
                      : "点击为此镜头找素材"
                }
                style={{ width: (c.durationFrames / 30) * zoom, minWidth: 4 }}
                className={`relative shrink-0 overflow-hidden p-2 ${c.source ? "border" : "border-2 border-dashed"} ${selected === c.id ? "border-cyan-200 bg-cyan-800/60" : c.source ? "border-white/20 bg-slate-700" : "cursor-pointer border-amber-300/60 bg-slate-900/60"}`}
              >
                {c.source && isMusicMvStockSource(c.source) && (
                  <StockClipThumb url={c.source.url} inFrame={c.sourceInFrame} />
                )}
                <span
                  role="slider"
                  aria-label={`${c.title}入点拖柄`}
                  onPointerDown={e => edge(e, "left", c.id)}
                  className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-white/20"
                />
                {c.source ? (
                  <span className="pointer-events-none relative">
                    {c.title.slice(0, 25)}
                    <br />
                    {(c.durationFrames / 30).toFixed(2)}秒
                    {isMusicMvStockSource(c.source) ? " ·图库" : ""}
                  </span>
                ) : (
                  <span className="pointer-events-none relative text-amber-100">
                    {c.kind === "singing" ? "" : "＋ "}镜头{shotNo(c.shotId)}{" "}
                    {c.title.slice(0, 12)}…
                    <br />（{(c.durationFrames / 30).toFixed(1)} 秒，待素材）
                  </span>
                )}
                <span
                  role="slider"
                  aria-label={`${c.title}出点拖柄`}
                  onPointerDown={e => edge(e, "right", c.id)}
                  className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-white/20"
                />
              </div>
            ))}
          </div>
          <div
            className="h-6 bg-emerald-800/50"
            style={{ width: p.audio.durationSec * zoom }}
          >
            歌曲主轨 · {p.audio.title}
          </div>
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-red-300"
            style={{ left: (frame / 30) * zoom }}
          />
        </div>
      </div>
      {clip && (
        <fieldset disabled={busy || p.disabled} className="space-y-1">
          <legend>所选片段 · {clip.title.slice(0, 40)}</legend>
          <label>
            源入点（秒）
            <input
              key={`${clip.id}-in-${clip.sourceInFrame}`}
              aria-label="源入点"
              type="number"
              min={0}
              step={1 / 30}
              defaultValue={clip.sourceInFrame / 30}
              onBlur={e => {
                try {
                  change(
                    trimMusicMvClip(
                      s.draft,
                      clip.id,
                      Math.round(Number(e.target.value) * 30),
                      clip.durationFrames
                    )
                  );
                } catch (e) {
                  setError(String(e));
                }
              }}
            />
          </label>
          <label>
            源出点（秒）
            <input
              key={`${clip.id}-out-${clip.sourceInFrame + clip.durationFrames}`}
              aria-label="源出点"
              type="number"
              min={0.5}
              step={1 / 30}
              defaultValue={(clip.sourceInFrame + clip.durationFrames) / 30}
              onBlur={e => {
                try {
                  change(
                    trimMusicMvClip(
                      s.draft,
                      clip.id,
                      clip.sourceInFrame,
                      Math.round(Number(e.target.value) * 30) -
                        clip.sourceInFrame
                    )
                  );
                } catch (e) {
                  setError(String(e));
                }
              }}
            />
          </label>
          <button
            className={button}
            onClick={() => {
              try {
                const pos = positions.find(r => r.clip.id === clip.id)!;
                change(
                  splitMusicMvClip(
                    s.draft,
                    clip.id,
                    frame - pos.startFrame,
                    crypto.randomUUID()
                  )
                );
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            在播放头分割
          </button>
          <button
            className={button}
            onClick={() =>
              change({
                ...s.draft,
                clips: s.draft.clips.filter(c => c.id !== clip.id),
              })
            }
          >
            移除片段（保留原片）
          </button>
          {clip.kind !== "singing" && (
            <button
              className={button}
              aria-haspopup="dialog"
              onClick={() => openDrawer(clip)}
            >
              {isMusicMvStockSource(clip.source) ? "换素材" : "找素材"}
            </button>
          )}
        </fieldset>
      )}
      <details>
        <summary>追加原镜头</summary>
        {initial.clips.map(c => (
          <button
            key={c.id}
            className={button}
            disabled={busy || p.disabled}
            onClick={() =>
              change({
                ...s.draft,
                clips: [...s.draft.clips, { ...c, id: crypto.randomUUID() }],
              })
            }
          >
            {c.title.slice(0, 30)}
          </button>
        ))}
      </details>
      <div className="rounded bg-black p-1">
        {preview && active?.clip.id === preview.id ? (
          <video
            ref={video}
            src={preview.url}
            muted
            playsInline
            onLoadedMetadata={align}
            onError={() => {
              setError("当前视频无法播放，请同步素材或恢复地址");
              setPlaying(false);
            }}
            className="max-h-52 w-full"
          />
        ) : (
          <p>当前位置尚无可播放画面</p>
        )}
        <audio
          ref={audio}
          src={songUrl}
          onEnded={() => setPlaying(false)}
          onError={() => {
            setError("歌曲播放失败");
            setPlaying(false);
          }}
        />
        <button
          className={button}
          disabled={!songUrl}
          onClick={() => {
            if (playing) setPlaying(false);
            else {
              if (frame >= Math.round(p.audio.durationSec * 30)) seek(0);
              void audio.current
                ?.play()
                .then(() => setPlaying(true))
                .catch(e => setError(String(e)));
            }
          }}
        >
          {playing ? "暂停" : "播放剪辑预览"}
        </button>
        <input
          aria-label="播放位置"
          type="range"
          min={0}
          max={Math.round(p.audio.durationSec * 30)}
          value={frame}
          onChange={e => seek(Number(e.target.value))}
        />
        <span>{(frame / 30).toFixed(2)}秒</span>
      </div>
      <details>
        <summary>保存的版本（{s.versions.length}）</summary>
        {s.versions.map(r => (
          <button
            className={button}
            key={r.revisionId}
            disabled={busy || p.disabled}
            onClick={() =>
              void action(async () => {
                const receipt = await utils.canvasMusicMv.getEdit.fetch({
                  basePlanRequestId: p.baseId,
                  revisionId: r.revisionId,
                });
                put({
                  ...commitMusicMvEdit(current.current.s, receipt.document),
                  saved: receipt,
                });
              })
            }
          >
            恢复 {r.createdAt}
          </button>
        ))}
      </details>
      {musicMvEditIssues(s.draft, p.plan).map((m, i) => (
        <p key={i} className="text-amber-200">
          {m}
        </p>
      ))}
      {error && (
        <p role="alert" className="text-amber-200">
          {error}
        </p>
      )}
      {drawerClip && (
        <StockFootageDrawer
          open
          onClose={() => setDrawerFor("")}
          title={`为镜头${shotNo(drawerClip.shotId)}找素材`}
          purpose="mv"
          usage="insert"
          kind="video"
          orientation={p.orientation}
          targetDurationSec={drawerClip.durationFrames / 30}
          sourceText={shotText(drawerClip)}
          context={{
            projectId: p.projectId || undefined,
            shotId: drawerClip.shotId,
          }}
          onPick={pick => pickStock(drawerClip.id, pick)}
        />
      )}
    </section>
  );
}
