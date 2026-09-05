import { describe, expect, it } from "vitest";
import {
  applyManhuaFinalSubtitleBurnSuccess,
  beginManhuaFinalSubtitleBurn,
  listManhuaFinalVideoVersions,
  refreshManhuaFinalVersionIdentity,
  replaceManhuaFinalAssembleVersion,
  selectManhuaFinalVideoVersion,
  updateManhuaFinalSubtitleBurnStatus,
} from "./manhuaFinalPostProd";

const original = "https://cdn.example/final-original.mp4";

describe("manhuaFinalPostProd", () => {
  it("续签已烧字的 GCS 版本仍保留原片，不撤销同一媒体的质检或重写创建时间", () => {
    const completed = applyManhuaFinalSubtitleBurnSuccess(
      beginManhuaFinalSubtitleBurn(
        { id: "final-e01", outputUrl: original, outputUrls: [original] },
        { jobId: "pp-source-gcs", sourceUrl: original, sourceGcsUri: "gs://bucket/source.mp4" },
      ),
      { jobId: "pp-source-gcs", resultUrl: "https://cdn.example/burn.mp4?sig=old", resultGcsUri: "gs://bucket/burn.mp4", updatedAt: 20 },
    );
    const reviewed = { ...completed, manhuaClipQuality: { status: "passed" }, lastFrameUrl: "https://cdn.example/end.jpg" };
    const refreshed = applyManhuaFinalSubtitleBurnSuccess(reviewed, {
      jobId: "pp-source-gcs", resultUrl: "https://cdn.example/burn.mp4?sig=new", resultGcsUri: "gs://bucket/burn.mp4", updatedAt: 30,
    });
    expect(listManhuaFinalVideoVersions(refreshed)).toEqual(["https://cdn.example/burn.mp4?sig=new", original]);
    expect(refreshed.manhuaClipQuality).toEqual({ status: "passed" });
    expect(refreshed.lastFrameUrl).toBe("https://cdn.example/end.jpg");
    expect(refreshed.manhuaFinalVersions?.[0]?.createdAt).toBe(20);
  });

  it("原片续签后烧字，后续再次刷新烧字结果也不退回原片的过期签名", () => {
    const pending = beginManhuaFinalSubtitleBurn(
      { id: "final-e01", outputUrl: original, outputUrls: [original] },
      { jobId: "pp-source-renew", sourceUrl: original, sourceGcsUri: "gs://bucket/source.mp4" },
    );
    const renewedSource = "https://cdn.example/original-new.mp4";
    const first = applyManhuaFinalSubtitleBurnSuccess({ ...pending, outputUrl: renewedSource }, {
      jobId: "pp-source-renew", resultUrl: "https://cdn.example/burn-old.mp4", resultGcsUri: "gs://bucket/burn.mp4",
    });
    const second = applyManhuaFinalSubtitleBurnSuccess(first, {
      jobId: "pp-source-renew", resultUrl: "https://cdn.example/burn-new.mp4", resultGcsUri: "gs://bucket/burn.mp4",
    });
    expect(listManhuaFinalVideoVersions(second)).toEqual(["https://cdn.example/burn-new.mp4", renewedSource]);
  });

  it("promotes the matching burn result and keeps the original as a selectable version", () => {
    const pending = beginManhuaFinalSubtitleBurn(
      { id: "final-e01", status: "done", outputUrl: original, outputUrls: [original] },
      { jobId: "pp-1", sourceUrl: original, updatedAt: 10 },
    );
    const done = applyManhuaFinalSubtitleBurnSuccess(pending, {
      jobId: "pp-1",
      resultUrl: "https://signed.example/burned-v1.mp4",
      resultGcsUri: "gs://bucket/post-prod/u1/burned-v1.mp4",
      updatedAt: 20,
    });
    expect(done.outputUrl).toBe("https://signed.example/burned-v1.mp4");
    expect(done.outputUrls).toEqual([
      "https://signed.example/burned-v1.mp4",
      original,
    ]);
    expect(done.manhuaFinalPostProd?.resultGcsUri).toBe(
      "gs://bucket/post-prod/u1/burned-v1.mp4",
    );
  });

  it("does not let an older job overwrite a new final or a newer burn task", () => {
    const pending = beginManhuaFinalSubtitleBurn(
      { id: "final-e01", status: "done", outputUrl: original, outputUrls: [original] },
      { jobId: "pp-old", sourceUrl: original, updatedAt: 10 },
    );
    const newer = {
      ...pending,
      outputUrl: "https://cdn.example/new-assemble.mp4",
      manhuaFinalPostProd: {
        ...pending.manhuaFinalPostProd!,
        jobId: "pp-new",
      },
    };
    expect(
      applyManhuaFinalSubtitleBurnSuccess(newer, {
        jobId: "pp-old",
        resultUrl: "https://signed.example/stale.mp4",
        resultGcsUri: "gs://bucket/post-prod/u1/stale.mp4",
      }),
    ).toBe(newer);
  });

  it("keeps a late result in history when the user selected another version", () => {
    const pending = beginManhuaFinalSubtitleBurn(
      {
        id: "final-e01",
        status: "done",
        outputUrl: original,
        outputUrls: [original, "https://cdn.example/older.mp4"],
      },
      { jobId: "pp-1", sourceUrl: original },
    );
    const selected = selectManhuaFinalVideoVersion(pending, "https://cdn.example/older.mp4");
    const done = applyManhuaFinalSubtitleBurnSuccess(selected, {
      jobId: "pp-1",
      resultUrl: "https://signed.example/burned.mp4",
      resultGcsUri: "gs://bucket/post-prod/u1/burned.mp4",
    });
    expect(done.outputUrl).toBe("https://cdn.example/older.mp4");
    expect(done.outputUrls).toContain("https://signed.example/burned.mp4");
  });

  it("ignores stale status and clears QC on explicit version selection", () => {
    const pending = beginManhuaFinalSubtitleBurn(
      {
        id: "final-e01",
        status: "done",
        outputUrl: original,
        outputUrls: [original, "https://cdn.example/older.mp4"],
        manhuaClipQuality: { status: "passed" },
        lastFrameUrl: "https://cdn.example/tail.jpg",
      },
      { jobId: "pp-1", sourceUrl: original },
    );
    expect(
      updateManhuaFinalSubtitleBurnStatus(pending, {
        jobId: "wrong",
        status: "failed",
      }),
    ).toBe(pending);
    const selected = selectManhuaFinalVideoVersion(pending, "https://cdn.example/older.mp4");
    expect(selected.outputUrl).toBe("https://cdn.example/older.mp4");
    expect(selected.manhuaClipQuality).toBeUndefined();
    expect(selected.lastFrameUrl).toBeUndefined();
  });

  it("uses GCS identity rather than an expiring signed URL to recognize the selected source", () => {
    const sourceOld = "https://signed.example/source-old.mp4?sig=old";
    const pending = beginManhuaFinalSubtitleBurn(
      { id: "final-e01", status: "done", outputUrl: sourceOld, outputUrls: [sourceOld] },
      {
        jobId: "pp-2",
        sourceUrl: sourceOld,
        sourceGcsUri: "gs://bucket/post-prod/u1/source.mp4",
      },
    );
    const resigned = {
      ...pending,
      outputUrl: "https://signed.example/source-new.mp4?sig=new",
    };
    const done = applyManhuaFinalSubtitleBurnSuccess(resigned, {
      jobId: "pp-2",
      resultUrl: "https://signed.example/burned.mp4",
      resultGcsUri: "gs://bucket/post-prod/u1/burned.mp4",
    });
    expect(done.outputUrl).toBe("https://signed.example/burned.mp4");
    expect(done.outputUrls).not.toContain("https://signed.example/source-old.mp4?sig=old");
    expect(done.outputUrls).toContain("https://signed.example/source-new.mp4?sig=new");
  });

  it("refreshes the same GCS result without accumulating expired signed URLs", () => {
    const first = applyManhuaFinalSubtitleBurnSuccess(
      beginManhuaFinalSubtitleBurn(
        { id: "final-e01", outputUrl: original, outputUrls: [original] },
        { jobId: "pp-3", sourceUrl: original },
      ),
      {
        jobId: "pp-3",
        resultUrl: "https://signed.example/burned.mp4?sig=old",
        resultGcsUri: "gs://bucket/post-prod/u1/burned.mp4",
      },
    );
    const refreshed = applyManhuaFinalSubtitleBurnSuccess(first, {
      jobId: "pp-3",
      resultUrl: "https://signed.example/burned.mp4?sig=new",
      resultGcsUri: "gs://bucket/post-prod/u1/burned.mp4",
    });
    expect(refreshed.outputUrl).toBe("https://signed.example/burned.mp4?sig=new");
    expect(refreshed.outputUrls).toEqual([
      "https://signed.example/burned.mp4?sig=new",
      original,
    ]);
  });

  it("does not re-promote the subtitle result after the user switched back to original", () => {
    const completed = applyManhuaFinalSubtitleBurnSuccess(
      beginManhuaFinalSubtitleBurn(
        { id: "final-e01", outputUrl: original, outputUrls: [original] },
        { jobId: "pp-4", sourceUrl: original },
      ),
      {
        jobId: "pp-4",
        resultUrl: "https://signed.example/burned.mp4?sig=old",
        resultGcsUri: "gs://bucket/post-prod/u1/burned.mp4",
      },
    );
    const originalSelected = selectManhuaFinalVideoVersion(completed, original);
    const refreshed = applyManhuaFinalSubtitleBurnSuccess(originalSelected, {
      jobId: "pp-4",
      resultUrl: "https://signed.example/burned.mp4?sig=new",
      resultGcsUri: "gs://bucket/post-prod/u1/burned.mp4",
    });
    expect(refreshed.outputUrl).toBe(original);
    expect(refreshed.outputUrls).toContain("https://signed.example/burned.mp4?sig=new");
    expect(refreshed.outputUrls).not.toContain("https://signed.example/burned.mp4?sig=old");
  });

  it("does not truncate paid final versions", () => {
    const versions = Array.from(
      { length: 12 },
      (_, index) => `https://cdn.example/v${index + 1}.mp4`,
    );
    const selected = selectManhuaFinalVideoVersion(
      { id: "final-e01", outputUrl: versions[0], outputUrls: versions },
      versions[11],
    );
    expect(selected.outputUrls).toHaveLength(12);
    expect(selected.outputUrls).toContain(versions[0]);
  });

  it("a new assemble keeps an in-flight burn for late-result history without replacing the new current", () => {
    const pending = beginManhuaFinalSubtitleBurn(
      { id: "final-e01", outputUrl: original, outputUrls: [original] },
      { jobId: "pp-old", sourceUrl: original },
    );
    const next = replaceManhuaFinalAssembleVersion(
      pending,
      "https://cdn.example/new-assemble.mp4",
    );
    expect(next.outputUrl).toBe("https://cdn.example/new-assemble.mp4");
    expect(next.outputUrls).toEqual([
      "https://cdn.example/new-assemble.mp4",
      original,
    ]);
    expect(next.manhuaFinalPostProd).toMatchObject({
      jobId: "pp-old",
      status: "queued",
      sourceSelected: false,
    });
    const late = applyManhuaFinalSubtitleBurnSuccess(next, {
      jobId: "pp-old",
      resultUrl: "https://signed.example/late-burn.mp4",
      resultGcsUri: "gs://bucket/post-prod/u1/late-burn.mp4",
    });
    expect(late.outputUrl).toBe("https://cdn.example/new-assemble.mp4");
    expect(late.outputUrls).toContain("https://signed.example/late-burn.mp4");
    expect(late.manhuaFinalVersions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ jobId: "pp-old", origin: "burn_subtitle" }),
        expect.objectContaining({ origin: "assemble" }),
      ]),
    );
  });

  it("refreshes an older signed URL by its stored job and GCS identity without changing selection", () => {
    const current = "https://cdn.example/current.mp4";
    const oldSigned = "https://signed.example/burned.mp4?sig=old";
    const block = {
      id: "final-e01",
      outputUrl: current,
      outputUrls: [current, oldSigned],
      manhuaFinalVersions: [
        {
          origin: "burn_subtitle" as const,
          url: oldSigned,
          jobId: "pp-history",
          gcsUri: "gs://bucket/post-prod/u1/history.mp4",
          createdAt: 10,
        },
      ],
    };
    const refreshed = refreshManhuaFinalVersionIdentity(block, {
      jobId: "pp-history",
      resultUrl: "https://signed.example/burned.mp4?sig=new",
      resultGcsUri: "gs://bucket/post-prod/u1/history.mp4",
    });
    expect(refreshed.outputUrl).toBe(current);
    expect(refreshed.outputUrls).toEqual([
      current,
      "https://signed.example/burned.mp4?sig=new",
    ]);
    expect(refreshed.outputUrls).not.toContain(oldSigned);
  });
});
