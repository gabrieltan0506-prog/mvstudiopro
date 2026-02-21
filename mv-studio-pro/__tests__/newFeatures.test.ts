import { describe, it, expect } from "vitest";

// ─── Test NBP Engine Selector Logic ──────────────────
describe("NBP Engine Selector Logic", () => {
  const ENGINE_OPTIONS = [
    { id: "forge", label: "Forge 標準", cost: 0, resolution: "1024×1024", minPlan: "free" },
    { id: "nbp_2k", label: "NBP 2K 高清", cost: 3, resolution: "2048×2048", minPlan: "pro" },
    { id: "nbp_4k", label: "NBP 4K 超清", cost: 8, resolution: "4096×4096", minPlan: "pro" },
  ];

  it("should have forge as free option with zero cost", () => {
    const forge = ENGINE_OPTIONS.find((e) => e.id === "forge");
    expect(forge).toBeDefined();
    expect(forge!.cost).toBe(0);
    expect(forge!.minPlan).toBe("free");
  });

  it("should have NBP 2K at 3 credits", () => {
    const nbp2k = ENGINE_OPTIONS.find((e) => e.id === "nbp_2k");
    expect(nbp2k).toBeDefined();
    expect(nbp2k!.cost).toBe(3);
    expect(nbp2k!.resolution).toBe("2048×2048");
  });

  it("should have NBP 4K at 8 credits", () => {
    const nbp4k = ENGINE_OPTIONS.find((e) => e.id === "nbp_4k");
    expect(nbp4k).toBeDefined();
    expect(nbp4k!.cost).toBe(8);
    expect(nbp4k!.resolution).toBe("4096×4096");
  });

  it("should require pro plan for NBP options", () => {
    const nbpOptions = ENGINE_OPTIONS.filter((e) => e.id.startsWith("nbp_"));
    expect(nbpOptions.length).toBe(2);
    nbpOptions.forEach((opt) => {
      expect(opt.minPlan).toBe("pro");
    });
  });

  // Test plan access logic
  function canAccessEngine(engineId: string, userPlan: string): boolean {
    const engine = ENGINE_OPTIONS.find((e) => e.id === engineId);
    if (!engine) return false;
    if (engine.minPlan === "free") return true;
    const planHierarchy = ["free", "starter", "pro", "enterprise"];
    return planHierarchy.indexOf(userPlan) >= planHierarchy.indexOf(engine.minPlan);
  }

  it("free users can only access forge", () => {
    expect(canAccessEngine("forge", "free")).toBe(true);
    expect(canAccessEngine("nbp_2k", "free")).toBe(false);
    expect(canAccessEngine("nbp_4k", "free")).toBe(false);
  });

  it("pro users can access all engines", () => {
    expect(canAccessEngine("forge", "pro")).toBe(true);
    expect(canAccessEngine("nbp_2k", "pro")).toBe(true);
    expect(canAccessEngine("nbp_4k", "pro")).toBe(true);
  });

  it("starter users cannot access NBP", () => {
    expect(canAccessEngine("forge", "starter")).toBe(true);
    expect(canAccessEngine("nbp_2k", "starter")).toBe(false);
    expect(canAccessEngine("nbp_4k", "starter")).toBe(false);
  });
});

// ─── Test Showcase Score Tier Logic ──────────────────
describe("Showcase Score Tier Logic", () => {
  function getScoreTier(score: number): { label: string; color: string } {
    if (score >= 95) return { label: "傳奇爆款", color: "#FFD60A" };
    if (score >= 90) return { label: "超級爆款", color: "#FF6B35" };
    return { label: "爆款", color: "#30D158" };
  }

  it("should return 傳奇爆款 for score >= 95", () => {
    expect(getScoreTier(95).label).toBe("傳奇爆款");
    expect(getScoreTier(100).label).toBe("傳奇爆款");
    expect(getScoreTier(99).label).toBe("傳奇爆款");
  });

  it("should return 超級爆款 for score 90-94", () => {
    expect(getScoreTier(90).label).toBe("超級爆款");
    expect(getScoreTier(94).label).toBe("超級爆款");
    expect(getScoreTier(92).label).toBe("超級爆款");
  });

  it("should return 爆款 for score < 90", () => {
    expect(getScoreTier(89).label).toBe("爆款");
    expect(getScoreTier(80).label).toBe("爆款");
    expect(getScoreTier(50).label).toBe("爆款");
  });
});

