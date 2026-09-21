/** 整段背负关系：从开镜即已背稳，不声称覆盖上背与放下过程。 */
import { z } from "zod";

export const previsPiggybackSchema = z.object({
  carrierId: z.string().min(1).max(100),
  passengerId: z.string().min(1).max(100),
}).strict();

export function previsPiggybackIssues(spec: {
  piggyback?: z.infer<typeof previsPiggybackSchema>;
  waterEmergence?: unknown;
  interactions?: readonly { actorId: string; targetActorId: string }[];
  actors: readonly {
    id: string; shape: string; riggedModel?: unknown; creature?: unknown; weapon?: unknown;
    start: readonly number[]; end: readonly number[]; facingDeg: number;
    moveStartSec: number; moveEndSec: number; motionRoute?: unknown;
    actions: readonly { kind: string }[];
  }[];
}): string[] {
  const pair = spec.piggyback;
  if (!pair) return [];
  const carrier = spec.actors.find(a => a.id === pair.carrierId);
  const passenger = spec.actors.find(a => a.id === pair.passengerId);
  if (!carrier || !passenger || carrier.id === passenger.id)
    return ["背负需要指定两名不同的在场人物"];
  const issues: string[] = [];
  if ([carrier, passenger].some(a => a.shape !== "human" || a.creature || a.weapon))
    issues.push("背负双方须为未持械的人形角色");
  if ([carrier, passenger].some(a => a.riggedModel))
    issues.push("现有带衣人物的背负网格接触尚未验收，暂不能提交此组合");
  if (spec.waterEmergence || spec.interactions?.some(e =>
    [e.actorId, e.targetActorId].some(id => id === carrier.id || id === passenger.id)))
    issues.push("背负暂不能与出水或同一人物的其他双人接触叠加");
  if (carrier.actions.some(a => a.kind !== "idle" && a.kind !== "walk") ||
      passenger.actions.some(a => a.kind !== "idle"))
    issues.push("背负当前支持承载者走位或停立；乘员的独立动作需先移除");
  if (["start", "end", "facingDeg", "moveStartSec", "moveEndSec", "motionRoute"].some(key =>
    JSON.stringify(carrier[key as keyof typeof carrier]) !== JSON.stringify(passenger[key as keyof typeof passenger])))
    issues.push("乘员须跟随承载者的同一站位与路线，不能同时保留独立位移");
  return issues;
}
