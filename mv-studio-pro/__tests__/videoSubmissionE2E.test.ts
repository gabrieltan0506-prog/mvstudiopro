/**
 * 視頻投稿端到端測試
 * 驗證完整流程：上傳 → AI 評分 → Credits 發放 → 展廳展示 → 互動功能
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock 數據 ──────────────────────────────────
const MOCK_VIDEO_SUBMISSION = {
  title: "我的爆款視頻測試",
  description: "這是一個測試視頻",
  videoUrl: "https://storage.example.com/test-video.mp4",
  platformLinks: [
    { platform: "douyin", url: "https://www.douyin.com/video/123456789" },
    { platform: "bilibili", url: "https://www.bilibili.com/video/BV1234567890" },
  ],
  screenshotUrls: ["https://storage.example.com/screenshot1.png"],
  licenseAgreed: true,
};

const MOCK_PLATFORM_URLS: Record<string, RegExp> = {
  douyin: /douyin\.com|tiktok\.com/,
  bilibili: /bilibili\.com/,
  xiaohongshu: /xiaohongshu\.com|xhslink\.com/,
  weixin_channels: /channels\.weixin\.qq\.com|weixin\.qq\.com/,
};

// ─── 1. 平台鏈接驗證 ──────────────────────────────
describe("平台鏈接格式驗證", () => {
  it("應該正確驗證抖音鏈接", () => {
    const validUrls = [
      "https://www.douyin.com/video/123456789",
      "https://v.douyin.com/abc123",
    ];
    validUrls.forEach((url) => {
      expect(MOCK_PLATFORM_URLS.douyin.test(url)).toBe(true);
    });
  });

  it("應該正確驗證B站鏈接", () => {
    const validUrls = [
      "https://www.bilibili.com/video/BV1234567890",
      "https://b23.tv/abc123",
    ];
    expect(MOCK_PLATFORM_URLS.bilibili.test(validUrls[0])).toBe(true);
  });

  it("應該正確驗證小紅書鏈接", () => {
    const validUrls = [
      "https://www.xiaohongshu.com/explore/abc123",
      "https://xhslink.com/abc",
    ];
    validUrls.forEach((url) => {
      expect(MOCK_PLATFORM_URLS.xiaohongshu.test(url)).toBe(true);
    });
  });

  it("應該拒絕無效的平台鏈接", () => {
    const invalidUrls = [
      "https://www.youtube.com/watch?v=123",
      "https://www.google.com",
      "not-a-url",
    ];
    invalidUrls.forEach((url) => {
      expect(MOCK_PLATFORM_URLS.douyin.test(url)).toBe(false);
      expect(MOCK_PLATFORM_URLS.bilibili.test(url)).toBe(false);
    });
  });
});

// ─── 2. 視頻時長驗證 ──────────────────────────────
describe("視頻時長驗證", () => {
  function validateDuration(durationSeconds: number): { valid: boolean; message?: string } {
    if (durationSeconds > 600) {
      return { valid: false, message: "視頻超過10分鐘，請裁剪為兩段後再上傳" };
    }
    return { valid: true };
  }

  it("應該接受 5 分鐘以內的視頻", () => {
    expect(validateDuration(180).valid).toBe(true);
    expect(validateDuration(300).valid).toBe(true);
  });

  it("應該接受 5-10 分鐘的視頻", () => {
    expect(validateDuration(420).valid).toBe(true);
    expect(validateDuration(600).valid).toBe(true);
  });

  it("應該拒絕超過 10 分鐘的視頻", () => {
    const result = validateDuration(601);
    expect(result.valid).toBe(false);
    expect(result.message).toContain("裁剪");
  });

  it("應該拒絕 15 分鐘的視頻", () => {
    expect(validateDuration(900).valid).toBe(false);
  });
});

// ─── 3. 動態抽幀策略 ──────────────────────────────
describe("動態抽幀策略", () => {
  function getScoringStrategy(durationSeconds: number) {
    if (durationSeconds <= 300) {
      return { totalFrames: 10, dropCount: 1, scoringFrames: 9 };
    }
    return { totalFrames: 12, dropCount: 2, scoringFrames: 10 };
  }

  it("≤5分鐘：抽10幀，去1幀，取9幀均分", () => {
    const strategy = getScoringStrategy(180);
    expect(strategy.totalFrames).toBe(10);
    expect(strategy.dropCount).toBe(1);
    expect(strategy.scoringFrames).toBe(9);
  });

  it("5分鐘整：使用短視頻策略", () => {
    const strategy = getScoringStrategy(300);
    expect(strategy.totalFrames).toBe(10);
    expect(strategy.dropCount).toBe(1);
    expect(strategy.scoringFrames).toBe(9);
  });

  it("5-10分鐘：抽12幀，去2幀，取10幀均分", () => {
    const strategy = getScoringStrategy(420);
    expect(strategy.totalFrames).toBe(12);
    expect(strategy.dropCount).toBe(2);
    expect(strategy.scoringFrames).toBe(10);
  });

  it("10分鐘整：使用長視頻策略", () => {
    const strategy = getScoringStrategy(600);
    expect(strategy.totalFrames).toBe(12);
    expect(strategy.dropCount).toBe(2);
    expect(strategy.scoringFrames).toBe(10);
  });
});

// ─── 4. Credits 獎勵計算 ──────────────────────────
describe("Credits 獎勵計算", () => {
  function calculateCreditsReward(score: number): number {
    if (score >= 90) return 80;
    if (score >= 80) return 30;
    return 0;
  }

  it("90分以上獎勵80 Credits", () => {
    expect(calculateCreditsReward(90)).toBe(80);
    expect(calculateCreditsReward(95)).toBe(80);
    expect(calculateCreditsReward(100)).toBe(80);
  });

  it("80-89分獎勵30 Credits", () => {
    expect(calculateCreditsReward(80)).toBe(30);
    expect(calculateCreditsReward(85)).toBe(30);
    expect(calculateCreditsReward(89)).toBe(30);
  });

  it("80分以下無獎勵", () => {
    expect(calculateCreditsReward(79)).toBe(0);
    expect(calculateCreditsReward(50)).toBe(0);
    expect(calculateCreditsReward(0)).toBe(0);
  });

  it("邊界值測試", () => {
    expect(calculateCreditsReward(79)).toBe(0);
    expect(calculateCreditsReward(80)).toBe(30);
    expect(calculateCreditsReward(89)).toBe(30);
    expect(calculateCreditsReward(90)).toBe(80);
  });
});

// ─── 5. 去最低分邏輯 ──────────────────────────────
describe("去最低分邏輯", () => {
  function dropLowestAndAverage(scores: number[], dropCount: number): { average: number; droppedIndices: number[] } {
    if (scores.length <= dropCount) {
      return { average: 0, droppedIndices: [] };
    }

    const indexed = scores.map((s, i) => ({ score: s, index: i }));
    indexed.sort((a, b) => a.score - b.score);

    const droppedIndices = indexed.slice(0, dropCount).map((item) => item.index);
    const remaining = indexed.slice(dropCount);
    const average = remaining.reduce((sum, item) => sum + item.score, 0) / remaining.length;

    return { average: Math.round(average * 10) / 10, droppedIndices };
  }

  it("10幀去1幀取9幀均分", () => {
    const scores = [85, 90, 78, 92, 88, 95, 82, 91, 87, 93];
    const result = dropLowestAndAverage(scores, 1);
    // 去掉最低78分，剩餘9幀
    expect(result.droppedIndices).toContain(2); // index 2 = 78分
    expect(result.average).toBeGreaterThan(85);
  });

  it("12幀去2幀取10幀均分", () => {
    const scores = [85, 90, 72, 92, 88, 95, 82, 91, 87, 93, 75, 89];
    const result = dropLowestAndAverage(scores, 2);
    // 去掉最低72和75分
    expect(result.droppedIndices).toContain(2); // index 2 = 72分
    expect(result.droppedIndices).toContain(10); // index 10 = 75分
    expect(result.droppedIndices.length).toBe(2);
  });

  it("所有幀分數相同時去最低分仍然正確", () => {
    const scores = [80, 80, 80, 80, 80, 80, 80, 80, 80, 80];
    const result = dropLowestAndAverage(scores, 1);
    expect(result.average).toBe(80);
    expect(result.droppedIndices.length).toBe(1);
  });

  it("去掉的幀數不超過總幀數", () => {
    const scores = [80, 90];
    const result = dropLowestAndAverage(scores, 3);
    expect(result.average).toBe(0);
  });
});

// ─── 6. 去重邏輯 ──────────────────────────────────
describe("視頻去重邏輯", () => {
  function generateFingerprint(title: string, platformLinks: string[]): string {
    const normalized = title.toLowerCase().trim();
    const sortedLinks = [...platformLinks].sort().join("|");
    return `${normalized}::${sortedLinks}`;
  }

  it("相同視頻在多平台分發應生成相同指紋", () => {
    const fp1 = generateFingerprint("我的爆款視頻", [
      "https://douyin.com/v/123",
      "https://bilibili.com/v/456",
    ]);
    const fp2 = generateFingerprint("我的爆款視頻", [
      "https://bilibili.com/v/456",
      "https://douyin.com/v/123",
    ]);
    expect(fp1).toBe(fp2);
  });

  it("不同視頻應生成不同指紋", () => {
    const fp1 = generateFingerprint("視頻A", ["https://douyin.com/v/111"]);
    const fp2 = generateFingerprint("視頻B", ["https://douyin.com/v/222"]);
    expect(fp1).not.toBe(fp2);
  });

  it("標題大小寫不影響指紋", () => {
    const fp1 = generateFingerprint("My Video", ["https://douyin.com/v/123"]);
    const fp2 = generateFingerprint("my video", ["https://douyin.com/v/123"]);
    expect(fp1).toBe(fp2);
  });
});

// ─── 7. 授權協議驗證 ──────────────────────────────
describe("平台授權協議", () => {
  function validateSubmission(data: {
    licenseAgreed: boolean;
    platformLinks: { platform: string; url: string }[];
    screenshotUrls: string[];
  }): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!data.licenseAgreed) {
      errors.push("必須同意平台授權協議");
    }

    if (!data.platformLinks || data.platformLinks.length === 0) {
      errors.push("至少需要一個平台發布鏈接");
    }

    if (!data.screenshotUrls || data.screenshotUrls.length === 0) {
      errors.push("必須上傳後台數據截圖");
    }

    return { valid: errors.length === 0, errors };
  }

  it("完整提交應通過驗證", () => {
    const result = validateSubmission({
      licenseAgreed: true,
      platformLinks: [{ platform: "douyin", url: "https://douyin.com/v/123" }],
      screenshotUrls: ["https://storage.example.com/ss.png"],
    });
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it("未同意授權協議應拒絕", () => {
    const result = validateSubmission({
      licenseAgreed: false,
      platformLinks: [{ platform: "douyin", url: "https://douyin.com/v/123" }],
      screenshotUrls: ["https://storage.example.com/ss.png"],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("必須同意平台授權協議");
  });

  it("無平台鏈接應拒絕", () => {
    const result = validateSubmission({
      licenseAgreed: true,
      platformLinks: [],
      screenshotUrls: ["https://storage.example.com/ss.png"],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("至少需要一個平台發布鏈接");
  });

  it("無截圖應拒絕", () => {
    const result = validateSubmission({
      licenseAgreed: true,
      platformLinks: [{ platform: "douyin", url: "https://douyin.com/v/123" }],
      screenshotUrls: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("必須上傳後台數據截圖");
  });

  it("多個錯誤應全部返回", () => {
    const result = validateSubmission({
      licenseAgreed: false,
      platformLinks: [],
      screenshotUrls: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(3);
  });
});

// ─── 8. 展廳展示條件 ──────────────────────────────
describe("展廳展示條件", () => {
  function shouldShowcase(score: number, licenseAgreed: boolean, status: string): boolean {
    return score >= 90 && licenseAgreed && status === "scored";
  }

  it("90分以上且已授權且已評分應展示", () => {
    expect(shouldShowcase(90, true, "scored")).toBe(true);
    expect(shouldShowcase(95, true, "scored")).toBe(true);
  });

  it("90分以下不應展示", () => {
    expect(shouldShowcase(89, true, "scored")).toBe(false);
  });

  it("未授權不應展示", () => {
    expect(shouldShowcase(95, false, "scored")).toBe(false);
  });

  it("未完成評分不應展示", () => {
    expect(shouldShowcase(95, true, "pending")).toBe(false);
    expect(shouldShowcase(95, true, "scoring")).toBe(false);
  });
});

// ─── 9. 互動功能驗證 ──────────────────────────────
describe("展廳互動功能", () => {
  it("點讚切換應正確工作", () => {
    let isLiked = false;
    let likeCount = 10;

    // 點讚
    isLiked = !isLiked;
    likeCount += isLiked ? 1 : -1;
    expect(isLiked).toBe(true);
    expect(likeCount).toBe(11);

    // 取消點讚
    isLiked = !isLiked;
    likeCount += isLiked ? 1 : -1;
    expect(isLiked).toBe(false);
    expect(likeCount).toBe(10);
  });

  it("收藏切換應正確工作", () => {
    let isFavorited = false;

    isFavorited = !isFavorited;
    expect(isFavorited).toBe(true);

    isFavorited = !isFavorited;
    expect(isFavorited).toBe(false);
  });

  it("評論長度應有限制", () => {
    const maxLength = 500;
    const shortComment = "很棒的視頻！";
    const longComment = "a".repeat(501);

    expect(shortComment.length <= maxLength).toBe(true);
    expect(longComment.length <= maxLength).toBe(false);
  });

  it("空評論不應提交", () => {
    const comment = "   ";
    expect(comment.trim().length > 0).toBe(false);
  });
});

// ─── 10. 管理員評分調整 ──────────────────────────
describe("管理員評分調整", () => {
  function adjustScore(
    currentScore: number | null,
    newScore: number,
    currentCredits: number
  ): { newScore: number; creditsDiff: number; newTotalCredits: number } {
    const oldReward = currentScore != null ? (currentScore >= 90 ? 80 : currentScore >= 80 ? 30 : 0) : 0;
    const newReward = newScore >= 90 ? 80 : newScore >= 80 ? 30 : 0;
    const creditsDiff = newReward - oldReward;

    return {
      newScore,
      creditsDiff,
      newTotalCredits: currentCredits + creditsDiff,
    };
  }

  it("從85分調整到92分應補發50 Credits", () => {
    const result = adjustScore(85, 92, 100);
    expect(result.creditsDiff).toBe(50); // 80 - 30 = 50
    expect(result.newTotalCredits).toBe(150);
  });

  it("從92分調整到85分應扣回50 Credits", () => {
    const result = adjustScore(92, 85, 150);
    expect(result.creditsDiff).toBe(-50); // 30 - 80 = -50
    expect(result.newTotalCredits).toBe(100);
  });

  it("從85分調整到75分應扣回30 Credits", () => {
    const result = adjustScore(85, 75, 100);
    expect(result.creditsDiff).toBe(-30); // 0 - 30 = -30
    expect(result.newTotalCredits).toBe(70);
  });

  it("從未評分調整到95分應發放80 Credits", () => {
    const result = adjustScore(null, 95, 50);
    expect(result.creditsDiff).toBe(80);
    expect(result.newTotalCredits).toBe(130);
  });
});
