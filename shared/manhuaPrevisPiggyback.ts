/** 从开镜已背稳；可显式编排一次滑落、接住与复位，不覆盖上背或放下。 */
import { z } from "zod";

export const previsPiggybackSlipCatchSchema = z.object({
  slipStartSec: z.number().finite().min(0),
  catchSec: z.number().finite().min(0),
  recoverEndSec: z.number().finite().min(0),
  dropMeters: z.number().finite().min(.06).max(.18),
}).strict();

export function expectedPiggybackMotion(
  event: z.infer<typeof previsPiggybackSlipCatchSchema> | undefined,
  frame: number,
): { dropMeters: number; supportGap: number } {
  if (!event) return { dropMeters: 0, supportGap: 0 };
  const time = (frame - 1) / 24;
  if (time <= event.slipStartSec || time >= event.recoverEndSec)
    return { dropMeters: 0, supportGap: 0 };
  if (time < event.catchSec) {
    const progress = (time - event.slipStartSec) / (event.catchSec - event.slipStartSec);
    return {
      dropMeters: event.dropMeters * progress * progress * (3 - 2 * progress),
      supportGap: event.dropMeters * .65 * Math.sin(Math.PI * progress),
    };
  }
  const progress = (time - event.catchSec) / (event.recoverEndSec - event.catchSec);
  return { dropMeters: event.dropMeters * (1 - progress * progress * (3 - 2 * progress)), supportGap: 0 };
}

export const previsPiggybackSchema = z.object({
  carrierId: z.string().min(1).max(100),
  passengerId: z.string().min(1).max(100),
  slipCatch: previsPiggybackSlipCatchSchema.optional(),
}).strict();

export function previsPiggybackIssues(spec: {
  piggyback?: z.infer<typeof previsPiggybackSchema>;
  durationSec: number;
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
  const slip = pair.slipCatch;
  if (slip && !(slip.slipStartSec + .2 <= slip.catchSec &&
      slip.catchSec + .2 <= slip.recoverEndSec && slip.recoverEndSec <= spec.durationSec))
    issues.push("背负滑落须依次设置开始、接住、恢复，间隔至少0.2秒且不超过本段时长");
  return issues;
}
