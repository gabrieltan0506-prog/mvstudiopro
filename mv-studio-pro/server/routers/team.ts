import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  teams,
  teamMembers,
  teamCreditAllocations,
  teamActivityLogs,
  users,
  stripeCustomers,
  creditBalances,
} from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";

// ─── 生成 6 位邀请码 ────────────────────────────
function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 排除易混淆字符
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// ─── 验证企业版用户 ────────────────────────────
async function requireEnterprise(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const customer = await db
    .select()
    .from(stripeCustomers)
    .where(eq(stripeCustomers.userId, userId))
    .limit(1);

  // 允许 enterprise 用户或 admin 用户
  if (customer.length > 0 && customer[0].plan === "enterprise") return true;

  // 也允许系统管理员
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (user.length > 0 && user[0].role === "admin") return true;

  throw new Error("此功能仅限企业版用户使用");
}

// ─── 验证团队管理员权限 ─────────────────────────
async function requireTeamAdmin(teamId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const team = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (team.length === 0) throw new Error("团队不存在");

  // 团队拥有者
  if (team[0].ownerId === userId) return { team: team[0], role: "owner" as const };

  // 团队管理员
  const member = await db
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.userId, userId),
        eq(teamMembers.status, "active")
      )
    )
    .limit(1);

  if (member.length > 0 && (member[0].role === "owner" || member[0].role === "admin")) {
    return { team: team[0], role: member[0].role };
  }

  throw new Error("您没有管理此团队的权限");
}

// ─── 记录活动日志 ──────────────────────────────
async function logActivity(
  teamId: number,
  userId: number,
  action: string,
  targetUserId?: number,
  description?: string,
  metadata?: Record<string, unknown>
) {
  const db = await getDb();
  if (!db) return;
  await db.insert(teamActivityLogs).values({
    teamId,
    userId,
    action,
    targetUserId: targetUserId ?? null,
    description: description ?? null,
    metadata: metadata ? JSON.stringify(metadata) : null,
  });
}

