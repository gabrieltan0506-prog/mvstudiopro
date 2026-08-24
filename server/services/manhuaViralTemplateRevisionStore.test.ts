import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManhuaViralTemplateCard } from "../../shared/manhuaViralTemplateBank";

const uploads: Array<{ objectName: string; body: ManhuaViralTemplateCard }> = [];

function originalCard(): ManhuaViralTemplateCard {
  return {
    id: "tpl_series_ownerfixture",
    nameZh: "原模板",
    laneZh: "系统觉醒",
    summaryZh: "原摘要",
    hook3sZh: "原钩子",
    beatGrid: [{ atSec: 0, conflictZh: "原冲突", visualZh: "原画面" }],
    scenePoolHints: ["山门"],
    castShape: { leadDesireZh: "活下来", pressureZh: "追杀" },
    densityHints: { minBodyChars: 280, minDialogueLines: 8, minLocationHits: 2 },
    sourceRefs: [{ url: "https://example.com/source", fetchedAt: "2026-08-16" }],
    status: "approved",
    publicCode: "A7F2",
    approvedAt: "2026-08-16T00:00:00.000Z",
  };
}

function revisionCard(): ManhuaViralTemplateCard {
  return {
    ...originalCard(),
    id: "tpl_revision_1234567890abcdef",
    nameZh: "优化模板",
    hook3sZh: "优化钩子",
    status: "proposed",
    publicCode: undefined,
    approvedAt: undefined,
    revision: {
      parentTemplateId: "tpl_series_ownerfixture",
      requestId: "request_owner_1234",
      model: "deepseek_v4_0813_high",
      modelName: "deepseek/deepseek-v4-pro-0813",
      reasoningEffort: "high",
      promptZh: "强化前三秒。",
      changedFields: ["nameZh", "hook3sZh"],
      reasons: [
        { field: "nameZh", reasonZh: "名称更清楚。" },
        { field: "hook3sZh", reasonZh: "强化前三秒。" },
      ],
      createdByUserId: 7,
      createdAt: "2026-08-17T00:00:00.000Z",
    },
  };
}

/**
 * 批准现在要占**生命周期锁**（与下架/恢复互斥），锁走 GCS 条件创建，
 * 所以 mock 必须让它拿得到也放得掉，否则批准会卡在「另一项操作正在处理」。
 */
const LOCK_OBJECT = "manhua-template-learn/locks/approved-lifecycle.json";
const lockState = vi.hoisted(() => ({ body: Buffer.from("{}"), held: false })) as {
  body: Buffer;
  held: boolean;
};

vi.mock("./gcs.js", () => ({
  getGcsBucketName: () => "b",
  uploadBufferToGcsIfAbsent: vi.fn(async (p: { objectName: string; buffer: Buffer }) => {
    if (p.objectName === LOCK_OBJECT) {
      if (lockState.held) return { created: false };
      lockState.held = true;
      lockState.body = p.buffer;
      return { created: true };
    }
    return { created: true };
  }),
  downloadGcsObjectVersioned: vi.fn(async ({ gcsUri }: { gcsUri: string }) => {
    if (String(gcsUri).endsWith(LOCK_OBJECT)) {
      return { buffer: lockState.body, generation: "1" };
    }
    return {
      buffer: Buffer.from(JSON.stringify(originalCard()), "utf8"),
      bucket: "b",
      objectName: "o",
      generation: "7",
    };
  }),
  deleteGcsObject: vi.fn(async (p: { objectName?: string }) => {
    if (p.objectName === LOCK_OBJECT) lockState.held = false;
  }),
  downloadGcsObject: vi.fn(async ({ gcsUri }: { gcsUri: string }) => ({
    buffer: Buffer.from(
      JSON.stringify(gcsUri.includes("/proposals/") ? revisionCard() : originalCard()),
      "utf8",
    ),
  })),
  listGcsObjectNamesByPrefix: vi.fn(async () => []),
  uploadBufferToGcs: vi.fn(async ({ objectName, buffer }: { objectName: string; buffer: Buffer }) => {
    uploads.push({ objectName, body: JSON.parse(buffer.toString("utf8")) as ManhuaViralTemplateCard });
    return { bucket: "b", objectName, gcsUri: `gs://b/${objectName}` };
  }),
}));

import {
  approveManhuaViralTemplate,
  saveManhuaViralTemplateRevisionProposal,
} from "./manhuaViralTemplateStore";

beforeEach(() => uploads.splice(0, uploads.length));

describe("模板优化修订存储", () => {
  it("优化结果只写 proposals，不覆盖 approved", async () => {
    const saved = await saveManhuaViralTemplateRevisionProposal(revisionCard());
    expect(saved.revision?.parentTemplateId).toBe("tpl_series_ownerfixture");
    expect(uploads.map((item) => item.objectName)).toEqual([
      "manhua-template-learn/proposals/tpl_revision_1234567890abcdef.json",
    ]);
  });

  it("批准修订时先归档旧版，再按原 id 与公开码替换正式模板", async () => {
    const approved = await approveManhuaViralTemplate({ id: "tpl_revision_1234567890abcdef" });
    expect(approved).toMatchObject({
      id: "tpl_series_ownerfixture",
      nameZh: "优化模板",
      hook3sZh: "优化钩子",
      publicCode: "A7F2",
      status: "approved",
    });
    expect(approved.revision).toBeUndefined();
    expect(approved.sourceRefs).toEqual(originalCard().sourceRefs);
    expect(uploads[0]?.objectName).toMatch(
      /^manhua-template-learn\/archive\/tpl_series_ownerfixture\/\d{17}\.json$/,
    );
    expect(uploads[0]?.body.nameZh).toBe("原模板");
    expect(uploads[1]?.objectName).toBe(
      "manhua-template-learn/approved/tpl_series_ownerfixture.json",
    );
    expect(uploads[1]?.body.nameZh).toBe("优化模板");
    expect(uploads[2]?.objectName).toBe(
      "manhua-template-learn/proposals/tpl_revision_1234567890abcdef.json",
    );
    expect(uploads[2]?.body.status).toBe("approved");
  });
});
