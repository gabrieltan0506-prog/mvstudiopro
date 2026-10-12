import { useEffect, useState } from "react";
import {
  codeMotionTimingSchema,
  type CodeMotionTiming,
} from "@shared/codeMotionTiming";
import type { CodeMotionAudioSource } from "@shared/codeMotionAudio";
export default function CodeMotionTimingPanel({
  value,
  sources,
  onChange,
  onAnalyze,
  busy = false,
  audioSources = [],
}: {
  value?: CodeMotionTiming;
  sources: CodeMotionAudioSource[];
  onChange: (value: CodeMotionTiming) => void;
  onAnalyze: (sourceId: string) => Promise<CodeMotionTiming>;
  busy?: boolean;
  audioSources?: { id: string; url: string }[];
}) {
  const [sourceId, setSourceId] = useState(
      value?.sourceId || sources[0]?.id || ""
    ),
    [draft, setDraft] = useState(value),
    [error, setError] = useState(""),
    [running, setRunning] = useState(false);
  useEffect(() => {
    setDraft(value);
    if (value) setSourceId(value.sourceId);
  }, [value]);
  useEffect(() => {
    if (sources[0] && !sources.some(source => source.id === sourceId))
      setSourceId(sources[0].id);
  }, [sources, sourceId]);
  const source = sources.find(s => s.id === sourceId),
    url = audioSources.find(s => s.id === sourceId)?.url;
  const edit = (next: CodeMotionTiming) => {
    setDraft({ ...next, review: "needs-review" });
    setError("");
  };
  const publish = (confirmed: boolean) => {
    try {
      if (!draft) throw Error("请先分析或添加真实秒窗");
      const parsed = codeMotionTimingSchema.parse({
        ...draft,
        review: confirmed ? "confirmed" : "needs-review",
      });
      if (
        source &&
        (parsed.words.some(w => w.endSec > source.duration) ||
          parsed.beats.some(b => b.at >= source.duration))
      )
        throw Error("时间超出当前原音");
      onChange(parsed);
      setDraft(parsed);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "词拍数据不完整");
    }
  };
  const empty = (): CodeMotionTiming => ({
    version: 1,
    sourceId: source!.id,
    sourceSha256: source!.sha256,
    method: "manual",
    review: "needs-review",
    words: [],
    beats: [],
  });
  if (!sources.length) return null;
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h3 className="font-medium">词语与拍点</h3>
      <p className="text-sm text-stone-600">
        从这份原音估计词语秒窗和音乐拍点，再试听、修改并确认。不会平均分字；原生听音估计可能有偏差。
      </p>
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="词拍原音"
          value={sourceId}
          onChange={e => {
            setSourceId(e.target.value);
            setDraft(undefined);
            setError("");
          }}
          disabled={busy || running}
        >
          {sources.map(s => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="rounded border px-3 py-1"
          disabled={!source || busy || running}
          onClick={async () => {
            setRunning(true);
            setError("");
            try {
              const result = await onAnalyze(sourceId);
              setDraft(result);
              onChange(result);
            } catch (e) {
              setError(e instanceof Error ? e.message : "听音分析失败");
            } finally {
              setRunning(false);
            }
          }}
        >
          {running ? "正在听音…" : "分析 / 恢复本次词拍"}
        </button>
        <button
          type="button"
          className="rounded border px-3 py-1"
          disabled={!source || busy || running}
          onClick={() =>
            edit({
              ...(draft || empty()),
              words: [
                ...(draft?.words || []),
                {
                  id: `word-${Date.now()}`,
                  text: "修改词语",
                  startSec: Math.min(
                    source!.duration - 0.1,
                    draft?.words.slice(-1)[0]?.endSec || 0
                  ),
                  endSec: Math.min(
                    source!.duration,
                    (draft?.words.slice(-1)[0]?.endSec || 0) + 0.5
                  ),
                  confidence: 1,
                  action: "pop",
                },
              ],
            })
          }
        >
          添加词语
        </button>
        <button
          type="button"
          className="rounded border px-3 py-1"
          disabled={!source || busy || running}
          onClick={() =>
            edit({
              ...(draft || empty()),
              beats: [
                ...(draft?.beats || []),
                {
                  id: `beat-${Date.now()}`,
                  at: Math.min(
                    source!.duration - 0.01,
                    (draft?.beats.slice(-1)[0]?.at || 0) + 0.5
                  ),
                  strength: 1,
                },
              ],
            })
          }
        >
          添加拍点
        </button>
      </div>
      {url && (
        <audio
          aria-label="词拍原音试听"
          controls
          preload="metadata"
          src={url}
        />
      )}
      {draft && (
        <>
          <p className="text-xs">
            {draft.method === "native-audio-estimate"
              ? "原生听音估计"
              : "手动秒窗"}{" "}
            · {draft.review === "confirmed" ? "已核对确认" : "待试听核对"} ·
            时间对应原音秒数，使用裁切后的摆放位置编译。
          </p>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th>词语</th>
                  <th>开始秒</th>
                  <th>结束秒</th>
                  <th>动作</th>
                  <th>置信度</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.words.map((word, index) => (
                  <tr key={word.id}>
                    <td>
                      <input
                        aria-label={`词语 ${index + 1}`}
                        className="w-32 rounded border p-1"
                        value={word.text}
                        onChange={e =>
                          edit({
                            ...draft,
                            words: draft.words.map((w, i) =>
                              i === index ? { ...w, text: e.target.value } : w
                            ),
                          })
                        }
                      />
                    </td>
                    {(["startSec", "endSec"] as const).map(key => (
                      <td key={key}>
                        <input
                          aria-label={`${index + 1} ${key}`}
                          type="number"
                          min={0}
                          step={0.01}
                          className="w-20 rounded border p-1"
                          value={word[key]}
                          onChange={e =>
                            edit({
                              ...draft,
                              words: draft.words.map((w, i) =>
                                i === index
                                  ? { ...w, [key]: Number(e.target.value) }
                                  : w
                              ),
                            })
                          }
                        />
                      </td>
                    ))}
                    <td>
                      <select
                        aria-label={`词语 ${index + 1} 动作`}
                        value={word.action}
                        onChange={e =>
                          edit({
                            ...draft,
                            words: draft.words.map((w, i) =>
                              i === index
                                ? {
                                    ...w,
                                    action: e.target
                                      .value as typeof word.action,
                                  }
                                : w
                            ),
                          })
                        }
                      >
                        {Object.entries({
                          pop: "弹出",
                          rise: "升起",
                          slide: "滑入",
                          spin: "旋入",
                          fade: "淡入",
                        }).map(([v, label]) => (
                          <option key={v} value={v}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{Math.round(word.confidence * 100)}%</td>
                    <td>
                      <button
                        type="button"
                        aria-label={`删除词语 ${index + 1}`}
                        onClick={() =>
                          edit({
                            ...draft,
                            words: draft.words.filter((_, i) => i !== index),
                          })
                        }
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex max-h-40 flex-wrap gap-2 overflow-auto">
            {draft.beats.map((beat, index) => (
              <label key={beat.id} className="text-xs">
                拍 {index + 1}{" "}
                <input
                  aria-label={`拍点 ${index + 1}`}
                  type="number"
                  min={0}
                  step={0.01}
                  className="w-20 rounded border p-1"
                  value={beat.at}
                  onChange={e =>
                    edit({
                      ...draft,
                      beats: draft.beats.map((b, i) =>
                        i === index ? { ...b, at: Number(e.target.value) } : b
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  aria-label={`删除拍点 ${index + 1}`}
                  onClick={() =>
                    edit({
                      ...draft,
                      beats: draft.beats.filter((_, i) => i !== index),
                    })
                  }
                >
                  ×
                </button>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              className="rounded border px-3 py-1"
              onClick={() => publish(false)}
            >
              保存待核对
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded bg-stone-900 px-3 py-1 text-white"
              onClick={() => publish(true)}
            >
              已试听核对，采用词拍动作
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
