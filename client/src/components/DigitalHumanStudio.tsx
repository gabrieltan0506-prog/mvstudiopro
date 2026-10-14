import { recoverDigitalHumanDraft } from "@/lib/digitalHumanRecovery";
import { DigitalHumanRecorder } from "./DigitalHumanRecorder";
import { inspectDigitalHumanRecording } from "@/lib/digitalHumanRecording";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { uploadOneCanvasAsset } from "@/lib/canvasUpload";
import { getJobForPoll } from "@/lib/jobs";
import { gsUriFromSignedGcsUrl } from "@shared/manhuaMultiview";
import {
  currentDigitalHumanAudio,
  digitalHumanVideoFailureStatus,
  digitalHumanDraftKey,
  digitalHumanDraftSchema,
  digitalHumanPending,
  digitalHumanVideoFingerprint,
  loadDigitalHumanDraft,
  newDigitalHumanDraft,
  prepareDigitalHumanVideo,
  type DigitalHumanDraft,
  type DigitalHumanVideo,
} from "@shared/digitalHumanStudio";
import {
  canvasImageCredits,
  canvasTtsCreditsForDuration,
  canvasVideoClipCredits,
  canvasVideoUpscaleCredits,
} from "@shared/canvasGenerationPricing";
import {
  digitalHumanMediaUrl,
  digitalHumanVideoBlock,
} from "@/lib/digitalHumanVideo";
import {
  manhuaOutboundConfirmationFingerprint,
  previewCanvasBlockOutbound,
  runCanvasBlock,
  type CanvasOutboundPreview,
  type CanvasRunDeps,
} from "@/lib/canvasRunBlock";
import { withLongJobsFlyDirect } from "@/lib/longJobsFlyOrigin";
import {
  fetchVideoUpscaleStatus,
  fetchWorkflowVideoEnhanceTasks,
  probeWorkflowVideoSource,
  startVideoUpscale,
} from "@/lib/videoUpscaleApi";
import type { CanvasBlock } from "@/lib/canvasTypes";
import { DigitalHumanSpatialStudio } from "./DigitalHumanSpatialStudio";
import "./DigitalHumanStudio.css";

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const statusLabel = (status: string) =>
  ({
    submitted: "已提交",
    running: "处理中",
    succeeded: "已生成",
    failed: "失败",
    unknown: "待核对",
  })[status] || status;

export function DigitalHumanMedia({
  source,
  kind,
  name,
}: {
  source: string;
  kind: "image" | "audio" | "video";
  name: string;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setUrl("");
    setError("");
    digitalHumanMediaUrl(source)
      .then(value => {
        if (alive) setUrl(value);
      })
      .catch(e => {
        if (alive) setError(messageOf(e));
      });
    return () => {
      alive = false;
    };
  }, [source]);
  if (!url)
    return <p role={error ? "alert" : "status"}>{error || "正在读取素材…"}</p>;
  return (
    <div className="dh-media">
      {kind === "image" ? (
        <img src={url} alt={name} />
      ) : kind === "audio" ? (
        <audio controls src={url} aria-label={name} />
      ) : (
        <video controls playsInline src={url} aria-label={name} />
      )}
      <a href={url} target="_blank" rel="noreferrer">
        打开{name}
      </a>
    </div>
  );
}

export function DigitalHumanStudio({
  initialPortrait,
}: {
  initialPortrait?: string;
}) {
  const { user } = useAuth();
  return user ? (
    <DigitalHumanWorkspace
      key={user.id}
      owner={String(user.id)}
      role={user.role}
      initialPortrait={initialPortrait}
    />
  ) : (
    <p>请登录后使用数字人视频。</p>
  );
}

