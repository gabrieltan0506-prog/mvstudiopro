import { type CodeMotionProject } from "./codeMotion";
import { type CodeMotionAudioSource } from "./codeMotionAudio";
import { CODE_MOTION_AUDIO_SOURCE_LIMIT } from "./codeMotionMedia";

/** 採用一次生成回执，同时更新音源和时间轴；不会截掉旁白尾音。 */
export function adoptCodeMotionSoundInProject(
  project: CodeMotionProject,
  source: CodeMotionAudioSource
): CodeMotionProject {
  if (!project.plan || !source.generated) throw new Error("请先完成画面安排");
  const generated = source.generated;
  const durationOfProject = project.brief.durationMode === "natural"
    ? project.plan.scenes.reduce((sum, scene) => sum + scene.duration, 0)
    : project.brief.duration;
  const scene =
    generated.kind === "speech"
      ? project.plan.scenes[generated.sceneIndex!]
      : null;
  if (
    generated.kind === "speech" &&
    (!scene ||
      scene.speech?.text.trim() !== generated.text ||
      scene.speech?.voice !== generated.voice ||
      (scene.speech?.role || "narration") !== (generated.role || "narration") ||
      (scene.speech?.emotion || "") !== (generated.emotion || ""))
  )
    throw new Error("旁白内容已变化，请使用对应版本的音源");
  if (scene && source.duration > scene.duration)
    throw new Error(
      `旁白长${source.duration.toFixed(2)}秒，超过本镜${scene.duration}秒。请缩短旁白或增加本镜时长。`
    );
  const old = (project.brief.audios ?? []).filter(
    a =>
      a.id === source.id ||
      (a.generated?.kind === generated.kind &&
        (generated.kind === "bgm" ||
          a.generated?.sceneIndex === generated.sceneIndex))
  );
  const ids = new Set(old.map(a => a.id));
  const audios = [
    ...(project.brief.audios ?? []).filter(a => !ids.has(a.id)),
    source,
  ];
  if (audios.length > CODE_MOTION_AUDIO_SOURCE_LIMIT)
    throw new Error("音源已满，请先移除不使用的音源");
  const at = scene
    ? project.plan.scenes
        .slice(0, generated.sceneIndex)
        .reduce((n, s) => n + s.duration, 0)
    : 0;
  const duration = scene
    ? source.duration
    : Math.min(source.duration, durationOfProject);
  const timing = project.plan.timing;
  const nextTiming = timing && audios.some(a => a.id === timing.sourceId && a.sha256 === timing.sourceSha256)
    ? timing : undefined;
  return {
    ...project,
    brief: { ...project.brief, duration: durationOfProject, audios },
    plan: {
      ...project.plan,
      timing: nextTiming,
      audioTimeline: [
        ...(project.plan.audioTimeline ?? []).filter(c => !ids.has(c.sourceId)),
        {
          sourceId: source.id,
          role: scene ? (generated.role || "narration") : "bgm",
          at,
          trimStart: 0,
          duration,
          volume: scene ? 1 : 0.25,
          fadeIn: scene ? 0 : Math.min(0.5, duration / 4),
          fadeOut: scene ? 0 : Math.min(1, duration / 4),
        },
      ],
    },
  };
}

/** Only the measured speech can extend its scene; existing animation keyframe seconds stay intact. */
export function adoptCodeMotionSoundWithMeasuredDuration(
  project: CodeMotionProject,
  source: CodeMotionAudioSource
): { project: CodeMotionProject; extendedBy: number } {
  const index = source.generated?.kind === "speech" ? source.generated.sceneIndex : undefined;
  const scene = index === undefined ? undefined : project.plan?.scenes[index];
  if (!scene || source.duration <= scene.duration)
    return { project: adoptCodeMotionSoundInProject(project, source), extendedBy: 0 };
  if (project.plan?.codeVideo?.clips.length)
    throw new Error("已有视频片段，不能移动已生成的镜窗；原配音已保留，请使用局部修改流程");
  const modelMotion = scene.speech?.role === "dialogue" || scene.production?.motion === "natural";
  const duration = modelMotion ? Math.ceil(source.duration) : Math.ceil(source.duration * 30) / 30;
  const extendedBy = duration - scene.duration;
  const oldTotal = project.plan!.scenes.reduce((n, s) => n + s.duration, 0);
  const oldEnd = project.plan!.scenes.slice(0, index! + 1).reduce((n, s) => n + s.duration, 0);
  const shifted: CodeMotionProject = {
    ...project,
    brief: { ...project.brief, duration: oldTotal + extendedBy },
    plan: {
      ...project.plan!,
      scenes: project.plan!.scenes.map((s, i) => i === index
        ? { ...s, duration, ...(s.composition ? { composition: { ...s.composition, duration } } : {}) }
        : s),
      audioTimeline: project.plan!.audioTimeline?.map(clip => {
        if (clip.at >= oldEnd - 1e-6) return { ...clip, at: clip.at + extendedBy };
        const audio = project.brief.audios?.find(a => a.id === clip.sourceId);
        if (clip.role === "bgm" && clip.at === 0 && Math.abs(clip.duration - oldTotal) < 1e-6 && audio)
          return { ...clip, duration: Math.min(audio.duration - clip.trimStart, oldTotal + extendedBy) };
        return clip;
      }),
    },
  };
  return { project: adoptCodeMotionSoundInProject(shifted, source), extendedBy };
}
