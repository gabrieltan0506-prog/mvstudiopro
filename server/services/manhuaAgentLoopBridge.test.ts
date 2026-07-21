import { describe, expect, it } from "vitest";
import {
  consumeManhuaAgentPendingAction,
  listManhuaAgentPendingActions,
  pushManhuaAgentPendingAction,
} from "./manhuaAgentLoopBridge";

describe("manhuaAgentLoopBridge pending actions", () => {
  it("queues and consumes host actions", () => {
    const sessionId = `test_${Date.now()}`;
    const action = pushManhuaAgentPendingAction({
      type: "generate_keyarts",
      sessionId,
      userId: 1,
      payload: { shotIndexes: [1, 2], billing: "host_jobs" },
    });
    expect(listManhuaAgentPendingActions(sessionId)).toHaveLength(1);
    const consumed = consumeManhuaAgentPendingAction(sessionId, action.id);
    expect(consumed?.id).toBe(action.id);
    expect(listManhuaAgentPendingActions(sessionId)).toHaveLength(0);
  });
});