function DigitalHumanWorkspace({
  owner,
  role,
  initialPortrait,
}: {
  owner: string;
  role: string;
  initialPortrait?: string;
}) {
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<DigitalHumanDraft>(() => {
    try {
      return (
        loadDigitalHumanDraft(
          localStorage.getItem(digitalHumanDraftKey(owner)),
          owner
        ) || newDigitalHumanDraft(owner, crypto.randomUUID())
      );
    } catch (e) {
      queueMicrotask(() =>
        setLoadError(`原草稿无法读取，已停止提交：${messageOf(e)}`)
      );
      return newDigitalHumanDraft(owner, crypto.randomUUID());
    }
  });
  const ref = useRef(draft);
  const savedRaw = useRef(localStorage.getItem(digitalHumanDraftKey(owner)));
  const active = useRef(true);
  const [busy, setBusy] = useState("");
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recordingHelp, setRecordingHelp] = useState(false);
  const [consent, setConsent] = useState(false);
  const [cloneLabel, setCloneLabel] = useState("我的声音");
  const [preview, setPreview] = useState<{
    row: DigitalHumanVideo;
    block: CanvasBlock;
    outbound: CanvasOutboundPreview;
  }>();
  const api = trpc.useUtils();
  const subscription = trpc.stripe.getSubscription.useQuery(undefined, {
    retry: false,
  });
  const referenceVoices = trpc.canvasAudio.listReferenceVoices.useQuery(
    undefined,
    { retry: false }
  );
  const designedVoices = trpc.canvasAudio.listDesignedVoices.useQuery(
    undefined,
    { retry: false }
  );
  const upload = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();
  const clone = trpc.canvasAudio.createReferenceVoice.useMutation();
  const dialogue = trpc.canvasAudio.generateDialogue.useMutation();
  const scene = trpc.digitalHuman.createScene.useMutation();
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  function save(update: (current: DigitalHumanDraft) => DigitalHumanDraft) {
    if (!active.current) throw new Error("页面已切换，请回到原草稿查询任务");
    if (loadError) throw new Error(loadError);
    if (localStorage.getItem(digitalHumanDraftKey(owner)) !== savedRaw.current)
      throw new Error("另一页面已更新草稿，请重新载入后核对，当前操作未提交");
    const next = digitalHumanDraftSchema.parse(update(ref.current));
    const raw = JSON.stringify(next);
    localStorage.setItem(digitalHumanDraftKey(owner), raw);
    savedRaw.current = raw;
    ref.current = next;
    setDraft(next);
  }
  function edit(patch: Partial<DigitalHumanDraft>) {
    try {
      save(d => ({ ...d, ...patch }));
      setPreview(undefined);
    } catch (e) {
      setError(messageOf(e));
    }
  }
  async function act(label: string, work: () => Promise<void>) {
    if (busyRef.current || loadError) return;
    busyRef.current = true;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      if (active.current) setError(messageOf(e));
    } finally {
      busyRef.current = false;
      if (active.current) setBusy("");
    }
  }
  async function createVoiceFromRecording(file: File) {
    if (ref.current.cloneRequest)
      throw new Error("请先核对原声线请求，不能重复上传");
    await inspectDigitalHumanRecording(file);
    const media = await uploadFile(file);
    const request = {
      requestId: crypto.randomUUID(),
      gcsUri: media.source,
      labelZh: cloneLabel.trim() || "我的声音",
      consent: true as const,
    };
    save(d => ({ ...d, cloneRequest: request }));
    const r = await clone.mutateAsync(request);
    if (r.status === "ready" && r.voiceId)
      edit({ voiceId: r.voiceId, cloneRequest: undefined });
    else setNotice(r.message || "声线处理中，请查询原任务");
    await referenceVoices.refetch();
  }
  async function uploadFile(file: File) {
    const asset = await uploadOneCanvasAsset({
      file,
      index: 0,
      getSignedUploadUrl: input => upload.mutateAsync(input),
    });
    if (!asset.gcsUri) throw new Error("上传未返回持久素材地址，未采用");
    return { source: asset.gcsUri, name: file.name };
  }
  // 迟到的回执仍写回原账号原草稿；不影响切换后页面，也不覆盖较新编辑。
  function updateVideo(id: string, patch: Partial<DigitalHumanVideo>) {
    const stored = loadDigitalHumanDraft(
      localStorage.getItem(digitalHumanDraftKey(owner)),
      owner
    );
    if (!stored || stored.id !== ref.current.id)
      throw new Error("原视频草稿已改变，保留任务编号后核对");
    const next = digitalHumanDraftSchema.parse({
      ...stored,
      videos: stored.videos.map(v =>
        v.requestId === id ? { ...v, ...patch } : v
      ),
    });
    const raw = JSON.stringify(next);
    localStorage.setItem(digitalHumanDraftKey(owner), raw);
    savedRaw.current = raw;
    if (active.current) {
      ref.current = next;
      setDraft(next);
    }
  }
  const scopeFor = (row: DigitalHumanVideo) => ({
    userId: owner,
    workspaceId: `digital-human:${ref.current.id}`,
    projectVersion: row.fingerprint,
    blockId: `dh-${row.requestId}`,
    epoch: 1,
  });
  function depsFor(row: DigitalHumanVideo): CanvasRunDeps {
    return {
      userId: owner,
      userRole: role,
      userPlan: subscription.data?.plan,
      optimizeCopy: async () => {
        throw new Error("数字人入口只提交已确认的视频文案");
      },
      assertCurrentSource: () => {
        const audio = currentDigitalHumanAudio(ref.current);
        if (
          !active.current ||
          !audio ||
          digitalHumanVideoFingerprint(ref.current, audio) !== row.fingerprint
        )
          throw new Error("输入已变化，请重新预览");
      },
      canvasIntentStorage: {
        getItem: key =>
          localStorage.getItem(`dh:${owner}:${ref.current.id}:${key}`),
        setItem: (key, value) =>
          localStorage.setItem(`dh:${owner}:${ref.current.id}:${key}`, value),
      },
      onCanvasIntentChanged: (_, intent) => {
        updateVideo(row.requestId, {
          intentId: intent.intentId,
          intentStatus: intent.status,
          ...(["submitted", "acknowledged", "unverified"].includes(
            intent.status
          )
            ? { submissionStarted: true }
            : {}),
          ...(intent.taskId ? { taskId: intent.taskId } : {}),
        });
      },
      onVideoTaskCreated: (_, info) =>
        updateVideo(row.requestId, { taskId: info.taskId, status: "running" }),
    };
  }
  async function recover() {
    const warnings = await recoverDigitalHumanDraft(ref.current, {
      listVoices: () => api.canvasAudio.listReferenceVoices.fetch(),
      dialogue: requestId =>
        api.canvasAudio.getDialogue.fetch({ billingRequestId: requestId }),
      scene: requestId => api.digitalHuman.getScene.fetch({ requestId }),
      job: getJobForPoll,
      intent: async intentId => {
        const response = await fetch(
          withLongJobsFlyDirect(
            `/api/jobs?op=canvasIntentStatus&intentId=${encodeURIComponent(intentId)}`
          ),
          { credentials: "include", cache: "no-store" }
        );
        const data = await response.json();
        return response.ok
          ? { taskId: data.taskId }
          : { message: data.error || "原任务待核对" };
      },
      video: fetchVideoUpscaleStatus,
      enhancements: fetchWorkflowVideoEnhanceTasks,
      save,
      updateVideo,
    });
    if (warnings.length) throw new Error(warnings.join("；"));
  }
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped || busyRef.current || loadError) return;
      busyRef.current = true;
      try {
        await recover();
      } catch (e) {
        if (!stopped) setError(messageOf(e));
      } finally {
        busyRef.current = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 10000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [loadError]);
  const voices = [
    ...(referenceVoices.data || []),
    ...(designedVoices.data || []),
  ];
  const currentAudio = currentDigitalHumanAudio(draft);
  return (
    <section className="dh-studio" aria-label="数字人视频工作台">
      <header>
        <p className="dh-eyebrow">数字人视频</p>
        <h2>让你的人像，用你的声音讲述。</h2>
        <p>
          人物、场景、声音与文案在这里组合。Seedance 2.5 · 720p 原片 → 4K 成片
        </p>
      </header>
      {(error || loadError) && (
        <p className="dh-error" role="alert">
          {loadError || error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">{busy}…</p>}
      {recordingHelp && (
        <DigitalHumanRecorder
          disabled={Boolean(busy) || Boolean(draft.cloneRequest)}
          onClose={() => setRecordingHelp(false)}
          onUse={async file => {
            await createVoiceFromRecording(file);
          }}
        />
      )}
      <fieldset
        disabled={Boolean(busy) || Boolean(loadError)}
        className="dh-grid"
      >
        <section className="dh-card">
          <h3>1 · 人像与场景</h3>
          <label>
            讲述者人像
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={e => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file)
                  void act("上传人像", async () =>
                    edit({ portrait: await uploadFile(file) })
                  );
              }}
            />
          </label>
          {initialPortrait && !draft.portrait && (
            <button
              type="button"
              onClick={() =>
                edit({
                  portrait: {
                    source:
                      gsUriFromSignedGcsUrl(initialPortrait) || initialPortrait,
                    name: "创作台已选人像",
                  },
                })
              }
            >
              沿用创作台人像
            </button>
          )}
          {draft.portrait && (
            <DigitalHumanMedia
              kind="image"
              source={draft.portrait.source}
              name="人像"
            />
          )}
          <label>
            场景参考图
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={e => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file)
                  void act("上传场景", async () =>
                    edit({ scene: await uploadFile(file) })
                  );
              }}
            />
          </label>
          {draft.scene && (
            <DigitalHumanMedia
              kind="image"
              source={draft.scene.source}
              name="场景"
            />
          )}
          <label>
            或者描述新场景
            <textarea
              value={draft.sceneDescription}
              maxLength={2000}
              onChange={e => edit({ sceneDescription: e.target.value })}
              placeholder="例如：明亮的书房，浅木书架，窗边柔和自然光"
            />
          </label>
          <button
            type="button"
            disabled={
              draft.scenes.some(s => digitalHumanPending(s.status)) ||
              draft.sceneDescription.trim().length < 4
            }
            onClick={() =>
              void act("生成场景", async () => {
                const request = {
                  requestId: crypto.randomUUID(),
                  description: ref.current.sceneDescription.trim(),
                  aspectRatio: ref.current.aspectRatio,
                };
                if (
                  !window.confirm(
                    `Sunburst 2K 场景图，${canvasImageCredits(0)}积分。确认生成？`
                  )
                )
                  return;
                save(d => ({
                  ...d,
                  scenes: [...d.scenes, { request, status: "submitted" }],
                }));
                try {
                  const r = await scene.mutateAsync(request);
                  save(d => ({
                    ...d,
                    scenes: d.scenes.map(s =>
                      s.request.requestId === request.requestId
                        ? { ...s, jobId: r.jobId, status: "running" }
                        : s
                    ),
                  }));
                } catch (e) {
                  save(d => ({
                    ...d,
                    scenes: d.scenes.map(s =>
                      s.request.requestId === request.requestId
                        ? { ...s, status: "unknown", message: messageOf(e) }
                        : s
                    ),
                  }));
                  throw e;
                }
              })
            }
          >
            生成场景 · {canvasImageCredits(0)}积分
          </button>
          {draft.scenes.map(s => (
            <div key={s.request.requestId}>
              <p>
                {statusLabel(s.status)} · {s.request.description}
              </p>
              {s.source && (
                <>
                  <DigitalHumanMedia
                    kind="image"
                    source={s.source}
                    name="场景候选"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      edit({ scene: { source: s.source!, name: "生成的场景" } })
                    }
                  >
                    采用此场景
                  </button>
                </>
              )}
              {s.message && <p>{s.message}</p>}
            </div>
          ))}
        </section>
        <section className="dh-card">
          <h3>2 · 我的声音与文案</h3>
          <label>
            选择已有声线
            <select
              value={draft.voiceId}
              onChange={e => edit({ voiceId: e.target.value })}
            >
              <option value="">请选择声音</option>
              {voices
                .filter(v => v.status === "ready" && v.voiceId)
                .map(v => (
                  <option key={v.requestId} value={v.voiceId}>
                    {v.labelZh}
                  </option>
                ))}
            </select>
          </label>
          {(referenceVoices.error || designedVoices.error) && (
            <p role="alert">声线列表暂不可用，请刷新查询。</p>
          )}
          <button
            type="button"
            onClick={() =>
              void act("查询声线", async () => {
                await referenceVoices.refetch();
                await designedVoices.refetch();
              })
            }
          >
            刷新我的声音
          </button>
          <button type="button" onClick={() => setRecordingHelp(true)}>
            打开录音弹窗
          </button>
          <details>
            <summary>用本人录音建立声线</summary>
            <label>
              声音名称
              <input
                value={cloneLabel}
                maxLength={80}
                onChange={e => setCloneLabel(e.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={consent}
                onChange={e => setConsent(e.target.checked)}
              />
              我拥有这段录音及声音的使用权
            </label>
            <p>上传 3–30 秒清晰录音，MP3 / WAV / M4A / AAC，最大 20 MB。</p>
            <input
              aria-label="上传声音参考"
              type="file"
              accept=".mp3,.wav,.m4a,.aac"
              disabled={!consent || Boolean(draft.cloneRequest)}
              onChange={e => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file)
                  void act("建立本人声线", async () => {
                    await createVoiceFromRecording(file);
                  });
              }}
            />
            {draft.cloneRequest && (
              <p>原声线请求已保存；请刷新声音列表核对，勿重复上传。</p>
            )}
          </details>
          <label>
            口播文案
            <textarea
              rows={8}
              maxLength={4000}
              value={draft.script}
              onChange={e => edit({ script: e.target.value })}
              placeholder="写下这次要讲的话。单条配音不超过30秒。"
            />
          </label>
          <p>
            配音按实际时长计费，每开始0.2秒2积分，15秒约
            {canvasTtsCreditsForDuration(15)}积分。超长音频保留，不截断。
          </p>
          <button
            type="button"
            disabled={
              !draft.script.trim() ||
              !draft.voiceId ||
              draft.audios.some(a => digitalHumanPending(a.status))
            }
            onClick={() =>
              void act("生成配音", async () => {
                const request = {
                  billingRequestId: crypto.randomUUID(),
                  input: ref.current.script.trim(),
                  voice: ref.current.voiceId,
                  speakerZh: "讲述者",
                  speakerId: `dh-${ref.current.id}`,
                  voiceStateZh: "",
                };
                if (
                  !window.confirm(
                    "将使用当前声线生成这段完整文案的配音，按实际音频时长扣费。确认生成？"
                  )
                )
                  return;
                save(d => ({
                  ...d,
                  audios: [...d.audios, { request, status: "submitted" }],
                }));
                try {
                  const r = await dialogue.mutateAsync(request);
                  save(d => ({
                    ...d,
                    audios: d.audios.map(a =>
                      a.request.billingRequestId === request.billingRequestId
                        ? {
                            ...a,
                            status:
                              r.status === "reconcile_manual"
                                ? "unknown"
                                : r.status,
                            jobId: r.jobId,
                            source: r.result?.gcsUri,
                            durationSec: r.result?.durationSec,
                            creditsCost: r.creditsCost,
                            canResumeSettlement: r.canResumeSettlement,
                            message: r.message,
                          }
                        : a
                    ),
                  }));
                } catch (e) {
                  save(d => ({
                    ...d,
                    audios: d.audios.map(a =>
                      a.request.billingRequestId === request.billingRequestId
                        ? { ...a, status: "unknown", message: messageOf(e) }
                        : a
                    ),
                  }));
                  throw e;
                }
              })
            }
          >
            生成配音并试听
          </button>
          {draft.audios.map(a => (
            <div key={a.request.billingRequestId}>
              <p>
                {a === currentAudio ? "当前配音" : "历史配音"} ·{" "}
                {statusLabel(a.status)}
                {a.durationSec ? ` · ${a.durationSec.toFixed(1)}秒` : ""}
              </p>
              {a.source && (
                <DigitalHumanMedia kind="audio" source={a.source} name="配音" />
              )}
              {a === currentAudio && a.source && (
                <label>
                  <input
                    type="checkbox"
                    checked={
                      draft.approvedAudioRequestId ===
                      a.request.billingRequestId
                    }
                    onChange={e =>
                      edit({
                        approvedAudioRequestId: e.target.checked
                          ? a.request.billingRequestId
                          : undefined,
                      })
                    }
                  />
                  我已试听，确认声音、读音和完整内容可用于视频
                </label>
              )}
              {a.message && <p>{a.message}</p>}
              {a.canResumeSettlement && (
                <button
                  type="button"
                  onClick={() =>
                    void act("恢复原配音结算", async () => {
                      if (
                        window.confirm(
                          "恢复原编号保存及结算，不重新生成声音。确认？"
                        )
                      ) {
                        await dialogue.mutateAsync(a.request);
                        await recover();
                      }
                    })
                  }
                >
                  恢复原配音结算
                </button>
              )}
            </div>
          ))}
        </section>
        <section className="dh-card dh-wide">
          <h3>3 · 表演、空间与镜头</h3>
          <label>
            画幅
            <select
              value={draft.aspectRatio}
              onChange={e =>
                edit({ aspectRatio: e.target.value as "9:16" | "16:9" })
              }
            >
              <option>9:16</option>
              <option>16:9</option>
            </select>
          </label>
          <label>
            表演与镜头要求
            <textarea
              value={draft.direction}
              maxLength={1500}
              onChange={e => edit({ direction: e.target.value })}
            />
          </label>
          <DigitalHumanSpatialStudio
            draft={draft}
            role={role}
            disabled={Boolean(busy)}
            onChange={patch => {
              save(d => ({ ...d, ...patch }));
              setPreview(undefined);
            }}
            uploadFile={uploadFile}
          />
        </section>
        <section className="dh-card dh-wide">
          <h3>4 · 确认输入，生成原片</h3>
          <p>
            先核对实际发送的文案、人物、场景和声音。原片成功后，继续本页的 4K
            超分。
          </p>
          <button
            type="button"
            onClick={() =>
              void act("核对视频输入", async () => {
                const row = prepareDigitalHumanVideo(
                  ref.current,
                  crypto.randomUUID()
                );
                const block = await digitalHumanVideoBlock(row);
                const outbound = await previewCanvasBlockOutbound(
                  depsFor(row),
                  block,
                  undefined,
                  { videoSubmissionKey: row.requestId }
                );
                if (outbound.compile.blocked)
                  throw new Error(
                    outbound.compile.fatalZh ||
                      "视频输入未通过出站检查，请核对文案与参考素材"
                  );
                setPreview({ row, block, outbound });
              })
            }
          >
            预览生成输入与费用
          </button>
          {preview && (
            <div className="dh-outbound">
              <p>
                Seedance 2.5 · 720p · {preview.outbound.durationSec}秒 ·{" "}
                {canvasVideoClipCredits({
                  videoModel: "seedance-2.5",
                  durationSec: preview.outbound.durationSec,
                  resolution: "720p",
                })}
                积分
              </p>
              <p>
                后续 4K 超分预计{" "}
                {canvasVideoUpscaleCredits("4k", preview.outbound.durationSec)}
                积分，按原片实际时长重新核价。
              </p>
              <pre>
                {String(preview.outbound.body.prompt || preview.row.prompt)}
              </pre>
              {preview.outbound.refs.imageUrls.map((url, i) => (
                <DigitalHumanMedia
                  key={url}
                  source={url}
                  kind="image"
                  name={`图片${i + 1}`}
                />
              ))}
              {preview.outbound.refs.audioUrls.map((url, i) => (
                <DigitalHumanMedia
                  key={url}
                  source={url}
                  kind="audio"
                  name={`音频${i + 1}`}
                />
              ))}
              {preview.outbound.refs.videoUrls.map((url, i) => (
                <DigitalHumanMedia
                  key={url}
                  source={url}
                  kind="video"
                  name={`预演${i + 1}`}
                />
              ))}
              <button
                type="button"
                onClick={() =>
                  void act("生成720p视频", async () => {
                    const p = preview;
                    const current = currentDigitalHumanAudio(ref.current);
                    if (
                      !current ||
                      digitalHumanVideoFingerprint(ref.current, current) !==
                        p.row.fingerprint
                    )
                      throw new Error("输入已变化，请重新预览");
                    if (
                      ref.current.videos.some(v =>
                        digitalHumanPending(v.status)
                      )
                    )
                      throw new Error("请先核对已有视频任务");
                    const scope = scopeFor(p.row);
                    save(d => ({ ...d, videos: [...d.videos, p.row] }));
                    setPreview(undefined);
                    try {
                      const result = await runCanvasBlock(
                        depsFor(p.row),
                        p.block,
                        undefined,
                        {
                          videoSubmissionKey: p.row.requestId,
                          enforceOutboundConfirmation: true,
                          resolveOutboundGate: () => ({
                            currentScope: scopeFor(p.row),
                            confirmation: {
                              scope,
                              fingerprint:
                                manhuaOutboundConfirmationFingerprint(
                                  p.outbound,
                                  scope
                                ),
                              confirmedAt: Date.now(),
                            },
                          }),
                        }
                      );
                      if (!result.outputUrl)
                        throw new Error("未收到视频产物，请查询原任务");
                      updateVideo(p.row.requestId, {
                        status: "succeeded",
                        source:
                          gsUriFromSignedGcsUrl(result.outputUrl) ||
                          result.outputUrl,
                      });
                    } catch (e) {
                      const receipt = ref.current.videos.find(
                        v => v.requestId === p.row.requestId
                      );
                      updateVideo(p.row.requestId, {
                        status: digitalHumanVideoFailureStatus(receipt),
                        message: messageOf(e),
                      });
                      throw e;
                    }
                  })
                }
              >
                确认以上输入并生成720p原片
              </button>
            </div>
          )}
        </section>
        <section className="dh-card dh-wide">
          <h3>5 · 原片与4K成片</h3>
          <button type="button" onClick={() => void act("查询原任务", recover)}>
            刷新任务状态
          </button>
          {draft.videos.map(v => (
            <article key={v.requestId}>
              <p>720p 原片 · {statusLabel(v.status)}</p>
              {v.message && <p>{v.message}</p>}
              {v.source && (
                <>
                  <DigitalHumanMedia
                    source={v.source}
                    kind="video"
                    name="720p原片"
                  />
                  <button
                    type="button"
                    disabled={
                      Boolean(v.upscale) && v.upscale!.status !== "failed"
                    }
                    onClick={() =>
                      void act("提交4K超分", async () => {
                        const metadata = await probeWorkflowVideoSource(
                          v.source!
                        );
                        const cost = canvasVideoUpscaleCredits(
                          "4k",
                          metadata.durationSec
                        );
                        if (
                          !window.confirm(
                            `原片${metadata.width}×${metadata.height}，${metadata.durationSec}秒。超分4K需${cost}积分，保留720p原片。确认？`
                          )
                        )
                          return;
                        const pending = {
                          status: "submitted" as const,
                          inputSource: v.source!,
                          durationSec: metadata.durationSec,
                          sourceResolution: metadata.sourceResolution,
                        };
                        updateVideo(v.requestId, { upscale: pending });
                        try {
                          const r = await startVideoUpscale({
                            videoUrl: v.source!,
                            target: "4k",
                            durationSec: metadata.durationSec,
                            sourceResolution: metadata.sourceResolution,
                            scopeKey: `digital-human:${ref.current.id}:${v.requestId}`,
                          });
                          updateVideo(v.requestId, {
                            upscale: {
                              ...pending,
                              taskId: r.taskId,
                              status: "running",
                            },
                          });
                        } catch (e) {
                          updateVideo(v.requestId, {
                            upscale: {
                              ...pending,
                              status: "unknown",
                              message: messageOf(e),
                            },
                          });
                          throw e;
                        }
                      })
                    }
                  >
                    超分到4K
                  </button>
                </>
              )}
              {v.upscale && (
                <div>
                  <p>4K 成片 · {statusLabel(v.upscale.status)}</p>
                  {v.upscale.message && <p>{v.upscale.message}</p>}
                  {v.upscale.source && (
                    <DigitalHumanMedia
                      source={v.upscale.source}
                      kind="video"
                      name="4K成片"
                    />
                  )}
                </div>
              )}
            </article>
          ))}
        </section>
      </fieldset>
    </section>
  );
}
