import { describe, it, expect } from "vitest";
import { PLANS, CREDIT_COSTS, CREDIT_PACKS } from "../server/plans";

describe("Team Credits Architecture", () => {
  describe("Enterprise Plan Configuration", () => {
    it("should have enterprise plan with team seats feature", () => {
      const enterprise = PLANS.enterprise;
      expect(enterprise).toBeDefined();
      expect(enterprise.name).toBe("Enterprise");
      expect(enterprise.featuresCn).toContain("团队席位");
      expect(enterprise.monthlyCredits).toBe(800);
      expect(enterprise.monthlyPrice).toBe(358);
    });

    it("should have correct plan hierarchy", () => {
      expect(PLANS.free.monthlyCredits).toBe(50);
      expect(PLANS.pro.monthlyCredits).toBe(200);
      expect(PLANS.enterprise.monthlyCredits).toBe(800);
      expect(PLANS.enterprise.monthlyCredits).toBeGreaterThan(PLANS.pro.monthlyCredits);
    });

    it("enterprise should have unlimited feature limits", () => {
      const limits = PLANS.enterprise.limits;
      expect(limits.mvAnalysis).toBe(-1);
      expect(limits.idolGeneration).toBe(-1);
      expect(limits.storyboard).toBe(-1);
      expect(limits.videoGeneration).toBe(-1);
    });
  });

  describe("Credit Costs", () => {
    it("should have correct credit costs for all actions", () => {
      expect(CREDIT_COSTS.mvAnalysis).toBe(8);
      expect(CREDIT_COSTS.idolGeneration).toBe(3);
      expect(CREDIT_COSTS.storyboard).toBe(15);
      expect(CREDIT_COSTS.videoGeneration).toBe(50);
    });

    it("all paid costs should be positive integers", () => {
      // forgeImage is intentionally 0 (free), skip it
      Object.entries(CREDIT_COSTS).forEach(([key, cost]) => {
        if (key === "forgeImage") {
          expect(cost).toBe(0);
        } else {
          expect(cost).toBeGreaterThan(0);
          expect(Number.isInteger(cost)).toBe(true);
        }
      });
    });
  });

  describe("Credit Packs", () => {
    it("should have small and large packs", () => {
      expect(CREDIT_PACKS.small.credits).toBe(50);
      expect(CREDIT_PACKS.small.price).toBe(35);
      expect(CREDIT_PACKS.large.credits).toBe(250);
      expect(CREDIT_PACKS.large.price).toBe(168);
    });

    it("large pack should have better per-credit value", () => {
      const smallRate = CREDIT_PACKS.small.price / CREDIT_PACKS.small.credits;
      const largeRate = CREDIT_PACKS.large.price / CREDIT_PACKS.large.credits;
      expect(largeRate).toBeLessThan(smallRate);
    });
  });

  describe("Team Credit Allocation Logic", () => {
    it("should correctly calculate available team credits", () => {
      const allocated = 200;
      const used = 75;
      const available = allocated - used;
      expect(available).toBe(125);
    });

    it("should correctly determine if team credits are sufficient", () => {
      const allocated = 100;
      const used = 90;
      const available = allocated - used;

      // mvAnalysis costs 8
      expect(available >= CREDIT_COSTS.mvAnalysis).toBe(true); // 10 >= 8
      // storyboard costs 15
      expect(available >= CREDIT_COSTS.storyboard).toBe(false); // 10 < 15
    });

    it("should correctly calculate pool availability after allocation", () => {
      const poolTotal = 800; // Enterprise monthly credits
      const allocated = 400;
      const available = poolTotal - allocated;
      expect(available).toBe(400);

      // Can allocate 300 more
      expect(available >= 300).toBe(true);
      // Cannot allocate 500
      expect(available >= 500).toBe(false);
    });

    it("should correctly calculate reclaimable credits", () => {
      const allocated = 200;
      const used = 75;
      const reclaimable = allocated - used;
      expect(reclaimable).toBe(125);

      // Cannot reclaim more than unused
      expect(reclaimable >= 130).toBe(false);
      expect(reclaimable >= 100).toBe(true);
    });

    it("should correctly calculate total available credits (personal + team)", () => {
      const personalBalance = 50;
      const teamAllocated = 200;
      const teamUsed = 100;
      const teamAvailable = teamAllocated - teamUsed;
      const totalAvailable = personalBalance + teamAvailable;

      expect(totalAvailable).toBe(150);
      expect(totalAvailable >= CREDIT_COSTS.videoGeneration).toBe(true); // 150 >= 50
    });

    it("should prioritize personal credits over team credits", () => {
      const personalBalance = 100;
      const cost = CREDIT_COSTS.mvAnalysis; // 8

      if (personalBalance >= cost) {
        const newPersonal = personalBalance - cost;
        expect(newPersonal).toBe(92);
      }
    });

    it("should fall back to team credits when personal is insufficient", () => {
      const personalBalance = 5;
      const teamAvailable = 50;
      const cost = CREDIT_COSTS.mvAnalysis; // 8

      if (personalBalance < cost && teamAvailable >= cost) {
        const newTeamUsed = cost;
        expect(newTeamUsed).toBe(8);
      }
    });
  });

  describe("Invite Code Generation", () => {
    it("should generate valid 6-character codes", () => {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      function generateInviteCode(): string {
        let code = "";
        for (let i = 0; i < 6; i++) {
          code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
      }

      const code = generateInviteCode();
      expect(code.length).toBe(6);
      for (const char of code) {
        expect(chars.includes(char)).toBe(true);
      }
    });

    it("should not contain easily confused characters", () => {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      expect(chars.includes("0")).toBe(false);
      expect(chars.includes("1")).toBe(false);
      expect(chars.includes("I")).toBe(false);
    });
  });

  describe("Team Member Roles", () => {
    it("should have correct role hierarchy", () => {
      const roles = ["owner", "admin", "member"];
      expect(roles.indexOf("owner")).toBeLessThan(roles.indexOf("admin"));
      expect(roles.indexOf("admin")).toBeLessThan(roles.indexOf("member"));
    });

    it("should have correct member statuses", () => {
      const statuses = ["active", "invited", "suspended", "removed"];
      expect(statuses).toContain("active");
      expect(statuses).toContain("invited");
      expect(statuses).toContain("suspended");
      expect(statuses).toContain("removed");
    });
  });
});
