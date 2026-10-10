import type { CodeMotionProject } from "./codeMotion";
import {
  codeMotionPlanElementSchema,
  codeMotionPlanSceneSchema,
  type CodeMotionPlanScene,
} from "./codeMotionComposition";

export const CODE_MOTION_EFFECTS = [
  {
    id: "fade",
    label: "柔和淡入",
    group: "transition",
    description: "相邻代码镜头短暂叠化，保留原画面内容。",
    useCase: "段落平缓衔接",
  },
  {
    id: "slideLeft",
    label: "向左滑动",
    group: "transition",
    description: "下一镜从右侧进入，推动上一镜离开。",
    useCase: "步骤与页面推进",
  },
  {
    id: "wipe",
    label: "擦拭转场",
    group: "transition",
    description: "沿画面边缘揭开下一镜。",
    useCase: "切换图文段落",
  },
  {
    id: "zoom",
    label: "推进转场",
    group: "transition",
    description: "推进到下一镜，镜内素材保持原样。",
    useCase: "强调下一段重点",
  },
  {
    id: "imageReveal",
    label: "照片揭示",
    group: "decoration",
    description: "逐张揭开镜头已有图片，保留裁切、位置与其他动作。",
    useCase: "已有照片逐步出现；不会生成新图",
  },
  {
    id: "drift",
    label: "漂浮粒子",
    group: "decoration",
    description: "添加缓慢上浮的点状装饰。",
    useCase: "轻柔气氛与背景层次",
  },
  {
    id: "burst",
    label: "扩散粒子",
    group: "decoration",
    description: "点状装饰从中心向外展开。",
    useCase: "强调画面变化",
  },
  {
    id: "orbit",
    label: "环绕粒子",
    group: "decoration",
    description: "点状装饰围绕中心循环移动。",
    useCase: "环形视觉节奏",
  },
  {
    id: "geometry",
    label: "空间几何转动",
    group: "decoration",
    description: "添加可旋转的简单空间几何体。",
    useCase: "几何展示；不制作实体模型资产",
  },
  {
    id: "pointMorph3d",
    label: "3D点云变形与环绕",
    group: "decoration",
    description: "空间点云从球体变为圆环，相机同步环绕；可逐帧定位。",
    useCase: "免费程序几何特效；不是生成3D模型或实景资产",
  },
  {
    id: "columnAnnotations",
    label: "三栏累积注记",
    group: "layout",
    description:
      "三张已选图固定对齐，素材名注记依次落下并保留；新增布局可编辑。",
    useCase: "图文对照；至少3张已选图、每镜至少4秒",
  },
  {
    id: "paperStack",
    label: "倾斜纸页堆叠",
    group: "layout",
    description: "2至4张已选图完整放入方角纸页，依序前移，旧页边缘持续可见。",
    useCase: "文件与手记展示；至少2张已选图、每镜至少4秒",
  },
] as const;
export type CodeMotionEffect = (typeof CODE_MOTION_EFFECTS)[number]["id"];
type Element = CodeMotionPlanScene["elements"][number];
type SelectedImage = CodeMotionProject["brief"]["images"][number];
// Only this workbench's generated layout is replaced on re-application.
const LAYOUT_PREFIX = "ink-menu-layout-";
const shortLabel = (name: string) => {
  const chars = Array.from(name);
  return chars.slice(0, 38).join("") + (chars.length > 38 ? "…" : "");
};

function imagesForScene(
  project: CodeMotionProject,
  scene: CodeMotionPlanScene
) {
  const selected = project.brief.images;
  const ids = scene.elements
    .filter(
      (e): e is Extract<Element, { type: "image" }> =>
        e.type === "image" && !e.id.startsWith(LAYOUT_PREFIX)
    )
    .map(e => e.imageId);
  return Array.from(new Set([...ids, ...selected.map(x => x.id)]))
    .map(id => selected.find(image => image.id === id))
    .filter((image): image is SelectedImage => !!image);
}

