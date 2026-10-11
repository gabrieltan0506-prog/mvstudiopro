import type { CodeMotionProject } from "./codeMotion";
import type { CodeMotionVideo } from "./codeMotionVideo";
import type { CodeMotionAudioSource } from "./codeMotionAudio";

/** 替换单镜时同步替换该镜导入原声，其余镜头、旁白和配乐保留。 */
export function adoptCodeMotionVideoIntoProject(
  current: CodeMotionProject,
  value: {
    asset: CodeMotionVideo["assets"][number];
    clip: CodeMotionVideo["clips"][number];
    audioSource?: CodeMotionAudioSource;
  }
): CodeMotionProject {
  if (!current.plan) throw Error("请先保存分镜");
  const { asset, clip, audioSource } = value,
    prior = current.plan.codeVideo;
  if (
    asset.originalAudioSourceId &&
    asset.originalAudioSourceId !== audioSource?.id
  )
    throw Error("导入片段缺少对应的原声音源");
  const replaced = prior?.clips.filter(c => c.at === clip.at) || [];
  const oldAudioIds = new Set(
    replaced
      .map(
        c => prior?.assets.find(a => a.id === c.assetId)?.originalAudioSourceId
      )
      .filter(Boolean)
  );
  const clips = [
    ...(prior?.clips || []).filter(c => c.at !== clip.at),
    clip,
  ].sort((a, b) => a.at - b.at);
  const used = new Set(clips.map(c => c.assetId));
  const assets = [
    ...(prior?.assets || []).filter(a => a.id !== asset.id && used.has(a.id)),
    asset,
  ];
  const audioTimeline = (current.plan.audioTimeline || []).filter(
    c =>
      !(
        c.at === clip.at &&
        (oldAudioIds.has(c.sourceId) || c.sourceId === audioSource?.id)
      )
  );
  if (audioSource)
    audioTimeline.push({
      sourceId: audioSource.id,
      role: "sfx",
      at: clip.at,
      trimStart: 0,
      duration: Math.min(clip.duration, audioSource.duration),
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
    });
  const usedAudio = new Set(audioTimeline.map(c => c.sourceId));
  const audios = (current.brief.audios || []).filter(
    a =>
      a.id !== audioSource?.id &&
      (!oldAudioIds.has(a.id) || usedAudio.has(a.id))
  );
  if (audioSource) audios.push(audioSource);
  return {
    ...current,
    brief: {
      ...current.brief,
      ...(current.brief.audios || audios.length ? { audios } : {}),
    },
    plan: {
      ...current.plan,
      ...(current.plan.audioTimeline || audioTimeline.length
        ? { audioTimeline }
        : {}),
      codeVideo: { version: 1, assets, clips },
    },
  };
}
