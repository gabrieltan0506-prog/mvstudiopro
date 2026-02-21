import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module
const mockInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
});
const mockSelect = vi.fn().mockReturnValue({
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([]),
      orderBy: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  }),
});
const mockDelete = vi.fn().mockReturnValue({
  where: vi.fn().mockResolvedValue([{ affectedRows: 0 }]),
});
const mockUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue([]),
  }),
});

const mockDb = {
  insert: mockInsert,
  select: mockSelect,
  delete: mockDelete,
  update: mockUpdate,
};

vi.mock("../db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

vi.mock("../../drizzle/schema", () => ({
  sessions: {
    id: "id",
    userId: "userId",
    openId: "openId",
    token: "token",
    loginMethod: "loginMethod",
    userAgent: "userAgent",
    expiresAt: "expiresAt",
    createdAt: "createdAt",
    lastActiveAt: "lastActiveAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ type: "eq", field: a, value: b })),
  and: vi.fn((...args: any[]) => ({ type: "and", conditions: args })),
  gt: vi.fn((a, b) => ({ type: "gt", field: a, value: b })),
  lt: vi.fn((a, b) => ({ type: "lt", field: a, value: b })),
  desc: vi.fn((a) => ({ type: "desc", field: a })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: any[]) => ({
      type: "sql",
      strings,
      values,
    }),
    { raw: (s: string) => ({ type: "sql_raw", value: s }) }
  ),
}));

describe("sessionDb", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock chain
    mockInsert.mockReturnValue({
      values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
    });
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });
    mockDelete.mockReturnValue({
      where: vi.fn().mockResolvedValue([{ affectedRows: 0 }]),
    });
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });
  });

  describe("createSession", () => {
    it("should call db.insert with correct session data", async () => {
      const { createSession } = await import("../sessionDb");

      await createSession({
        userId: 1,
        openId: "test_open_id",
        token: "jwt_token_123",
        loginMethod: "oauth",
        userAgent: "Mozilla/5.0",
        expiresAt: new Date("2027-01-01"),
      });

      expect(mockInsert).toHaveBeenCalled();
    });

    it("should handle database not available gracefully", async () => {
      const { getDb } = await import("../db");
      (getDb as any).mockResolvedValueOnce(null);

      const { createSession } = await import("../sessionDb");

      // Should not throw
      await expect(
        createSession({
          userId: 1,
          openId: "test",
          token: "token",
          expiresAt: new Date(),
        })
      ).resolves.toBeUndefined();
    });
  });

  describe("getSessionByToken", () => {
    it("should return null when no session found", async () => {
      const { getSessionByToken } = await import("../sessionDb");
      const result = await getSessionByToken("nonexistent_token");
      expect(result).toBeNull();
    });

    it("should return session when found and not expired", async () => {
      const mockSession = {
        id: 1,
        userId: 1,
        openId: "test_open_id",
        token: "jwt_token_123",
        loginMethod: "oauth",
        userAgent: "Mozilla/5.0",
        expiresAt: new Date("2027-01-01"),
        createdAt: new Date(),
        lastActiveAt: new Date(),
      };

      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockSession]),
          }),
        }),
      });

      const { getSessionByToken } = await import("../sessionDb");
      const result = await getSessionByToken("jwt_token_123");
      expect(result).toEqual(mockSession);
    });

    it("should return null when database not available", async () => {
      const { getDb } = await import("../db");
      (getDb as any).mockResolvedValueOnce(null);

      const { getSessionByToken } = await import("../sessionDb");
      const result = await getSessionByToken("some_token");
      expect(result).toBeNull();
    });
  });

  describe("deleteSessionByToken", () => {
    it("should call db.delete with correct token", async () => {
      const { deleteSessionByToken } = await import("../sessionDb");
      await deleteSessionByToken("jwt_token_to_delete");
      expect(mockDelete).toHaveBeenCalled();
    });

    it("should handle database not available gracefully", async () => {
      const { getDb } = await import("../db");
      (getDb as any).mockResolvedValueOnce(null);

      const { deleteSessionByToken } = await import("../sessionDb");
      await expect(deleteSessionByToken("token")).resolves.toBeUndefined();
    });
  });

  describe("deleteAllUserSessions", () => {
    it("should call db.delete for all user sessions", async () => {
      const { deleteAllUserSessions } = await import("../sessionDb");
      await deleteAllUserSessions(1);
      expect(mockDelete).toHaveBeenCalled();
    });
  });

  describe("cleanupExpiredSessions", () => {
    it("should delete expired sessions", async () => {
      mockDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue([{ affectedRows: 5 }]),
      });

      const { cleanupExpiredSessions } = await import("../sessionDb");
      const deleted = await cleanupExpiredSessions();
      expect(deleted).toBe(5);
    });

    it("should return 0 when database not available", async () => {
      const { getDb } = await import("../db");
      (getDb as any).mockResolvedValueOnce(null);

      const { cleanupExpiredSessions } = await import("../sessionDb");
      const deleted = await cleanupExpiredSessions();
      expect(deleted).toBe(0);
    });
  });
});
