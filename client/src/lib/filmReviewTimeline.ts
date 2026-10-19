import type { AdvisorFilmReview } from "@shared/manhuaAdvisorFilmReview";

export type FilmEvidenceRow = {
  id: string;
  startSec: number;
  endSec: number;
  title: string;
  fields: { label: string; text: string }[];
};
export type FilmEvidenceCue = {
  id: string;
  atSec: number;
  title: string;
  text: string;
};
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const second = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
const fields = (row: Record<string, unknown>, names: Record<string, string>) =>
  Object.entries(names).flatMap(([key, label]) =>
    text(row[key]) ? [{ label, text: text(row[key]) }] : []
  );
const cueLabels: Record<string, string> = {
  source_change: "声源变化",
  voice_change: "人声变化",
  sfx: "音效",
  bgm_in: "配乐进入",
  bgm_change: "配乐变化",
  bgm_out: "配乐退出",
  atmosphere_change: "氛围变化",
  dynamics_change: "强弱变化",
  mix_change: "混音变化",
  silence_in: "进入留白",
  silence_out: "结束留白",
};

/** 只投影已有证据，不补写模型观察，也不改变原始记录和时间。 */
export function buildFilmReviewTimeline(report: AdvisorFilmReview) {
  const shots: FilmEvidenceRow[] = [],
    audio: FilmEvidenceRow[] = [],
    cues: FilmEvidenceCue[] = [];
  const warnings: string[] = [];
  const audioNotes: { label: string; text: string }[] = [];
  function interval(
    value: unknown,
    id: string,
    startKey: string,
    endKey: string,
    title: string,
    names: Record<string, string>,
    dest: FilmEvidenceRow[]
  ) {
    const row = object(value),
      startSec = row[startKey],
      endSec = row[endKey];
    if (!second(startSec) || !second(endSec) || endSec <= startSec) {
      warnings.push(`${title}的时间无效，请在完整记录中核对。`);
      return;
    }
    dest.push({ id, startSec, endSec, title, fields: fields(row, names) });
  }
  function cue(value: unknown, id: string, title: string, textKey: string) {
    const row = object(value);
    if (!second(row.atSec)) {
      warnings.push(`${title}的时间无效，请在完整记录中核对。`);
      return;
    }
    cues.push({
      id,
      atSec: row.atSec,
      title,
      text: text(row[textKey]) || "未提供描述",
    });
  }
  const native = report.nativeEvidence?.analysis;
  if (native) {
    array(native.shots).forEach((row, i) =>
      interval(
        row,
        `shot-${i}`,
        "startSec",
        "endSec",
        `镜头 ${i + 1}`,
        {
          hintZh: "画面",
          shotSizeZh: "景别",
          angleZh: "机位",
          compositionZh: "构图",
          cameraMoveZh: "运镜",
          blockingZh: "站位",
          bodyActionZh: "身体动作",
          limbPropActionZh: "肢体与道具",
          microExpressionZh: "微表情",
          gazeBreathZh: "眼神与呼吸",
          relationshipReactionZh: "互动",
          lightingZh: "灯光",
          actionZh: "动作",
          transitionInZh: "转场",
        },
        shots
      )
    );
    array(native.audioResolution).forEach((chunk, ci) => {
      const analysis = object(object(chunk).analysis);
      audioNotes.push(
        ...fields(analysis, {
          audioBeatStructureZh: "声音节拍",
          mixNotesZh: "混音观察",
          reusableAudioZh: "可借鉴手法",
        })
      );
      array(analysis.audioTrack).forEach((row, i) => {
        interval(
          row,
          `audio-${ci}-${i}`,
          "fromSec",
          "toSec",
          `声音 ${ci + 1}.${i + 1}`,
          {
            emotionArcZh: "情绪",
            toneZh: "语气",
            sfxZh: "音效",
            bgmZh: "配乐",
            atmosphereZh: "氛围",
            silenceZh: "留白",
          },
          audio
        );
        array(object(row).cues).forEach((v, j) =>
          cue(
            v,
            `audio-cue-${ci}-${i}-${j}`,
            cueLabels[text(object(v).kind)] || "声音变化",
            "detailZh"
          )
        );
      });
    });
    array(native.keyMoments).forEach((v, i) =>
      cue(v, `moment-${i}`, text(object(v).kindZh) || "重点时刻", "noteZh")
    );
    array(native.subtitles).forEach((v, i) =>
      cue(v, `subtitle-${i}`, "字幕", "textZh")
    );
  } else if (report.observerEvidence) {
    report.observerEvidence.analysis.shots.forEach((row, i) =>
      interval(
        row,
        `shot-${i}`,
        "startSec",
        "endSec",
        `镜头 ${i + 1}`,
        { descriptionZh: "画面" },
        shots
      )
    );
    report.observerEvidence.analysis.audioSegments.forEach((row, i) =>
      interval(
        row,
        `audio-${i}`,
        "startSec",
        "endSec",
        `声音 ${i + 1}`,
        { descriptionZh: "声音" },
        audio
      )
    );
    report.observerEvidence.analysis.subtitles.forEach((v, i) =>
      cue(v, `subtitle-${i}`, "字幕", "textZh")
    );
  }
  shots.sort((a, b) => a.startSec - b.startSec);
  audio.sort((a, b) => a.startSec - b.startSec);
  cues.sort((a, b) => a.atSec - b.atSec);
  return {
    shots,
    audio,
    cues,
    warnings,
    audioNotes,
    beat: text(native?.beatStructureZh),
    mood: text(native?.moodArcZh),
  };
}

export function filmTimelineWarnings(
  rows: FilmEvidenceRow[],
  durationSec: number,
  label: string
) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [];
  const result: string[] = [];
  let end = 0;
  for (const row of rows) {
    if (row.endSec > durationSec)
      result.push(
        `${row.title}结束于 ${row.endSec.toFixed(1)} 秒，超出原片 ${durationSec.toFixed(2)} 秒；原始时间未改写。`
      );
    if (row.startSec - end > 0.1)
      result.push(
        `${label} ${end.toFixed(1)}–${row.startSec.toFixed(1)} 秒缺少记录。`
      );
    end = Math.max(end, row.endSec);
  }
  if (durationSec - end > 0.1)
    result.push(
      `${label} ${end.toFixed(1)}–${durationSec.toFixed(1)} 秒缺少记录。`
    );
  return result;
}
