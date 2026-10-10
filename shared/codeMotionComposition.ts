import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const n = (min: number, max: number) => z.number().finite().min(min).max(max);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const codeMotionEaseSchema = z.enum([
  "linear",
  "easeIn",
  "easeOut",
  "easeInOut",
  "step",
]);
const values = {
  x: n(-4, 4).optional(),
  y: n(-4, 4).optional(),
  z: n(-10, 10).optional(),
  scale: n(0.001, 20).optional(),
  scaleX: n(0.001, 20).optional(),
  scaleY: n(0.001, 20).optional(),
  rotation: n(-3600, 3600).optional(),
  rotationX: n(-3600, 3600).optional(),
  rotationY: n(-3600, 3600).optional(),
  opacity: n(0, 1).optional(),
  reveal: n(0, 1).optional(),
  fill: color.optional(),
  stroke: color.optional(),
};
export const codeMotionTransformSchema = z.object(values).strict();
export const codeMotionKeyframeSchema = z
  .object({ at: n(0, 180), ease: codeMotionEaseSchema.optional(), ...values })
  .strict();
const base = z
  .object({
    id,
    start: n(0, 180).default(0),
    end: n(0, 180).optional(),
    continuity: z.enum(["reset", "carry"]).default("reset"),
    transform: codeMotionTransformSchema.default({}),
    keyframes: z.array(codeMotionKeyframeSchema).max(64).default([]),
    blend: z.enum(["normal", "multiply", "screen", "add"]).default("normal"),
    layer: z.number().int().min(-100).max(100).default(0),
  })
  .strict();
