import { assertCanvasSpeechInstruction } from "@shared/canvasDialogueControls";
import { DigitalHumanFilmDirectorPanel } from "./DigitalHumanFilmDirectorPanel";
import { digitalHumanAdoptedFilmPrompt } from "@shared/digitalHumanStudio";
import { DIGITAL_HUMAN_DIRECTION_MAX_CHARS, DIGITAL_HUMAN_FILM_MODELS, digitalHumanFilmModelSchema } from "@shared/digitalHumanFilmDirector";
import { DigitalHumanOmniPanel } from "./DigitalHumanOmniPanel";
import { DigitalHumanPostProduction } from "./DigitalHumanPostProduction";
import { adoptDigitalHumanSource, type DigitalHumanSource } from "@shared/digitalHumanStudio";
import { recoverDigitalHumanDraft } from "@/lib/digitalHumanRecovery";
import { DigitalHumanRecorder } from "./DigitalHumanRecorder";
import { DigitalHumanProductionPanel } from "./DigitalHumanProductionPanel";
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
  digitalHumanVideoIsCurrent,
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
  source,
}: {
  initialPortrait?: string;
  source?: DigitalHumanSource;
}) {
  const { user } = useAuth();
  return user ? (
    <DigitalHumanWorkspace
      key={user.id}
      owner={String(user.id)}
      role={user.role}
      initialPortrait={initialPortrait}
      source={source}
    />
  ) : (
    <p>请登录后使用数字人视频。</p>
  );
}

