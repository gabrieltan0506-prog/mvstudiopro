import { createManhuaPrevisStudio, manhuaPrevisSpecSchema, PREVIS_MAX_ACTORS, previsCapacityIssueZh, type ManhuaPrevisStudio } from "./manhuaPrevis";
import type { PrevisSourceShot } from "./manhuaPrevisScript";

// 单字称呼只从明确出场名单或别名读取，不在动作正文里撞字匹配。
const castNames = (value?: string) => Array.from(new Set(String(value || "").split(/[；;、，,/|与和\n]+/).map(name => name.replace(/（[^）]*）|\([^)]*\)/g, "").trim()).filter(Boolean)));

/** 仅建立真实本段演员基线；动作与机位交由顾问，不把初始静立视为已完成预演。 */
export function createAdvisorPrevisStudio(input: {
  durationSec: number;
  shots: PrevisSourceShot[];
  castZh?: string;
  /** 仅对本段明确授权的一次性打手启用基础演员，不创建或借用资产。 */
  transientCharacterNames?: readonly string[];
  characters: Array<{ id: string; label: string; tag?: string; aliasZh?: string; shape?: "human" | "horse"; model?: { taskId: string; assetRef?: string } }>;
}): ManhuaPrevisStudio {
  const names = castNames(input.castZh);
  const text = input.shots.map(shot => shot.actionZh).join("\n");
  const namesOf = (c: typeof input.characters[number]) => [c.label, c.tag, ...castNames(c.aliasZh)].filter((name): name is string => Boolean(name?.trim())).map(name => name.trim());
  const transientIds: Record<string, string> = { "打手甲": "actor-transient-dashou-jia", "打手乙": "actor-transient-dashou-yi" };
  const allowedTransient = Array.from(new Set(input.transientCharacterNames ?? []));
  if (allowedTransient.some(name => !Object.hasOwn(transientIds, name))) throw new Error("临时配角范围不符；仅允许已确认的打手甲、打手乙，其他人物仍须绑定资产。");
  const transientNames = allowedTransient.filter(name => (names.length ? names.includes(name) : text.includes(name)) && !input.characters.some(c => namesOf(c).includes(name)));
  const missing = names.filter(name => !input.characters.some(c => namesOf(c).includes(name)) && !transientNames.includes(name));
  if (missing.length) throw new Error(`本段人物尚未绑定资产：${missing.join("、")}。请先绑定；不会遗漏人物或用默认角色替代。`);
  const selected = input.characters.filter(c => namesOf(c).some(name => names.length ? names.includes(name) : name.length >= 2 && text.includes(name)));
  if (!selected.length && !transientNames.length) throw new Error("本段分镜未能识别已绑定人物，请先在剧本中写清出场人物姓名，再交给顾问安排动作。");
  if (selected.length + transientNames.length > PREVIS_MAX_ACTORS) throw new Error("本段出场人物超过白模容量，请先按剧情拆分片段；不会截掉人物。");
  if (new Set(selected.map(c => c.id)).size !== selected.length || new Set(selected.map(c => c.label)).size !== selected.length) throw new Error("人物身份存在重复，请先核对剧本人物绑定。");
  const studio = createManhuaPrevisStudio(input.durationSec);
  const totalActors = selected.length + transientNames.length;
  const capacityIssue = previsCapacityIssueZh({ durationSec: studio.spec.durationSec, actors: [...selected, ...transientNames] });
  if (capacityIssue) throw new Error(capacityIssue);
  // 初始排布只用于建立演员基线；多人分行，避免单排越过舞台坐标范围。
  const columns = totalActors <= 6 ? totalActors : Math.min(9, Math.ceil(Math.sqrt(totalActors * 1.6)));
  const rows = Math.ceil(totalActors / columns);
  const positionOf = (index: number): [number, number] => [(index % columns - (columns - 1) / 2) * 1.5, (Math.floor(index / columns) - (rows - 1) / 2) * 1.5];
  const baseActor = studio.spec.actors[0];
  studio.spec.actors = [
    ...selected.map((c, index) => ({
      ...baseActor, id: `actor-${index + 1}`, nameZh: c.label, assetRef: c.id,
      shape: c.shape ?? "human", start: positionOf(index),
      end: positionOf(index),
    })),
    ...transientNames.map((name, index) => ({
      ...baseActor, id: transientIds[name], nameZh: name, shape: "human" as const,
      start: positionOf(selected.length + index),
      end: positionOf(selected.length + index),
    })),
  ];
  if (totalActors > 6) {
    // 多人初始阵列按35mm视域、最近一排与边距确定广角机位。
    const width = (columns - 1) * 1.5 + 2;
    studio.spec.cameras = [{ startSec: 0, endSec: studio.spec.durationSec,
      position: [0, -Math.ceil(width * 35 / 36 + (rows - 1) * .75), 2.5], target: [0, 0, 1], lens: 35 }];
  }
  studio.spec = manhuaPrevisSpecSchema.parse(studio.spec);
  return studio;
}

/** One actor per confirmed identity; face and full-body references are not two people.
 * Ambiguous same-duty references stay separate so the existing identity check can block them.
 */
export function selectPrevisCharacterSlots<T extends {id:string;seedLibraryId?:string|null;duty?:"identity"|"look"|null}>(slots:readonly T[]):T[] {
  const groups=new Map<string,T[]>();
  for(const slot of slots){const key=slot.seedLibraryId || `ref:${slot.id}`;const group=groups.get(key)||[];if(!group.some(s=>s.id===slot.id))group.push(slot);groups.set(key,group);}
  return Array.from(groups.values()).flatMap(group=>{
    const rank=(s:T)=>s.duty==="look"?2:s.duty==="identity"?0:1;
    const best=Math.max(...group.map(rank));
    return group.filter(s=>rank(s)===best);
  });
}
