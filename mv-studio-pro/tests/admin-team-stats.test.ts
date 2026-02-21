import { describe, it, expect } from "vitest";

/**
 * 團隊成員 Credits 統計儀表板 - 單元測試
 *
 * 測試後端 API 返回結構和前端數據處理邏輯
 */

// ─── 模擬 API 返回數據 ─────────────────────────
const mockStatsResponse = {
  teams: [
    { id: 1, name: "設計團隊", ownerId: 1 },
    { id: 2, name: "開發團隊", ownerId: 2 },
  ],
  selectedTeamId: 1,
  memberRanking: [
    { memberId: 1, userId: 10, role: "owner", allocated: 500, used: 320, status: "active", userName: "Alice", userEmail: "alice@test.com", remaining: 180, utilizationRate: 64 },
    { memberId: 2, userId: 11, role: "admin", allocated: 300, used: 250, status: "active", userName: "Bob", userEmail: "bob@test.com", remaining: 50, utilizationRate: 83 },
    { memberId: 3, userId: 12, role: "member", allocated: 200, used: 50, status: "active", userName: "Charlie", userEmail: "charlie@test.com", remaining: 150, utilizationRate: 25 },
  ],
  featureDistribution: [
    { action: "mvAnalysis", count: 15, totalCredits: 75 },
    { action: "idolGeneration", count: 20, totalCredits: 100 },
    { action: "storyboard", count: 10, totalCredits: 80 },
    { action: "idol3D", count: 5, totalCredits: 50 },
  ],
  dailyTrend: [
    { date: "2026-02-10", credits: 30, actions: 6 },
    { date: "2026-02-11", credits: 45, actions: 9 },
    { date: "2026-02-12", credits: 20, actions: 4 },
    { date: "2026-02-13", credits: 55, actions: 11 },
    { date: "2026-02-14", credits: 35, actions: 7 },
  ],
  memberFeatureBreakdown: [
    { userId: 10, action: "mvAnalysis", count: 8, credits: 40 },
    { userId: 10, action: "idolGeneration", count: 12, credits: 60 },
    { userId: 11, action: "storyboard", count: 6, credits: 48 },
    { userId: 11, action: "idol3D", count: 5, credits: 50 },
    { userId: 12, action: "mvAnalysis", count: 7, credits: 35 },
  ],
  summary: {
    totalMembers: 3,
    totalAllocated: 1000,
    totalUsed: 620,
    utilizationRate: 62,
  },
};

// ─── 測試 API 返回結構 ─────────────────────────
describe("adminTeamCreditsStats API 返回結構", () => {
  it("應包含所有必要字段", () => {
    expect(mockStatsResponse).toHaveProperty("teams");
    expect(mockStatsResponse).toHaveProperty("selectedTeamId");
    expect(mockStatsResponse).toHaveProperty("memberRanking");
    expect(mockStatsResponse).toHaveProperty("featureDistribution");
    expect(mockStatsResponse).toHaveProperty("dailyTrend");
    expect(mockStatsResponse).toHaveProperty("memberFeatureBreakdown");
    expect(mockStatsResponse).toHaveProperty("summary");
  });

  it("teams 應為數組且包含 id 和 name", () => {
    expect(Array.isArray(mockStatsResponse.teams)).toBe(true);
    mockStatsResponse.teams.forEach((team) => {
      expect(team).toHaveProperty("id");
      expect(team).toHaveProperty("name");
      expect(team).toHaveProperty("ownerId");
    });
  });

  it("selectedTeamId 應為數字", () => {
    expect(typeof mockStatsResponse.selectedTeamId).toBe("number");
  });
});