function layoutElements(
  effect: "columnAnnotations" | "paperStack",
  images: SelectedImage[],
  duration: number,
  layer: number,
  portrait: boolean
): Element[] {
  const result: Element[] = [];
  const add = (element: unknown) =>
    result.push(codeMotionPlanElementSchema.parse(element));
  if (effect === "columnAnnotations") {
    images.slice(0, 3).forEach((image, i) => {
      const x = 0.18 + i * 0.32,
        at = duration * (0.16 + i * 0.22),
        settled = at + Math.min(0.28, duration * 0.06);
      const common = { start: 0, end: duration, continuity: "reset" };
      add({
        ...common,
        id: `${LAYOUT_PREFIX}column-${i}-paper`,
        type: "shape",
        shape: "rect",
        width: 0.28,
        height: 0.58,
        radius: 0,
        layer,
        transform: { x, y: 0.45, fill: "#f4f1e8", stroke: "#b8b4aa" },
      });
      add({
        ...common,
        id: `${LAYOUT_PREFIX}column-${i}-image`,
        type: "image",
        imageId: image.id,
        width: 0.255,
        height: 0.52,
        fit: "contain",
        layer: layer + 1,
        transform: { x, y: 0.44 },
      });
      // Focus moves, but each annotation has its own permanent window through the scene end.
      add({
        ...common,
        id: `${LAYOUT_PREFIX}column-${i}-focus`,
        type: "shape",
        shape: "rect",
        filled: false,
        width: 0.286,
        height: 0.586,
        strokeWidth: 0.006,
        layer: layer + 2,
        transform: { x, y: 0.45, stroke: "#deef7c", opacity: 0 },
        keyframes: [
          { at, opacity: 1, ease: "step" },
          { at: duration * (0.38 + i * 0.22), opacity: 0, ease: "step" },
        ],
      });
      const movement = [
        { at, y: 0.7, opacity: 0 },
        { at: settled, y: 0.77, opacity: 1, ease: "easeOut" },
      ];
      add({
        id: `${LAYOUT_PREFIX}column-${i}-note`,
        type: "shape",
        shape: "rect",
        start: at,
        end: duration,
        width: 0.28,
        height: 0.12,
        radius: 0,
        layer: layer + 3,
        transform: {
          x,
          y: 0.7,
          fill: "#deef7c",
          stroke: "#deef7c",
          opacity: 0,
        },
        keyframes: movement,
      });
      add({
        id: `${LAYOUT_PREFIX}column-${i}-label`,
        type: "text",
        start: at,
        end: duration,
        text: shortLabel(image.name),
        fontSize: 0.024,
        maxWidth: 0.25,
        lineHeight: 1.15,
        layer: layer + 4,
        transform: { x, y: 0.7, fill: "#182524", opacity: 0 },
        keyframes: movement,
      });
    });
  } else {
    const aspect = portrait ? 9 / 16 : 16 / 9;
    const width = Math.min(0.6, (0.66 * 0.707) / aspect),
      height = (width * aspect) / 0.707;
    images.slice(0, 4).forEach((image, i) => {
      const at = i * duration * 0.18,
        settled = at + Math.min(0.35, duration * 0.07);
      const x = 0.46 + i * 0.024,
        y = 0.46 + i * 0.019,
        rotation = [-6, 3, -2, 5][i];
      const movement = [
        { at, x: x + 0.16, y: y - 0.06, rotation: rotation + 9, opacity: 0 },
        { at: settled, x, y, rotation, opacity: 1, ease: "easeOut" },
      ];
      const common = {
        start: at,
        end: duration,
        transform: {
          x: x + 0.16,
          y: y - 0.06,
          rotation: rotation + 9,
          opacity: 0,
        },
        keyframes: movement,
      };
      add({
        ...common,
        id: `${LAYOUT_PREFIX}paper-${i}-sheet`,
        type: "shape",
        shape: "rect",
        width,
        height,
        radius: 0,
        layer: layer + i * 3,
        transform: { ...common.transform, fill: "#f4f1e8", stroke: "#a4aaa6" },
      });
      add({
        ...common,
        id: `${LAYOUT_PREFIX}paper-${i}-image`,
        type: "image",
        imageId: image.id,
        width: width * 0.91,
        height: height * 0.89,
        fit: "contain",
        layer: layer + i * 3 + 1,
      });
      // Static image source remains intact; no frame, model or document content is invented.
    });
  }
  return result;
}

