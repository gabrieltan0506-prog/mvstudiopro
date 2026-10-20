import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AdvisorFilmReview,
  AdvisorFilmReviewTarget,
} from "@shared/manhuaAdvisorFilmReview";
import { resolveCanvasMaterialUrl } from "@/lib/omniCanvasApi";
import {
  buildFilmReviewTimeline,
  filmTimelineWarnings,
  type FilmEvidenceRow,
} from "@/lib/filmReviewTimeline";

type Props = {
  report: AdvisorFilmReview;
  target: AdvisorFilmReviewTarget;
  onEdit: (text: string) => void;
  disabled?: boolean;
};
export function ManhuaAdvisorFilmReview(props: Props) {
  return (
    <FilmReview
      key={JSON.stringify([
        props.target.blockId,
        props.target.revision,
        props.target.videoUri,
        props.report.nativeEvidence?.sourceGeneration,
      ])}
      {...props}
    />
  );
}
function FilmReview(props: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [duration, setDuration] = useState<number | undefined>();
  const [at, setAt] = useState(0);
  const [selected, setSelected] = useState("");
  const timeline = useMemo(
    () => buildFilmReviewTimeline(props.report),
    [props.report]
  );
  useEffect(() => {
    let current = true;
    setUrl("");
    setError("");
    setDuration(undefined);
    setAt(0);
    const source = props.target.videoUri;
    Promise.resolve()
      .then(() =>
        source.startsWith("gs://") ? resolveCanvasMaterialUrl(source) : source
      )
      .then(value => {
        if (!/^https:\/\//.test(value)) throw Error("无效素材地址");
        if (current) setUrl(value);
      })
      .catch(() => {
        if (current) setError("原片暂时无法读取，审阅记录仍保留。");
      });
    return () => {
      current = false;
    };
  }, [props.target.videoUri, attempt]);
  const canSeek = Boolean(url && duration && !error);
  function seek(time: number) {
    if (
      !video.current ||
      !canSeek ||
      !Number.isFinite(time) ||
      time < 0 ||
      time >= duration!
    )
      return;
    video.current.currentTime = time;
    setAt(time);
  }
  const shot =
    timeline.shots.find(row => row.id === selected) ||
    timeline.shots.find(row => at >= row.startSec && at < row.endSec);
  const sound = timeline.audio.filter(row =>
    shot
      ? row.startSec < shot.endSec && row.endSec > shot.startSec
      : at >= row.startSec && at < row.endSec
  );
  const warnings = [
    ...timeline.warnings,
    ...(duration
      ? [
          ...filmTimelineWarnings(timeline.shots, duration, "画面"),
          ...filmTimelineWarnings(timeline.audio, duration, "声音"),
          ...timeline.cues
            .filter(row => row.atSec >= duration)
            .map(
              row => `${row.title} ${row.atSec.toFixed(1)} 秒超出可播放范围。`
            ),
        ]
      : []),
  ];
  const range = (row: FilmEvidenceRow) =>
    `${row.startSec.toFixed(1)}–${row.endSec.toFixed(1)}秒`;
  const describe = (row: FilmEvidenceRow) => (
    <dl className="grid gap-2 break-words">
      {row.fields.length ? (
        row.fields.map((field, i) => (
          <div key={i}>
            <dt className="text-xs opacity-60">{field.label}</dt>
            <dd>{field.text}</dd>
          </div>
        ))
      ) : (
        <p>这一段未提供文字描述，请核对原片。</p>
      )}
    </dl>
  );
  return (
    <section
      aria-label="影片审阅结果"
      className="space-y-3 rounded-xl border border-cyan-300/30 p-3 text-sm"
    >
      <h3 className="font-semibold">{props.target.label} · Gemini Flash审阅</h3>
      {url && (
        <video
          ref={video}
          src={url}
          controls
          preload="metadata"
          className="max-h-72 w-full"
          onLoadedMetadata={e => {
            const value = e.currentTarget.duration;
            if (Number.isFinite(value) && value > 0) setDuration(value);
            else setError("原片时长无法读取，暂不能按时间定位。");
          }}
          onTimeUpdate={e => {
            setAt(e.currentTarget.currentTime);
            setSelected("");
          }}
          onError={() => setError("原片播放失败，审阅记录仍保留。")}
        />
      )}
      {!url && !error && <p role="status">正在读取原片…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="underline"
            onClick={() => setAttempt(n => n + 1)}
          >
            重新读取原片
          </button>
        </div>
      )}
      <p>{props.report.summary}</p>
      {(props.report.nativeEvidence || props.report.observerEvidence) && (
        <section
          aria-label="音画逐镜对照"
          className="space-y-3 rounded-lg border border-white/15 p-3"
        >
          <header>
            <h4 className="font-semibold">音画逐镜对照</h4>
            <p className="text-xs opacity-70">
              点击时间定位原片；播放时同步镜头。以下为模型判读，时间与内容均待核对。
            </p>
          </header>
          {timeline.beat && <p>叙事节拍：{timeline.beat}</p>}
          {timeline.mood && <p>情绪变化：{timeline.mood}</p>}
          <div
            className="flex max-h-40 flex-wrap gap-2 overflow-y-auto"
            aria-label="镜头列表"
          >
            {timeline.shots.map(row => (
              <button
                type="button"
                key={row.id}
                aria-pressed={shot?.id === row.id}
                className="rounded border border-white/20 px-3 py-2 text-left aria-pressed:border-cyan-300 aria-pressed:bg-cyan-500/15"
                onClick={() => {
                  setSelected(row.id);
                  seek(row.startSec);
                }}
              >
                {row.title} · {range(row)}
              </button>
            ))}
          </div>
          {!timeline.shots.length && <p>这份记录没有有效的逐镜区间。</p>}
          {shot && (
            <div className="grid gap-4 md:grid-cols-2">
              <article aria-label="当前镜头画面" className="min-w-0 space-y-2">
                <h5 className="font-semibold">
                  {shot.title} · {range(shot)}
                </h5>
                {describe(shot)}
              </article>
              <article aria-label="当前镜头声音" className="min-w-0 space-y-2">
                <h5 className="font-semibold">同段声音</h5>
                {sound.length ? (
                  sound.map(row => (
                    <div
                      key={row.id}
                      className="space-y-2 border-b border-white/10 pb-3"
                    >
                      <p className="text-xs opacity-70">
                        原声音区间 {range(row)}
                      </p>
                      {describe(row)}
                    </div>
                  ))
                ) : (
                  <p>没有与该镜头重叠的声音记录，不能据此认定原片无声。</p>
                )}
              </article>
            </div>
          )}
          <details>
            <summary>
              全部声音区间与重点时刻（
              {timeline.audio.length + timeline.cues.length}）
            </summary>
            <div className="max-h-96 space-y-3 overflow-y-auto py-3">
              {timeline.audioNotes.map((note, i) => (
                <p key={`note-${i}`}>
                  <span className="opacity-60">{note.label}：</span>
                  {note.text}
                </p>
              ))}
              {timeline.audio.map(row => (
                <article key={row.id}>
                  <button
                    type="button"
                    disabled={!canSeek || row.startSec >= duration!}
                    className="underline disabled:opacity-40"
                    onClick={() => {
                      setSelected("");
                      seek(row.startSec);
                    }}
                  >
                    {row.title} · {range(row)}
                  </button>
                  {describe(row)}
                </article>
              ))}
              {timeline.cues.map(row => (
                <p key={row.id}>
                  <button
                    type="button"
                    disabled={!canSeek || row.atSec >= duration!}
                    className="underline disabled:opacity-40"
                    onClick={() => {
                      setSelected("");
                      seek(row.atSec);
                    }}
                  >
                    {row.atSec.toFixed(1)}秒 · {row.title}
                  </button>{" "}
                  {row.text}
                </p>
              ))}
            </div>
          </details>
          {warnings.length > 0 && (
            <details>
              <summary>待核对的时间记录（{warnings.length}）</summary>
              <ul className="space-y-1 py-2 text-amber-200">
                {warnings.map((message, i) => (
                  <li key={i}>{message}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
      {props.report.nativeEvidence && (
        <details className="rounded border border-white/15 p-2">
          <summary>完整音画审阅记录</summary>
          <p>沿用模板学习的逐镜与音轨校验；判读仍需你核对。</p>
          <button
            className="underline"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob(
                  [JSON.stringify(props.report.nativeEvidence, null, 2)],
                  { type: "application/json" }
                )
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "完整音画审阅记录.json";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            下载完整记录
          </button>
        </details>
      )}
      {props.report.observerEvidence && (
        <details className="rounded border border-white/15 p-2">
          <summary>查看音画证据与覆盖范围</summary>
          <p>
            画面区间{" "}
            {(
              props.report.observerEvidence.validation.visualIntervalCoverage
                .ratio * 100
            ).toFixed(1)}
            %；声音区间{" "}
            {(
              props.report.observerEvidence.validation.audioIntervalCoverage
                .ratio * 100
            ).toFixed(1)}
            %。区间覆盖不代表感知准确。
          </p>
          {(["shots", "audioSegments"] as const).map(key => (
            <div key={key}>
              <h4>{key === "shots" ? "画面" : "声音"}</h4>
              {props.report.observerEvidence!.analysis[key].map((row, i) => (
                <p key={i}>
                  <button
                    className="underline"
                    disabled={!canSeek || row.startSec >= duration!}
                    onClick={() => {
                      setSelected("");
                      seek(row.startSec);
                    }}
                  >
                    {row.startSec.toFixed(1)}–{row.endSec.toFixed(1)}秒
                  </button>{" "}
                  {row.descriptionZh}
                </p>
              ))}
            </div>
          ))}
        </details>
      )}
      {props.report.findings.map((f, i) => (
        <div key={i} className="space-y-2 border-t border-white/15 pt-2">
          <button
            type="button"
            disabled={!canSeek || f.atSec >= duration!}
            className="text-cyan-200 underline disabled:opacity-40"
            onClick={() => {
              setSelected("");
              seek(f.atSec);
            }}
          >
            {f.atSec.toFixed(1)}–{f.endSec.toFixed(1)}秒 · {f.category}
          </button>
          <p>
            {f.kind ? `${f.kind}：` : ""}
            {f.observation}
          </p>
          <p>建议：{f.suggestion}</p>
          <p className="text-xs opacity-70">{f.confidence}</p>
          <button
            disabled={props.disabled}
            className="rounded border border-cyan-300/40 px-3 py-2 disabled:opacity-40"
            onClick={() =>
              props.onEdit(
                `只修改${f.atSec.toFixed(1)}–${f.endSec.toFixed(1)}秒，其余保持原样。${f.suggestion}`
              )
            }
          >
            让顾问准备视频修改方案
          </button>
        </div>
      ))}
      <p className="text-xs opacity-70">
        {props.report.limitations} · 分析建议待你核对；不会自动修改或生成。
      </p>
    </section>
  );
}
