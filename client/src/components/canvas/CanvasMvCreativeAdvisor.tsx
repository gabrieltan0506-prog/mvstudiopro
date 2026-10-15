import { MusicEmotionPanel } from "./MusicEmotionPanel";
import { CreativeEvidenceReviewPanel } from "./CreativeEvidenceReviewPanel";
import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { resolveMusicMvMediaUrl } from "@/lib/musicMvAdvisor";
import {
  musicMvAdvisorRequest,
  musicMvSourceKey,
  readMvVideoDuration,
} from "@/lib/musicMvAdvisor";
import {
  parseMusicMvAdvisorProposal,
  MUSIC_MV_SHOT_LABELS,
  type CanvasMusicCandidate,
  type CanvasMusicMvDraftInput,
  type CanvasMusicMvPlan,
  type MusicMvAdvisorSession,
} from "@shared/canvasMusicMv";
import type { CanvasBlock } from "@/lib/canvasTypes";

type Props = {
  audio?: CanvasMusicCandidate;
  lyrics: string;
  creativePrompt: string;
  videoModel: string;
  projectId?: string;
  references: Array<{
    id: string;
    fileName: string;
    url: string;
    gcsUri?: string;
  }>;
  blocks: CanvasBlock[];
  session?: MusicMvAdvisorSession;
  disabled: boolean;
  footageIds: string[];
  onFootageIds: (ids: string[]) => void;
  onSession: (session: MusicMvAdvisorSession) => void;
  onNewSession: (session: MusicMvAdvisorSession) => void;
  onApply: (result: {
    requestId: string;
    plan: CanvasMusicMvPlan;
    input: CanvasMusicMvDraftInput;
  }) => Promise<void>;
};
const button =
  "rounded border border-white/20 px-2 py-1.5 text-xs disabled:opacity-40";