// ─── Test Showcase Sort Logic ──────────────────
describe("Showcase Sort Logic", () => {
  const mockVideos = [
    { id: 1, viralScore: 92, createdAt: "2026-02-15T10:00:00Z", title: "A" },
    { id: 2, viralScore: 97, createdAt: "2026-02-10T10:00:00Z", title: "B" },
    { id: 3, viralScore: 90, createdAt: "2026-02-18T10:00:00Z", title: "C" },
    { id: 4, viralScore: 95, createdAt: "2026-02-12T10:00:00Z", title: "D" },
  ];

  it("should sort by score descending", () => {
    const sorted = [...mockVideos].sort((a, b) => b.viralScore - a.viralScore);
    expect(sorted[0].viralScore).toBe(97);
    expect(sorted[1].viralScore).toBe(95);
    expect(sorted[2].viralScore).toBe(92);
    expect(sorted[3].viralScore).toBe(90);
  });

  it("should sort by date descending (most recent first)", () => {
    const sorted = [...mockVideos].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    expect(sorted[0].title).toBe("C"); // Feb 18
    expect(sorted[1].title).toBe("A"); // Feb 15
    expect(sorted[2].title).toBe("D"); // Feb 12
    expect(sorted[3].title).toBe("B"); // Feb 10
  });
});

// ─── Test My Videos Status Display Logic ──────────────
describe("My Videos Status Logic", () => {
  function getStatusInfo(status: string): { label: string; color: string } {
    switch (status) {
      case "pending": return { label: "待審核", color: "#F59E0B" };
      case "analyzing": return { label: "分析中", color: "#64D2FF" };
      case "scored": return { label: "已評分", color: "#30D158" };
      case "rejected": return { label: "已拒絕", color: "#FF453A" };
      case "manual_review": return { label: "人工複審", color: "#FF9F0A" };
      default: return { label: "未知", color: "#999" };
    }
  }

  it("should return correct status labels", () => {
    expect(getStatusInfo("pending").label).toBe("待審核");
    expect(getStatusInfo("analyzing").label).toBe("分析中");
    expect(getStatusInfo("scored").label).toBe("已評分");
    expect(getStatusInfo("rejected").label).toBe("已拒絕");
    expect(getStatusInfo("manual_review").label).toBe("人工複審");
  });

  it("should return unknown for invalid status", () => {
    expect(getStatusInfo("invalid").label).toBe("未知");
    expect(getStatusInfo("").label).toBe("未知");
  });

  // Test credits reward calculation
  function calculateReward(score: number | null): number {
    if (score === null) return 0;
    if (score >= 90) return 80;
    if (score >= 80) return 30;
    return 0;
  }

  it("should award 80 credits for score >= 90", () => {
    expect(calculateReward(90)).toBe(80);
    expect(calculateReward(95)).toBe(80);
    expect(calculateReward(100)).toBe(80);
  });

  it("should award 30 credits for score 80-89", () => {
    expect(calculateReward(80)).toBe(30);
    expect(calculateReward(85)).toBe(30);
    expect(calculateReward(89)).toBe(30);
  });

  it("should award 0 credits for score < 80", () => {
    expect(calculateReward(79)).toBe(0);
    expect(calculateReward(50)).toBe(0);
    expect(calculateReward(0)).toBe(0);
  });

  it("should award 0 credits for null score", () => {
    expect(calculateReward(null)).toBe(0);
  });
});

// ─── Test Platform Info Mapping ──────────────────
describe("Platform Info Mapping", () => {
  const PLATFORM_INFO: Record<string, { name: string; color: string }> = {
    douyin: { name: "抖音", color: "#FE2C55" },
    weixin_channels: { name: "視頻號", color: "#FA9D3B" },
    xiaohongshu: { name: "小紅書", color: "#FF2442" },
    bilibili: { name: "B站", color: "#00A1D6" },
  };

  it("should have all 4 platforms defined", () => {
    expect(Object.keys(PLATFORM_INFO)).toHaveLength(4);
  });

  it("should map douyin correctly", () => {
    expect(PLATFORM_INFO.douyin.name).toBe("抖音");
  });

  it("should map weixin_channels correctly", () => {
    expect(PLATFORM_INFO.weixin_channels.name).toBe("視頻號");
  });

  it("should map xiaohongshu correctly", () => {
    expect(PLATFORM_INFO.xiaohongshu.name).toBe("小紅書");
  });

  it("should map bilibili correctly", () => {
    expect(PLATFORM_INFO.bilibili.name).toBe("B站");
  });
});
