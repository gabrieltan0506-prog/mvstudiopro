import { eq } from "drizzle-orm";
import { musicMembershipCredits, users } from "../drizzle/schema";
import { getDb } from "./db";
import { hasUnlimitedAccess } from "./services/access-policy";

export type MusicBillingMode = "free" | "single" | "package" | "admin";

export const SINGLE_MUSIC_CREDIT_COST = 8;
export const PACKAGE_CREDIT_COST = 1;
export const FREE_TRACK_LIMIT = 1;
export const FREE_SECONDS_LIMIT = 180;
export const DEFAULT_TRACK_SECONDS = 120;

type BalanceRow = typeof musicMembershipCredits.$inferSelect;

async function isUnlimitedUser(userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const [user] = await db
    .select({ role: users.role, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return hasUnlimitedAccess({ role: user?.role, email: user?.email });
}

async function getOrCreateMusicMembershipBalance(userId: number): Promise<BalanceRow> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(musicMembershipCredits)
    .where(eq(musicMembershipCredits.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  await db.insert(musicMembershipCredits).values({ userId });

  const created = await db
    .select()
    .from(musicMembershipCredits)
    .where(eq(musicMembershipCredits.userId, userId))
    .limit(1);

  if (created.length === 0) {
    throw new Error("Failed to initialize music membership credits");
  }
  return created[0];
}

export async function getMusicMembershipState(userId: number) {
  if (await isUnlimitedUser(userId)) {
    return {
      mode: "admin" as const,
      musicCredits: 999999,
      packageCredits: 999999,
      freeTrackCount: 0,
      freeSecondsUsed: 0,
      canGenerateFree: true,
      freeTrackRemaining: FREE_TRACK_LIMIT,
      freeSecondsRemaining: FREE_SECONDS_LIMIT,
      canDownload: true,
    };
  }

  const balance = await getOrCreateMusicMembershipBalance(userId);
  const freeTrackRemaining = Math.max(0, FREE_TRACK_LIMIT - balance.freeTrackCount);
  const freeSecondsRemaining = Math.max(0, FREE_SECONDS_LIMIT - balance.freeSecondsUsed);
  const canGenerateFree = freeTrackRemaining > 0 && freeSecondsRemaining > 0;

  let mode: MusicBillingMode = "free";
  if (balance.packageCredits > 0) {
    mode = "package";
  } else if (balance.musicCredits >= SINGLE_MUSIC_CREDIT_COST) {
    mode = "single";
  }

  return {
    mode,
    musicCredits: balance.musicCredits,
    packageCredits: balance.packageCredits,
    freeTrackCount: balance.freeTrackCount,
    freeSecondsUsed: balance.freeSecondsUsed,
    canGenerateFree,
    freeTrackRemaining,
    freeSecondsRemaining,
    canDownload: mode === "single" || mode === "package",
  };
}

export async function consumeMusicGenerationCredit(
  userId: number,
  requestedSeconds: number = DEFAULT_TRACK_SECONDS
): Promise<{ mode: MusicBillingMode; deducted: number }> {
  if (await isUnlimitedUser(userId)) {
    return { mode: "admin", deducted: 0 };
  }

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const normalizedSeconds = Number.isFinite(requestedSeconds) && requestedSeconds > 0
    ? Math.floor(requestedSeconds)
    : DEFAULT_TRACK_SECONDS;

  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(musicMembershipCredits)
      .where(eq(musicMembershipCredits.userId, userId))
      .limit(1);

    let balance = existing[0];
    if (!balance) {
      await tx.insert(musicMembershipCredits).values({ userId });
      const created = await tx
        .select()
        .from(musicMembershipCredits)
        .where(eq(musicMembershipCredits.userId, userId))
        .limit(1);
      balance = created[0];
    }

    if (!balance) {
      throw new Error("Failed to initialize music membership balance");
    }

    if (balance.packageCredits >= PACKAGE_CREDIT_COST) {
      await tx
        .update(musicMembershipCredits)
        .set({ packageCredits: balance.packageCredits - PACKAGE_CREDIT_COST })
        .where(eq(musicMembershipCredits.userId, userId));
      return { mode: "package" as const, deducted: PACKAGE_CREDIT_COST };
    }

    if (balance.musicCredits >= SINGLE_MUSIC_CREDIT_COST) {
      await tx
        .update(musicMembershipCredits)
        .set({ musicCredits: balance.musicCredits - SINGLE_MUSIC_CREDIT_COST })
        .where(eq(musicMembershipCredits.userId, userId));
      return { mode: "single" as const, deducted: SINGLE_MUSIC_CREDIT_COST };
    }

    const nextTrackCount = balance.freeTrackCount + 1;
    const nextSecondsUsed = balance.freeSecondsUsed + normalizedSeconds;
    const withinFreeTrackLimit = nextTrackCount <= FREE_TRACK_LIMIT;
    const withinFreeSecondsLimit = nextSecondsUsed <= FREE_SECONDS_LIMIT;

    if (!withinFreeTrackLimit || !withinFreeSecondsLimit) {
      throw new Error(
        `Music credits exhausted. Need single (${SINGLE_MUSIC_CREDIT_COST}) or package (${PACKAGE_CREDIT_COST}).`
      );
    }

    await tx
      .update(musicMembershipCredits)
      .set({
        freeTrackCount: nextTrackCount,
        freeSecondsUsed: nextSecondsUsed,
      })
      .where(eq(musicMembershipCredits.userId, userId));

    return { mode: "free" as const, deducted: 0 };
  });
}

export function isDownloadAllowedForMode(mode: MusicBillingMode | string | undefined): boolean {
  return mode === "single" || mode === "package" || mode === "admin";
}
