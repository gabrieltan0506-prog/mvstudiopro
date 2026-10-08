import { createManhuaPrevisStudio, manhuaPrevisSpecSchema, type ManhuaPrevisStudio } from "./manhuaPrevis";
import type { PrevisSourceShot } from "./manhuaPrevisScript";

// 单字称呼只从明确出场名单或别名读取，不在动作正文里撞字匹配。
const castNames = (value?: string) => Array.from(new Set(String(value || "").split(/[；;、，,/|与和\n]+/).map(name => name.replace(/（[^）]*）|\([^)]*\)/g, "").trim()).filter(Boolean)));

/** 仅建立真实本段演员基线；动作与机位交由顾问，不把初始静立视为已完成预演。 */
export function createAdvisorPrevisStudio(input: {
  durationSec: number;
  shots: PrevisSourceShot[];
  castZh?: string;
  characters: Array<{ id: string; label: string; tag?: string; aliasZh?: string; shape?: "human" | "horse"; model?: { taskId: string; assetRef?: string } }>;
}): ManhuaPrevisStudio {
  const names = castNames(input.castZh);
  const text = input.shots.map(shot => shot.actionZh).join("\n");
  const namesOf = (c: typeof input.characters[number]) => [c.label, c.tag, ...castNames(c.aliasZh)].filter((name): name is string => Boolean(name?.trim())).map(name => name.trim());
  const missing = names.filter(name => !input.characters.some(c => namesOf(c).includes(name)));
  if (missing.length) throw new Error(`本段人物尚未绑定资产：${missing.join("、")}。请先绑定；不会遗漏人物或用默认角色替代。`);
  const selected = input.characters.filter(c => namesOf(c).some(name => names.length ? names.includes(name) : name.length >= 2 && text.includes(name)));
  if (!selected.length) throw new Error("本段分镜未能识别已绑定人物，请先在剧本中写清出场人物姓名，再交给顾问安排动作。");
  if (selected.length > 6) throw new Error("本段出场人物超过白模容量，请先按剧情拆分片段；不会截掉人物。");
  if (new Set(selected.map(c => c.id)).size !== selected.length || new Set(selected.map(c => c.label)).size !== selected.length) throw new Error("人物身份存在重复，请先核对剧本人物绑定。");
  const studio = createManhuaPrevisStudio(input.durationSec);
  studio.spec.actors = selected.map((c, index) => ({
    ...studio.spec.actors[0], id: `actor-${index + 1}`, nameZh: c.label, assetRef: c.id,
    shape: c.shape ?? "human", start: [index * 1.5 - (selected.length - 1) * .75, 0],
    end: [index * 1.5 - (selected.length - 1) * .75, 0],
  }));
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