/** MV咨询使用原顾问的免费额度、收费确认、事务和退款；采用不触发媒体生成。 */
export function CanvasMvCreativeAdvisor(props: Props) {
  const ask = trpc.mvAnalysis.askPlatformSkillQa.useMutation({ retry: false });
  const adopt = trpc.canvasMusicMv.adoptConcept.useMutation({ retry: false });
  const quota = trpc.mvAnalysis.getManhuaAdvisorQuota.useQuery(
    props.projectId ? { projectId: props.projectId } : undefined,
    { enabled: Boolean(props.audio), retry: false }
  );
  const [error, setError] = useState("");
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState(
    "请实际听完整首歌，提出一个主推荐和三个不同的MV方案，安排对口型、生成画面及可用素材切片，说明开场、高潮和结尾。"
  );
  const lock = useRef(false);
  const current = useRef(props);
  current.current = props;
  const videos = props.blocks
    .flatMap(block => [
      ...(block.uploadedAssets || [])
        .filter(a => a.kind === "video")
        .map(a => ({
          assetId: a.id,
          url: a.gcsUri || a.url,
          name: a.fileName || "上传视频",
          taskId: undefined as string | undefined,
        })),
      ...(block.kind === "video" &&
      block.status === "done" &&
      block.outputUrl &&
      !block.musicMvShot
        ? [
            {
              assetId: block.id,
              url: block.outputUrl,
              name: block.prompt.slice(0, 150) || "已有视频",
              taskId: block.videoTaskId,
            },
          ]
        : []),
    ])
    .filter((v, i, rows) => rows.findIndex(x => x.assetId === v.assetId) === i);
  const patch = (session: MusicMvAdvisorSession) => {
    current.current = { ...current.current, session };
    props.onSession(session);
  };
  const matches = (s: MusicMvAdvisorSession) => {
    const p = current.current;
    return Boolean(
      p.audio &&
        s.target.audio.id === p.audio.id &&
        (s.target.audio.gcsUri || s.target.audio.url) ===
          (p.audio.gcsUri || p.audio.url) &&
        s.target.audio.durationSec === p.audio.durationSec &&
        s.projectId === p.projectId &&

        s.target.lyrics === p.lyrics &&
        s.target.creativePrompt === p.creativePrompt &&
        JSON.stringify(s.target.referenceSummaries) ===
          JSON.stringify(p.references.map(r => r.fileName || r.id)) &&
        JSON.stringify(s.target.referenceKeys) ===
          JSON.stringify(p.references.map(r => r.gcsUri || r.url)) &&
        JSON.stringify(s.target.footage.map(f => f.assetId)) ===
          JSON.stringify(p.footageIds) &&
        s.target.footage.every(f =>
          p.blocks.some(
            b =>
              b.uploadedAssets?.some(
                a => a.id === f.assetId && (a.gcsUri || a.url) === f.url
              ) ||
              (b.id === f.assetId &&
                b.outputUrl === f.url &&
                b.videoTaskId === f.taskId)
          )
        )
    );
  };
  const run = async (confirmPaid = false, newConsultation = false) => {
    if (lock.current || props.disabled || !props.audio) return;
    lock.current = true;
    setBusy(true);
    setError("");
    let session = props.session;
    try {
      if (!session || newConsultation) {
        if (session?.status === "pending")
          throw new Error("原咨询尚未确认结果，请先恢复原咨询");
        if (!props.creativePrompt.trim())
          throw new Error("请先填写MV创意或希望表达的主题");
        const footage = await Promise.all(
          props.footageIds.map(async id => {
            const item = videos.find(v => v.assetId === id);
            if (!item) throw new Error("所选素材已移除，请重新选择");
            const url = await resolveMusicMvMediaUrl(item.url);
            return {
              ...item,
              durationSec: await readMvVideoDuration(url),
              sourceStartSec: 0,
            };
          })
        );
        const target = {
          audio: props.audio,
          lyrics: props.lyrics,
          creativePrompt: props.creativePrompt,
          referenceSummaries: props.references.map(r => r.fileName || r.id),
          referenceKeys: props.references.map(r => r.gcsUri || r.url),
          footage,
        };
        const sourceKey = await musicMvSourceKey({
          ...target,
          audio: {
            ...target.audio,
            url: target.audio.gcsUri || target.audio.url,
          },
        });
        session = {
          requestId: crypto.randomUUID(),
          projectId: props.projectId,
          target: { ...target, sourceKey },
          question,
          videoModel: props.videoModel,
          status: "pending",
        };
        if (!matches(session))
          throw new Error("准备期间输入已变化，请按当前版本重新咨询");
        current.current = { ...current.current, session };
        props.onNewSession(session);
      }
      const response = await ask.mutateAsync({
        ...musicMvAdvisorRequest(session),
        ...(confirmPaid
          ? { confirmPaid: true, confirmedCredits: quota.data?.price }
          : {}),
      });
      const proposal = parseMusicMvAdvisorProposal(
        response.answer,
        session.target
      );
      if (current.current.session?.requestId !== session.requestId) return;
      patch({ ...session, status: "succeeded", proposal });
      setPaid(false);
      void quota.refetch();
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "MV咨询未确认，请恢复原咨询";
      setError(message);
      if (/PAYMENT_REQUIRED|免费.*用完|请确认后重试/.test(message))
        setPaid(true);
      if (session && /ADVISOR_OPERATION_FAILED/.test(message))
        patch({ ...session, status: "failed" });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const select = async (conceptId: string) => {
    const s = props.session;
    if (
      lock.current ||
      props.disabled ||
      s?.status !== "succeeded" ||
      !s.proposal?.evidenceId || (s.proposal.review && s.proposal.review.verdict !== "approved")
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (!matches(s))
        throw new Error("歌曲或创意已变化，请重新咨询；原方案仍保留");
      if (s.adoption && s.adoption.conceptId !== conceptId)
        throw new Error("上一方案采用尚未确认，请先恢复该方案采用");
      const adoption = s.adoption || {
        requestId: crypto.randomUUID(),
        conceptId,
      };
      patch({ ...s, adoption });
      const result = await adopt.mutateAsync({
        ...adoption,
        advisorRequestId: s.requestId,
        evidenceId: s.proposal.evidenceId,
      });
      if (current.current.session?.requestId !== s.requestId) return;
      if (!matches(s))
        throw new Error("输入已变化，原方案采用回执保留，未铺设镜头");
      await current.current.onApply(result);
      patch({ ...s, adoption: undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : "采用未确认，请恢复原方案采用");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="MV创作顾问"
      className="space-y-2 rounded border border-cyan-300/30 p-2 text-xs"
    >
      <strong>创作顾问 · MV创作</strong>
      <p>
        听取已选歌曲，给出创意与完整镜头安排。选定方案后铺到自由画布，尚不生成视频。
      </p>
      <textarea
        aria-label="MV顾问要求"
        rows={3}
        maxLength={1200}
        value={question}
        onChange={e => setQuestion(e.target.value)}
        disabled={busy || props.session?.status === "pending"}
        className="w-full rounded bg-black/30 p-2"
      />
      <details>
        <summary>可穿插的已有视频（{props.footageIds.length}）</summary>
        {videos.map(v => (
          <label key={v.assetId} className="block">
            <input
              type="checkbox"
              disabled={busy || props.session?.status === "pending"}
              checked={props.footageIds.includes(v.assetId)}
              onChange={e =>
                props.onFootageIds(
                  e.target.checked
                    ? [...props.footageIds, v.assetId]
                    : props.footageIds.filter(id => id !== v.assetId)
                )
              }
            />
            {v.name}
          </label>
        ))}
        {!videos.length && (
          <p>上传视频到画布后可选择；没有素材时顾问只安排可用的生成镜头。</p>
        )}
      </details>
      <button
        className={button}
        disabled={busy || props.disabled || !props.audio || paid}
        onClick={() => void run(false, props.session?.status !== "pending")}
      >
        {busy
          ? "正在处理…"
          : props.session?.status === "pending"
            ? "恢复原MV咨询"
            : "听歌并构思MV"}
      </button>
      <p>
        {quota.data?.exempt
          ? "本账号咨询免扣积分"
          : `当前作品剩余免费咨询 ${quota.data?.remaining ?? "待核"} 次；用完后会先确认费用。`}
      </p>
      {paid && (
        <button
          className={button}
          disabled={busy || !quota.data}
          onClick={() => void run(true)}
        >
          确认本次咨询 {quota.data?.price} 积分
        </button>
      )}
      {error && (
        <p role="alert" className="text-amber-200">
          {error}
        </p>
      )}
      {props.session?.proposal && (
        <>
          <p>{props.session.proposal.summaryZh}</p>
          <CreativeEvidenceReviewPanel review={props.session.proposal.review} />
          <details>
            <summary>歌曲段落与待核事项</summary>
            {props.session.proposal.sections.map((s, i) => (
              <div key={i}><p>{s.startSec}–{s.endSec}秒 · {s.labelZh}：{s.heardZh}</p><MusicEmotionPanel emotion={s.emotion} /></div>
            ))}
            {props.session.proposal.uncertaintiesZh.map((s, i) => (
              <p key={i}>待核：{s}</p>
            ))}
          </details>
          {props.session.proposal.concepts.map((c, i) => (
            <article
              key={c.id}
              className="space-y-1 rounded border border-white/15 p-2"
            >
              <strong>
                {i === 0 ? "主推荐" : "备选"} · {c.titleZh}
              </strong>
              <p>{c.rationaleZh}</p>
              {c.emotionalArc?.map((a, j) => <MusicEmotionPanel key={j} label={a.sectionZh} emotion={a.emotion} />)}
              <p>开场：{c.openingZh}</p>
              <p>高潮：{c.peakZh}</p>
              <p>结尾：{c.endingZh}</p>
              <details>
                <summary>查看完整 {c.plan.shots.length} 镜安排</summary>
                {c.plan.shots.map(s => (
                  <p key={s.id}>
                    {s.startSec}–{s.endSec}秒 ·{" "}
                    {MUSIC_MV_SHOT_LABELS[s.kind || "generated"]}：
                    {s.visualPrompt}；{s.cameraPrompt}
                    {s.sourceClip
                      ? `；素材从${s.sourceClip.sourceStartSec}秒开始`
                      : ""}
                  </p>
                ))}
              </details>
              <button
                className={button}
                disabled={
                  busy ||
                  props.disabled ||
                  !matches(props.session!) ||
                  Boolean(props.session?.proposal?.review && props.session.proposal.review.verdict !== "approved") ||
                  Boolean(
                    props.session?.adoption &&
                      props.session.adoption.conceptId !== c.id
                  )
                }
                onClick={() => void select(c.id)}
              >
                {props.session?.adoption?.conceptId === c.id
                  ? "恢复本方案采用"
                  : "采用并铺到自由画布"}
              </button>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
