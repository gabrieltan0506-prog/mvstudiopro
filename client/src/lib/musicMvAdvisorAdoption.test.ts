import { describe, expect, it } from "vitest";
import type { MusicMvAdvisorSession } from "@shared/canvasMusicMv";
import { musicMvAdoptionFailure, musicMvAdoptionRequest } from "./musicMvAdvisor";

const FAILED_ID = "13aa4909-82b3-4405-bec2-4007d2cff805";
const SUCCESS_ID = "c1ee985b-c77c-4194-9bad-e09d1368ed19";
const EVIDENCE_ID = "7e70bc4d-c77e-4c07-a9c0-80ab78d99f62";

function session(over: Partial<MusicMvAdvisorSession> = {}): MusicMvAdvisorSession {
  return {
    requestId: SUCCESS_ID,
    projectId: "d31a3a49-45a4-4346-a4a8-571897c2c1d0",
    target: {
      sourceKey: "k",
      audio: { id: "song", url: "https://example.test/a.mp3", durationSec: 20 },
      lyrics: "",
      creativePrompt: "雨中归途",
      referenceSummaries: [],
      referenceKeys: [],
      footage: [],
    },
    question: "q",
    videoModel: "veo",
    status: "succeeded",
    proposal: {
      kind: "music_mv_v1",
      sourceKey: "k",
      evidenceId: EVIDENCE_ID,
      summaryZh: "s",
      sections: [],
      uncertaintiesZh: [],
      concepts: [{ id: "c1" }, { id: "c2" }],
    } as unknown as MusicMvAdvisorSession["proposal"],
    ...over,
  };
}

function trpcError(code: string, message: string) {
  return Object.assign(new Error(message), { data: { code } });
}

describe("MV顾问采用请求体与失败处理（1109 线上 bug）", () => {
  it("采用请求体的 advisorRequestId / evidenceId 只来自当前成功咨询", () => {
    const request = musicMvAdoptionRequest(session(), "c1");
    expect(request.advisorRequestId).toBe(SUCCESS_ID);
    expect(request.evidenceId).toBe(EVIDENCE_ID);
    expect(request.conceptId).toBe("c1");
    expect(request.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("同方案恢复沿用原采用编号；未成功会话或旧失败编号不得发起采用", () => {
    const adoption = { requestId: "91e65bed-666d-42bf-ab34-0e2316146b29", conceptId: "c1" };
    expect(musicMvAdoptionRequest(session({ adoption }), "c1").requestId).toBe(adoption.requestId);
    expect(() => musicMvAdoptionRequest(session({ adoption }), "c2")).toThrow(/恢复该方案/);
    expect(() => musicMvAdoptionRequest(session({ requestId: FAILED_ID, status: "failed" }), "c1")).toThrow(/重新发起咨询/);
    expect(() => musicMvAdoptionRequest(undefined, "c1")).toThrow(/重新发起咨询/);
    expect(() => musicMvAdoptionRequest(session({ proposal: { ...session().proposal!, evidenceId: undefined } }), "c1")).toThrow(/重新发起咨询/);
  });
  it("服务端明确拒绝（PRECONDITION_FAILED）后清掉采用锁定并提示重新咨询，允许再点", () => {
    const locked = session({ adoption: { requestId: "91e65bed-666d-42bf-ab34-0e2316146b29", conceptId: "c1" } });
    const failure = musicMvAdoptionFailure(trpcError("PRECONDITION_FAILED", "原顾问咨询尚未成功，请先查询原咨询"), locked);
    expect(failure.rejected).toBe(true);
    expect(failure.session.adoption).toBeUndefined();
    expect(failure.message).toMatch(/重新发起咨询/);
    // 清锁后任一方案都能重新发起采用，且仍指向成功那次咨询
    expect(musicMvAdoptionRequest(failure.session, "c2").advisorRequestId).toBe(SUCCESS_ID);
  });
  it("网络中断等不确定失败保留采用锁定，走幂等恢复", () => {
    const locked = session({ adoption: { requestId: "91e65bed-666d-42bf-ab34-0e2316146b29", conceptId: "c1" } });
    const failure = musicMvAdoptionFailure(new TypeError("Failed to fetch"), locked);
    expect(failure.rejected).toBe(false);
    expect(failure.session.adoption).toEqual(locked.adoption);
    expect(musicMvAdoptionRequest(failure.session, "c1").requestId).toBe(locked.adoption!.requestId);
  });
});
