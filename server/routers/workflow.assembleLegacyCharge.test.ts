import { describe, expect, it, vi } from "vitest";
const effects = vi.hoisted(() => ({ getCredits: vi.fn(), deductCreditsAmount: vi.fn() }));
vi.mock("../credits", async importOriginal => ({ ...await importOriginal<object>(), ...effects }));
import { workflowRouter } from "./workflow.js";

describe("旧合成页面不可先预扣再走新任务重复收费", () => {
  it.each(["music", "final_render"] as const)("普通用户旧 %s 预扣在读余额和扣款前要求刷新", async step => {
    const caller = workflowRouter.createCaller({ user: { id: 7, role: "user" } } as never);
    await expect(caller.chargeStep({ step, quantity: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(effects.getCredits).not.toHaveBeenCalled(); expect(effects.deductCreditsAmount).not.toHaveBeenCalled();
  });
});
