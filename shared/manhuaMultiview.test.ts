import { describe, expect, it } from "vitest";
import {
  buildManhuaMultiviewPrompt,
  computeManhuaMultiviewVersion,
  evaluateManhuaMultiviewReadiness,
  gsUriFromSignedGcsUrl,
  mergeManhuaMultiviewDraft,
  normalizeManhuaMultiviewDraft,
  orderManhuaMultiviewViews,
  type ManhuaMultiviewDraftView,
} from "./manhuaMultiview";

const signed = (name: string) =>
  `https://storage.googleapis.com/mv-bucket/generated/canvas-gpt-image2/${name}.png?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=abc`;

function view(v: ManhuaMultiviewDraftView["view"], name: string = v, createdAt = 1): ManhuaMultiviewDraftView {
  return { view: v, url: signed(name), createdAt };
}

describe("manhuaMultiview", () => {
  it("签名链接还原 gs://，非 GCS 链接返回空", () => {
    expect(gsUriFromSignedGcsUrl(signed("front"))).toBe("gs://mv-bucket/generated/canvas-gpt-image2/front.png");
    expect(gsUriFromSignedGcsUrl("https://mv-bucket.storage.googleapis.com/a/b%20c.png?x=1")).toBe("gs://mv-bucket/a/b c.png");
    expect(gsUriFromSignedGcsUrl("https://cdn.example.com/x.png")).toBe("");
    expect(gsUriFromSignedGcsUrl("http://storage.googleapis.com/b/o.png")).toBe("");
    expect(gsUriFromSignedGcsUrl("not a url")).toBe("");
  });

  it("视角版本：签名轮换不变、重出一张即变、顺序固定前/左/后/右", () => {
    const a = [view("front"), view("left"), view("back"), view("right")];
    const b = a.map((v) => ({ ...v, url: v.url.replace("Signature=abc", "Signature=zzz") }));
    expect(computeManhuaMultiviewVersion(a)).toBe(computeManhuaMultiviewVersion(b));
    const c = [view("right"), view("back"), view("left"), view("front")];
    expect(computeManhuaMultiviewVersion(c)).toBe(computeManhuaMultiviewVersion(a));
    const d = [view("front"), view("left"), view("back"), view("right", "right-v2", 2)];
    expect(computeManhuaMultiviewVersion(d)).not.toBe(computeManhuaMultiviewVersion(a));
    expect(computeManhuaMultiviewVersion(a).length).toBeLessThanOrEqual(4_096);
  });

  it("超长身份退化为哈希且仍 ≤4096", () => {
    const long = MANHUA_VIEWS().map((v) => ({ view: v, url: `https://cdn.example.com/${"x".repeat(1_500)}/${v}.png`, createdAt: 1 }));
    const version = computeManhuaMultiviewVersion(long);
    expect(version.startsWith("mv1h:")).toBe(true);
    expect(version.length).toBeLessThanOrEqual(4_096);
  });

  it("同一视角保留最新一张并按顺序输出", () => {
    const ordered = orderManhuaMultiviewViews([view("left", "l1", 1), view("front"), view("left", "l2", 5)]);
    expect(ordered.map((v) => v.view)).toEqual(["front", "left"]);
    expect(ordered[1].url).toContain("l2");
  });

  it("就绪判定：缺正面拒、只一张拒、定妆图换版拒、2–4 张通过", () => {
    const sv = "gs://b/face.png";
    expect(evaluateManhuaMultiviewReadiness(undefined, sv)).toMatchObject({ ready: false });
    expect(evaluateManhuaMultiviewReadiness({ sourceVersion: sv, views: [view("left")], updatedAt: 1 }, sv)).toMatchObject({ ready: false, reasonZh: expect.stringContaining("正面") });
    expect(evaluateManhuaMultiviewReadiness({ sourceVersion: sv, views: [view("front")], updatedAt: 1 }, sv)).toMatchObject({ ready: false, missing: ["left", "back", "right"] });
    expect(evaluateManhuaMultiviewReadiness({ sourceVersion: "gs://b/other.png", views: [view("front"), view("left")], updatedAt: 1 }, sv)).toMatchObject({ ready: false, reasonZh: expect.stringContaining("已换") });
    const ok = evaluateManhuaMultiviewReadiness({ sourceVersion: sv, views: [view("front"), view("back")], updatedAt: 1 }, sv);
    expect(ok.ready).toBe(true);
    if (ok.ready) {
      expect(ok.views.map((v) => v.view)).toEqual(["front", "back"]);
      expect(ok.version.startsWith("mv1:")).toBe(true);
    }
  });

  it("归一化：坏视角/非 https 丢弃，全坏返回 undefined，gs:// 保留", () => {
    expect(normalizeManhuaMultiviewDraft(null)).toBeUndefined();
    expect(normalizeManhuaMultiviewDraft({ sourceVersion: "v", views: [{ view: "top", url: "https://a/x.png" }, { view: "front", url: "http://a/x.png" }] })).toBeUndefined();
    const d = normalizeManhuaMultiviewDraft({
      sourceVersion: "v",
      views: [{ view: "back", url: "https://a/b.png", gcsUri: "gs://a/b.png", createdAt: 3 }, { view: "front", url: "https://a/f.png", createdAt: "bad" }],
      updatedAt: 9,
    });
    expect(d).toEqual({
      sourceVersion: "v",
      updatedAt: 9,
      views: [
        { view: "front", url: "https://a/f.png", createdAt: 0 },
        { view: "back", url: "https://a/b.png", gcsUri: "gs://a/b.png", createdAt: 3 },
      ],
    });
  });

  it("合并：同版覆盖同视角保留其余，换版整组重来", () => {
    const sv = "gs://b/face.png";
    const d1 = mergeManhuaMultiviewDraft(undefined, sv, view("front"), 10);
    const d2 = mergeManhuaMultiviewDraft(d1, sv, view("left"), 11);
    const d3 = mergeManhuaMultiviewDraft(d2, sv, view("left", "left-v2", 12), 12);
    expect(d3.views.map((v) => v.view)).toEqual(["front", "left"]);
    expect(d3.views[1].url).toContain("left-v2");
    const d4 = mergeManhuaMultiviewDraft(d3, "gs://b/new-face.png", view("back"), 13);
    expect(d4.views.map((v) => v.view)).toEqual(["back"]);
    expect(d4.sourceVersion).toBe("gs://b/new-face.png");
  });

  it("提示词含视角说明、保持一致与白底正交约束", () => {
    const p = buildManhuaMultiviewPrompt("back", "墨屠");
    expect(p).toContain("「墨屠」");
    expect(p).toContain("背对镜头");
    expect(p).toContain("纯白背景");
    expect(p).toContain("完全一致");
    expect(buildManhuaMultiviewPrompt("front")).not.toContain("「");
  });
});

function MANHUA_VIEWS() {
  return ["front", "left", "back", "right"] as const;
}
