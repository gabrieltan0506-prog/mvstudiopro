import { useMemo, useState } from "react";
import {
  MANHUA_STORY_EMOTION_FORMAT,
  checkManhuaStoryEmotion,
  manhuaStoryEmotionIsStale,
  normalizeManhuaStoryEmotion,
  summarizeManhuaStoryEmotion,
  type ManhuaEmotionPoint,
  type ManhuaStoryBeat,
  type ManhuaStoryEmotion,
} from "@shared/manhuaStoryEmotion";

/**
 * 剧本页「剧情与情绪」折叠区（生产者入口）。
 *
 * 定位：这是**唯一**产出 storyEmotion 的地方。分镜卡与配乐只消费，不各自再编一份。
 * 默认折叠——剧本页主体仍然是剧本，情绪设计是要用时才展开的高级项。
 *
 * 不做的事：不调用模型、不生成、不扣费。这里只让人把设计判断落成结构化数据。
 */

const KIND_OPTIONS: Array<{ value: ManhuaEmotionPoint["kind"]; labelZh: string }> = [
  { value: "rise", labelZh: "上升" },
  { value: "turn", labelZh: "转折" },
  { value: "fall", labelZh: "回落" },
  { value: "breath", labelZh: "留白（配乐会静）" },
];

const field =
  "rounded border border-white/20 bg-[#141a24] px-1.5 py-1 text-[11px] text-white min-w-0";
const btn =
  "rounded border border-cyan-300/30 px-2 py-1 text-[11px] text-cyan-50 disabled:opacity-40";

export type ManhuaStoryEmotionPanelProps = {
  /** 当前集号：只编辑本集，跨集数据保留不动 */
  episode: number;
  /** 本集段数，决定段号下拉范围 */
  segmentCount: number;
  /** 当前剧本版本标识；换剧本后旧分析要标失效 */
  scriptVersionKey: string;
  analysis?: ManhuaStoryEmotion | null;
  disabled?: boolean;
  onChange: (next: ManhuaStoryEmotion | undefined) => void;
};

function emptyAnalysis(scriptVersionKey: string): ManhuaStoryEmotion {
  return {
    format: MANHUA_STORY_EMOTION_FORMAT,
    scriptVersionKey,
    beats: [],
    curve: [],
    foreshadows: [],
    unreviewedZh: [],
  };
}

