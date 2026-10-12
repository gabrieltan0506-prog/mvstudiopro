import { createManhuaPrevisStudio, manhuaPrevisSpecSchema, type ManhuaPrevisStudio } from "./manhuaPrevis";

type Shape = "human" | "horse";
export type PrevisCastCharacter = { id: string; label: string; shape?: Shape };

/** 只应用用户明确核对的人物，不从正文猜单字姓名，不改既有人物编号或媒体。 */
export function repairManhuaPrevisCast(studio: ManhuaPrevisStudio, characters: readonly PrevisCastCharacter[], input: {
  additions: Array<{ assetRef: string; shape: Shape }>;
  shapes: Array<{ actorId: string; shape: Shape }>;
}): ManhuaPrevisStudio {
  if (studio.pending) throw new Error("本段仍有在途渲染，请先查询原任务再核对人物。");
  const actors = studio.spec.actors.map(actor => ({ ...actor }));
  for (const change of input.shapes) {
    const actor = actors.find(row => row.id === change.actorId);
    if (!actor) throw new Error("人物方案已变化，请重新核对。");
    if (actor.shape === change.shape) continue;
    if (actor.creature) throw new Error(`${actor.nameZh}已有专用形态，请在对应配置中核对。`);
    if (actor.riggedModel && (change.shape === "horse") !== (actor.riggedModel.rigKind === "quadruped"))
      throw new Error(`${actor.nameZh}的已采用骨骼与新形态不符，原模型配置保留，请先核对模型。`);
    actor.shape = change.shape;
  }
  for (const addition of input.additions) {
    const matches = characters.filter(character => character.id === addition.assetRef);
    if (matches.length !== 1) throw new Error("待补人物的资产不存在或身份不唯一，请重新核对。");
    const character = matches[0];
    if (actors.some(actor => actor.assetRef === character.id || actor.nameZh === character.label))
      throw new Error(`${character.label}已在本段，不能重复补入。`);
    let sequence = 1;
    while (actors.some(actor => actor.id === `actor-${sequence}`)) sequence++;
    // 新人物只建立待调度基线，避开已有起点；不将静立冒充剧情动作。
    let position: [number, number] | undefined;
    for (let y = -6; y <= 6 && !position; y += 1.5) for (let x = -6; x <= 6; x += 1.5) {
      if (actors.every(actor => Math.hypot(actor.start[0] - x, actor.start[1] - y) >= 1.4)) { position = [x, y]; break; }
    }
    if (!position) throw new Error("没有可用的初始站位，请先调整本段人物。");
    actors.push({ ...createManhuaPrevisStudio(studio.spec.durationSec).spec.actors[0],
      id: `actor-${sequence}`, nameZh: character.label, assetRef: character.id,
      shape: addition.shape, start: position, end: position });
  }
  const spec = manhuaPrevisSpecSchema.parse({ ...studio.spec, actors });
  if (JSON.stringify(spec) === JSON.stringify(studio.spec)) return studio;
  return { ...studio, spec, specHistory: [...(studio.specHistory || []), {
    spec: studio.spec, createdAt: new Date().toISOString(), reasonZh: "核对本段人物与形态前的配置",
  }] };
}
