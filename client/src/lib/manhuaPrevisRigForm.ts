import {
  PREVIS_BODY_BONES,
  previsRiggedModelSchema,
  type PrevisRiggedModel,
} from "@shared/manhuaPrevisRig";

export const RIG_EXPRESSIONS = {
  calm: "平静",
  tense: "紧张",
  surprised: "惊讶",
} as const;
type Cue = NonNullable<PrevisRiggedModel["performance"]>["cues"][number];
type NumericCueKey = Exclude<keyof Cue, "expression" | "gazeTarget">;
export type RigCueForm = Record<NumericCueKey, string> & {
  expression: Cue["expression"];
  gazeTarget: [string, string, string];
};
export type RigForm = {
  enabled: boolean;
  sourceJobId: string;
  forwardAxis: PrevisRiggedModel["forwardAxis"];
  targetHeight: string;
  boneMap: Partial<Record<(typeof PREVIS_BODY_BONES)[number], string>>;
  performanceEnabled: boolean;
  eyes: { left: string; right: string };
  expressions: Record<keyof typeof RIG_EXPRESSIONS, string>;
  cues: RigCueForm[];
};
export function newRigCue(start = 0, end = 1): RigCueForm {
  return {
    startSec: String(start),
    endSec: String(end),
    gazeTarget: ["", "", ""],
    headYawDeg: "0",
    headPitchDeg: "0",
    breathAmplitude: "0.01",
    breathHz: "0.25",
    expression: "calm",
    intensity: "1",
  };
}
export function createRigForm(
  value?: PrevisRiggedModel,
  taskId?: string
): RigForm {
  const p = value?.performance;
  return {
    enabled: !!value,
    sourceJobId: value?.sourceJobId ?? taskId ?? "",
    forwardAxis: value?.forwardAxis ?? "-Y",
    targetHeight: String(value?.targetHeight ?? 1.7),
    boneMap: { ...value?.boneMap },
    performanceEnabled: !!p,
    eyes: p ? { ...p.controller.eyeBones } : { left: "", right: "" },
    expressions: {
      calm: p ? JSON.stringify(p.controller.expressions.calm) : "",
      tense: p ? JSON.stringify(p.controller.expressions.tense) : "",
      surprised: p ? JSON.stringify(p.controller.expressions.surprised) : "",
    },
    cues: p
      ? p.cues.map(c => ({
          ...c,
          startSec: String(c.startSec),
          endSec: String(c.endSec),
          gazeTarget: c.gazeTarget.map(String) as [string, string, string],
          headYawDeg: String(c.headYawDeg),
          headPitchDeg: String(c.headPitchDeg),
          breathAmplitude: String(c.breathAmplitude),
          breathHz: String(c.breathHz),
          intensity: String(c.intensity),
        }))
      : [],
  };
}
function numeric(value: string, label: string) {
  if (!value.trim() || !Number.isFinite(Number(value)))
    throw new Error(`${label}须填写有限数字`);
  return Number(value);
}
/** 未完整表单只留本地；此函数是显式应用的唯一数据出口。 */
export function applyRigForm(
  form: RigForm,
  context: {
    taskId?: string;
    durationSec: number;
    shape: "human" | "horse";
    hasCreature?: boolean;
  }
): PrevisRiggedModel | undefined {
  if (!form.enabled) return undefined;
  if (context.shape !== "human" || context.hasCreature)
    throw new Error("带骨角色仅支持普通人形，不能与四足或魔化预设同时应用");
  if (!context.taskId || form.sourceJobId !== context.taskId)
    throw new Error("当前角色没有匹配版本的已成功3D模型，请重新选择当前模型");
  const boneMap = Object.fromEntries(
    Object.entries(form.boneMap)
      .map(([key, value]) => [key, value?.trim()])
      .filter(([, value]) => value)
  );
  const data: Record<string, unknown> = {
    sourceJobId: form.sourceJobId,
    forwardAxis: form.forwardAxis,
    targetHeight: numeric(form.targetHeight, "模型高度"),
    ...(Object.keys(boneMap).length ? { boneMap } : {}),
  };
  if (form.performanceEnabled) {
    const expressions = Object.fromEntries(
      Object.keys(RIG_EXPRESSIONS).map(key => {
        try {
          return [
            key,
            JSON.parse(form.expressions[key as keyof typeof RIG_EXPRESSIONS]),
          ];
        } catch {
          throw new Error(
            `${RIG_EXPRESSIONS[key as keyof typeof RIG_EXPRESSIONS]}须填写实际形变名与权重的JSON对象`
          );
        }
      })
    );
    data.performance = {
      controller: { eyeBones: form.eyes, expressions },
      cues: form.cues.map(c => ({
        startSec: numeric(c.startSec, "起点"),
        endSec: numeric(c.endSec, "终点"),
        gazeTarget: c.gazeTarget.map(v => numeric(v, "视线坐标")),
        headYawDeg: numeric(c.headYawDeg, "左右转头"),
        headPitchDeg: numeric(c.headPitchDeg, "上下点头"),
        breathAmplitude: numeric(c.breathAmplitude, "呼吸幅度"),
        breathHz: numeric(c.breathHz, "呼吸频率"),
        expression: c.expression,
        intensity: numeric(c.intensity, "表情强度"),
      })),
    };
  }
  const result = previsRiggedModelSchema.safeParse(data);
  if (!result.success)
    throw new Error(
      result.error.issues
        .map(i => `${i.path.join(".")}：${i.message}`)
        .join("；")
    );
  let end = 0;
  for (const cue of result.data.performance?.cues ?? []) {
    if (
      cue.startSec < end ||
      cue.endSec > context.durationSec ||
      cue.endSec - cue.startSec < 0.5
    )
      throw new Error("表演轨须按顺序排列、不重叠、每段至少0.5秒且不超过片长");
    end = cue.endSec;
  }
  const p = result.data.performance;
  if (p) {
    const values = Object.values(p.controller.expressions).map(m =>
      JSON.stringify(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)))
    );
    if (new Set(values).size !== 3)
      throw new Error("三种表情不能使用完全相同的控制值");
  }
  const mapped = Object.values(result.data.boneMap ?? {});
  if (new Set(mapped).size !== mapped.length)
    throw new Error("不同语义不能映射到同一根骨骼");
  return result.data;
}
