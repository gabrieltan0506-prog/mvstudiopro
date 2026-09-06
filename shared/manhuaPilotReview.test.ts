import { describe, expect, it } from "vitest";
import {
  assertManhuaPilotSubmissionAllowed,
  manhuaPilotScopeKey,
  manhuaPilotReviewStateSchema,
  manhuaPilotSubmissionSchema,
} from "./manhuaPilotReview";

const scope = {
  projectVersion: "a".repeat(64),
  episodeIndex: 1,
  videoModel: "seedance-2.5",
};
describe("服务端试片审批合同", () => {
  it("账号、项目正文版本、集号、引擎均进入身份，不信旧集号键", () => {
    const key = manhuaPilotScopeKey("alice", scope);
    expect(key).not.toBe(manhuaPilotScopeKey("bob", scope));
    expect(key).not.toBe(
      manhuaPilotScopeKey("alice", { ...scope, projectVersion: "b".repeat(64) })
    );
    expect(key).not.toBe(
      manhuaPilotScopeKey("alice", { ...scope, episodeIndex: 2 })
    );
    expect(key).not.toBe(
      manhuaPilotScopeKey("alice", { ...scope, videoModel: "wan-3.0" })
    );
    expect(() => manhuaPilotScopeKey("", scope)).toThrow();
  });
  it("没有成功产物或任务身份不能形成批准", () => {
    expect(
      manhuaPilotReviewStateSchema.safeParse({ status: "approved" }).success
    ).toBe(false);
    expect(
      manhuaPilotReviewStateSchema.safeParse({
        status: "approved",
        taskId: "old",
        outputUrl: "javascript:alert(1)",
      }).success
    ).toBe(false);
    expect(
      manhuaPilotSubmissionSchema.safeParse({
        projectVersion: "old-series",
        episodeIndex: 1,
        segmentIndex: 1,
        intent: "pilot",
      }).success
    ).toBe(false);
  });
  it("未批准只允许首段十秒", () => {
    expect(() =>
      assertManhuaPilotSubmissionAllowed(
        { status: "not_started" },
        { intent: "pilot", segmentIndex: 1 },
        10
      )
    ).not.toThrow();
    expect(() =>
      assertManhuaPilotSubmissionAllowed(
        { status: "not_started" },
        { intent: "pilot", segmentIndex: 2 },
        10
      )
    ).toThrow();
    expect(() =>
      assertManhuaPilotSubmissionAllowed(
        { status: "not_started" },
        { intent: "pilot", segmentIndex: 1 },
        30
      )
    ).toThrow();
    expect(() =>
      assertManhuaPilotSubmissionAllowed(
        { status: "not_started" },
        { intent: "full", segmentIndex: 1 },
        30
      )
    ).toThrow();
  });
  it.each(["submitting", "reconcile_manual", "generated", "approved"] as const)(
    "%s 时不能重烧试片",
    status => {
      expect(() =>
        assertManhuaPilotSubmissionAllowed(
          { status },
          { intent: "pilot", segmentIndex: 1 },
          10
        )
      ).toThrow();
    }
  );
  it("已批准才允许整段；退回后可显式重新试片", () => {
    expect(() =>
      assertManhuaPilotSubmissionAllowed(
        { status: "approved" },
        { intent: "full", segmentIndex: 3 },
        30
      )
    ).not.toThrow();
    expect(() =>
      assertManhuaPilotSubmissionAllowed(
        { status: "rejected" },
        { intent: "pilot", segmentIndex: 1 },
        10
      )
    ).not.toThrow();
  });
});