function DigitalHumanWorkspace({
  owner,
  role,
  initialPortrait,
  source,
}: {
  source?: DigitalHumanSource;
  owner: string;
  role: string;
  initialPortrait?: string;
}) {
  const [upscaleTarget, setUpscaleTarget] = useState<"2k" | "4k">("4k");
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
  const [narrationRecorder, setNarrationRecorder] = useState(false);
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
  const inspectNarration = trpc.digitalHuman.inspectNarration.useMutation();
  const scene = trpc.digitalHuman.createScene.useMutation();
  const cloudSave = trpc.digitalHuman.saveDraft.useMutation();
  const cloudGeneration = useRef<string | undefined>(undefined);
  const cloudQueue = useRef<Promise<void>>(Promise.resolve());
  const [cloudStatus, setCloudStatus] = useState("正在读取云端稿件");
  const cloudError = useRef<string | undefined>(undefined);
  async function flushCloud() {
    let pending: Promise<void>;
    do { pending = cloudQueue.current; await pending; } while (pending !== cloudQueue.current);
    if (!active.current) throw new Error("页面已切换，未提交生产");
    if (!cloudGeneration.current || cloudError.current) throw new Error(cloudError.current || "云端稿件尚未确认，未提交生产");
  }
  function queueCloud(next: DigitalHumanDraft) {
    cloudQueue.current = cloudQueue.current.then(async () => {
      if (!cloudGeneration.current || cloudError.current) return;
      setCloudStatus("正在保存云端稿件");
      try {
        const receipt = await cloudSave.mutateAsync({ draft: next, expectedGeneration: cloudGeneration.current });
        cloudGeneration.current = receipt.generation; setCloudStatus("云端已保存");
      } catch (e) { cloudError.current = messageOf(e); setCloudStatus(cloudError.current); }
    });
  }
  async function loadCloud() {
    const localBefore = savedRaw.current;
    const remote = await api.digitalHuman.getDraft.fetch();
    if (!active.current || savedRaw.current !== localBefore || localStorage.getItem(digitalHumanDraftKey(owner)) !== localBefore) throw new Error("读取期间本机稿件已变化，未覆盖");
    if (remote.draft && localBefore && JSON.stringify(remote.draft) !== JSON.stringify(ref.current)) {
      cloudError.current = "本机与云端稿件不同，请导出本机副本后明确选择读取云端或保存本机";
      cloudGeneration.current = remote.generation; setCloudStatus(cloudError.current); return;
    }
    cloudGeneration.current = remote.generation; cloudError.current = undefined;
    if (remote.draft) {
      const raw = JSON.stringify(remote.draft); localStorage.setItem(digitalHumanDraftKey(owner), raw);
      savedRaw.current = raw; ref.current = remote.draft; setDraft(remote.draft);
    } else queueCloud(ref.current);
    setCloudStatus(remote.draft ? "云端稿件已恢复" : "正在建立云端稿件");
  }
  useEffect(() => { void loadCloud().catch(e => { cloudError.current = messageOf(e); setCloudStatus(cloudError.current); }); }, []);

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
    queueCloud(next);
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
      await flushCloud();
      await work();
      await flushCloud();
    } catch (e) {
      if (active.current) setError(messageOf(e));
    } finally {
      busyRef.current = false;
      if (active.current) setBusy("");
    }
  }
  function acquireWork(label: string) {
    if (!active.current || busyRef.current || loadError) throw new Error("制作稿正在处理，请等当前操作结束");
    busyRef.current = true; setBusy(label);
    return () => { busyRef.current = false; if (active.current) setBusy(""); };
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
    await flushCloud();
    const r = await clone.mutateAsync(request);
    if (r.status === "ready" && r.voiceId)
      save(d => ({ ...d, voiceId: r.voiceId!, approvedAudioRequestId: undefined, cloneRequest: undefined }));
    else setNotice(r.message || "声线处理中，请查询原任务");
    await referenceVoices.refetch();
    await flushCloud();
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
  async function adoptNarration(file: File) {
    const snapshot = { id: ref.current.id, script: ref.current.script.trim() };
    if (!snapshot.script) throw new Error("请先写好本次完整口播文案");
    if (file.size <= 0 || file.size > 60 * 1024 * 1024 || !/\.(wav|mp3|m4a|aac)$/i.test(file.name)) throw new Error("旁白支持WAV、MP3、M4A或AAC，最大60MB");
    const asset = await uploadFile(file);
    const inspected = await inspectNarration.mutateAsync({ source: asset.source });
    if (!active.current || ref.current.id !== snapshot.id || ref.current.script.trim() !== snapshot.script) throw new Error("上传期间稿件已变化，未采用录音，请回到对应文案重新确认");
    const request = { billingRequestId: crypto.randomUUID(), input: snapshot.script, voice: "recorded-narration", speakerZh: "本人原声", speakerId: `dh-${snapshot.id}`, voiceStateZh: "本人实际录音" };
    save(d => ({ ...d, approvedAudioRequestId: undefined, audios: [...d.audios, { origin: "recording", fileName: file.name, request, status: "succeeded", source: inspected.source, durationSec: inspected.durationSec, creditsCost: 0 }] }));
    await flushCloud();
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
    queueCloud(next);
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
          !audio || !digitalHumanVideoIsCurrent(ref.current, row)
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
    const voiceRequestId = ref.current.cloneRequest?.requestId;
    const warnings = await recoverDigitalHumanDraft(ref.current, {
      listVoices: async () => {
        const result = await referenceVoices.refetch();
        if (result.error) throw result.error;
        return result.data || [];
      },
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
      omni: requestId => api.digitalHuman.getOmni.fetch({ requestId }),
      video: fetchVideoUpscaleStatus,
      enhancements: fetchWorkflowVideoEnhanceTasks,
      save,
      updateVideo,
    });
    if (voiceRequestId && !ref.current.cloneRequest) setNotice("本人新声线已建立并选中，生成配音前请核对文案与费用。");
    if (warnings.length) throw new Error(warnings.join("；"));
  }
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped || busyRef.current || loadError || !cloudGeneration.current || cloudError.current) return;
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
          先上传人物或角色照片，再填写文案、选择声音并试听配音。场景与产品演示按制作需要补充。
        </p>
      </header>
      <section className="dh-card">
        <p role="status">{cloudStatus}</p>
        <button type="button" disabled={Boolean(busy)} onClick={() => {
          const blob = new Blob([JSON.stringify(ref.current, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob); const a = document.createElement("a");
          a.href = url; a.download = "数字人制作稿.json"; a.click(); URL.revokeObjectURL(url);
        }}>导出本机副本</button>
        <button type="button" disabled={Boolean(busy)} onClick={() => void (async () => {
          if (!window.confirm("读取云端稿件将替换本页制作稿；请先导出本机副本。确认读取？")) return;
          if (busyRef.current) return;
          busyRef.current = true; setBusy("读取云端稿件");
          const localBefore = savedRaw.current;
          try {
            await cloudQueue.current;
            const remote = await api.digitalHuman.getDraft.fetch();
            if (!active.current || savedRaw.current !== localBefore || localStorage.getItem(digitalHumanDraftKey(owner)) !== localBefore) throw new Error("读取期间本机稿件已变化，未覆盖");
            if (!remote.draft) throw new Error("云端没有制作稿，未覆盖本机");
            const raw = JSON.stringify(remote.draft); localStorage.setItem(digitalHumanDraftKey(owner), raw);
            savedRaw.current = raw; ref.current = remote.draft; setDraft(remote.draft);
            cloudGeneration.current = remote.generation; cloudError.current = undefined; setPreview(undefined); setCloudStatus("云端稿件已恢复");
          } catch (e) { setError(messageOf(e)); }
          finally { busyRef.current = false; if (active.current) setBusy(""); }
        })()}>读取云端版本</button>
        <button type="button" disabled={Boolean(busy)} onClick={() => void (async () => {
          if (!window.confirm("将当前本机制作稿保存为云端版本？请先核对另一设备的修改。")) return;
          if (busyRef.current) return;
          busyRef.current = true; setBusy("保存本机稿件");
          try {
            await cloudQueue.current; const remote = await api.digitalHuman.getDraft.fetch();
            if (!active.current || localStorage.getItem(digitalHumanDraftKey(owner)) !== savedRaw.current) throw new Error("本机稿件已在另一页面变化，未覆盖云端");
            cloudGeneration.current = remote.generation; cloudError.current = undefined;
            queueCloud(ref.current); await flushCloud();
          } catch (e) { setError(messageOf(e)); }
          finally { busyRef.current = false; if (active.current) setBusy(""); }
        })()}>明确保存本机版本</button>
      </section>
      {source && <section className="dh-card">
        <h3>平台稿件 · {source.title}</h3>
        <p>完整正文与{source.shots.length}镜分镜将一起采用，原素材和任务记录保留。</p>
        <details><summary>核对正文与分镜</summary><p style={{ whiteSpace: "pre-wrap" }}>{source.script}</p>
          {source.shots.map(shot => <p key={shot.cellIndex}>{shot.cellIndex} · {shot.sceneZh} · {shot.shotSize} · {shot.actionZh} · {shot.cameraMoveZh} · {shot.dialogueZh}</p>)}</details>
        <button type="button" disabled={Boolean(busy) || Boolean(loadError)} onClick={() => void act("采用平台稿件", async () => {
          if (!window.confirm("采用这份稿件替换当前正文和导演说明？原音频、视频和素材记录保留，配音需重新确认。")) return;
          save(d => adoptDigitalHumanSource(d, source)); setPreview(undefined);
        })}>采用这份正文与分镜</button>
      </section>}
      {draft.source && <p>制作来源：{draft.source.title} · {draft.source.platform} · {draft.source.shots.length}镜</p>}
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
            const release = acquireWork("建立本人声线");
            try { await flushCloud(); await createVoiceFromRecording(file); } finally { release(); }
          }}
        />
      )}
      {narrationRecorder && <DigitalHumanRecorder mode="narration" script={draft.script}
        disabled={Boolean(busy)} onClose={() => setNarrationRecorder(false)} onUse={async file => {
          const release = acquireWork("采用完整旁白");
          try { await flushCloud(); await adoptNarration(file); } finally { release(); }
        }} />}
      <fieldset
        disabled={Boolean(busy) || Boolean(loadError)}
        className="dh-grid"
      >
        <section className="dh-card">
          <h3>1 · 上传人物或角色照片</h3>
          <label>
            人物或角色照片
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={e => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file)
                  void act("上传人物或角色照片", async () =>
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
                  void act("上传场景", async () => {
                    const previous = ref.current.scene;
                    const scene = await uploadFile(file);
                    // 首次上传保留用户预写要求；替换图片时不继承上一场景的描述。
                    edit({ scene, ...(previous && previous.source !== scene.source ? { sceneDescription: "" } : {}) });
                  });
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
                  await flushCloud();
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
                      edit({ scene: { source: s.source!, name: "生成的场景" }, sceneDescription: s.request.description })
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
          <p role="status">{draft.cloneRequest ? "本人声线正在建立，完成后会自动选择；暂不使用旧音色生成。" : `当前声线：${voices.find(v => v.voiceId === draft.voiceId)?.labelZh || "尚未选择"}`}</p>
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
              placeholder="写下完整文案。超过30秒的配音可按真实停顿分段生成视频。"
            />
          </label>
          <details open>
            <summary>使用本人完整录音</summary>
            <p>先写好上方文案，再从头录完或上传已有旁白，3秒至5分钟。采用后逐段试听；原声可为单声道，最终与立体声BGM、音效混音。上传原声不收取合成配音费用。</p>
            <button type="button" disabled={!draft.script.trim()} onClick={() => setNarrationRecorder(true)}>录制完整旁白</button>
            <label>上传完整旁白（本人声音，确认有使用权）
              <input aria-label="上传完整旁白" type="file" accept=".wav,.mp3,.m4a,.aac" disabled={!draft.script.trim()}
                onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void act("采用完整旁白", () => adoptNarration(file)); }} />
            </label>
          </details>
          <label>克隆配音演法
            <textarea aria-label="克隆配音演法" rows={3} maxLength={100} value={draft.speechInstruction}
              onChange={e => edit({ speechInstruction: e.target.value })}
              placeholder="例如：保留本人音色，开场有力度，关键词重读，句间自然停顿。" />
          </label>
          <p>此处是给声音模型的指令，不作为台词朗读。当前支持百炼本人克隆声线；“嗯、你看”等要念出来的语气词请写进口播文案。表情和手势在导演方案中安排。</p>
          <p>
            配音按实际时长计费，每开始0.2秒2积分，15秒约
            {canvasTtsCreditsForDuration(15)}积分。超长音频保留，不截断。
          </p>
          <button
            type="button"
            disabled={
              !draft.script.trim() ||
              !draft.voiceId || Boolean(draft.cloneRequest) ||
              draft.audios.some(a => digitalHumanPending(a.status))
            }
            onClick={() =>
              void act("生成配音", async () => {
                if (ref.current.cloneRequest) throw new Error("本人新声线仍在建立，请先查询原任务，不能沿用旧声线生成");
                const request = {
                  billingRequestId: crypto.randomUUID(),
                  input: ref.current.script.trim(),
                  voice: ref.current.voiceId,
                  speakerZh: "讲述者",
                  speakerId: `dh-${ref.current.id}`,
                  voiceStateZh: "",
                  ...(ref.current.speechInstruction.trim() ? { speechInstruction: ref.current.speechInstruction.trim() } : {}),
                };
                assertCanvasSpeechInstruction(request.voice, request.speechInstruction);
                if (
                  !window.confirm(
                    `将使用当前声线生成完整文稿，按实际时长扣费。演法：${request.speechInstruction || "自然朗读"}。确认生成？`
                  )
                )
                  return;
                save(d => ({
                  ...d,
                  audios: [...d.audios, { request, status: "submitted" }],
                }));
                try {
                  await flushCloud();
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
                {a.origin === "recording" ? "本人录音" : statusLabel(a.status)}
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
              {a.origin !== "recording" && a.canResumeSettlement && (
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
              aria-label="完整导演要求"
              value={draft.direction}
              maxLength={DIGITAL_HUMAN_DIRECTION_MAX_CHARS}
              onChange={e => edit({ direction: e.target.value })}
            />
            <small>{draft.direction.length} / {DIGITAL_HUMAN_DIRECTION_MAX_CHARS} 字，完整保存并用于导演、动作预演与视频生成。</small>
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
            beforeSubmit={flushCloud}
            acquireWork={acquireWork}
          />
        </section>
        {(role === "admin" || role === "supervisor") && <DigitalHumanOmniPanel draft={draft} disabled={Boolean(busy)} save={save} beforeSubmit={flushCloud} acquireWork={acquireWork} updateVideo={updateVideo} />}
        <section className="dh-card dh-wide">
          <h3>带货视频制作 · 人物、场景与镜头</h3>
          <label>视频模型<select aria-label="数字人视频模型" value={draft.filmModel||"seedance-2.5"} disabled={Boolean(busy)} onChange={e=>edit({filmModel:digitalHumanFilmModelSchema.parse(e.target.value)})}>
            {Object.entries(DIGITAL_HUMAN_FILM_MODELS).map(([value,profile])=><option key={value} value={value}>{profile.label}</option>)}
          </select></label>
          <p>
            先核对实际发送的文案、人物、场景和声音。原片成功后，继续本页的 4K
            超分。
          </p>
          <button
            type="button"
            onClick={() =>
              void act("核对视频输入", async () => {
                digitalHumanAdoptedFilmPrompt(ref.current);
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
                {DIGITAL_HUMAN_FILM_MODELS[preview.row.filmModel||"seedance-2.5"].label} · {preview.outbound.durationSec}秒 ·{" "}
                {canvasVideoClipCredits({
                  videoModel: preview.row.filmModel || "seedance-2.5",
                  durationSec: preview.outbound.durationSec,
                  resolution: DIGITAL_HUMAN_FILM_MODELS[preview.row.filmModel||"seedance-2.5"].resolution,
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
                  void act("生成数字人视频", async () => {
                    const p = preview;
                    const current = currentDigitalHumanAudio(ref.current);
                    if (
                      !current || !digitalHumanVideoIsCurrent(ref.current, p.row)
                    )
                      throw new Error("输入已变化，请重新预览");
                    if (
                      ref.current.videos.some(v =>
                        digitalHumanPending(v.status)
                      )
                    )
                      throw new Error("请先核对已有视频任务");
                    const scope = scopeFor(p.row);
                    save(d => ({ ...d, videos: [...d.videos, { ...p.row, intentId: p.row.requestId }] }));
                    setPreview(undefined);
                    try {
                      await flushCloud();
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
                确认以上输入并生成{DIGITAL_HUMAN_FILM_MODELS[preview.row.filmModel || "seedance-2.5"].resolution}原片
              </button>
            </div>
          )}
        </section>
        <DigitalHumanFilmDirectorPanel draft={draft} disabled={Boolean(busy)} save={save} beforeSubmit={flushCloud} acquireWork={acquireWork} />
        <DigitalHumanProductionPanel draft={draft} disabled={Boolean(busy)} save={save} beforeSubmit={flushCloud} uploadFile={uploadFile} acquireWork={acquireWork}
          previewVideo={async row => {
            digitalHumanAdoptedFilmPrompt(ref.current, row.segment?.startSec || 0, row.segment?.endSec);
            const block = await digitalHumanVideoBlock(row);
            const outbound = await previewCanvasBlockOutbound(depsFor(row), block, undefined, { videoSubmissionKey: row.requestId });
            if (outbound.compile.blocked) throw new Error(outbound.compile.fatalZh || "本段视频输入未通过出站检查");
            setPreview({ row, block, outbound });
            setNotice("本段输入已准备，请在上方核对完整参考与费用后确认生成。");
          }} />
        {cloudGeneration.current && !cloudError.current && <DigitalHumanPostProduction draft={draft} disabled={Boolean(busy)} save={save} beforeSubmit={flushCloud} acquireWork={acquireWork} userRole={role} />}
        <section className="dh-card dh-wide">
          <h3>5 · 原片与超分成片</h3>
          <label>超分目标<select aria-label="超分目标" value={upscaleTarget} disabled={Boolean(busy)} onChange={e=>setUpscaleTarget(e.target.value === "2k" ? "2k" : "4k")}><option value="2k">2K</option><option value="4k">4K</option></select></label>
          <button type="button" onClick={() => void act("查询原任务", recover)}>
            刷新任务状态
          </button>
          {draft.videos.map(v => (
            <article key={v.requestId}>
              <p>{v.engine === "omnihuman2-wavespeed" ? "数字人口播原片" : `${DIGITAL_HUMAN_FILM_MODELS[v.filmModel||"seedance-2.5"].label} 原片`} · {statusLabel(v.status)}</p>
              {v.message && <p>{v.message}</p>}
              {v.source && (
                <>
                  <DigitalHumanMedia
                    source={v.source}
                    kind="video"
                    name={v.engine === "omnihuman2-wavespeed" ? "数字人口播原片" : `${DIGITAL_HUMAN_FILM_MODELS[v.filmModel||"seedance-2.5"].resolution}原片`}
                  />
                  <button
                    type="button"
                    disabled={
                      Boolean(v.upscale) && (digitalHumanPending(v.upscale!.status) || ((v.upscale!.target || "4k") === upscaleTarget && v.upscale!.status === "succeeded"))
                    }
                    onClick={() =>
                      void act(`提交${upscaleTarget.toUpperCase()}超分`, async () => {
                        const metadata = await probeWorkflowVideoSource(
                          v.source!
                        );
                        const cost = canvasVideoUpscaleCredits(
                          upscaleTarget,
                          metadata.durationSec
                        );
                        if (
                          !window.confirm(
                            `原片${metadata.width}×${metadata.height}，${metadata.durationSec}秒。超分${upscaleTarget.toUpperCase()}需${cost}积分，保留原片。确认？`
                          )
                        )
                          return;
                        const pending = {
                          target: upscaleTarget,
                          status: "submitted" as const,
                          inputSource: v.source!,
                          durationSec: metadata.durationSec,
                          sourceResolution: metadata.sourceResolution,
                        };
                        updateVideo(v.requestId, { upscale: pending, upscaleHistory: [...(v.upscaleHistory || []), ...(v.upscale ? [v.upscale] : [])] });
                        try {
                          await flushCloud();
                          const r = await startVideoUpscale({
                            videoUrl: v.source!,
                            target: upscaleTarget,
                            durationSec: metadata.durationSec,
                            sourceResolution: metadata.sourceResolution,
                            scopeKey: `digital-human:${ref.current.id}:${v.requestId}:${upscaleTarget}`,
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
                    超分到{upscaleTarget.toUpperCase()}
                  </button>
                </>
              )}
              {v.upscaleHistory?.filter(h => h.source).map((h,i)=><DigitalHumanMedia key={i} source={h.source!} kind="video" name={`历史${(h.target||"4k").toUpperCase()}超分成片`} />)}
              {v.upscale && (
                <div>
                  <p>{(v.upscale.target || "4k").toUpperCase()} 超分成片 · {statusLabel(v.upscale.status)}</p>
                  {v.upscale.message && <p>{v.upscale.message}</p>}
                  {v.upscale.source && (
                    <DigitalHumanMedia
                      source={v.upscale.source}
                      kind="video"
                      name={`${(v.upscale.target || "4k").toUpperCase()}超分成片`}
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
