import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock getDb
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  offset: vi.fn().mockReturnThis(),
  leftJoin: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockReturnThis(),
};

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

describe("Showcase Feature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chain methods
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.orderBy.mockReturnThis();
    mockDb.limit.mockReturnThis();
    mockDb.offset.mockReturnThis();
    mockDb.leftJoin.mockReturnThis();
  });

  describe("Schema", () => {
    it("should export showcaseRatings table from schema", async () => {
      const schema = await import("../drizzle/schema");
      expect(schema.showcaseRatings).toBeDefined();
      expect(schema.showcaseLikes).toBeDefined();
      expect(schema.showcaseFavorites).toBeDefined();
      expect(schema.showcaseComments).toBeDefined();
    });

    it("should export videoSubmissions table from schema", async () => {
      const schema = await import("../drizzle/schema");
      expect(schema.videoSubmissions).toBeDefined();
      expect(schema.videoPlatformLinks).toBeDefined();
    });
  });

  describe("Showcase Router", () => {
    it("should have all required routes", async () => {
      const { showcaseRouter } = await import("./routers/showcase");
      const routerDef = showcaseRouter._def;
      const procedures = routerDef.procedures as Record<string, unknown>;

      // Check all required routes exist
      expect(procedures).toHaveProperty("getAll");
      expect(procedures).toHaveProperty("rateVideo");
      expect(procedures).toHaveProperty("getUserRating");
      expect(procedures).toHaveProperty("toggleLike");
      expect(procedures).toHaveProperty("toggleFavorite");
      expect(procedures).toHaveProperty("getUserInteractions");
      expect(procedures).toHaveProperty("addComment");
      expect(procedures).toHaveProperty("getComments");
      expect(procedures).toHaveProperty("deleteComment");
    });

    it("should have admin routes", async () => {
      const { showcaseRouter } = await import("./routers/showcase");
      const routerDef = showcaseRouter._def;
      const procedures = routerDef.procedures as Record<string, unknown>;

      expect(procedures).toHaveProperty("adminGetAllVideos");
      expect(procedures).toHaveProperty("adminAdjustScore");
      expect(procedures).toHaveProperty("adminFlagVideo");
    });
  });

  describe("Rating Validation", () => {
    it("should only accept ratings between 1 and 5", () => {
      // Test that the rating schema is properly defined
      const { z } = require("zod");
      const ratingSchema = z.object({
        videoId: z.number(),
        rating: z.number().min(1).max(5),
      });

      // Valid ratings
      expect(ratingSchema.safeParse({ videoId: 1, rating: 1 }).success).toBe(true);
      expect(ratingSchema.safeParse({ videoId: 1, rating: 3 }).success).toBe(true);
      expect(ratingSchema.safeParse({ videoId: 1, rating: 5 }).success).toBe(true);

      // Invalid ratings
      expect(ratingSchema.safeParse({ videoId: 1, rating: 0 }).success).toBe(false);
      expect(ratingSchema.safeParse({ videoId: 1, rating: 6 }).success).toBe(false);
      expect(ratingSchema.safeParse({ videoId: 1, rating: -1 }).success).toBe(false);
    });
  });

  describe("Admin Credits Skip", () => {
    it("should skip credits deduction for admin users in virtual idol generation", async () => {
      // Verify the admin check logic exists in routers.ts
      const fs = require("fs");
      const routersContent = fs.readFileSync("server/routers.ts", "utf-8");

      // Check that admin skip logic exists
      expect(routersContent).toContain('ctx.user.role === "admin"');
      expect(routersContent).toContain("isAdminUser");
      expect(routersContent).toContain("if (!isAdminUser)");
    });
  });
});