const text = base.extend({
  type: z.literal("text"),
  text: z.string().min(1).max(600),
  fontSize: n(0.01, 0.5).default(0.08),
  font: z.enum(["sans", "serif", "mono"]).default("sans"),
  weight: z.enum(["normal", "bold"]).default("bold"),
  align: z.enum(["left", "center", "right"]).default("center"),
  maxWidth: n(0.05, 2).default(0.9),
  lineHeight: n(0.8, 2.5).default(1.2),
  letterSpacing: n(-0.02, 0.1).default(0),
});
const shape = base.extend({
  type: z.literal("shape"),
  shape: z.enum(["rect", "ellipse", "triangle", "line"]),
  width: n(0.001, 4).default(0.25),
  height: n(0.001, 4).default(0.25),
  radius: n(0, 0.5).default(0),
  strokeWidth: n(0, 0.05).default(0.003),
  filled: z.boolean().default(true),
});
const path = base.extend({
  type: z.literal("path"),
  points: z
    .array(z.tuple([n(-4, 4), n(-4, 4)]))
    .min(2)
    .max(128),
  closed: z.boolean().default(false),
  filled: z.boolean().default(false),
  strokeWidth: n(0.0005, 0.05).default(0.004),
});
const particles = base.extend({
  type: z.literal("particles"),
  count: z.number().int().min(1).max(300).default(60),
  seed: z.number().int().min(0).max(2147483647).default(1),
  spread: n(0.01, 3).default(0.4),
  speed: n(0, 2).default(0.12),
  size: n(0.0005, 0.05).default(0.004),
  motion: z.enum(["drift", "burst", "orbit"]).default("drift"),
  depth: n(0, 3).default(0),
});
const mesh = base.extend({
  type: z.literal("mesh"),
  geometry: z.enum(["box", "tetrahedron", "octahedron"]),
  width: n(0.01, 3).default(0.3),
  height: n(0.01, 3).default(0.3),
  depth: n(0.01, 3).default(0.3),
  wireframe: z.boolean().default(false),
  strokeWidth: n(0, 0.03).default(0.002),
});
const imageFields = {
  width: n(0.01, 4).default(0.5),
  height: n(0.01, 4).default(0.5),
  fit: z.enum(["contain", "cover"]).default("contain"),
};
const image = base.extend({
  type: z.literal("image"),
  imageUri: z
    .string()
    .regex(/^gs:\/\/[^\s?#]+$/)
    .max(2048),
  ...imageFields,
});
const planImage = base.extend({
  type: z.literal("image"),
  imageId: z.string().uuid(),
  ...imageFields,
});
export const codeMotionElementSchema = z.discriminatedUnion("type", [
  text,
  shape,
  path,
  particles,
  mesh,
  image,
]);
export const codeMotionPlanElementSchema = z.discriminatedUnion("type", [
  text,
  shape,
  path,
  particles,
  mesh,
  planImage,
]);
const cameraValues = {
  x: n(-4, 4).optional(),
  y: n(-4, 4).optional(),
  z: n(0.2, 20).optional(),
  rotationX: n(-85, 85).optional(),
  rotationY: n(-180, 180).optional(),
  zoom: n(0.1, 8).optional(),
};
const camera = z
  .object({
    ...cameraValues,
    keyframes: z
      .array(
        z
          .object({
            at: n(0, 180),
            ease: codeMotionEaseSchema.optional(),
            ...cameraValues,
          })
          .strict()
      )
      .max(32)
      .default([]),
  })
  .strict();
const sceneFields = {
  id,
  duration: n(0.5, 180),
  background: color.optional(),
  camera: camera.optional(),
  transition: z
    .object({
      type: z.enum(["cut", "fade", "slideLeft", "wipe", "zoom"]),
      duration: n(0, 2).default(0.3),
    })
    .strict()
    .optional(),
};
function validateScene(
  v: {
    duration: number;
    camera?: { keyframes: { at: number }[] };
    transition?: { duration: number };
    elements: {
      id: string;
      start: number;
      end?: number;
      keyframes: { at: number }[];
    }[];
  },
  ctx: z.RefinementCtx
) {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (new Set(v.elements.map(e => e.id)).size !== v.elements.length)
    fail("同一镜头的元素ID不能重复");
  const ordered = (frames: { at: number }[]) =>
    frames.every(
      (k, i) => k.at <= v.duration && (!i || k.at > frames[i - 1].at)
    );
  if (
    v.elements.some(
      e =>
        e.start >= v.duration ||
        (e.end !== undefined && (e.end <= e.start || e.end > v.duration)) ||
        !ordered(e.keyframes)
    )
  )
    fail("元素秒窗或关键帧越界，关键帧须严格递增");
  if (
    v.elements.some(e => {
      const element = e as typeof e & {
        type: string;
        transform: Record<string, unknown>;
      };
      return (
        !["mesh", "particles"].includes(element.type) &&
        [element.transform, ...element.keyframes].some(
          k => "rotationX" in k || "rotationY" in k
        )
      );
    })
  )
    fail("二维元素不支持X/Y轴旋转，请改用三维几何体或粒子");
  if (v.camera && !ordered(v.camera.keyframes))
    fail("相机关键帧须递增且在本镜头内");
  if (v.transition && v.transition.duration > v.duration / 2)
    fail("转场不得超过镜头时长的一半");
}
export const codeMotionSceneSchema = z
  .object({
    ...sceneFields,
    elements: z.array(codeMotionElementSchema).min(1).max(48),
  })
  .strict()
  .superRefine(validateScene);
export const codeMotionPlanSceneSchema = z
  .object({
    ...sceneFields,
    elements: z.array(codeMotionPlanElementSchema).min(1).max(48),
  })
  .strict()
  .superRefine(validateScene);
export const codeMotionCompositionSchema = z
  .object({
    version: z.literal(1),
    scenes: z.array(codeMotionSceneSchema).min(1).max(18),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (
      v.scenes.some(
        s =>
          s.elements.reduce(
            (n, e) => n + (e.type === "particles" ? e.count : 0),
            0
          ) > 1500
      )
    )
      fail("单镜粒子总数不能超过1500");
    if (v.scenes.reduce((s, x) => s + x.duration, 0) > 180)
      fail("编排总时长超过180秒");
    if (new Set(v.scenes.map(s => s.id)).size !== v.scenes.length)
      fail("镜头ID不能重复");
    if (
      v.scenes.reduce((n, s) => n + s.elements.length, 0) > 512 ||
      v.scenes.reduce(
        (n, s) => n + s.elements.reduce((k, e) => k + e.keyframes.length, 0),
        0
      ) > 4000
    )
      fail("编排元素或关键帧过多");
    for (let i = 0; i < v.scenes.length; i++) {
      for (const e of v.scenes[i].elements) {
        if (e.continuity !== "carry") continue;
        const prior = v.scenes[i - 1]?.elements.find(p => p.id === e.id);
        if (!prior || prior.type !== e.type)
          fail("贯穿元素必须承接上一镜同ID且同类型元素");
      }
    }
  });
export type CodeMotionScene = z.infer<typeof codeMotionSceneSchema>;
export type CodeMotionPlanScene = z.infer<typeof codeMotionPlanSceneSchema>;
export type CodeMotionComposition = z.infer<typeof codeMotionCompositionSchema>;
/** 仅转换已归属核验的素材映射；不会解析URL或从网络取素材。 */
export function resolveCodeMotionCompositionImages(
  scenes: CodeMotionPlanScene[],
  images: { id: string; gcsUri: string }[]
): CodeMotionComposition {
  const byId = new Map(images.map(x => [x.id, x.gcsUri]));
  return codeMotionCompositionSchema.parse({
    version: 1,
    scenes: scenes.map(s => ({
      ...s,
      elements: s.elements.map(e => {
        if (e.type !== "image") return e;
        const { imageId, ...rest } = e;
        const imageUri = byId.get(imageId);
        if (!imageUri) throw new Error(`镜头图片未绑定已选素材：${imageId}`);
        return { ...rest, imageUri };
      }),
    })),
  });
}
/** 调整镜长时同步缩放镜内时间，保留动作顺序和素材身份。 */
export function retimeCodeMotionPlanScene(
  scene: CodeMotionPlanScene,
  newDuration: number
): CodeMotionPlanScene {
  const duration = n(0.5, 180).parse(newDuration);
  const original = codeMotionPlanSceneSchema.parse(scene);
  const ratio = duration / original.duration;
  const time = (at: number) =>
    at === original.duration ? duration : Math.min(duration, at * ratio);
  return codeMotionPlanSceneSchema.parse({
    ...original,
    duration,
    ...(original.transition
      ? {
          transition: {
            ...original.transition,
            duration: Math.min(
              2,
              duration / 2,
              original.transition.duration * ratio
            ),
          },
        }
      : {}),
    ...(original.camera
      ? {
          camera: {
            ...original.camera,
            keyframes: original.camera.keyframes.map(k => ({
              ...k,
              at: time(k.at),
            })),
          },
        }
      : {}),
    elements: original.elements.map(element => ({
      ...element,
      start: time(element.start),
      ...(element.end !== undefined ? { end: time(element.end) } : {}),
      keyframes: element.keyframes.map(k => ({ ...k, at: time(k.at) })),
    })),
  });
}
/** 模型提示词与渲染器共同遵守的字段说明；时间以每镜起点为0的绝对秒数表达。 */
export const CODE_MOTION_COMPOSITION_GUIDE = `composition逐镜JSON：{id,duration,background?:#RRGGBB,camera?,transition?,elements:[...]}。禁止代码、HTML、URL、任意字段。元素id跨镜稳定；continuity=carry只承接上一镜同id同type最终变换及粒子运动时钟，否则reset；文字/形状属性和相机仍需逐镜明确提供。每元素start/end和keyframes[].at均为本镜头内绝对秒数，关键帧严格递增。transform与keyframe可设x/y（画幅归一化，默认0.5中心）、z（朝向镜头为正）、scale/scaleX/scaleY、rotation（度），mesh/particles另可设rotationX/rotationY（度）、opacity/reveal（0到1）、fill/stroke（#RRGGBB）；ease为linear/easeIn/easeOut/easeInOut/step，作用于到达该关键帧。layer=-100..100，blend=normal/multiply/screen/add。
元素type=text：text,fontSize(画布短边比例),font=sans/serif/mono,weight=normal/bold,align=left/center/right,maxWidth(画幅宽比例),lineHeight,letterSpacing(短边比例)，reveal按字符显现。type=shape：shape=rect/ellipse/triangle/line,width/height(画幅比例),radius(短边比例),filled,strokeWidth(短边比例)。type=path：points为相对元素中心的归一化[x,y]数组，closed/filled/strokeWidth，reveal控制描边长度。type=image：imageId必须是本次图片UUID，width/height/fit=contain或cover，禁止模型提供imageUri。type=particles：count<=300,seed固定整数,spread/speed/size,motion=drift/burst/orbit,depth；按绝对时间确定性求值。type=mesh：geometry=box/tetrahedron/octahedron,width/height/depth,wireframe/strokeWidth，受控凸几何三维透视，不含人物骨骼/碰撞物理。
相机camera可设x/y（默认0.5）,z（默认4，0.2..20）,rotationX(-85..85)/rotationY(-180..180),zoom(0.1..8),keyframes（同字段和at/ease）。transition={type:cut/fade/slideLeft/wipe/zoom,duration<=2且<=镜长一半}用于进入本镜，不增加总片长。每镜<=48元素且粒子总数<=1500、每元素<=64关键帧、path<=128点，映客计划最多12镜、总元素<=512。每镜duration必须等于对应计划时长。`;