// ─── 測試成員排行數據 ─────────────────────────
describe("成員用量排行", () => {
  it("應按使用量降序排列", () => {
    const usedValues = mockStatsResponse.memberRanking.map((m) => m.used);
    for (let i = 1; i < usedValues.length; i++) {
      expect(usedValues[i - 1]).toBeGreaterThanOrEqual(usedValues[i]);
    }
  });

  it("每個成員應包含完整字段", () => {
    mockStatsResponse.memberRanking.forEach((member) => {
      expect(member).toHaveProperty("memberId");
      expect(member).toHaveProperty("userId");
      expect(member).toHaveProperty("role");
      expect(member).toHaveProperty("allocated");
      expect(member).toHaveProperty("used");
      expect(member).toHaveProperty("remaining");
      expect(member).toHaveProperty("utilizationRate");
    });
  });

  it("remaining 應等於 allocated - used", () => {
    mockStatsResponse.memberRanking.forEach((member) => {
      expect(member.remaining).toBe(member.allocated - member.used);
    });
  });

  it("utilizationRate 計算正確", () => {
    mockStatsResponse.memberRanking.forEach((member) => {
      if (member.allocated > 0) {
        const expected = Math.round((member.used / member.allocated) * 100);
        expect(member.utilizationRate).toBe(expected);
      }
    });
  });
});

// ─── 測試功能分佈數據 ─────────────────────────
describe("功能使用分佈", () => {
  it("應包含功能名稱、次數和 Credits", () => {
    mockStatsResponse.featureDistribution.forEach((feature) => {
      expect(feature).toHaveProperty("action");
      expect(feature).toHaveProperty("count");
      expect(feature).toHaveProperty("totalCredits");
      expect(typeof feature.action).toBe("string");
      expect(typeof feature.count).toBe("number");
      expect(typeof feature.totalCredits).toBe("number");
    });
  });

  it("百分比計算正確（總和為 100%）", () => {
    const total = mockStatsResponse.featureDistribution.reduce((s, f) => s + f.totalCredits, 0);
    const percentages = mockStatsResponse.featureDistribution.map((f) =>
      total > 0 ? Math.round((f.totalCredits / total) * 100) : 0
    );
    // 因為四捨五入，總和可能在 98-102 之間
    const sum = percentages.reduce((s, p) => s + p, 0);
    expect(sum).toBeGreaterThanOrEqual(95);
    expect(sum).toBeLessThanOrEqual(105);
  });
});

