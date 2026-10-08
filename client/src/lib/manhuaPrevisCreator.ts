import type { ManhuaPrevisSpec } from "@shared/manhuaPrevis";
import { previsControllerSchema } from "@shared/manhuaPrevisRig";
import {
  createRigForm,
  newRigCue,
  type RigForm,
  type RigCueForm,
} from "./manhuaPrevisRigForm";
import type { PreparedRigProfile } from "./manhuaPrevisProfiles";

export type GazeChoice = {
  id: string;
  label: string;
  point?: [number, number, number];
  unavailableReason?: string;
};

/** 与当前渲染器一致的线性走位；只用于把明确选择转换成既有固定视线点。 */
export function actorPositionAt(
  actor: ManhuaPrevisSpec["actors"][number],
  time: number
): [number, number] {
  const span = actor.moveEndSec - actor.moveStartSec;
  const u =
    span > 0 ? Math.max(0, Math.min(1, (time - actor.moveStartSec) / span)) : 0;
  return actor.start.map((v, axis) => v + (actor.end[axis] - v) * u) as [
    number,
    number,
  ];
}

export function creatorGazeChoices(
  spec: ManhuaPrevisSpec,
  actorId: string,
  cue: Pick<RigCueForm, "startSec" | "endSec">
): GazeChoice[] {
  const start = Number(cue.startSec),
    end = Number(cue.endSec);
  if (
    !cue.startSec.trim() ||
    !cue.endSec.trim() ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start
  )
    return [];
  const shots = spec.cameras.filter(c => c.startSec < end && c.endSec > start);
  const camerasMatch =
    shots.length > 0 &&
    shots.every(c =>
      c.position.every((v, i) => Math.abs(v - shots[0].position[i]) < 1e-6)
    );
  const result: GazeChoice[] = [
    {
      id: "camera",
      label: "看向镜头",
      ...(camerasMatch
        ? { point: [...shots[0].position] as [number, number, number] }
        : { unavailableReason: "这段跨过不同机位，请先拆分表演时段" }),
    },
  ];
  for (const target of spec.actors) {
    if (target.id === actorId) continue;
    const a = actorPositionAt(target, start),
      b = actorPositionAt(target, end);
    const stationary = a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
    result.push({
      id: `actor:${target.id}`,
      label: `看向${target.nameZh}`,
      ...(stationary
        ? {
            point: [
              a[0],
              a[1],
              (target.riggedModel?.targetHeight ?? 1.7) * 0.92,
            ] as [number, number, number],
          }
        : { unavailableReason: "对方在这段内移动，当前需分段设置视线" }),
    });
  }
  return result;
}

export function selectedGazeChoice(cue: RigCueForm, choices: GazeChoice[]) {
  if (cue.gazeTarget.some(v => !v.trim() || !Number.isFinite(Number(v))))
    return "";
  return (
    choices.find(c =>
      c.point?.every((v, i) => Math.abs(v - Number(cue.gazeTarget[i])) < 1e-6)
    )?.id ?? "saved"
  );
}

export function applyGazeChoice(
  cue: RigCueForm,
  id: string,
  choices: GazeChoice[]
): RigCueForm {
  const choice = choices.find(c => c.id === id);
  if (!choice?.point || choice.unavailableReason)
    throw new Error(choice?.unavailableReason ?? "请选择可用的注视对象");
  return {
    ...cue,
    gazeTarget: choice.point.map(String) as RigCueForm["gazeTarget"],
  };
}

export function configuredController(form: RigForm) {
  try {
    const controller = previsControllerSchema.parse({
      eyeBones: form.eyes,
      expressions: Object.fromEntries(
        Object.entries(form.expressions).map(([key, value]) => [
          key,
          JSON.parse(value),
        ])
      ),
    });
    const maps = Object.values(controller.expressions).map(m =>
      JSON.stringify(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)))
    );
    return new Set(maps).size === 3 ? controller : undefined;
  } catch {
    return undefined;
  }
}

export function creatorCue(
  start: number,
  end: number,
  spec?: ManhuaPrevisSpec,
  actorId?: string
) {
  const cue = newRigCue(start, end);
  const choices = spec && actorId ? creatorGazeChoices(spec, actorId, cue) : [];
  const first = choices.find(c => c.point && !c.unavailableReason);
  return first ? applyGazeChoice(cue, first.id, choices) : cue;
}

/** 角色配置复用不携带上一段表演；同源当前草稿的复杂表演保持原样。 */
export function usePreparedRig(
  form: RigForm,
  profile: PreparedRigProfile,
  context: {
    assetRef?: string;
    taskId?: string;
    durationSec: number;
    spec?: ManhuaPrevisSpec;
    actorId: string;
  }
): RigForm {
  if (
    !context.assetRef ||
    profile.assetRef !== context.assetRef ||
    profile.sourceJobId !== context.taskId ||
    profile.riggedModel.sourceJobId !== context.taskId
  ) {
    throw new Error("角色或模型版本不匹配，请重新准备当前模型");
  }
  const { controller, ...base } = profile.riggedModel;
  const next = createRigForm(base, context.taskId);
  if (!controller)
    return form.sourceJobId === context.taskId
      ? {
          ...next,
          performanceEnabled: form.performanceEnabled,
          eyes: { ...form.eyes },
          expressions: { ...form.expressions },
          cues: form.cues.map(c => ({
            ...c,
            gazeTarget: [...c.gazeTarget] as RigCueForm["gazeTarget"],
          })),
        }
      : next;
  const parsed = previsControllerSchema.parse(controller);
  return {
    ...next,
    performanceEnabled: true,
    eyes: { ...parsed.eyeBones },
    expressions: Object.fromEntries(
      Object.entries(parsed.expressions).map(([k, v]) => [k, JSON.stringify(v)])
    ) as RigForm["expressions"],
    cues:
      form.sourceJobId === context.taskId && form.cues.length
        ? form.cues.map(c => ({
            ...c,
            gazeTarget: [...c.gazeTarget] as RigCueForm["gazeTarget"],
          }))
        : [creatorCue(0, context.durationSec, context.spec, context.actorId)],
  };
}