function revealImage(
  element: Extract<Element, { type: "image" }>,
  duration: number
): Element {
  const finish =
    element.start +
    Math.min(1.2, ((element.end ?? duration) - element.start) * 0.35);
  const frames = new Map<number, Element["keyframes"][number]>();
  for (const frame of element.keyframes) {
    const { reveal: _reveal, ...rest } = frame;
    if (Object.keys(rest).some(key => key !== "at" && key !== "ease"))
      frames.set(frame.at, rest);
  }
  for (const frame of [
    { at: element.start, reveal: 0 },
    { at: finish, reveal: 1 },
  ]) {
    const old = frames.get(frame.at);
    frames.set(frame.at, {
      ...(old ?? { ease: "easeOut" as const }),
      ...frame,
    });
  }
  if (frames.size > 64) throw Error("图片动作已满，请先整理关键帧后再采用揭示");
  return {
    ...element,
    revealDirection: element.revealDirection ?? "left",
    transform: { ...element.transform, reveal: 0 },
    keyframes: Array.from(frames.values()).sort((a, b) => a.at - b.at),
  };
}

/** Writes the same composition schema consumed by both preview and formal rendering. */
export function applyCodeMotionEffect(
  project: CodeMotionProject,
  effect: CodeMotionEffect
): CodeMotionProject {
  if (!project.plan || project.brief.style !== "scenes")
    throw Error("请先整理逐镜创作，再采用特效");
  let at = 0,
    changed = 0;
  const scenes = project.plan.scenes.map(scene => {
    const start = at;
    at += scene.duration;
    const coveredByVideo = project.plan!.codeVideo?.clips.some(
      c => c.at < at && c.at + c.duration > start
    );
    if (!scene.composition || coveredByVideo) return scene;
    const composition = structuredClone(scene.composition);
    if (effect === "imageReveal") {
      if (!composition.elements.some(e => e.type === "image")) return scene;
      composition.elements = composition.elements.map(e =>
        e.type === "image" ? revealImage(e, scene.duration) : e
      );
    } else if (effect === "columnAnnotations" || effect === "paperStack") {
      const images = imagesForScene(project, composition);
      if (images.length < (effect === "columnAnnotations" ? 3 : 2))
        throw Error(
          effect === "columnAnnotations"
            ? "三栏注记需要至少3张已选图片，请先选择素材"
            : "纸页堆叠需要至少2张已选图片，请先选择素材"
        );
      if (scene.duration < 4)
        throw Error("图文布局需要每个代码镜头至少4秒，请先留出阅读时间");
      const original = composition.elements.filter(
        e => !e.id.startsWith(LAYOUT_PREFIX)
      );
      const layer = Math.max(0, ...original.map(e => e.layer)) + 1;
      if (layer + 11 > 100)
        throw Error("当前镜头图层已满，请先整理图层后再采用布局");
      const elements = layoutElements(
        effect,
        images,
        scene.duration,
        layer,
        project.brief.orientation === "portrait"
      );
      if (original.length + elements.length > 48)
        throw Error("当前镜头元素已满，请先整理画面后再采用布局");
      composition.elements = [...original, ...elements];
    } else if (
      effect === "fade" ||
      effect === "slideLeft" ||
      effect === "wipe" ||
      effect === "zoom"
    ) {
      composition.transition = {
        type: effect,
        duration: Math.min(0.35, scene.duration / 2),
      };
    } else {
      composition.elements = composition.elements.filter(
        e => e.id !== "ink-menu-effect"
      );
      const foregroundLayer =
        Math.max(0, ...composition.elements.map(e => e.layer)) + 1;
      if (effect === "pointMorph3d" && foregroundLayer > 100)
        throw Error("当前镜头图层已满，请先整理图层后再采用3D特效");
      composition.elements.push(
        effect === "pointMorph3d"
          ? codeMotionPlanElementSchema.parse({
              id: "ink-menu-effect",
              type: "pointMorph",
              from: "sphere",
              to: "torus",
              count: 240,
              seed: 41,
              spread: 0.4,
              size: 0.005,
              layer: foregroundLayer,
              transform: {
                x: 0.5,
                y: 0.45,
                fill: "#deef7c",
                rotationX: 15,
                morph: 0,
              },
              keyframes: [
                { at: 0, morph: 0, rotationY: 0 },
                {
                  at: scene.duration * 0.72,
                  morph: 1,
                  rotationY: 100,
                  ease: "easeInOut",
                },
                { at: scene.duration, morph: 1, rotationY: 135 },
              ],
            })
          : effect === "geometry"
            ? codeMotionPlanElementSchema.parse({
                id: "ink-menu-effect",
                type: "mesh",
                geometry: "octahedron",
                width: 0.25,
                height: 0.25,
                depth: 0.25,
                transform: { x: 0.8, y: 0.25, fill: "#df9969" },
                keyframes: [
                  { at: 0, rotationY: 0 },
                  { at: scene.duration, rotationY: 180 },
                ],
              })
            : codeMotionPlanElementSchema.parse({
                id: "ink-menu-effect",
                type: "particles",
                motion: effect,
                count: 60,
                seed: 41,
                spread: 0.7,
                speed: 0.12,
                size: 0.004,
                transform: { x: 0.5, y: 0.5, fill: "#df9969" },
                keyframes: [],
              })
      );
      if (effect === "pointMorph3d") {
        const initialOrbit = composition.camera?.orbitY ?? 0;
        const cameraFrames = new Map<
          number,
          NonNullable<CodeMotionPlanScene["camera"]>["keyframes"][number]
        >();
        for (const frame of composition.camera?.keyframes ?? []) {
          const { orbitY: _orbitY, ...other } = frame;
          if (Object.keys(other).some(key => key !== "at" && key !== "ease"))
            cameraFrames.set(frame.at, other);
        }
        for (const frame of [
          { at: 0, orbitY: initialOrbit },
          {
            at: scene.duration,
            orbitY: initialOrbit + (initialOrbit > 3565 ? -35 : 35),
          },
        ]) {
          cameraFrames.set(frame.at, {
            ...(cameraFrames.get(frame.at) ?? {}),
            ...frame,
          });
        }
        if (cameraFrames.size > 32)
          throw Error("镜头动作已满，请先整理相机动作后再采用环绕");
        composition.camera = {
          ...composition.camera,
          orbitY: initialOrbit,
          keyframes: Array.from(cameraFrames.values()).sort(
            (a, b) => a.at - b.at
          ),
        };
      }
    }
    if (composition.elements.length > 48)
      throw Error("当前镜头元素已满，请先整理画面后再采用特效");
    if (
      composition.elements.reduce(
        (sum, e) =>
          sum +
          (e.type === "particles" || e.type === "pointMorph" ? e.count : 0),
        0
      ) > 1500
    )
      throw Error("当前镜头粒子已满，请先整理粒子后再采用特效");
    changed++;
    return {
      ...scene,
      composition: codeMotionPlanSceneSchema.parse(composition),
    };
  });
  if (!changed)
    throw Error(
      effect === "imageReveal"
        ? "当前可编辑代码镜头没有图片，请先把已选素材放入镜头；原视频不变"
        : "当前镜头由原片覆盖，没有可采用代码特效的镜头；可在逐镜设置中修改原片"
    );
  if (
    scenes.reduce(
      (n, scene) => n + (scene.composition?.elements.length ?? 0),
      0
    ) > 512
  )
    throw Error("作品画面元素已满，请先整理镜头后再采用特效");
  if (
    scenes.reduce(
      (n, scene) =>
        n +
        (scene.composition?.elements.reduce(
          (sum, e) => sum + e.keyframes.length,
          0
        ) ?? 0),
      0
    ) > 4000
  )
    throw Error("作品动作已满，请先整理关键帧后再采用特效");
  return { ...project, plan: { ...project.plan, scenes } };
}
