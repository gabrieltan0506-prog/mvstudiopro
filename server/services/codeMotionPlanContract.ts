import { z } from "zod";
import {
  codeMotionPlanSchema,
  type CodeMotionBrief,
} from "../../shared/codeMotion";
import { codeMotionTransformSchema } from "../../shared/codeMotionComposition";

/** 顾问只编排尚待制作的内容，不能伪造已生成媒体、三维归档、词拍或音源身份。 */
export function codeMotionPlanningResponseSchema(brief: CodeMotionBrief) {
  let scene = codeMotionPlanSchema.shape.scenes.element;
  if (brief.style !== "scenes")
    scene = scene.omit({ composition: true }) as typeof scene;
  if (!brief.images.length)
    scene = scene.omit({ imageId: true }) as typeof scene;
  const base = codeMotionPlanSchema
    .omit({ codeVideo: true, spatial: true, timing: true })
    .extend({
      scenes: z
        .array(scene)
        .min(1)
        .max(brief.style === "data" ? 1 : 12),
    });
  return !brief.audios?.length
    ? base.extend({ audioTimeline: z.array(z.never()).max(0).optional() })
    : base;
}

export function codeMotionPlanningContract(brief: CodeMotionBrief) {
  const schema = codeMotionPlanningResponseSchema(brief);
  const audioIds = (brief.audios || []).map(a => a.id);
  const mode =
    brief.style === "scenes"
      ? "本次是逐镜创作，每镜必须包含composition。坐标、颜色、透明度、缩放只能放在element.transform对象或element.keyframes条目中，绝对不能直接放在element根层。所有scale/scaleX/scaleY最小0.001；出现/消失使用opacity=0或reveal=0，不能写scale=0。"
      : `本次明确选择${brief.style === "words" ? "动态文字" : brief.style === "cards" ? "图文卡片" : "数据展示"}模式。每镜绝对禁止composition字段，不绘制元素。保留用户故事、direction、speech和production，让现有文字/图片/数据渲染器显示画面；需要人物自然动作的镜头仍标production.motion=natural。`;
  const example =
    brief.style === "scenes"
      ? {
          id: "scene_1",
          duration: 5,
          elements: [
            {
              id: "cup",
              type: "shape",
              shape: "rect",
              width: 0.1,
              height: 0.15,
              transform: { x: 0.5, y: 0.6, fill: "#D4A373", opacity: 0 },
              keyframes: [
                { at: 0, opacity: 0 },
                { at: 1, opacity: 1 },
              ],
            },
          ],
        }
      : undefined;
  return [
    "以下本次合同优先于前面的通用创作示例；只输出符合本次合同的数据。",
    mode,
    audioIds.length
      ? `audioTimeline.sourceId只能逐字使用这些真实音源ID：${JSON.stringify(audioIds)}。不可添加虚构音源。`
      : "本次没有任何已上传音源。audioTimeline必须省略或为[]。待合成的旁白/对白只写speech；需要配乐时在musicDirection写明实际乐器、情绪随剧情的变化、进出点和收尾，供音乐模型真正生成；没有配乐需要则省略。musicDirection不是已生成音源。禁止写voice_1、bgm、tts、pending等虚构sourceId，也禁止把speech当作已经存在的音源。",
    ...(example
      ? [
          `composition结构示例（仅说明字段层级，不复制该画面）：${JSON.stringify(example)}`,
        ]
      : []),
    `准确JSON字段合同：${JSON.stringify(z.toJSONSchema(schema, { io: "input" }))}`,
  ].join("\n");
}

/** 只移动语义不变的变换属性；冲突和非法数值继续拒绝，不丢弃镜头、音轨或模型输出。 */
export function normalizeCodeMotionPlanTransforms(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const value = structuredClone(raw) as Record<string, unknown>;
  if (!Array.isArray(value.scenes)) return value;
  const keys = Object.keys(codeMotionTransformSchema.shape);
  for (const scene of value.scenes) {
    if (
      !scene ||
      typeof scene !== "object" ||
      !scene.composition ||
      !Array.isArray(scene.composition.elements)
    )
      continue;
    for (const element of scene.composition.elements) {
      if (!element || typeof element !== "object" || Array.isArray(element))
        continue;
      for (const key of keys) {
        if (!(key in element)) continue;
        if (
          element.transform !== undefined &&
          (!element.transform ||
            typeof element.transform !== "object" ||
            Array.isArray(element.transform))
        )
          continue;
        const transform = element.transform ?? {};
        if (key in transform && transform[key] !== element[key])
          throw Error("顾问画面变换字段冲突，请重新整理，原方案未采用");
        element.transform = { ...transform, [key]: element[key] };
        delete element[key];
      }
    }
  }
  return value;
}
