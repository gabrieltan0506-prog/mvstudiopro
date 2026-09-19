/** 从用户参考中提炼的材质要求；不声称图片具有真实网格或特定渲染器。 */
export const MANHUA_3D_MATERIAL_ZH = "按已确认角色结构保持身份、肢体数量、服装与配件。PBR材质按皮肤、毛发、布料、金属分别表现粗糙度、反射和细节；磨损须符合角色经历，避免所有表面统一塑料高光。光源方向与场景依据一致，以体积转折和接触阴影表现空间；轮廓光、雾与景深只在镜头需要时使用，不遮掉资产结构。";

export function compileManhua3dImageTreatment(treatment: unknown, isEdit: boolean): string {
  if (treatment !== "preserve_3d") return "";
  if (!isEdit) throw new Error("保留构图的3D质感处理需要底图，请切换微调并选择参考图。");
  return `【3D质感改图】保留底图构图、主体身份和数量、姿态、服饰结构、空间布局及原有超现实设计，仅调整材质、体积和受光。异常肢体按已确认物种设定核对，不把多尾、有翼或非人角色改成人类。${MANHUA_3D_MATERIAL_ZH}不添加额外支撑物或文字。此处理产出参考图片，不代表可绑骨模型、实测几何或8K分辨率。`;
}
