import { creativeUserText } from "@/lib/creativeUserText";
import {SongDemoPanel} from "./SongDemoPanel";
import { MusicEmotionPanel } from "./MusicEmotionPanel";
import { CreativeEvidenceReviewPanel } from "./CreativeEvidenceReviewPanel";
import { useEffect, useRef, useState } from "react";
import { manhuaSourceVersionIdentity } from "@shared/manhuaMultiview";
import { trpc } from "@/lib/trpc";
import { resolveMusicMvMediaUrl } from "@/lib/musicMvAdvisor";
import { musicMvSourceKey } from "@/lib/musicMvAdvisor";
import { manhuaCreativeAdvisorContextSchema } from "@shared/manhuaCreativeAdvisor";
import {
  parseSunoSongProposal,
  type CanvasMusicCandidate,
  type SunoSongSession,
  type SunoSongBrief,
  type SongDemoRun,
} from "@shared/canvasMusicMv";

type Props = {
  audio?: CanvasMusicCandidate;
  referenceMediaKind?: "audio" | "video";
  craftIds: string[];
  optimizeExisting?: boolean;
  originalBrief?: SunoSongBrief;
  onOptimizeExisting?: (value:boolean)=>void;
  demos:SongDemoRun[];
  selectedDemo?:{requestId:string;variantIndex:number};
  onDemos:(records:SongDemoRun[])=>void;
  onSelectDemo:(requestId:string,variantIndex:number)=>void;
  onCraftIds: (ids: string[]) => void;
  requirements: string;
  projectId?: string;
  videoModel: string;
  session?: SunoSongSession;
  history: SunoSongSession[];
  disabled: boolean;
  onRequirements: (text: string) => void;
  onSession: (s: SunoSongSession) => void;
  onNew: (s: SunoSongSession) => void;
  onApply: (
    brief: SunoSongBrief,
    session: SunoSongSession,
    conceptId: string
  ) => void;
};
const optimizationRequirements="保留完整歌词、标题和时长，优化音乐风格与编曲提示词，给出三种可试听对比的编曲方向。";
const resolvedRequirements=(p:Props)=>p.requirements.trim()||(p.optimizeExisting?optimizationRequirements:"");
const button =
  "rounded border border-white/20 px-2 py-1 text-xs disabled:opacity-40";
