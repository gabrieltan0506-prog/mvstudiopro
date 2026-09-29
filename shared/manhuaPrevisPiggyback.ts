/** 从开镜已背稳；可显式编排一次滑落、接住与复位，可编排完整放下，仍不覆盖上背。 */
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

export const previsPiggybackSetDownSchema = z.object({
  startSec: z.number().finite().min(0),
  groundSec: z.number().finite().min(0),
  releaseSec: z.number().finite().min(0),
  endSec: z.number().finite().min(0),
}).strict();

export const previsPiggybackSchema = z.object({
  carrierId: z.string().min(1).max(100),
  passengerId: z.string().min(1).max(100),
  slipCatch: previsPiggybackSlipCatchSchema.optional(),
  setDown: previsPiggybackSetDownSchema.optional(),
}).strict();

export function previsPiggybackIssues(spec: {
  piggyback?: z.infer<typeof previsPiggybackSchema>;
  durationSec: number;
  waterEmergence?: unknown;
  interactions?: readonly { actorId: string; targetActorId: string }[];
  actors: readonly {
    id: string; shape: string; riggedModel?: unknown; creature?: unknown; weapon?: unknown;
    start: readonly number[]; end: readonly number[]; facingDeg: number;
    moveStartSec: number; moveEndSec: number; motionRoute?: readonly {timeSec: number; position: readonly number[]; facingDeg: number}[];
    actions: readonly { kind: string; startSec: number; endSec: number }[];
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
  if (carrier.actions.some(a => a.kind !== "idle" && a.kind !== "walk" && (!pair.setDown || a.startSec < pair.setDown.endSec)) ||
      passenger.actions.some(a => a.kind !== "idle"))
    issues.push("背负当前支持承载者走位或停立；乘员的独立动作需先移除");
  if (["start", "end", "facingDeg", "moveStartSec", "moveEndSec", "motionRoute"].some(key =>
    JSON.stringify(carrier[key as keyof typeof carrier]) !== JSON.stringify(passenger[key as keyof typeof passenger])))
    issues.push("乘员须跟随承载者的同一站位与路线，不能同时保留独立位移");
  const slip = pair.slipCatch;
  if (slip && !(slip.slipStartSec + .2 <= slip.catchSec &&
      slip.catchSec + .2 <= slip.recoverEndSec && slip.recoverEndSec <= spec.durationSec))
    issues.push("背负滑落须依次设置开始、接住、恢复，间隔至少0.2秒且不超过本段时长");
  const down = pair.setDown;
  if (down) {
    if (!(down.startSec + .75 <= down.groundSec && down.groundSec + .25 <= down.releaseSec && down.releaseSec + .25 <= down.endSec && down.endSec <= spec.durationSec - 1/24) ||
        Object.values(down).some(t => Math.abs(t*24-Math.round(t*24)) > 1e-6))
      issues.push("放下须按24帧依次设置下蹲、落地、松手、起身；各阶段不少于0.75、0.25、0.25秒且在片长内");
    if (slip && slip.recoverEndSec > down.startSec) issues.push("滑落接住必须在放下开始前完成");
    const route = carrier.motionRoute;
    const moving = route?.length ? route.some((node, i) => i > 0 && down.startSec < node.timeSec && down.endSec > route[i-1].timeSec &&
      (node.facingDeg !== route[i-1].facingDeg || node.position.some((v,k) => v !== route[i-1].position[k]))) :
      carrier.start.some((v,k) => v !== carrier.end[k]) && down.startSec < carrier.moveEndSec && down.endSec > carrier.moveStartSec;
    if (moving || carrier.actions.some(a => a.kind !== "idle" && a.startSec < down.endSec && a.endSec > down.startSec))
      issues.push("放下期间承载者须停稳且不叠加其他动作；放下结束后可独立走位");
  }
  return issues;
}