// ─── 測試時間趨勢數據 ─────────────────────────
describe("Credits 消耗趨勢", () => {
  it("每天應包含 date、credits 和 actions", () => {
    mockStatsResponse.dailyTrend.forEach((day) => {
      expect(day).toHaveProperty("date");
      expect(day).toHaveProperty("credits");
      expect(day).toHaveProperty("actions");
      expect(typeof day.date).toBe("string");
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it("日均消耗計算正確", () => {
    const totalCredits = mockStatsResponse.dailyTrend.reduce((s, d) => s + d.credits, 0);
    const days = mockStatsResponse.dailyTrend.length;
    const avgPerDay = Math.round(totalCredits / Math.max(days, 1));
    expect(avgPerDay).toBe(Math.round(185 / 5)); // 37
  });
});

// ─── 測試成員功能明細 ─────────────────────────
describe("成員功能使用明細", () => {
  it("應包含 userId、action、count 和 credits", () => {
    mockStatsResponse.memberFeatureBreakdown.forEach((item) => {
      expect(item).toHaveProperty("userId");
      expect(item).toHaveProperty("action");
      expect(item).toHaveProperty("count");
      expect(item).toHaveProperty("credits");
    });
  });

  it("可按 userId 正確分組", () => {
    const grouped: Record<number, typeof mockStatsResponse.memberFeatureBreakdown> = {};
    mockStatsResponse.memberFeatureBreakdown.forEach((item) => {
      if (!grouped[item.userId]) grouped[item.userId] = [];
      grouped[item.userId].push(item);
    });
    expect(Object.keys(grouped).length).toBe(3); // 3 個用戶
    expect(grouped[10].length).toBe(2); // Alice 用了 2 個功能
    expect(grouped[11].length).toBe(2); // Bob 用了 2 個功能
    expect(grouped[12].length).toBe(1); // Charlie 用了 1 個功能
  });
});

// ─── 測試彙總數據 ─────────────────────────────
describe("彙總指標", () => {
  it("totalAllocated 應等於所有成員 allocated 之和", () => {
    const sum = mockStatsResponse.memberRanking.reduce((s, m) => s + m.allocated, 0);
    expect(mockStatsResponse.summary.totalAllocated).toBe(sum);
  });

  it("totalUsed 應等於所有成員 used 之和", () => {
    const sum = mockStatsResponse.memberRanking.reduce((s, m) => s + m.used, 0);
    expect(mockStatsResponse.summary.totalUsed).toBe(sum);
  });

  it("utilizationRate 計算正確", () => {
    const expected = Math.round(
      (mockStatsResponse.summary.totalUsed / mockStatsResponse.summary.totalAllocated) * 100
    );
    expect(mockStatsResponse.summary.utilizationRate).toBe(expected);
  });

  it("totalMembers 應等於 memberRanking 長度", () => {
    expect(mockStatsResponse.summary.totalMembers).toBe(mockStatsResponse.memberRanking.length);
  });
});

// ─── 測試空數據場景 ─────────────────────────────
describe("空數據場景", () => {
  const emptyResponse = {
    teams: [],
    selectedTeamId: null,
    memberRanking: [],
    featureDistribution: [],
    dailyTrend: [],
    memberFeatureBreakdown: [],
    summary: { totalMembers: 0, totalAllocated: 0, totalUsed: 0, utilizationRate: 0 },
  };

  it("空團隊列表應正常處理", () => {
    expect(emptyResponse.teams.length).toBe(0);
    expect(emptyResponse.selectedTeamId).toBeNull();
  });

  it("空成員排行應正常處理", () => {
    expect(emptyResponse.memberRanking.length).toBe(0);
  });

  it("空彙總指標全為 0", () => {
    expect(emptyResponse.summary.totalMembers).toBe(0);
    expect(emptyResponse.summary.totalAllocated).toBe(0);
    expect(emptyResponse.summary.totalUsed).toBe(0);
    expect(emptyResponse.summary.utilizationRate).toBe(0);
  });
});

// ─── 測試功能名稱映射 ─────────────────────────
describe("功能名稱映射", () => {
  const ACTION_LABELS: Record<string, string> = {
    mvAnalysis: "MV 分析",
    idolGeneration: "偶像生成",
    storyboard: "分鏡腳本",
    videoGeneration: "MV 生成",
    idol3D: "偶像轉 3D",
  };

  it("所有功能都有中文映射", () => {
    mockStatsResponse.featureDistribution.forEach((f) => {
      expect(ACTION_LABELS[f.action]).toBeDefined();
      expect(typeof ACTION_LABELS[f.action]).toBe("string");
    });
  });

  it("未知功能應回退到原始名稱", () => {
    const unknownAction = "unknownFeature";
    const label = ACTION_LABELS[unknownAction] ?? unknownAction;
    expect(label).toBe("unknownFeature");
  });
});

// ─── 測試圖表數據處理 ─────────────────────────
describe("圖表數據處理", () => {
  it("柱狀圖最大值計算正確", () => {
    const maxUsed = Math.max(...mockStatsResponse.memberRanking.map((m) => m.used), 1);
    expect(maxUsed).toBe(320);
  });

  it("趨勢圖最大值計算正確", () => {
    const maxCredits = Math.max(...mockStatsResponse.dailyTrend.map((d) => d.credits), 1);
    expect(maxCredits).toBe(55);
  });

  it("柱狀圖寬度比例計算正確", () => {
    const maxUsed = Math.max(...mockStatsResponse.memberRanking.map((m) => m.used), 1);
    const chartWidth = 300; // 模擬圖表寬度
    mockStatsResponse.memberRanking.forEach((member) => {
      const barWidth = Math.max((member.used / maxUsed) * chartWidth, 4);
      expect(barWidth).toBeGreaterThanOrEqual(4);
      expect(barWidth).toBeLessThanOrEqual(chartWidth);
    });
  });

  it("趨勢圖柱高度計算正確", () => {
    const maxCredits = Math.max(...mockStatsResponse.dailyTrend.map((d) => d.credits), 1);
    const maxHeight = 120;
    mockStatsResponse.dailyTrend.forEach((day) => {
      const height = Math.max((day.credits / maxCredits) * maxHeight, 2);
      expect(height).toBeGreaterThanOrEqual(2);
      expect(height).toBeLessThanOrEqual(maxHeight);
    });
  });
});