export function sunoSongAdvisorRequest(s: SunoSongSession) {
  return {
    requestId: s.requestId,
    question: s.target.originalBrief ? "仅优化现有音乐风格提示词，保留完整歌词、标题和目标时长，输出三套不同编曲方案供Demo比较。" : s.target.audio
      ? "请读取参考音频或MV，拆解音画方法并创作三套不同曲风的原创Suno V6歌曲方案。"
      : "请按主题创作三套不同曲风的原创Suno V6歌曲方案，没有音频参考，不生成听音结论。",
    rawQuestion: s.target.originalBrief ? "仅优化现有音乐风格提示词，保留完整歌词、标题和目标时长，输出三套不同编曲方案供Demo比较。" : s.target.audio
      ? "请读取参考音频或MV，拆解音画方法并创作三套不同曲风的原创Suno V6歌曲方案。"
      : "请按主题创作三套不同曲风的原创Suno V6歌曲方案，没有音频参考，不生成听音结论。",
    manhuaContext: manhuaCreativeAdvisorContextSchema.parse({
      projectId: s.projectId,
      seriesTitle: "歌曲创作",
      episodeIndex: 1,
      episodeTitle: "参考歌曲再创作",
      stage: "storyboard",
      activeStudio: { tool: "musicMv", episodeIndex: 1 },
      videoModel: s.videoModel,
      writerConfirmed: false,
      episodeBody: "",
      assetSummary: "",
      shotSummary: "",
      blockers: [],
      sunoSong: s.target,
    }),
  };
}
/** 原曲是听音参考；采用只填写新歌表单，不直接调用Suno。 */
export function CanvasSunoSongAdvisor(p: Props) {
  const cloudTemplates=trpc.canvasMusicMv.listSongCraftTemplates.useQuery(undefined,{staleTime:0,refetchOnWindowFocus:true});
  const library = trpc.canvasMusicMv.listCreativeLibrary.useQuery(undefined, {retry: false});
  const ask = trpc.mvAnalysis.askPlatformSkillQa.useMutation({ retry: false });
  const quota = trpc.mvAnalysis.getManhuaAdvisorQuota.useQuery(
    p.projectId ? { projectId: p.projectId } : undefined,
    { retry: false }
  );
  const [craftQuery, setCraftQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const lock = useRef(false);
  const current = useRef(p);
  current.current = p;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let stop = false;
    setPreview("");
    if (p.audio)
      void resolveMusicMvMediaUrl(p.audio.gcsUri || p.audio.url)
        .then(url => {
          if (!stop) setPreview(url);
        })
        .catch(e => {
          if (!stop) setError(String(e));
        });
    return () => {
      stop = true;
    };
  }, [p.audio?.gcsUri, p.audio?.url]);
  const matches = (s: SunoSongSession) => {
    const now = current.current;
    return (
      JSON.stringify(now.optimizeExisting?now.originalBrief:undefined)===JSON.stringify(s.target.originalBrief) &&
      (now.referenceMediaKind || "audio") === (s.target.referenceMediaKind || "audio") &&
      now.audio?.id === s.target.audio?.id &&
      manhuaSourceVersionIdentity(now.audio?.gcsUri || now.audio?.url) ===
        manhuaSourceVersionIdentity(
          s.target.audio?.gcsUri || s.target.audio?.url
        ) &&
      now.audio?.durationSec === s.target.audio?.durationSec &&
      resolvedRequirements(now) === s.target.requirements &&
      JSON.stringify(now.craftIds) ===
        JSON.stringify(s.target.craftIds || []) &&
      now.projectId === s.projectId
    );
  };
  const put = (s: SunoSongSession) => {
    current.current = { ...current.current, session: s };
    current.current.onSession(s);
  };
  const run = async (confirmPaid = false, newVersion = false) => {
    if (lock.current || p.disabled) return;
    lock.current = true;
    setBusy(true);
    setError("");
    let s = current.current.session;
    try {
      if (!s || newVersion) {
        if (s?.status === "pending")
          throw new Error("请先恢复原咨询，避免重复听音收费");
        if (!resolvedRequirements(p)) throw new Error("请填写新歌主题与要求");
        if (p.optimizeExisting&&!p.originalBrief) throw new Error("请先填写完整歌词和音乐风格，并核对时长及参数范围");
        const target = {
          audio: p.audio,
          referenceMediaKind: p.referenceMediaKind || "audio",
          requirements: resolvedRequirements(p),
          craftIds: p.craftIds,
          ...(p.optimizeExisting?{originalBrief:p.originalBrief}:{}),
        };
        const sourceKey = await musicMvSourceKey({
          ...target,
          audio: target.audio
            ? {
                ...target.audio,
                url: manhuaSourceVersionIdentity(
                  target.audio.gcsUri || target.audio.url
                ),
              }
            : undefined,
        });
        s = {
          requestId: crypto.randomUUID(),
          projectId: p.projectId,
          videoModel: p.videoModel,
          target: { ...target, sourceKey },
          status: "pending",
        };
        if (!matches(s)) throw new Error("参考或要求已变化，请重新咨询");
        current.current = { ...current.current, session: s };
        p.onNew(s);
      }
      const response = await ask.mutateAsync({
        ...sunoSongAdvisorRequest(s),
        ...(confirmPaid
          ? { confirmPaid: true, confirmedCredits: quota.data?.price }
          : {}),
      });
      const proposal = parseSunoSongProposal(response.answer, s.target);
      if (!alive.current || current.current.session?.requestId !== s.requestId)
        return;
      put({ ...s, status: "succeeded", proposal });
      setPaid(false);
      void quota.refetch();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (alive.current) {
        setError(message);
        if (/PAYMENT_REQUIRED|免费.*用完|请确认后重试/.test(message))
          setPaid(true);
        if (s && /ADVISOR_OPERATION_FAILED/.test(message))
          put({ ...s, status: "failed" });
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <section
      aria-label="参考歌曲创作"
      className="space-y-2 rounded border border-violet-300/30 p-2 text-xs"
    >
      <strong>按主题或参考歌曲创作新歌</strong>
      <p>
        提供主题或参考作品，获得歌词、曲风与编曲方案；选定方案后可继续生成歌曲。
      </p>
      {p.audio ? (
        <p>
          参考曲：{p.audio.title} · {p.audio.durationSec.toFixed(2)} 秒
        </p>
      ) : (
        <p>未选参考歌曲：按主题创作，不进行听音分析。</p>
      )}
      {preview && (p.referenceMediaKind === "video" ? <video controls src={preview} className="w-full" /> : <audio controls src={preview} className="w-full" />)}
      <details>
        <summary>创意生成库（已选 {p.craftIds.length} 项）</summary>
        <p>
          可指定最多3项，也可留空由顾问按主题选择2–3项。访谈归纳与媒体分析分别标注。
        </p>
        <input
          aria-label="搜索创作方法"
          placeholder="按歌曲、歌手或创作者搜索"
          value={craftQuery}
          onChange={e => setCraftQuery(e.target.value)}
          className="w-full rounded bg-black/30 p-2"
        />
        <button type="button" className={button} disabled={library.isFetching||cloudTemplates.isFetching} onClick={() => {void library.refetch();void cloudTemplates.refetch();}}>刷新最新模板</button>
        {cloudTemplates.error&&<p role="alert">云端歌曲模板读取失败：{creativeUserText(cloudTemplates.error.message)}</p>}
        {cloudTemplates.data&&<p>云端模板 {cloudTemplates.data.cards.length} 条 · 更新于 {cloudTemplates.data.publishedAt}</p>}
        {library.error && <p role="alert">个人创意库读取失败：{creativeUserText(library.error.message)}</p>}
        {library.data?.filter(entry => entry.report.titleZh.toLowerCase().includes(craftQuery.trim().toLowerCase())).map(entry => (
          <details key={entry.id} className="my-1 rounded border border-white/15 p-2">
            <summary><label><input type="checkbox" checked={p.craftIds.includes(entry.id)}
              disabled={busy || p.disabled || p.session?.status === "pending" || (!p.craftIds.includes(entry.id) && p.craftIds.length >= 3)}
              onChange={event => p.onCraftIds(event.target.checked ? [...p.craftIds, entry.id] : p.craftIds.filter(id => id !== entry.id))} /> {entry.report.titleZh} · 我的收藏</label></summary>
            <p>{entry.report.summaryZh}</p>
            {entry.report.methods.map(method => <p key={method.id}>{method.titleZh}：{method.principleZh}</p>)}
            {entry.report.limitationsZh.map((line,index) => <p key={index}>{line}</p>)}
          </details>
        ))}
        {(cloudTemplates.data?.cards||[]).filter(c =>
          `${c.title} ${c.contributor}`
            .toLowerCase()
            .includes(craftQuery.trim().toLowerCase())
        ).map(c => (
          <details
            key={c.id}
            className="my-1 rounded border border-white/15 p-2"
          >
            <summary>
              <label>
                <input
                  type="checkbox"
                  aria-label={`选择${c.title}`}
                  checked={p.craftIds.includes(c.id)}
                  disabled={
                    busy ||
                    p.disabled ||
                    p.session?.status === "pending" ||
                    (!p.craftIds.includes(c.id) && p.craftIds.length >= 3)
                  }
                  onChange={e =>
                    p.onCraftIds(
                      e.target.checked
                        ? [...p.craftIds, c.id]
                        : p.craftIds.filter(id => id !== c.id)
                    )
                  }
                />{" "}
                {c.title} ·{" "}
                {c.basis === "native_audio" ? "音画分析" : "访谈归纳"}
              </label>
            </summary>
            <p>{c.contributor}</p>
            {c.evidence && (
              <p>
                音画分析结果尚未人工复核。精确节拍、音高与和弦未经独立测量。
              </p>
            )}
            {c.evidence && (
              <details>
                <summary>来源审阅与未验项</summary>
                {c.evidence.auditNotes.map((note, index) => (
                  <p key={index}>{note}</p>
                ))}
              </details>
            )}
            {c.highlights.map((h, i) => (
              <p key={i}>{h}</p>
            ))}
            <p>写词提示：{c.lyricPrompt}</p>
            <p>风格提示：{c.stylePrompt}</p>
            <p>MV提示：{c.mvPrompt}</p>
            {c.sources.map(source => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="mr-2 underline"
              >
                {source.title}
              </a>
            ))}
          </details>
        ))}
      </details>
      <label className="flex gap-2"><input type="checkbox" aria-label="保留歌词优化音乐提示词" checked={Boolean(p.optimizeExisting)} disabled={busy||p.disabled||p.session?.status==="pending"} onChange={e=>p.onOptimizeExisting?.(e.target.checked)}/>保留歌词，优化现有音乐提示词</label>
      {p.optimizeExisting&&<details open><summary>本次优化输入</summary><p>保留歌曲表单中的完整歌词、标题及目标时长，优化风格、配器与演唱表达；输出三个编曲方向。</p><p>{p.originalBrief?.style||"请先在歌曲表单填写音乐风格"}</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{p.originalBrief?.prompt||"请先填写歌词"}</pre></details>}
      <textarea
        aria-label="新歌创作要求"
        className="w-full rounded bg-black/30 p-2"
        rows={3}
        maxLength={6000}
        value={p.requirements}
        disabled={busy || p.disabled || p.session?.status === "pending"}
        onChange={e => p.onRequirements(e.target.value)}
        placeholder="例如：学习参考曲副歌的情绪推进，写一首关于毕业后重逢的中文新歌，女声，约3分钟。"
      />
      <p>
        本次提交：
        {p.audio
          ? "完整参考音视频 → 分析创作方法 → 提出不同曲风方案"
          : "创作要求 → 提出不同曲风方案"}
        ；此按钮不生成音乐。咨询沿用现有免费额度，额度不足时显示积分确认。
      </p>
      <button
        className={button}
        disabled={
          busy ||
          p.disabled ||
          !resolvedRequirements(p) ||
          p.session?.status === "succeeded" ||
          p.session?.status === "failed"
        }
        onClick={() => void run()}
      >
        {p.session?.status === "pending"
          ? "恢复原听音咨询"
          : p.optimizeExisting
            ? "优化提示词并给出三种编曲方案"
            : p.audio
            ? "听音拆解并创作新歌方案"
            : "按主题创作新歌方案"}
      </button>
      {p.session && p.session.status !== "pending" && (
        <button
          className={button}
          disabled={busy || p.disabled}
          onClick={() => void run(false, true)}
        >
          按当前要求新一轮咨询
        </button>
      )}
      {paid && (
        <button
          className={button}
          disabled={busy || p.disabled || quota.data?.price === undefined}
          onClick={() => void run(true)}
        >
          确认本次咨询 · {quota.data?.price ?? "待核价"} 积分
        </button>
      )}
      {p.session?.proposal && (
        <>
          <p>{p.session.proposal.summaryZh}</p>
          <details>
            <summary>依据与可借鉴方法</summary>
            {p.session.proposal.sections.map((s, i) => (
              <div key={i}><p>{s.startSec.toFixed(1)}–{s.endSec.toFixed(1)}秒 · {s.labelZh}：{s.heardZh}</p><MusicEmotionPanel emotion={s.emotion} /></div>
            ))}
            {p.session.proposal.transferableCraft.map((t, i) => (
              <p key={i}>{t}</p>
            ))}
            {p.session.proposal.uncertaintiesZh.map((t, i) => (
              <p key={i}>未确认：{t}</p>
            ))}
          </details>
          <CreativeEvidenceReviewPanel review={p.session.proposal.review} />
          {p.session.proposal.concepts.map((c, i) => (
            <details
              key={c.id}
              open={i === 0}
              className="rounded border border-white/15 p-2"
            >
              <summary>
                {i === 0 ? "主推荐" : "备选"} · {c.brief.title}
              </summary>
              <p>{c.rationaleZh}</p>
              {c.emotionalArc?.map((a, j) => <MusicEmotionPanel key={j} label={a.sectionZh} emotion={a.emotion} />)}
              <p>新作区别：{c.differenceZh}</p>
              <p>记忆点：{c.hookZh}</p>
              {c.lyricMethodZh && <p>写词方法：{c.lyricMethodZh}</p>}
              {c.mvDirectionZh && <p>MV方向：{c.mvDirectionZh}</p>}
              <p>风格：{c.brief.style}</p>
              <p>排除：{c.brief.negative_tags || "无"}</p>
              <pre className="whitespace-pre-wrap font-sans">
                {c.brief.prompt}
              </pre>
              <p>
                目标 {c.brief.duration}秒 · 风格强度{" "}
                {Math.round(c.brief.style_weight * 100)}% · 随机性{" "}
                {Math.round(c.brief.weirdness_constraint * 100)}%
              </p>
              <button
                className={button}
                disabled={
                  busy ||
                  p.disabled ||
                  !matches(p.session!) ||
                  (p.session?.proposal?.review && p.session.proposal.review.verdict !== "approved") ||
                  !p.session?.proposal?.evidenceId
                }
                onClick={() => {
                  const s = current.current.session;
                  if (!s || !matches(s) || !s.proposal?.evidenceId || (s.proposal.review && s.proposal.review.verdict !== "approved")) {
                    setError("参考版本已变化，未采用");
                    return;
                  }
                  p.onApply(c.brief, s, c.id);
                }}
              >
                采用歌词与编曲方案
              </button>
            </details>
          ))}
        </>
      )}
      <SongDemoPanel session={p.session} history={p.history} records={p.demos} disabled={p.disabled||busy} canGenerate={Boolean(p.session&&matches(p.session))} selected={p.selectedDemo} onChange={p.onDemos} onSelect={(run,variant,session)=>{p.onApply(run.fullBrief,session,run.conceptId);p.onSelectDemo(run.requestId,variant.index);}} />
      {!!p.history.length && (
        <details>
          <summary>历史咨询（{p.history.length}）</summary>
          {p.history.map(s => (
            <details key={s.requestId}>
              <summary>
                {s.target.audio?.title || "主题创作"} · {s.status}
              </summary>
              <p>{s.target.requirements}</p>
              {s.proposal?.concepts.map(c => (
                <div key={c.id}>
                  <strong>{c.brief.title}</strong>
                  <p>{c.brief.style}</p>
                  <pre className="whitespace-pre-wrap">{c.brief.prompt}</pre>
                  <button
                    className={button}
                    disabled={busy || p.disabled || !s.proposal?.evidenceId || Boolean(s.proposal?.review && s.proposal.review.verdict !== "approved")}
                    onClick={() => p.onApply(c.brief, s, c.id)}
                  >
                    采用此历史方案
                  </button>
                </div>
              ))}
            </details>
          ))}
        </details>
      )}
      {error && (
        <p role="alert" className="text-amber-200">
          {creativeUserText(error)}
        </p>
      )}
    </section>
  );
}
