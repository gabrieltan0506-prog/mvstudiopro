import { useState } from "react";
import type { CodeMotionPlanScene } from "@shared/codeMotionComposition";
import { codeMotionPlanSceneSchema } from "@shared/codeMotionComposition";

const field =
  "mt-1 w-full rounded-lg border border-stone-200 px-2 py-1.5 text-sm";
const kinds = {
  text: "文字",
  shape: "图形",
  path: "线条",
  particles: "粒子",
  mesh: "空间几何",
  image: "图片",
} as const;
const numeric = [
  "x",
  "y",
  "z",
  "scale",
  "rotation",
  "rotationX",
  "rotationY",
  "opacity",
  "reveal",
] as const;
export function makeCodeMotionScene(
  id: string,
  duration: number,
  text: string,
  imageId?: string
): CodeMotionPlanScene {
  return codeMotionPlanSceneSchema.parse({
    id,
    duration,
    background: "#f5f1e8",
    transition: { type: "fade", duration: Math.min(0.3, duration / 2) },
    elements: [
      {
        id: `${id}-title`,
        type: "text",
        text,
        fontSize: 0.075,
        transform: { x: 0.5, y: imageId ? 0.18 : 0.46, fill: "#26211c" },
        keyframes: [
          { at: 0, opacity: 0, y: imageId ? 0.22 : 0.55 },
          {
            at: Math.min(0.6, duration / 2),
            opacity: 1,
            y: imageId ? 0.18 : 0.46,
            ease: "easeOut",
          },
        ],
      },
      ...(imageId
        ? [
            {
              id: `${id}-image`,
              type: "image",
              imageId,
              width: 0.75,
              height: 0.65,
              transform: { x: 0.5, y: 0.58 },
              keyframes: [
                { at: 0, scale: 0.9 },
                { at: duration, scale: 1 },
              ],
            },
          ]
        : []),
    ],
  });
}
export default function CodeMotionSceneEditor({
  scene,
  images,
  previousScene,
  onChange: notifyChange,
}: {
  scene: CodeMotionPlanScene;
  images: { id: string; name: string }[];
  previousScene?: CodeMotionPlanScene;
  onChange(value: CodeMotionPlanScene): void;
}) {
  const [error, setError] = useState("");
  const onChange = (value: unknown) => {
    const parsed = codeMotionPlanSceneSchema.safeParse(value);
    if (!parsed.success) {
      const detail = parsed.error.issues[0]?.message || "";
      setError(
        `这次修改未保存，原稿已保留：${/[\u4e00-\u9fff]/.test(detail) ? detail : "请检查数值范围、在场秒数和动作节点顺序"}`
      );
      return;
    }
    if (
      parsed.data.elements.some(
        element =>
          element.continuity === "carry" &&
          !previousScene?.elements.some(
            prior => prior.id === element.id && prior.type === element.type
          )
      )
    ) {
      setError(
        "这次修改未保存，原稿已保留：请选择上一镜中同类型的元素来延续。"
      );
      return;
    }
    setError("");
    notifyChange(parsed.data);
  };
  const update = (
    i: number,
    value: Partial<CodeMotionPlanScene["elements"][number]>
  ) =>
    onChange({
      ...scene,
      elements: scene.elements.map((e, k) =>
        i === k ? ({ ...e, ...value } as typeof e) : e
      ),
    });
  const add = (type: keyof typeof kinds) => {
    const defaults =
      type === "text"
        ? { text: "新文字" }
        : type === "shape"
          ? { shape: "ellipse" }
          : type === "path"
            ? {
                points: [
                  [-0.2, 0],
                  [0, -0.15],
                  [0.2, 0.05],
                ],
              }
            : type === "particles"
              ? { seed: 1, motion: "orbit" }
              : type === "mesh"
                ? { geometry: "box" }
                : { imageId: images[0]?.id };
    if (type === "image" && !images.length) return;
    const value = {
      ...scene,
      elements: [
        ...scene.elements,
        {
          type,
          id: `el_${crypto.randomUUID().replaceAll("-", "")}`,
          ...defaults,
          transform: { x: 0.5, y: 0.5, fill: "#c65e32" },
        },
      ],
    };
    onChange(value);
  };
  return (
    <div className="mt-4 space-y-3 border-t pt-3">
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="grid grid-cols-3 gap-2">
        <label className="text-xs">
          背景
          <input
            className={field}
            type="color"
            value={scene.background || "#f5f1e8"}
            onChange={e => onChange({ ...scene, background: e.target.value })}
          />
        </label>
        <label className="text-xs">
          进入画面
          <select
            className={field}
            value={scene.transition?.type || "cut"}
            onChange={e =>
              onChange({
                ...scene,
                transition: {
                  type: e.target.value as NonNullable<
                    CodeMotionPlanScene["transition"]
                  >["type"],
                  duration: Math.min(0.3, scene.duration / 2),
                },
              })
            }
          >
            {Object.entries({
              cut: "直接切换",
              fade: "淡入",
              slideLeft: "向左推进",
              wipe: "擦除揭示",
              zoom: "推进",
            }).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          镜头缩放
          <input
            type="number"
            className={field}
            min={0.1}
            max={8}
            step={0.1}
            value={scene.camera?.zoom || 1}
            onChange={e =>
              onChange({
                ...scene,
                camera: {
                  ...scene.camera,
                  zoom: Number(e.target.value),
                  keyframes: scene.camera?.keyframes || [],
                },
              })
            }
          />
        </label>
      </div>
      {scene.elements.map((element, i) => (
        <details
          key={element.id}
          className="rounded-lg border border-stone-200 p-3"
        >
          <summary className="cursor-pointer text-sm">
            {kinds[element.type]} ·{" "}
            {element.type === "text"
              ? element.text.slice(0, 22)
              : element.type === "image"
                ? images.find(a => a.id === element.imageId)?.name
                : `${i + 1}`}{" "}
            · {element.keyframes.length}个动作节点
          </summary>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <label className="text-xs">
                开始出现（秒）
                <input
                  aria-label={`元素${i + 1}开始出现`}
                  type="number"
                  className={field}
                  min={0}
                  max={scene.duration}
                  step={0.05}
                  value={element.start}
                  onChange={e => update(i, { start: Number(e.target.value) })}
                />
              </label>
              <label className="text-xs">
                结束出现（秒）
                <input
                  aria-label={`元素${i + 1}结束出现`}
                  type="number"
                  className={field}
                  min={0}
                  max={scene.duration}
                  step={0.05}
                  value={element.end ?? scene.duration}
                  onChange={e => update(i, { end: Number(e.target.value) })}
                />
              </label>
              <label className="text-xs">
                画面层级
                <input
                  aria-label={`元素${i + 1}画面层级`}
                  type="number"
                  className={field}
                  min={-100}
                  max={100}
                  step={1}
                  value={element.layer}
                  onChange={e => update(i, { layer: Number(e.target.value) })}
                />
              </label>
            </div>
            <label className="block text-xs">
              与上一镜衔接
              <select
                aria-label={`元素${i + 1}与上一镜衔接`}
                className={field}
                value={element.continuity === "carry" ? element.id : "reset"}
                onChange={e =>
                  update(
                    i,
                    e.target.value === "reset"
                      ? { continuity: "reset" }
                      : { id: e.target.value, continuity: "carry" }
                  )
                }
              >
                <option value="reset">从本镜重新开始</option>
                {(previousScene?.elements || [])
                  .filter(
                    prior =>
                      prior.type === element.type &&
                      !scene.elements.some(
                        (other, n) => n !== i && other.id === prior.id
                      )
                  )
                  .map((prior, n) => (
                    <option key={prior.id} value={prior.id}>
                      延续上一镜
                      {prior.type === "text"
                        ? `文字：${prior.text.slice(0, 20)}`
                        : `${kinds[prior.type]} ${n + 1}`}
                    </option>
                  ))}
              </select>
            </label>
            {element.type === "mesh" && (
              <label className="block text-xs">
                几何形状
                <select
                  aria-label={`元素${i + 1}几何形状`}
                  className={field}
                  value={element.geometry}
                  onChange={e =>
                    update(i, {
                      geometry: e.target.value as typeof element.geometry,
                    })
                  }
                >
                  <option value="box">长方体</option>
                  <option value="tetrahedron">四面体</option>
                  <option value="octahedron">八面体</option>
                </select>
              </label>
            )}
            {element.type === "shape" && (
              <label className="block text-xs">
                图形形状
                <select
                  aria-label={`元素${i + 1}图形形状`}
                  className={field}
                  value={element.shape}
                  onChange={e =>
                    update(i, { shape: e.target.value as typeof element.shape })
                  }
                >
                  <option value="rect">矩形</option>
                  <option value="ellipse">椭圆</option>
                  <option value="triangle">三角形</option>
                  <option value="line">线段</option>
                </select>
              </label>
            )}
            {element.type === "particles" && (
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">
                  粒子运动
                  <select
                    aria-label={`元素${i + 1}粒子运动`}
                    className={field}
                    value={element.motion}
                    onChange={e =>
                      update(i, {
                        motion: e.target.value as typeof element.motion,
                      })
                    }
                  >
                    <option value="drift">漂移</option>
                    <option value="burst">向外散开</option>
                    <option value="orbit">环绕</option>
                  </select>
                </label>
                <label className="text-xs">
                  粒子数量
                  <input
                    aria-label={`元素${i + 1}粒子数量`}
                    type="number"
                    className={field}
                    min={1}
                    max={300}
                    step={1}
                    value={element.count}
                    onChange={e => update(i, { count: Number(e.target.value) })}
                  />
                </label>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              {(element.type === "mesh" ||
                element.type === "shape" ||
                element.type === "image") &&
                (
                  [
                    "width",
                    "height",
                    ...(element.type === "mesh" ? ["depth"] : []),
                  ] as Array<"width" | "height" | "depth">
                ).map(key => (
                  <label className="text-xs" key={key}>
                    {{ width: "宽度", height: "高度", depth: "厚度" }[key]}
                    <input
                      aria-label={`元素${i + 1}${key}`}
                      type="number"
                      className={field}
                      min={0.01}
                      max={3}
                      step={0.05}
                      value={
                        (element as unknown as Record<string, number>)[key]
                      }
                      onChange={e =>
                        update(i, { [key]: Number(e.target.value) })
                      }
                    />
                  </label>
                ))}
              {element.type === "particles" &&
                (["spread", "speed", "size", "depth"] as const).map(key => (
                  <label className="text-xs" key={key}>
                    {
                      {
                        spread: "分布范围",
                        speed: "运动速度",
                        size: "粒子大小",
                        depth: "空间深度",
                      }[key]
                    }
                    <input
                      aria-label={`元素${i + 1}${key}`}
                      type="number"
                      className={field}
                      step={key === "size" ? 0.001 : 0.05}
                      value={element[key]}
                      onChange={e =>
                        update(i, { [key]: Number(e.target.value) })
                      }
                    />
                  </label>
                ))}
            </div>
            {element.type === "mesh" && (
              <label className="text-xs">
                <input
                  type="checkbox"
                  checked={element.wireframe}
                  onChange={e => update(i, { wireframe: e.target.checked })}
                />{" "}
                只显示几何轮廓
              </label>
            )}

            {element.type === "text" && (
              <label className="block text-xs">
                画面文字
                <textarea
                  className={field}
                  value={element.text}
                  maxLength={600}
                  onChange={e => update(i, { text: e.target.value })}
                />
              </label>
            )}
            {element.type === "image" && (
              <label className="block text-xs">
                图片
                <select
                  className={field}
                  value={element.imageId}
                  onChange={e => update(i, { imageId: e.target.value })}
                >
                  {images.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["x", "横向位置"],
                  ["y", "纵向位置"],
                  ["scale", "大小"],
                  ["rotation", "旋转角度"],
                  ["opacity", "不透明度"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="text-xs">
                  {label}
                  <input
                    type="number"
                    className={field}
                    step={0.05}
                    value={
                      element.transform[key] ??
                      (key === "x" || key === "y"
                        ? 0.5
                        : key === "rotation"
                          ? 0
                          : 1)
                    }
                    onChange={e =>
                      update(i, {
                        transform: {
                          ...element.transform,
                          [key]: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              ))}
              <label className="text-xs">
                颜色
                <input
                  type="color"
                  className={field}
                  value={element.transform.fill || "#26211c"}
                  onChange={e =>
                    update(i, {
                      transform: { ...element.transform, fill: e.target.value },
                    })
                  }
                />
              </label>
            </div>
            <p className="text-xs text-stone-500">
              位置0.5为画面中心，动作秒数从本镜头开始计算。已有动作节点会优先使用节点中的位置、大小和颜色；修改动画请同时检查下方节点。
            </p>
            {element.keyframes.map((keyframe, k) => (
              <div key={k} className="rounded-lg bg-stone-50 p-2">
                <div className="flex gap-2">
                  <label className="text-xs">
                    第几秒
                    <input
                      type="number"
                      min={0}
                      max={scene.duration}
                      step={0.05}
                      className={field}
                      value={keyframe.at}
                      onChange={e =>
                        update(i, {
                          keyframes: element.keyframes.map((f, n) =>
                            k === n ? { ...f, at: Number(e.target.value) } : f
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="text-xs">
                    速度变化
                    <select
                      className={field}
                      value={keyframe.ease || "linear"}
                      onChange={e =>
                        update(i, {
                          keyframes: element.keyframes.map((f, n) =>
                            k === n
                              ? { ...f, ease: e.target.value as typeof f.ease }
                              : f
                          ),
                        })
                      }
                    >
                      {Object.entries({
                        linear: "匀速",
                        easeIn: "逐渐加快",
                        easeOut: "逐渐放慢",
                        easeInOut: "先快后慢",
                        step: "立即变化",
                      }).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {numeric
                    .filter(key => keyframe[key] !== undefined)
                    .map(key => (
                      <label key={key} className="text-xs">
                        {
                          {
                            x: "横向",
                            y: "纵向",
                            z: "深度",
                            scale: "大小",
                            rotation: "平面旋转",
                            rotationX: "上下旋转",
                            rotationY: "左右旋转",
                            opacity: "不透明度",
                            reveal: "显现比例",
                          }[key]
                        }
                        <input
                          type="number"
                          step={0.05}
                          className={field}
                          value={keyframe[key]}
                          onChange={e =>
                            update(i, {
                              keyframes: element.keyframes.map((f, n) =>
                                k === n
                                  ? { ...f, [key]: Number(e.target.value) }
                                  : f
                              ),
                            })
                          }
                        />
                      </label>
                    ))}
                </div>
                <button
                  type="button"
                  className="mt-2 text-xs"
                  onClick={() =>
                    update(i, {
                      keyframes: element.keyframes.filter((_, n) => k !== n),
                    })
                  }
                >
                  删除动作节点
                </button>
              </div>
            ))}
            <div className="flex gap-3 text-xs">
              <button
                type="button"
                disabled={
                  element.keyframes.length >= 64 ||
                  element.keyframes.some(f => f.at === scene.duration)
                }
                onClick={() =>
                  update(i, {
                    keyframes: [
                      ...element.keyframes,
                      {
                        at: scene.duration,
                        x: element.transform.x ?? 0.5,
                        y: element.transform.y ?? 0.5,
                        scale: element.transform.scale ?? 1,
                        rotation: element.transform.rotation ?? 0,
                        opacity: 1,
                      },
                    ].sort((a, b) => a.at - b.at),
                  })
                }
              >
                加入结尾动作节点
              </button>
              <button
                type="button"
                disabled={scene.elements.length <= 1}
                onClick={() =>
                  onChange({
                    ...scene,
                    elements: scene.elements.filter((_, n) => i !== n),
                  })
                }
              >
                删除元素
              </button>
            </div>
          </div>
        </details>
      ))}
      <div className="flex flex-wrap gap-2">
        {Object.entries(kinds).map(([type, label]) => (
          <button
            type="button"
            key={type}
            className="rounded-lg border px-2 py-1 text-xs"
            disabled={
              scene.elements.length >= 48 ||
              (type === "image" && !images.length)
            }
            onClick={() => add(type as keyof typeof kinds)}
          >
            添加{label}
          </button>
        ))}
      </div>
    </div>
  );
}