export function ManhuaStoryEmotionPanel({
  episode,
  segmentCount,
  scriptVersionKey,
  analysis,
  disabled,
  onChange,
}: ManhuaStoryEmotionPanelProps) {
  const [openedOnce, setOpenedOnce] = useState(false);
  const stale = manhuaStoryEmotionIsStale(analysis, scriptVersionKey);
  const issues = useMemo(() => checkManhuaStoryEmotion(analysis), [analysis]);
  const blocks = issues.filter((i) => i.level === "block");
  const warns = issues.filter((i) => i.level === "warn");
  const segments = useMemo(
    () => Array.from({ length: Math.max(1, Math.floor(segmentCount) || 1) }, (_, i) => i + 1),
    [segmentCount],
  );

  /**
   * 每次改动都过一遍 normalize 再交出去：面板里手输的脏值（强度打 99、段号打 0）
   * 不许流进存稿，否则下游读到的就是脏数据。
   */
  const commit = (next: ManhuaStoryEmotion) => {
    if (disabled) return;
    onChange(normalizeManhuaStoryEmotion({ ...next, scriptVersionKey }));
  };
  const current = analysis ?? emptyAnalysis(scriptVersionKey);

  const setCurve = (segmentIndex: number, patch: Partial<ManhuaEmotionPoint>) => {
    const rest = current.curve.filter((p) => !(p.episode === episode && p.segmentIndex === segmentIndex));
    const old = current.curve.find((p) => p.episode === episode && p.segmentIndex === segmentIndex);
    const merged: ManhuaEmotionPoint = {
      episode,
      segmentIndex,
      intensity: old?.intensity ?? 5,
      kind: old?.kind ?? "rise",
      reasonZh: old?.reasonZh ?? "",
      ...patch,
    };
    commit({ ...current, curve: [...rest, merged] });
  };

  const setBeat = (id: string, patch: Partial<ManhuaStoryBeat>) =>
    commit({ ...current, beats: current.beats.map((b) => (b.id === id ? { ...b, ...patch } : b)) });

  const addBeat = () => {
    const id = `beat_e${episode}_s1_${Date.now()}`;
    commit({
      ...current,
      beats: [
        ...current.beats,
        {
          id,
          episode,
          segmentIndex: 1,
          characterZh: "",
          wantZh: "",
          obstacleZh: "",
          fromStateZh: "",
          triggerZh: "",
          choiceZh: "",
          toStateZh: "",
          sourceZh: "",
        },
      ],
    });
  };

  const episodeBeats = current.beats.filter((b) => b.episode === episode);
  const episodeCurve = (segmentIndex: number) =>
    current.curve.find((p) => p.episode === episode && p.segmentIndex === segmentIndex);

  return (
    <details
      className="my-2 rounded-lg border border-cyan-400/20 bg-cyan-500/[0.04] p-2"
      data-manhua-story-emotion
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) setOpenedOnce(true);
      }}
    >
      <summary className="cursor-pointer text-[11px] font-medium text-cyan-50">
        剧情与情绪
        <span className="ml-2 font-normal text-white/45" data-manhua-story-emotion-summary>
          {summarizeManhuaStoryEmotion(analysis)}
        </span>
      </summary>

      {stale ? (
        <div
          className="mt-2 rounded-md border border-amber-300/30 bg-amber-500/10 p-2 text-[10px] leading-4 text-amber-50"
          data-manhua-story-emotion-stale
        >
          剧本已变动，这份分析是旧稿做的，下游不会采用。逐条核对后任意改一处即可重新盖上当前剧本版本。
        </div>
      ) : null}

      {blocks.length ? (
        <ul className="mt-2 space-y-1" data-manhua-story-emotion-blocks>
          {blocks.slice(0, 8).map((i, k) => (
            <li key={k} className="rounded border border-rose-300/30 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-50">
              {i.segmentIndex ? `第${i.segmentIndex}段：` : ""}
              {i.messageZh}
            </li>
          ))}
        </ul>
      ) : null}

      {openedOnce ? (
        <>
          <div className="mt-3">
            <p className="text-[11px] font-medium text-white/80">情绪曲线（按段）</p>
            <p className="mb-1 text-[9px] leading-4 text-white/35">
              强度是设计判断不是测量值；留白段配乐会插静默，不是缺口。
            </p>
            <div className="space-y-1">
              {segments.map((seg) => {
                const point = episodeCurve(seg);
                return (
                  <div key={seg} className="flex flex-wrap items-center gap-1" data-manhua-story-emotion-seg={seg}>
                    <span className="w-10 shrink-0 text-[10px] text-white/50">第{seg}段</span>
                    <select
                      className={field}
                      aria-label={`第${seg}段情绪类型`}
                      value={point?.kind ?? ""}
                      disabled={disabled}
                      onChange={(e) =>
                        e.target.value
                          ? setCurve(seg, { kind: e.target.value as ManhuaEmotionPoint["kind"] })
                          : commit({
                              ...current,
                              curve: current.curve.filter(
                                (p) => !(p.episode === episode && p.segmentIndex === seg),
                              ),
                            })
                      }
                    >
                      <option value="">未设</option>
                      {KIND_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.labelZh}
                        </option>
                      ))}
                    </select>
                    <input
                      className={`${field} w-14`}
                      type="number"
                      min={0}
                      max={10}
                      step={0.5}
                      aria-label={`第${seg}段情绪强度`}
                      value={point?.intensity ?? ""}
                      disabled={disabled || !point}
                      onChange={(e) => setCurve(seg, { intensity: Number(e.target.value) })}
                    />
                    <input
                      className={`${field} flex-1`}
                      placeholder="为什么是这个强度（由剧情变化解释）"
                      aria-label={`第${seg}段情绪理由`}
                      value={point?.reasonZh ?? ""}
                      disabled={disabled || !point}
                      onChange={(e) => setCurve(seg, { reasonZh: e.target.value })}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium text-white/80">因果节拍</p>
              <button type="button" className={btn} disabled={disabled} onClick={addBeat} data-manhua-story-emotion-add-beat>
                添加节拍
              </button>
            </div>
            <p className="mb-1 text-[9px] leading-4 text-white/35">
              开始状态 → 触发 → 选择 → 结束状态。四段齐了下游才读得到完整因果。
            </p>
            {episodeBeats.length === 0 ? (
              <p className="text-[10px] text-white/35">本集还没有节拍。</p>
            ) : null}
            <div className="space-y-2">
              {episodeBeats.map((b) => (
                <div key={b.id} className="rounded border border-white/10 p-1.5" data-manhua-story-emotion-beat={b.id}>
                  <div className="flex flex-wrap items-center gap-1">
                    <select
                      className={field}
                      aria-label="节拍所在段"
                      value={b.segmentIndex}
                      disabled={disabled}
                      onChange={(e) => setBeat(b.id, { segmentIndex: Number(e.target.value) })}
                    >
                      {segments.map((seg) => (
                        <option key={seg} value={seg}>
                          第{seg}段
                        </option>
                      ))}
                    </select>
                    <input
                      className={`${field} w-24`}
                      placeholder="人物"
                      aria-label="节拍人物"
                      value={b.characterZh}
                      disabled={disabled}
                      onChange={(e) => setBeat(b.id, { characterZh: e.target.value })}
                    />
                    <input
                      className={`${field} flex-1`}
                      placeholder="想得到什么"
                      aria-label="人物想要什么"
                      value={b.wantZh}
                      disabled={disabled}
                      onChange={(e) => setBeat(b.id, { wantZh: e.target.value })}
                    />
                    <button
                      type="button"
                      className={btn}
                      disabled={disabled}
                      onClick={() => commit({ ...current, beats: current.beats.filter((x) => x.id !== b.id) })}
                    >
                      移除
                    </button>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-1">
                    {(
                      [
                        ["obstacleZh", "阻力来自谁"],
                        ["fromStateZh", "开始状态"],
                        ["triggerZh", "触发"],
                        ["choiceZh", "他的选择"],
                        ["toStateZh", "结束状态"],
                        ["sourceZh", "原文位置／原创"],
                      ] as Array<[keyof ManhuaStoryBeat, string]>
                    ).map(([key, ph]) => (
                      <input
                        key={String(key)}
                        className={field}
                        placeholder={ph}
                        aria-label={ph}
                        value={String(b[key] ?? "")}
                        disabled={disabled}
                        onChange={(e) => setBeat(b.id, { [key]: e.target.value } as Partial<ManhuaStoryBeat>)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {warns.length ? (
            <ul className="mt-2 space-y-1" data-manhua-story-emotion-warns>
              {warns.slice(0, 6).map((i, k) => (
                <li key={k} className="text-[10px] leading-4 text-amber-100/70">
                  {i.segmentIndex ? `第${i.segmentIndex}段：` : ""}
                  {i.messageZh}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </details>
  );
}