export const teamRouter = router({
  // ─── 创建团队 ──────────────────────────────────
  createTeam: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      await requireEnterprise(userId);

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // 检查是否已有团队
      const existing = await db
        .select()
        .from(teams)
        .where(eq(teams.ownerId, userId))
        .limit(1);
      if (existing.length > 0) {
        throw new Error("您已拥有一个团队，每个企业帐号只能创建一个团队");
      }

      // 生成唯一邀请码
      let inviteCode = generateInviteCode();
      let attempts = 0;
      while (attempts < 10) {
        const dup = await db
          .select()
          .from(teams)
          .where(eq(teams.inviteCode, inviteCode))
          .limit(1);
        if (dup.length === 0) break;
        inviteCode = generateInviteCode();
        attempts++;
      }

      // 创建团队
      await db.insert(teams).values({
        name: input.name,
        ownerId: userId,
        inviteCode,
        creditPool: 0,
        creditAllocated: 0,
        maxMembers: 10,
      });

      const newTeam = await db
        .select()
        .from(teams)
        .where(eq(teams.ownerId, userId))
        .limit(1);

      // 将拥有者加为成员
      await db.insert(teamMembers).values({
        teamId: newTeam[0].id,
        userId,
        role: "owner",
        status: "active",
        joinedAt: new Date(),
      });

      await logActivity(newTeam[0].id, userId, "team_created", undefined, `团队「${input.name}」已创建`);

      return {
        team: newTeam[0],
        inviteCode,
      };
    }),

  // ─── 获取我的团队 ──────────────────────────────
  getMyTeam: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const userId = ctx.user.id;

    // 先查是否为团队拥有者
    let team = await db
      .select()
      .from(teams)
      .where(eq(teams.ownerId, userId))
      .limit(1);

    // 如果不是拥有者，查是否为成员
    if (team.length === 0) {
      const membership = await db
        .select()
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.userId, userId),
            eq(teamMembers.status, "active")
          )
        )
        .limit(1);

      if (membership.length > 0) {
        team = await db
          .select()
          .from(teams)
          .where(eq(teams.id, membership[0].teamId))
          .limit(1);
      }
    }

    if (team.length === 0) return null;

    // 获取成员列表
    const members = await db
      .select({
        id: teamMembers.id,
        userId: teamMembers.userId,
        role: teamMembers.role,
        allocatedCredits: teamMembers.allocatedCredits,
        usedCredits: teamMembers.usedCredits,
        status: teamMembers.status,
        joinedAt: teamMembers.joinedAt,
        invitedAt: teamMembers.invitedAt,
        userName: users.name,
        userEmail: users.email,
      })
      .from(teamMembers)
      .leftJoin(users, eq(teamMembers.userId, users.id))
      .where(eq(teamMembers.teamId, team[0].id))
      .orderBy(teamMembers.createdAt);

    // 当前用户的成员记录
    const myMembership = members.find((m) => m.userId === userId);

    return {
      team: team[0],
      members: members.map((m) => ({
        ...m,
        joinedAt: m.joinedAt?.toISOString() ?? null,
        invitedAt: m.invitedAt?.toISOString() ?? null,
      })),
      myRole: myMembership?.role ?? (team[0].ownerId === userId ? "owner" : null),
      isOwner: team[0].ownerId === userId,
    };
  }),

  // ─── 邀请成员（通过 Email） ────────────────────
  inviteMember: protectedProcedure
    .input(
      z.object({
        teamId: z.number(),
        email: z.string().email(),
        role: z.enum(["admin", "member"]).default("member"),
        initialCredits: z.number().min(0).max(10000).default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const { team } = await requireTeamAdmin(input.teamId, userId);

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // 检查成员上限
      const memberCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, input.teamId),
            sql`${teamMembers.status} IN ('active', 'invited')`
          )
        );
      if ((memberCount[0]?.count ?? 0) >= team.maxMembers) {
        throw new Error(`团队成员已达上限（${team.maxMembers} 人）`);
      }

      // 查找用户
      const targetUser = await db
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (targetUser.length === 0) {
        throw new Error("找不到此 Email 对应的用户，请确认对方已注册");
      }

      // 检查是否已是成员
      const existingMember = await db
        .select()
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, input.teamId),
            eq(teamMembers.userId, targetUser[0].id)
          )
        )
        .limit(1);

      if (existingMember.length > 0) {
        if (existingMember[0].status === "active" || existingMember[0].status === "invited") {
          throw new Error("此用户已是团队成员或已被邀请");
        }
        // 重新邀请已移除的成员
        await db
          .update(teamMembers)
          .set({ status: "invited", role: input.role, invitedAt: new Date() })
          .where(eq(teamMembers.id, existingMember[0].id));
      } else {
        await db.insert(teamMembers).values({
          teamId: input.teamId,
          userId: targetUser[0].id,
          role: input.role,
          status: "invited",
          allocatedCredits: input.initialCredits,
          usedCredits: 0,
        });
      }

      // 如果有初始分配额度，更新团队已分配数
      if (input.initialCredits > 0) {
        const available = team.creditPool - team.creditAllocated;
        if (input.initialCredits > available) {
          throw new Error(`Credits 池余额不足。可用: ${available}, 需要: ${input.initialCredits}`);
        }
        await db
          .update(teams)
          .set({ creditAllocated: team.creditAllocated + input.initialCredits })
          .where(eq(teams.id, input.teamId));
      }

      await logActivity(
        input.teamId,
        userId,
        "member_invited",
        targetUser[0].id,
        `邀请 ${targetUser[0].name ?? targetUser[0].email} 加入团队`,
        { email: input.email, role: input.role, initialCredits: input.initialCredits }
      );

      return { success: true, message: `已邀请 ${input.email} 加入团队` };
    }),

  // ─── 接受邀请 ──────────────────────────────────
  acceptInvite: protectedProcedure
    .input(z.object({ teamId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const member = await db
        .select()
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, input.teamId),
            eq(teamMembers.userId, ctx.user.id),
            eq(teamMembers.status, "invited")
          )
        )
        .limit(1);

      if (member.length === 0) throw new Error("未找到待处理的邀请");

      await db
        .update(teamMembers)
        .set({ status: "active", joinedAt: new Date() })
        .where(eq(teamMembers.id, member[0].id));

      await logActivity(input.teamId, ctx.user.id, "member_joined", undefined, "成员接受邀请加入团队");

      return { success: true };
    }),

  // ─── 通过邀请码加入 ────────────────────────────
  joinByCode: protectedProcedure
    .input(z.object({ inviteCode: z.string().length(6) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const team = await db
        .select()
        .from(teams)
        .where(eq(teams.inviteCode, input.inviteCode.toUpperCase()))
        .limit(1);

      if (team.length === 0) throw new Error("邀请码无效");

      // 检查是否已是成员
      const existing = await db
        .select()
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, team[0].id),
            eq(teamMembers.userId, ctx.user.id)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        if (existing[0].status === "active") throw new Error("您已是此团队成员");
        if (existing[0].status === "invited") {
          // 直接接受
          await db
            .update(teamMembers)
            .set({ status: "active", joinedAt: new Date() })
            .where(eq(teamMembers.id, existing[0].id));
          return { success: true, teamName: team[0].name };
        }
        // 重新加入
        await db
          .update(teamMembers)
          .set({ status: "active", joinedAt: new Date() })
          .where(eq(teamMembers.id, existing[0].id));
        return { success: true, teamName: team[0].name };
      }

      // 检查成员上限
      const memberCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, team[0].id),
            sql`${teamMembers.status} IN ('active', 'invited')`
          )
        );
      if ((memberCount[0]?.count ?? 0) >= team[0].maxMembers) {
        throw new Error("团队成员已达上限");
      }

      await db.insert(teamMembers).values({
        teamId: team[0].id,
        userId: ctx.user.id,
        role: "member",
        status: "active",
        joinedAt: new Date(),
      });

      await logActivity(team[0].id, ctx.user.id, "member_joined", undefined, "通过邀请码加入团队");

      return { success: true, teamName: team[0].name };
    }),

  // ─── 分配 Credits 给成员 ───────────────────────
  allocateCredits: protectedProcedure
    .input(
      z.object({
        teamId: z.number(),
        memberId: z.number(), // team_members.id
        amount: z.number().min(1).max(10000),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const { team } = await requireTeamAdmin(input.teamId, userId);

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // 获取成员
      const member = await db
        .select()
        .from(teamMembers)
        .where(
          and(eq(teamMembers.id, input.memberId), eq(teamMembers.teamId, input.teamId))
        )
        .limit(1);

      if (member.length === 0) throw new Error("成员不存在");
      if (member[0].status !== "active") throw new Error("成员状态异常，无法分配");

      // 检查可用额度
      const available = team.creditPool - team.creditAllocated;
      if (input.amount > available) {
        throw new Error(`Credits 池余额不足。可用: ${available}, 需要: ${input.amount}`);
      }

      const newAllocated = member[0].allocatedCredits + input.amount;

      // 更新成员额度
      await db
        .update(teamMembers)
        .set({ allocatedCredits: newAllocated })
        .where(eq(teamMembers.id, input.memberId));

      // 更新团队已分配数
      await db
        .update(teams)
        .set({ creditAllocated: team.creditAllocated + input.amount })
        .where(eq(teams.id, input.teamId));

      // 记录分配历史
      await db.insert(teamCreditAllocations).values({
        teamId: input.teamId,
        memberId: input.memberId,
        allocatedBy: userId,
        amount: input.amount,
        balanceAfter: newAllocated,
        note: input.note ?? null,
      });

      // 获取成员用户名
      const targetUser = await db
        .select()
        .from(users)
        .where(eq(users.id, member[0].userId))
        .limit(1);

      await logActivity(
        input.teamId,
        userId,
        "credits_allocated",
        member[0].userId,
        `分配 ${input.amount} Credits 给 ${targetUser[0]?.name ?? "成员"}`,
        { amount: input.amount, balanceAfter: newAllocated }
      );

      return { success: true, newBalance: newAllocated };
    }),

  // ─── 回收成员 Credits ──────────────────────────
  reclaimCredits: protectedProcedure
    .input(
      z.object({
        teamId: z.number(),
        memberId: z.number(),
        amount: z.number().min(1),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const { team } = await requireTeamAdmin(input.teamId, userId);

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const member = await db
        .select()
        .from(teamMembers)
        .where(
          and(eq(teamMembers.id, input.memberId), eq(teamMembers.teamId, input.teamId))
        )
        .limit(1);

      if (member.length === 0) throw new Error("成员不存在");

      const unused = member[0].allocatedCredits - member[0].usedCredits;
      if (input.amount > unused) {
        throw new Error(`只能回收未使用的 Credits。可回收: ${unused}`);
      }

      const newAllocated = member[0].allocatedCredits - input.amount;

      await db
        .update(teamMembers)
        .set({ allocatedCredits: newAllocated })
        .where(eq(teamMembers.id, input.memberId));

      await db
        .update(teams)
        .set({ creditAllocated: team.creditAllocated - input.amount })
        .where(eq(teams.id, input.teamId));

      await db.insert(teamCreditAllocations).values({
        teamId: input.teamId,
        memberId: input.memberId,
        allocatedBy: userId,
        amount: -input.amount,
        balanceAfter: newAllocated,
        note: input.note ?? `回收 ${input.amount} Credits`,
      });

      await logActivity(
        input.teamId,
        userId,
        "credits_reclaimed",
        member[0].userId,
        `回收 ${input.amount} Credits`,
        { amount: input.amount, balanceAfter: newAllocated }
      );

      return { success: true, newBalance: newAllocated };
    }),

  // ─── 充值团队 Credits 池 ──────────────────────
  fundPool: protectedProcedure
    .input(
      z.object({
        teamId: z.number(),
        amount: z.number().min(1).max(100000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const { team } = await requireTeamAdmin(input.teamId, userId);

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // 从拥有者的个人 Credits 余额转入团队池
      const ownerBalance = await db
        .select()
        .from(creditBalances)
        .where(eq(creditBalances.userId, team.ownerId))
        .limit(1);

      if (ownerBalance.length === 0 || ownerBalance[0].balance < input.amount) {
        throw new Error(`个人 Credits 余额不足。可用: ${ownerBalance[0]?.balance ?? 0}`);
      }

      // 扣除拥有者余额
      await db
        .update(creditBalances)
        .set({
          balance: ownerBalance[0].balance - input.amount,
          lifetimeSpent: ownerBalance[0].lifetimeSpent + input.amount,
        })
        .where(eq(creditBalances.userId, team.ownerId));

      // 增加团队池
      await db
        .update(teams)
        .set({ creditPool: team.creditPool + input.amount })
        .where(eq(teams.id, input.teamId));

      await logActivity(
        input.teamId,
        userId,
        "pool_funded",
        undefined,
        `从个人帐户转入 ${input.amount} Credits 到团队池`,
        { amount: input.amount, newPool: team.creditPool + input.amount }
      );

      return { success: true, newPool: team.creditPool + input.amount };
    }),

  // ─── 移除成员 ──────────────────────────────────
  removeMember: protectedProcedure
    .input(z.object({ teamId: z.number(), memberId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const { team } = await requireTeamAdmin(input.teamId, userId);

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const member = await db
        .select()
        .from(teamMembers)
        .where(
          and(eq(teamMembers.id, input.memberId), eq(teamMembers.teamId, input.teamId))
        )
        .limit(1);

      if (member.length === 0) throw new Error("成员不存在");
      if (member[0].role === "owner") throw new Error("无法移除团队拥有者");

      // 回收未使用的 Credits
      const unused = member[0].allocatedCredits - member[0].usedCredits;
      if (unused > 0) {
        await db
          .update(teams)
          .set({ creditAllocated: team.creditAllocated - unused })
          .where(eq(teams.id, input.teamId));
      }

      await db
        .update(teamMembers)
        .set({ status: "removed" })
        .where(eq(teamMembers.id, input.memberId));

      await logActivity(input.teamId, userId, "member_removed", member[0].userId, "成员已被移除");

      return { success: true, reclaimedCredits: unused };
    }),

  // ─── 更改成员角色 ──────────────────────────────
  changeMemberRole: protectedProcedure
    .input(
      z.object({
        teamId: z.number(),
        memberId: z.number(),
        newRole: z.enum(["admin", "member"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      await requireTeamAdmin(input.teamId, userId);

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const member = await db
        .select()
        .from(teamMembers)
        .where(
          and(eq(teamMembers.id, input.memberId), eq(teamMembers.teamId, input.teamId))
        )
        .limit(1);

      if (member.length === 0) throw new Error("成员不存在");
      if (member[0].role === "owner") throw new Error("无法更改拥有者角色");

      await db
        .update(teamMembers)
        .set({ role: input.newRole })
        .where(eq(teamMembers.id, input.memberId));

      await logActivity(
        input.teamId,
        userId,
        "role_changed",
        member[0].userId,
        `角色更改为 ${input.newRole}`
      );

      return { success: true };
    }),

  // ─── 获取团队活动日志 ──────────────────────────
  getActivityLogs: protectedProcedure
    .input(z.object({ teamId: z.number(), limit: z.number().min(1).max(100).default(30) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];

      // 验证是团队成员
      const member = await db
        .select()
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.teamId, input.teamId),
            eq(teamMembers.userId, ctx.user.id),
            eq(teamMembers.status, "active")
          )
        )
        .limit(1);

      const team = await db.select().from(teams).where(eq(teams.id, input.teamId)).limit(1);
      if (member.length === 0 && (team.length === 0 || team[0].ownerId !== ctx.user.id)) {
        throw new Error("您不是此团队的成员");
      }

      const logs = await db
        .select({
          id: teamActivityLogs.id,
          action: teamActivityLogs.action,
          description: teamActivityLogs.description,
          createdAt: teamActivityLogs.createdAt,
          userName: users.name,
          userEmail: users.email,
        })
        .from(teamActivityLogs)
        .leftJoin(users, eq(teamActivityLogs.userId, users.id))
        .where(eq(teamActivityLogs.teamId, input.teamId))
        .orderBy(desc(teamActivityLogs.createdAt))
        .limit(input.limit);

      return logs.map((l) => ({
        ...l,
        createdAt: l.createdAt?.toISOString() ?? null,
      }));
    }),

  // ─── 获取团队使用统计 ──────────────────────────
  getTeamStats: protectedProcedure
    .input(z.object({ teamId: z.number() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      await requireTeamAdmin(input.teamId, userId);

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const team = await db.select().from(teams).where(eq(teams.id, input.teamId)).limit(1);
      if (team.length === 0) throw new Error("团队不存在");

      // 成员用量排行
      const memberUsage = await db
        .select({
          memberId: teamMembers.id,
          userId: teamMembers.userId,
          role: teamMembers.role,
          allocated: teamMembers.allocatedCredits,
          used: teamMembers.usedCredits,
          userName: users.name,
          userEmail: users.email,
        })
        .from(teamMembers)
        .leftJoin(users, eq(teamMembers.userId, users.id))
        .where(
          and(
            eq(teamMembers.teamId, input.teamId),
            eq(teamMembers.status, "active")
          )
        )
        .orderBy(desc(teamMembers.usedCredits));

      // 分配历史
      const allocationHistory = await db
        .select({
          id: teamCreditAllocations.id,
          amount: teamCreditAllocations.amount,
          balanceAfter: teamCreditAllocations.balanceAfter,
          note: teamCreditAllocations.note,
          createdAt: teamCreditAllocations.createdAt,
          allocatorName: users.name,
        })
        .from(teamCreditAllocations)
        .leftJoin(users, eq(teamCreditAllocations.allocatedBy, users.id))
        .where(eq(teamCreditAllocations.teamId, input.teamId))
        .orderBy(desc(teamCreditAllocations.createdAt))
        .limit(50);

      return {
        pool: {
          total: team[0].creditPool,
          allocated: team[0].creditAllocated,
          available: team[0].creditPool - team[0].creditAllocated,
        },
        memberUsage,
        allocationHistory: allocationHistory.map((a) => ({
          ...a,
          createdAt: a.createdAt?.toISOString() ?? null,
        })),
        totalMembers: memberUsage.length,
        totalUsed: memberUsage.reduce((sum, m) => sum + m.used, 0),
      };
    }),

  // ─── 更新团队名称 ─────────────────────────────
  updateTeam: protectedProcedure
    .input(
      z.object({
        teamId: z.number(),
        name: z.string().min(1).max(100).optional(),
        maxMembers: z.number().min(2).max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      await requireTeamAdmin(input.teamId, userId);

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const updates: Record<string, unknown> = {};
      if (input.name) updates.name = input.name;
      if (input.maxMembers) updates.maxMembers = input.maxMembers;

      if (Object.keys(updates).length > 0) {
        await db.update(teams).set(updates).where(eq(teams.id, input.teamId));
      }

      return { success: true };
    }),

  // ─── 获取待处理的邀请 ──────────────────────────
  getMyInvitations: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];

    const invitations = await db
      .select({
        memberId: teamMembers.id,
        teamId: teamMembers.teamId,
        role: teamMembers.role,
        allocatedCredits: teamMembers.allocatedCredits,
        invitedAt: teamMembers.invitedAt,
        teamName: teams.name,
        ownerName: users.name,
      })
      .from(teamMembers)
      .leftJoin(teams, eq(teamMembers.teamId, teams.id))
      .leftJoin(users, eq(teams.ownerId, users.id))
      .where(
        and(
          eq(teamMembers.userId, ctx.user.id),
          eq(teamMembers.status, "invited")
        )
      );

    return invitations.map((inv) => ({
      ...inv,
      invitedAt: inv.invitedAt?.toISOString() ?? null,
    }));
  }),

  // ─── 拒绝邀请 ─────────────────────────────────
  declineInvite: protectedProcedure
    .input(z.object({ teamId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db
        .update(teamMembers)
        .set({ status: "removed" })
        .where(
          and(
            eq(teamMembers.teamId, input.teamId),
            eq(teamMembers.userId, ctx.user.id),
            eq(teamMembers.status, "invited")
          )
        );

      return { success: true };
    }),
});
